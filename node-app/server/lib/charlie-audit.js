import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-audit.json";
const empty = () => ({ eventos: [] });

function clean(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeValue(value) {
  const json = JSON.stringify(value ?? null, (key, item) => /senha|password|token|secret|credential/i.test(key) ? undefined : item);
  return json ? JSON.parse(json) : null;
}

export function recordCharlieAudit(entry) {
  const state = readJsonConfig(FILE, empty());
  state.eventos.push({
    em: new Date().toISOString(),
    usuario: Number(entry.userId || 0),
    pergunta: clean(entry.pergunta, 500),
    intencao: entry.intencao || null,
    tabelas: [...new Set((entry.tabelas || []).map((item) => String(item).toUpperCase()))].slice(0, 20),
    sql: clean(entry.sql, 4000),
    duracaoMs: Number(entry.duracaoMs || 0),
    registros: Number(entry.registros || 0),
    erro: clean(entry.erro, 300) || null,
    tarefaId: Number(entry.tarefaId || 0) || null,
    operacaoId: clean(entry.operacaoId, 80) || null,
    confirmacao: entry.confirmacao === true,
    origem: clean(entry.origem, 20) || "CHARLIE",
    valores: safeValue(entry.valores),
  });
  state.eventos = state.eventos.slice(-400);
  writeJsonConfig(FILE, state);
}

export function listCharlieAudit(limit = 50) {
  const state = readJsonConfig(FILE, empty());
  return state.eventos.slice(-Math.max(1, Math.min(100, limit))).reverse();
}
