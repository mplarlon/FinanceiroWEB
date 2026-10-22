import crypto from "node:crypto";
import { ACTION_RUNNERS, aplicarReajuste } from "./charlie-task-actions.js";
import { getAction, userCan, validateActionParams } from "./charlie-task-catalog.js";
import {
  getTask,
  publicTask,
  recoverInterruptedTasks,
  savePreference,
  saveTask,
} from "./charlie-task-store.js";
import { buildCsv, buildExcel, buildPdf, columnsFromRows, fileSlug, normalizeTableExport, summableIndexes } from "./table-export.js";
import { captureAndAudit } from "./charlie-audit-service.js";
import { executeCharlieWrite } from "./charlie-write-services.js";

const OPEN = new Set(["planejada", "validando", "executando", "preparando", "aguardando_informacoes", "aguardando_confirmacao", "em_execucao"]);
const runningExports = new Map();
const runningConfirmations = new Set();

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("A consulta passou do tempo limite e foi interrompida.");
      error.status = 408;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function cancelRunningExport(taskId) {
  const job = runningExports.get(Number(taskId));
  if (!job) return false;
  job.cancelled = true;
  return true;
}

function hashSnapshot(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot || [])).digest("hex").slice(0, 16);
}

function sample(rows) {
  return (rows || []).slice(0, 20);
}

function preferencePatch(params) {
  const patch = {};
  if (params.formato && params.formato !== "nenhum") patch.formato = params.formato;
  if (params.agrupar && params.agrupar !== "nenhum") patch.agrupamento = params.agrupar;
  return patch;
}

function chatResult(task, extra = {}) {
  const view = publicTask(task);
  return {
    resposta: task.resumo,
    intencao: { type: "tarefa", acao: task.acao, nivel: task.nivel, interpretador: task.interpretador || "regras" },
    dados: view.amostra,
    tarefa: view,
    origem: "banco",
    sugestoes: extra.sugestoes || [],
    tabelas: extra.tabelas || [],
  };
}

function baseTask(action, user, plan, params) {
  return {
    usuario: user.id,
    conversaId: plan.conversaId || null,
    intencao: plan.interpretador || "regras",
    interpretador: plan.interpretador || "regras",
    acao: action.id,
    titulo: action.nome,
    operacao: action.descricao,
    nivel: action.nivel,
    parametros: params,
    servico: action.servico,
    confirmacaoNecessaria: false,
    podeConfirmar: false,
    podeCancelar: false,
    quantidade: 0,
    quantidadeConcluida: null,
    quantidadeNaoProcessada: 0,
    erros: [],
    etapas: [],
    amostra: [],
    linhas: [],
    rascunhos: [],
    formato: params.formato && params.formato !== "nenhum" ? params.formato : null,
    confirmacaoExpiraEm: null,
    alertaId: plan.alertaId || null,
    alertaRegra: plan.alertaRegra || null,
    recomendacaoId: plan.recomendacaoId || null,
    evidenciaEm: plan.evidenciaEm || null,
  };
}

export async function runCharlieTask(plan, user, deps) {
  if (!plan) return null;
  if (plan.tipo === "confirmacao_implicita") {
    const task = getTask(plan.tarefaId, user.id, deps);
    const resposta = task
      ? "A confirmação precisa ser feita no botão Confirmar execução. Uma frase na conversa não autoriza a alteração."
      : "Não há tarefa pendente para confirmar.";
    return {
      resposta,
      intencao: { type: "tarefa", acao: task?.acao || null, nivel: task?.nivel || null, interpretador: "contexto" },
      dados: [],
      tarefa: publicTask(task),
      origem: "banco",
      sugestoes: [],
    };
  }
  const action = getAction(plan.acao);
  if (!action) return null;
  if (!action.habilitada || action.nivel >= 4 || plan.bloqueada) {
    const task = saveTask({
      ...baseTask(action, user, plan, {}),
      status: "falhou",
      resumo: plan.motivo || "Essa operação permanece bloqueada e não foi executada.",
      erros: [plan.motivo || "Operação crítica bloqueada."],
      etapas: [{ nome: action.nome, situacao: "bloqueado", quantidade: 0 }],
    }, deps);
    return chatResult(task, { sugestoes: ["consultar títulos vencidos", "faturamento dos últimos seis meses por vendedor"] });
  }
  const validated = validateActionParams(action, plan.parametros || {});
  if (!validated.ok) {
    const task = saveTask({
      ...baseTask(action, user, plan, validated.params),
      status: "aguardando_informacoes",
      resumo: validated.errors[0] || "Faltam informações para continuar.",
      erros: validated.errors,
      podeCancelar: true,
      etapas: [{ nome: "Dados necessários", situacao: "aguardando", quantidade: 0 }],
    }, deps);
    return chatResult(task);
  }
  if (!userCan(action, user, "preparar")) {
    const task = saveTask({
      ...baseTask(action, user, plan, validated.params),
      status: "falhou",
      resumo: "Não tenho permissão para preparar essa alteração. É necessária permissão gerencial.",
      erros: ["Permissão gerencial necessária."],
    }, deps);
    return chatResult(task);
  }
  const runner = ACTION_RUNNERS[action.id];
  if (!runner) {
    const task = saveTask({
      ...baseTask(action, user, plan, validated.params),
      status: "falhou",
      resumo: "Essa ação não possui um serviço executor autorizado.",
      erros: ["Serviço executor ausente."],
    }, deps);
    return chatResult(task);
  }
  const prepared = saveTask({
    ...baseTask(action, user, plan, validated.params),
    status: "em_execucao",
    resumo: "Consultando os dados autorizados.",
    podeCancelar: true,
    etapas: [{ nome: action.nome, situacao: "em_execucao", quantidade: 0 }],
  }, deps);
  try {
    const outcome = await withTimeout(runner({
      ...deps,
      actor: user,
      cancelled: () => getTask(prepared.id, user.id, deps)?.status === "cancelada",
    }, validated.params), deps.timeoutMs || 20000);
    const current = getTask(prepared.id, user.id, deps);
    if (current?.status === "cancelada") return chatResult(current);
    const needsConfirm = action.confirmacao && outcome.quantidadeElegivel !== 0 && (outcome.snapshot || []).length > 0;
    const status = needsConfirm
      ? "aguardando_confirmacao"
      : outcome.parcial
        ? "concluida_parcial"
        : "concluida";
    const canConfirm = needsConfirm && userCan(action, user, "executar");
    const notice = [
      outcome.resumo,
      plan.aviso || "",
      needsConfirm && !canConfirm ? "A prévia está pronta, mas a confirmação exige permissão gerencial." : "",
      needsConfirm && canConfirm ? "Nada foi alterado. Use o botão Confirmar execução se os valores estiverem corretos." : "",
      validated.params.formato && validated.params.formato !== "nenhum" && deps.preferenciaAplicada
        ? `Usei ${validated.params.formato.toUpperCase()}, como nas exportações anteriores.`
        : "",
    ].filter(Boolean).join(" ");
    const formato = validated.params.formato && validated.params.formato !== "nenhum" ? validated.params.formato : null;
    const task = saveTask({
      ...baseTask(action, user, plan, validated.params),
      id: prepared.id,
      criadaEm: prepared.criadaEm,
      status,
      resumo: notice,
      quantidade: outcome.quantidade ?? outcome.linhas?.length ?? 0,
      quantidadeConcluida: needsConfirm ? 0 : outcome.quantidade ?? outcome.linhas?.length ?? 0,
      quantidadeNaoProcessada: outcome.quantidadeNaoProcessada || 0,
      linhas: outcome.linhas || [],
      amostra: sample(outcome.linhas),
      rascunhos: (outcome.rascunhos || []).slice(0, 20),
      snapshot: outcome.snapshot || [],
      snapshotHash: hashSnapshot(outcome.snapshot || []),
      erros: outcome.erros || [],
      etapas: outcome.etapas || [],
      confirmacaoNecessaria: needsConfirm,
      confirmacaoExpiraEm: needsConfirm ? new Date(Date.now() + Number(deps.confirmationTtlMs || 15 * 60 * 1000)).toISOString() : null,
      podeConfirmar: canConfirm,
      podeCancelar: needsConfirm,
      detalhe: outcome.detalhe || null,
      grupo: outcome.grupo || null,
      totalizar: Boolean(outcome.totalizar),
      totais: outcome.totais || null,
      relatorio: outcome.periodo || outcome.totalizar || formato
        ? {
          nome: action.nome,
          periodo: outcome.periodo || null,
          quantidade: outcome.linhas?.length || 0,
          formato,
          geradoEm: new Date().toISOString(),
          totais: outcome.totais || null,
        }
        : null,
    }, deps);
    const patch = preferencePatch(validated.params);
    if (Object.keys(patch).length) savePreference(user.id, patch, deps);
    return chatResult(task);
  } catch (error) {
    const current = getTask(prepared.id, user.id, deps);
    if (current?.status === "cancelada") return chatResult(current);
    const task = saveTask({
      ...baseTask(action, user, plan, validated.params),
      id: prepared.id,
      criadaEm: prepared.criadaEm,
      status: "falhou",
      resumo: error.message || "Não consegui preparar a tarefa.",
      erros: [error.message || "Falha ao preparar a tarefa."],
      quantidadeConcluida: 0,
    }, deps);
    return chatResult(task);
  }
}

export async function confirmCharlieTask(taskId, user, body, deps) {
  const executionKey = `${Number(user?.id || 0)}:${Number(taskId)}`;
  if (runningConfirmations.has(executionKey))
    return { status: 409, body: { ok: false, erro: "Esta tarefa já está em execução." } };
  recoverInterruptedTasks(deps);
  const task = getTask(taskId, user.id, deps);
  if (!task) return { status: 404, body: { ok: false, erro: "Tarefa não encontrada." } };
  if (task.status === "concluida" || task.status === "concluida_parcial")
    return { status: 200, body: { ok: true, jaExecutada: true, ...chatResult(task) } };
  if (task.status === "em_execucao")
    return { status: 409, body: { ok: false, erro: "Esta tarefa já está em execução." } };
  if (task.status !== "aguardando_confirmacao")
    return { status: 409, body: { ok: false, erro: "Esta tarefa não está aguardando confirmação." } };
  if (body?.confirmar !== true)
    return { status: 400, body: { ok: false, erro: "A confirmação precisa ser explícita." } };
  const action = getAction(task.acao);
  if (!action || !userCan(action, user, "executar") || !action.confirmacao || action.nivel >= 4)
    return { status: 403, body: { ok: false, erro: "Sem permissão para executar esta tarefa." } };
  if (!task.confirmacaoExpiraEm || Date.parse(task.confirmacaoExpiraEm) <= Date.now()) {
    task.status = "falhou";
    task.podeConfirmar = false;
    task.resumo = "A confirmação expirou. Gere uma nova prévia para continuar.";
    saveTask(task, deps);
    return { status: 410, body: { ok: false, erro: task.resumo, ...chatResult(task) } };
  }
  if (hashSnapshot(task.snapshot) !== task.snapshotHash)
    return { status: 409, body: { ok: false, erro: "A prévia da tarefa foi alterada. Prepare novamente." } };
  // The lock closes the gap between reading the persisted status and marking the
  // task as running. It prevents two requests handled by this server process from
  // opening two write transactions for the same confirmation.
  runningConfirmations.add(executionKey);
  task.status = "em_execucao";
  task.execucaoIniciadaEm = new Date().toISOString();
  task.podeConfirmar = false;
  saveTask(task, deps);
  try {
    const applied = await deps.withWriteTransaction((tx) => task.acao === "produtos.reajuste_precos"
      ? aplicarReajuste(tx, task.snapshot)
      : executeCharlieWrite(tx, task, deps.writeServices));
    task.status = task.quantidadeNaoProcessada ? "concluida_parcial" : "concluida";
    task.quantidadeConcluida = applied.quantidadeConcluida;
    task.execucaoId = crypto.randomUUID();
    task.servico = applied.servico;
    task.confirmacao = { em: new Date().toISOString(), usuario: Number(user.id || 0) };
    task.resumo = task.acao === "produtos.reajuste_precos"
      ? `Atualizei ${applied.quantidadeConcluida} preço(s). ${task.quantidadeNaoProcessada ? `${task.quantidadeNaoProcessada} ficaram de fora da prévia.` : ""}`.trim()
      : `Operação concluída pelo serviço do ERP${applied.codigo != null ? ` (código ${applied.codigo})` : ""}.`;
    task.etapas = [...(task.etapas || []), { nome: action.nome, situacao: "concluida", quantidade: applied.quantidadeConcluida }];
    task.podeCancelar = false;
    saveTask(task, deps);
    if (task.acao === "produtos.reajuste_precos") {
      for (const item of task.snapshot || []) captureAndAudit({
        type: "price_change", operation: "update", entity: "PRODUTOPRECO",
        recordId: `${item.produto}:${item.tabela}:${item.unidade}`,
        actor: { id: user.id, name: user.name }, company: user.company || null, branch: user.branch || null,
        origin: "CHARLIE_TASK", correlationId: task.execucaoId,
        previous: { price: item.anterior }, next: { price: item.novo, cost: item.custo, ...(item.descricao && item.descricao !== "Não informado" ? { productName: item.descricao } : {}) },
        changedFields: ["PRECO"], justification: task.solicitacao || null,
        authorization: { id: task.id, type: "confirmacao_explicita" },
      });
    }
    return { status: 200, body: { ok: true, ...chatResult(task) } };
  } catch (error) {
    task.status = "falhou";
    task.quantidadeConcluida = 0;
    task.quantidadeNaoProcessada = task.snapshot?.length || task.quantidade || 0;
    task.erros = [...(task.erros || []), error.message || "Falha na execução."];
    task.resumo = error.message || "Não consegui concluir a atualização.";
    task.podeCancelar = false;
    task.etapas = [...(task.etapas || []), { nome: "Atualização de preços", situacao: "falhou", quantidade: 0 }];
    saveTask(task, deps);
    return { status: error.status || 409, body: { ok: false, erro: task.resumo, ...chatResult(task) } };
  } finally {
    runningConfirmations.delete(executionKey);
  }
}

export function cancelCharlieTask(taskId, user, deps) {
  const task = getTask(taskId, user.id, deps);
  if (!task) return { status: 404, body: { ok: false, erro: "Tarefa não encontrada." } };
  if (cancelRunningExport(task.id)) {
    return {
      status: 200,
      body: { ok: true, ...chatResult({ ...task, resumo: "Cancelei a exportação em andamento. Nenhum dado do ERP foi alterado." }) },
    };
  }
  if (!OPEN.has(task.status))
    return { status: 409, body: { ok: false, erro: "Esta tarefa não pode mais ser cancelada." } };
  task.status = "cancelada";
  task.podeConfirmar = false;
  task.podeCancelar = false;
  task.resumo = "Cancelei a tarefa antes de alterar qualquer registro.";
  task.etapas = [...(task.etapas || []), { nome: "Cancelamento", situacao: "cancelada", quantidade: 0 }];
  saveTask(task, deps);
  return { status: 200, body: { ok: true, ...chatResult(task) } };
}

const MONEY_KEYS = new Set(["TOTAL", "SALDO", "CUSTO", "DIFERENCA", "PRECO", "PRECO_A", "PRECO_B"]);

function indicatorText(totais) {
  return Object.entries(totais || {})
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => {
      const shown = MONEY_KEYS.has(key)
        ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      return `${key.replaceAll("_", " ")} ${shown}`;
    })
    .join(" · ");
}

function stampTable(table, task, columns) {
  table.periodo = task.relatorio?.periodo || "";
  table.geradoEm = task.relatorio?.geradoEm ? new Date(task.relatorio.geradoEm).toLocaleString("pt-BR") : "";
  table.totalizar = Boolean(task.totalizar);
  table.somar = summableIndexes(columns);
  table.indicadores = indicatorText(task.totais);
  if (task.grupo) {
    const index = columns.findIndex((column) => column.chave === task.grupo);
    if (index >= 0) table.grupo = index;
  }
  return table;
}

function sheetFor(rows, title, name, task) {
  const columns = columnsFromRows(rows);
  const table = normalizeTableExport({
    formato: "excel",
    titulo: title,
    colunas: columns,
    linhas: rows,
  });
  table.name = name;
  return stampTable(table, task, columns);
}

export async function exportCharlieTask(taskId, user, formato, deps) {
  const task = getTask(taskId, user.id, deps);
  if (!task) return { status: 404, body: { ok: false, erro: "Tarefa não encontrada." } };
  const rows = task.linhas || [];
  if (!rows.length) return { status: 409, body: { ok: false, erro: "Esta tarefa não tem dados para exportar." } };
  const requested = String(formato || task.formato || "excel").toLowerCase();
  if (!["excel", "pdf", "csv"].includes(requested))
    return { status: 400, body: { ok: false, erro: "Escolha Excel, PDF ou CSV." } };
  const job = { cancelled: false };
  runningExports.set(task.id, job);
  try {
    if (deps.beforeBuild) await deps.beforeBuild();
    if (job.cancelled) return { status: 499, body: { ok: false, erro: "Exportação cancelada." } };
    const table = sheetFor(rows, task.relatorio?.nome || task.titulo, "Resumo", task);
    if (requested === "excel" && task.detalhe?.length) {
      const detalhe = sheetFor(task.detalhe, `${task.titulo} — detalhe`, "Detalhe", { ...task, grupo: "PESSOA", totalizar: true });
      table.abas = [{ ...table, abas: undefined, name: "Resumo" }, detalhe];
    }
    const options = { shouldStop: () => job.cancelled };
    const buffer = requested === "pdf"
      ? await buildPdf(table)
      : requested === "csv"
        ? buildCsv(table)
        : await buildExcel(table, options);
    task.exportacoes = [...(task.exportacoes || []), {
      em: new Date().toISOString(),
      formato: requested,
      usuario: Number(user.id || 0),
      quantidade: rows.length,
    }].slice(-30);
    saveTask(task, deps);
    const extension = requested === "pdf" ? "pdf" : requested === "csv" ? "csv" : "xlsx";
    const type = requested === "pdf"
      ? "application/pdf"
      : requested === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return { status: 200, buffer, type, filename: `${fileSlug(task.titulo)}-${task.id}.${extension}`, quantidade: rows.length };
  } catch (error) {
    if (error.status === 499 || job.cancelled)
      return { status: 499, body: { ok: false, erro: "Exportação cancelada." } };
    throw error;
  } finally {
    runningExports.delete(task.id);
  }
}
