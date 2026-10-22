import crypto from "node:crypto";
import { ACTION_RUNNERS } from "./charlie-task-actions.js";
import { getAction, userCan, validateActionParams } from "./charlie-task-catalog.js";
import { getTask, publicTask, saveTask } from "./charlie-task-store.js";
import { COMPOSITE_STATUS, validateCompositePlan } from "./charlie-composite-plan.js";

const FINISHED = new Set(["concluida", "concluida_parcial"]);
const TERMINAL = new Set(["concluida", "concluida_parcial", "falhou", "cancelada", "bloqueada"]);

function now() { return new Date().toISOString(); }
function sample(rows, limit = 20) { return (rows || []).slice(0, limit); }

function resultFor(task) {
  const view = publicTask(task);
  return {
    resposta: task.resumo,
    intencao: { type: "tarefa_composta", acao: "tarefa.composta", nivel: task.nivel || 2, interpretador: task.interpretador || "regras" },
    dados: view.amostra,
    tarefa: view,
    origem: "banco",
    sugestoes: task.status === "concluida_parcial" || task.status === "falhou" ? ["repetir somente a etapa que falhou"] : [],
  };
}

function inputFor(step, context) {
  const dependencies = step.dependencias || [];
  if (!dependencies.length) return {};
  const outputs = dependencies.map((id) => context.resultados[id]).filter(Boolean);
  const latest = outputs.at(-1) || {};
  return {
    inputRows: latest.linhas || [],
    inputDrafts: latest.rascunhos || [],
    inputPeriod: latest.periodo || null,
    dependencyResults: Object.fromEntries(dependencies.map((id) => [id, context.resultados[id]])),
  };
}

function aggregate(task) {
  const completed = task.etapas.filter((item) => FINISHED.has(item.status));
  const failed = task.etapas.filter((item) => item.status === "falhou");
  const last = [...completed].reverse().find((item) => task.contexto.resultados[item.id]?.linhas);
  const output = last ? task.contexto.resultados[last.id] : {};
  task.linhas = output.linhas || [];
  task.amostra = sample(task.linhas);
  task.rascunhos = output.rascunhos || Object.values(task.contexto.resultados).flatMap((item) => item.rascunhos || []).slice(0, 20);
  task.quantidade = task.linhas.length;
  task.quantidadeConcluida = completed.length;
  task.quantidadeNaoProcessada = task.etapas.length - completed.length;
  task.erros = task.etapas.flatMap((item) => item.erro ? [`${item.nome}: ${item.erro}`] : []);
  if (failed.length) {
    task.status = completed.length ? COMPOSITE_STATUS.CONCLUIDA_PARCIAL : COMPOSITE_STATUS.FALHOU;
    task.resumo = `Concluí ${completed.length} de ${task.etapas.length} etapa(s). Falha em ${failed[0].nome}: ${failed[0].erro}`;
  } else if (completed.length === task.etapas.length) {
    task.status = COMPOSITE_STATUS.CONCLUIDA;
    task.resumo = `Concluí as ${task.etapas.length} etapas de ${task.titulo}.`;
  }
  task.podeCancelar = !TERMINAL.has(task.status);
  task.podeRepetir = Boolean(failed.length);
  task.relatorio = task.formato && task.linhas.length ? {
    nome: task.titulo,
    periodo: output.periodo || null,
    quantidade: task.linhas.length,
    formato: task.formato,
    geradoEm: now(),
    totais: output.totais || null,
  } : null;
  return task;
}

async function execute(task, user, deps) {
  task.status = COMPOSITE_STATUS.VALIDANDO;
  task.podeCancelar = true;
  saveTask(task, deps);
  const checked = validateCompositePlan({ etapas: task.etapas });
  if (!checked.ok) {
    task.status = COMPOSITE_STATUS.FALHOU;
    task.erros = checked.errors;
    task.resumo = checked.errors[0];
    task.podeCancelar = false;
    saveTask(task, deps);
    return resultFor(task);
  }
  task.status = COMPOSITE_STATUS.EXECUTANDO;
  task.execucaoIniciadaEm = now();
  task.execucaoId ||= crypto.randomUUID();
  saveTask(task, deps);

  for (const step of task.etapas) {
    if (getTask(task.id, user.id, deps)?.status === COMPOSITE_STATUS.CANCELADA) return resultFor(getTask(task.id, user.id, deps));
    if (FINISHED.has(step.status)) continue;
    const unmet = (step.dependencias || []).filter((id) => !FINISHED.has(task.etapas.find((item) => item.id === id)?.status));
    if (unmet.length) {
      step.status = "bloqueada";
      step.erro = `Dependência não concluída: ${unmet.join(", ")}.`;
      continue;
    }
    const action = getAction(step.acao);
    const runner = ACTION_RUNNERS[step.acao];
    const validated = action ? validateActionParams(action, step.parametros || {}) : { ok: false, errors: ["Ação inexistente."] };
    if (!action || !runner || !validated.ok || !userCan(action, user, "preparar")) {
      step.status = "falhou";
      step.erro = !action || !runner ? "Ação sem executor autorizado." : !validated.ok ? validated.errors.join(" ") : "Usuário sem permissão para esta ação.";
      step.terminadaEm = now();
      break;
    }
    step.status = "executando";
    step.iniciadaEm = now();
    step.erro = null;
    saveTask(task, deps);
    try {
      const inherited = inputFor(step, task.contexto);
      const outcome = await runner({ ...deps, ...inherited, cancelled: () => getTask(task.id, user.id, deps)?.status === COMPOSITE_STATUS.CANCELADA }, validated.params);
      const current = getTask(task.id, user.id, deps);
      if (current?.status === COMPOSITE_STATUS.CANCELADA) return resultFor(current);
      task.contexto.resultados[step.id] = {
        linhas: outcome.linhas || [], rascunhos: outcome.rascunhos || [], periodo: outcome.periodo || null,
        totais: outcome.totais || null, quantidade: outcome.quantidade ?? outcome.linhas?.length ?? 0,
        resumo: outcome.resumo || "Etapa concluída.",
      };
      step.status = outcome.parcial ? "concluida_parcial" : "concluida";
      step.quantidade = outcome.quantidade ?? outcome.linhas?.length ?? 0;
      step.resultado = { quantidade: step.quantidade, resumo: outcome.resumo || "Etapa concluída." };
      step.terminadaEm = now();
      saveTask(task, deps);
    } catch (error) {
      step.status = "falhou";
      step.erro = error.message || "Falha na execução da etapa.";
      step.terminadaEm = now();
      saveTask(task, deps);
      break;
    }
  }
  aggregate(task);
  saveTask(task, deps);
  return resultFor(task);
}

export async function runCompositeTask(plan, user, deps = {}) {
  const validated = validateCompositePlan(plan);
  const task = saveTask({
    usuario: user.id,
    conversaId: plan.conversaId || null,
    composta: true,
    titulo: plan.titulo,
    operacao: plan.solicitacao,
    solicitacao: plan.solicitacao,
    interpretador: plan.interpretador,
    acao: "tarefa.composta",
    nivel: Math.max(...(plan.etapas || []).map((item) => getAction(item.acao)?.nivel || 1)),
    status: COMPOSITE_STATUS.PLANEJADA,
    parametros: plan.parametros || {},
    plano: { versao: plan.versao || 1, etapas: plan.etapas.map((item) => ({ ...item })) },
    etapas: plan.etapas.map((item) => ({ ...item })),
    contexto: { filtros: plan.parametros || {}, resultados: {} },
    formato: plan.parametros?.formato || null,
    resumo: validated.ok ? "Plano validado. Iniciando as etapas autorizadas." : validated.errors[0],
    erros: validated.errors,
    linhas: [], amostra: [], rascunhos: [], quantidade: 0, quantidadeConcluida: 0,
    confirmacaoNecessaria: false, podeConfirmar: false, podeCancelar: validated.ok, podeRepetir: false,
  }, deps);
  if (!validated.ok || plan.bloqueada) {
    task.status = COMPOSITE_STATUS.FALHOU;
    task.podeCancelar = false;
    saveTask(task, deps);
    return resultFor(task);
  }
  return execute(task, user, deps);
}

export async function retryCompositeTask(taskId, user, deps = {}) {
  const task = getTask(taskId, user.id, deps);
  if (!task?.composta) return { status: 404, body: { ok: false, erro: "Tarefa composta não encontrada." } };
  if (!task.etapas.some((item) => item.status === "falhou" || item.status === "bloqueada"))
    return { status: 409, body: { ok: false, erro: "Não há etapa com falha para repetir." } };
  for (const step of task.etapas) if (step.status === "falhou" || step.status === "bloqueada") {
    step.status = "planejada"; delete step.erro; delete step.iniciadaEm; delete step.terminadaEm;
  }
  task.status = COMPOSITE_STATUS.PLANEJADA;
  task.podeRepetir = false;
  const result = await execute(task, user, deps);
  return { status: 200, body: { ok: true, ...result } };
}
