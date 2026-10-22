import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-tasks.json";
const SENSITIVE = /senha|password|token|secret|credential|autorizacao/i;

export function emptyTaskState() {
  return { nextId: 1, tarefas: [], contextos: {}, preferencias: {} };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function load(deps = {}) {
  if (deps.store) return deps.store.state;
  return readJsonConfig(FILE, emptyTaskState());
}

function persist(deps, state) {
  if (deps.store) {
    deps.store.state = state;
    return state;
  }
  writeJsonConfig(FILE, state);
  return state;
}

export function createMemoryStore(initial = emptyTaskState()) {
  return { state: clone(initial) };
}

export function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE.test(key)) continue;
    next[key] = stripSensitive(item);
  }
  return next;
}

function contextKey(userId, conversationId) {
  return `${Number(userId || 0)}:${Number(conversationId || 0)}`;
}

export function getPreference(userId, deps) {
  const state = load(deps);
  return state.preferencias[String(Number(userId || 0))] || null;
}

export function savePreference(userId, patch, deps) {
  const state = load(deps);
  const key = String(Number(userId || 0));
  const current = state.preferencias[key] || {};
  const next = stripSensitive({ ...current, ...patch, atualizadoEm: new Date().toISOString() });
  delete next.confirmacao;
  delete next.autorizado;
  state.preferencias[key] = next;
  persist(deps, state);
  return next;
}

export function getConversationTask(userId, conversationId, deps) {
  if (!conversationId) return null;
  const state = load(deps);
  const taskId = state.contextos[contextKey(userId, conversationId)];
  return state.tarefas.find((item) => item.id === taskId && item.usuario === Number(userId || 0)) || null;
}

export function getTask(taskId, userId, deps) {
  const state = load(deps);
  return state.tarefas.find((item) => item.id === Number(taskId) && item.usuario === Number(userId || 0)) || null;
}

export function listTasks(userId, limit = 30, deps) {
  const state = load(deps);
  return state.tarefas
    .filter((item) => item.usuario === Number(userId || 0))
    .slice(-Math.max(1, Math.min(100, limit)))
    .reverse()
    .map(publicTask);
}

export function findAlertTask(alertId, recommendationId, userId, deps) {
  const state = load(deps);
  return [...state.tarefas].reverse().find((item) =>
    item.usuario === Number(userId || 0)
    && item.alertaId === Number(alertId)
    && item.recomendacaoId === recommendationId
    && !["falhou", "cancelada"].includes(item.status));
}

export function saveTask(task, deps) {
  const state = load(deps);
  const now = new Date().toISOString();
  const stored = stripSensitive({
    ...task,
    id: task.id || state.nextId++,
    usuario: Number(task.usuario || 0),
    criadaEm: task.criadaEm || now,
    atualizadaEm: now,
  });
  const index = state.tarefas.findIndex((item) => item.id === stored.id);
  if (index >= 0) state.tarefas[index] = stored;
  else state.tarefas.push(stored);
  state.tarefas = state.tarefas.slice(-400);
  if (stored.conversaId)
    state.contextos[contextKey(stored.usuario, stored.conversaId)] = stored.id;
  persist(deps, state);
  return stored;
}

export function attachTaskConversation(taskId, userId, conversationId, deps) {
  const task = getTask(taskId, userId, deps);
  if (!task || !conversationId) return task;
  task.conversaId = Number(conversationId);
  return saveTask(task, deps);
}

export function recoverInterruptedTasks(deps, now = Date.now(), maxAgeMs = 120000) {
  const state = load(deps);
  let changed = false;
  for (const task of state.tarefas) {
    if (task.status !== "em_execucao" && task.status !== "executando" && task.status !== "validando") continue;
    const started = Date.parse(task.execucaoIniciadaEm || 0);
    if (!Number.isFinite(started) || now - started < maxAgeMs) continue;
    task.status = task.composta ? "falhou" : "resultado_indeterminado";
    task.quantidadeConcluida = task.composta
      ? (task.etapas || []).filter((item) => item.status === "concluida" || item.status === "concluida_parcial").length
      : 0;
    const recovery = task.composta
      ? "A execução foi interrompida. As etapas já concluídas foram preservadas; repita somente a etapa pendente após validar os dados."
      : "A comunicação foi interrompida durante a execução. O resultado é indeterminado: confira o ERP e a auditoria antes de preparar uma nova operação; a tarefa não será repetida automaticamente.";
    task.erros = [...(task.erros || []), recovery];
    task.podeRepetir = Boolean(task.composta);
    task.atualizadaEm = new Date(now).toISOString();
    changed = true;
  }
  if (changed) persist(deps, state);
  return state.tarefas.filter((item) => item.status === "falhou");
}

export function publicTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    conversaId: task.conversaId || null,
    status: task.status,
    titulo: task.titulo,
    operacao: task.operacao,
    acao: task.acao,
    nivel: task.nivel,
    resumo: task.resumo,
    quantidade: task.quantidade || 0,
    quantidadeConcluida: task.quantidadeConcluida ?? null,
    quantidadeNaoProcessada: task.quantidadeNaoProcessada || 0,
    amostra: task.amostra || [],
    rascunhos: task.rascunhos || [],
    erros: task.erros || [],
    etapas: task.etapas || [],
    formato: task.formato || null,
    confirmacaoNecessaria: Boolean(task.confirmacaoNecessaria),
    podeConfirmar: Boolean(task.podeConfirmar),
    podeCancelar: Boolean(task.podeCancelar),
    confirmacao: task.confirmacao || null,
    confirmacaoExpiraEm: task.confirmacaoExpiraEm || null,
    servico: task.servico || null,
    execucaoId: task.execucaoId || null,
    composta: Boolean(task.composta),
    podeRepetir: Boolean(task.podeRepetir),
    progresso: task.composta ? {
      concluidas: (task.etapas || []).filter((item) => item.status === "concluida" || item.status === "concluida_parcial").length,
      total: (task.etapas || []).length,
    } : null,
    criadaEm: task.criadaEm,
    atualizadaEm: task.atualizadaEm,
    temPlanilha: Boolean(task.linhas?.length),
    relatorio: task.relatorio || null,
    exportacoes: Array.isArray(task.exportacoes) ? task.exportacoes.length : 0,
    alertaId: task.alertaId || null,
    recomendacaoId: task.recomendacaoId || null,
    verificacao: task.verificacao || null,
  };
}
