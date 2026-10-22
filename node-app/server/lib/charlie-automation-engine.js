import crypto from "node:crypto";
import { getAction, userCan } from "./charlie-task-catalog.js";
import { runCharlieTask } from "./charlie-task-engine.js";
import { runCompositeTask } from "./charlie-composite-engine.js";
import { nextExecution } from "./charlie-automation-plan.js";
import { cashRiskConditionMet } from "./charlie-executive-engine.js";
import {
  addAutomationExecution,
  getAutomation,
  hasExecutionKey,
  listDueAutomations,
  listAutomationExecutions,
  saveAutomation,
} from "./charlie-automation-store.js";

function slotKey(item, scheduledAt) {
  return crypto.createHash("sha256").update(`${item.id}:${scheduledAt}:${item.versao}`).digest("hex");
}

function actorFor(item, deps) {
  return deps.resolveUser ? deps.resolveUser(item.criadaPor) : { id: item.criadaPor, gerencial: false, ativo: true };
}

function conditionSatisfied(condition, task) {
  if (!condition) return true;
  const rows = task?.amostra || [];
  if (condition.tipo === "soma_maior_que") {
    const total = rows.reduce((sum, row) => {
      const key = condition.campos.find((field) => Number.isFinite(Number(row?.[field])));
      return sum + (key ? Number(row[key]) : 0);
    }, 0);
    return total > Number(condition.valor);
  }
  if (condition.tipo === "variacao_menor_que")
    return rows.some((row) => condition.campos.some((field) => Number(row?.[field]) < Number(condition.valor)));
  if (condition.tipo === "projecao_caixa_negativa") return cashRiskConditionMet(task);
  return Number(task?.quantidade || 0) > 0;
}

export async function executeAutomation(idOrItem, deps = {}, options = {}) {
  const item = typeof idOrItem === "object" ? idOrItem : getAutomation(idOrItem, deps);
  if (!item) throw Object.assign(new Error("Automação não encontrada."), { status: 404 });
  const actor = await actorFor(item, deps);
  const action = item.acao ? getAction(item.acao) : null;
  if (!actor?.ativo || (!item.planoComposto && (!action || !userCan(action, actor, "preparar")))) {
    const stopped = saveAutomation({ ...item, status: "pausada", ultimaFalha: "Responsável inativo ou sem a permissão necessária.", atualizadaPor: 0 }, deps);
    addAutomationExecution(item.id, { status: "bloqueada", erro: stopped.ultimaFalha }, deps);
    return { status: "bloqueada", automacao: stopped };
  }
  const scheduledAt = options.scheduledAt || item.proximaExecucao || new Date().toISOString();
  const key = slotKey(item, scheduledAt);
  if (!options.manual && hasExecutionKey(key, deps)) return { status: "duplicada", automacao: item };
  if (!options.manual && item.modalidade === "condicional" && item.repeticaoAlertaMinutos) {
    const last = listAutomationExecutions(item.id, deps).find((entry) => entry.status === "concluida");
    const cooldown = Number(item.repeticaoAlertaMinutos) * 60000;
    if (last && Date.now() - Date.parse(last.fimEm || last.criadaEm) < cooldown) {
      addAutomationExecution(item.id, { status: "ignorada", agendadaPara: scheduledAt, resultado: "Ocorrência já comunicada dentro do intervalo mínimo." }, deps);
      const updated = saveAutomation({ ...item, proximaExecucao: nextExecution(item.agenda, new Date(), item.fusoHorario), atualizadaPor: 0 }, deps);
      return { status: "ignorada", automacao: updated };
    }
  }
  const execution = addAutomationExecution(item.id, {
    status: "executando", inicioEm: new Date().toISOString(), chaveIdempotencia: key,
    agendadaPara: scheduledAt, manual: Boolean(options.manual), usuario: actor.id,
  }, deps);
  try {
    const plan = item.planoComposto || { tipo: "executar", acao: item.acao, parametros: item.parametros || {}, interpretador: "automacao" };
    const taskDeps = { ...deps, store: deps.taskStore };
    const result = item.planoComposto
      ? await runCompositeTask(plan, actor, taskDeps)
      : await runCharlieTask(plan, actor, taskDeps);
    const task = result?.tarefa;
    const conditionalEmpty = item.modalidade === "condicional" && !conditionSatisfied(item.condicao, task);
    const status = conditionalEmpty ? "ignorada" : task?.status === "falhou" ? "falhou" : "concluida";
    addAutomationExecution(item.id, {
      ...execution, status, fimEm: new Date().toISOString(), tarefaId: task?.id || null,
      resultado: conditionalEmpty ? "Condição não atendida." : result?.resposta || "Execução concluída.",
      aguardandoAprovacao: task?.status === "aguardando_confirmacao",
    }, deps);
    const next = nextExecution(item.agenda, new Date(Math.max(Date.now(), Date.parse(scheduledAt) || 0)), item.fusoHorario);
    const updated = saveAutomation({
      ...item,
      status: status === "falhou" ? "falhou" : "ativa",
      ultimaExecucao: new Date().toISOString(),
      proximaExecucao: next,
      ultimaTarefaId: task?.id || null,
      falhasConsecutivas: status === "falhou" ? Number(item.falhasConsecutivas || 0) + 1 : 0,
      atualizadaPor: 0,
    }, deps);
    return { status, automacao: updated, tarefa: task, resposta: result?.resposta };
  } catch (error) {
    addAutomationExecution(item.id, { ...execution, status: "falhou", fimEm: new Date().toISOString(), erro: String(error.message || error).slice(0, 500) }, deps);
    const failures = Number(item.falhasConsecutivas || 0) + 1;
    const updated = saveAutomation({
      ...item, status: failures >= 3 ? "pausada" : "falhou", falhasConsecutivas: failures,
      ultimaFalha: String(error.message || error).slice(0, 500),
      proximaExecucao: nextExecution(item.agenda, new Date(), item.fusoHorario), atualizadaPor: 0,
    }, deps);
    return { status: "falhou", automacao: updated, erro: updated.ultimaFalha };
  }
}

export async function runDueAutomations(deps = {}, options = {}) {
  const due = listDueAutomations(options.now || Date.now(), deps);
  const concurrency = Math.max(1, Math.min(10, Number(options.concurrency || 2)));
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < due.length) {
      const item = due[cursor++];
      results.push(await executeAutomation(item, deps, { scheduledAt: item.proximaExecucao }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
  return results;
}
