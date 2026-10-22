import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { DEFAULT_SETTINGS } from "./charlie-breakfast-engine.js";

const SETTINGS = "charlie-breakfast-config.json";
const RUNS = "charlie-breakfast-runs.json";
const ALERTS = "charlie-breakfast-alerts.json";
const LINKS = "charlie-breakfast-links.json";
const STATE = "charlie-breakfast-state.json";
const SELLER_SENDS = "charlie-breakfast-seller-sends.json";
const EXPENSES = "charlie-breakfast-despesas.json";
const OPEN = new Set(["novo", "visualizado", "em_tratamento"]);
const STATUS = new Set(["novo", "visualizado", "em_tratamento", "resolvido", "ignorado"]);

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
const time = (value, fallback) => /^\d{2}:\d{2}$/.test(String(value || "")) ? String(value).slice(0, 5) : fallback;
const list = (value) => String(value || "").split(/[;,\s]+/).map((item) => item.trim()).filter(Boolean);

export function readSettings() {
  const saved = readJsonConfig(SETTINGS, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    canais: { ...DEFAULT_SETTINGS.canais, ...saved.canais },
    indicadores: { ...DEFAULT_SETTINGS.indicadores, ...saved.indicadores },
    limites: { ...DEFAULT_SETTINGS.limites, ...saved.limites },
    metas: { ...DEFAULT_SETTINGS.metas, ...saved.metas, vendedores: { ...DEFAULT_SETTINGS.metas.vendedores, ...saved.metas?.vendedores }, filiais: { ...DEFAULT_SETTINGS.metas.filiais, ...saved.metas?.filiais }, equipes: { ...DEFAULT_SETTINGS.metas.equipes, ...saved.metas?.equipes } },
    notificacaoIndividual: { ...DEFAULT_SETTINGS.notificacaoIndividual, ...saved.notificacaoIndividual },
    campanhas: { ...DEFAULT_SETTINGS.campanhas, ...saved.campanhas },
    weekdays: Array.isArray(saved.weekdays) && saved.weekdays.length ? saved.weekdays.map(Number).filter((item) => item >= 0 && item <= 6) : DEFAULT_SETTINGS.weekdays,
  };
}

export function saveSettings(input = {}) {
  const current = readSettings();
  const limites = { ...current.limites };
  for (const [key, min, max] of [
    ["valorPrioridade", 0, 1e12], ["margemMinima", 0, 100], ["semGiroDias", 1, 365], ["coberturaRiscoDias", 1, 180],
    ["acompanhamentoHoras", 1, 24 * 90], ["quedaVendas", 1, 100], ["baixaAtipica", 0, 1e9], ["reposicaoDias", 1, 180],
    ["variacaoMinima", 0, 100], ["clienteInativoDias", 1, 730],
  ]) if (key in (input.limites || {})) limites[key] = clamp(input.limites[key], min, max, limites[key]);
  const next = {
    ...current,
    enabled: "enabled" in input ? Boolean(input.enabled) : current.enabled,
    time: time(input.time, current.time),
    weekdays: Array.isArray(input.weekdays) ? input.weekdays.map(Number).filter((item) => item >= 0 && item <= 6) : current.weekdays,
    emails: "emails" in input ? list(input.emails).join("; ") : current.emails,
    whatsapp: "whatsapp" in input ? list(input.whatsapp).map((item) => item.replace(/\D/g, "")).filter(Boolean).join("; ") : current.whatsapp,
    empresas: Array.isArray(input.empresas) ? input.empresas.map(Number).filter((item) => item > 0) : current.empresas,
    canais: { ...current.canais, ...input.canais },
    formato: input.formato === "resumido" ? "resumido" : input.formato ? "completo" : current.formato,
    enviarReal: "enviarReal" in input ? Boolean(input.enviarReal) : current.enviarReal,
    templateWhatsapp: "templateWhatsapp" in input ? String(input.templateWhatsapp || "").trim().slice(0, 120) : current.templateWhatsapp,
    templateIdioma: "templateIdioma" in input ? String(input.templateIdioma || "pt_BR").trim().slice(0, 12) || "pt_BR" : current.templateIdioma || "pt_BR",
    templateVariaveis: "templateVariaveis" in input ? Boolean(input.templateVariaveis) : current.templateVariaveis !== false,
    linkHoras: "linkHoras" in input ? clamp(input.linkHoras, 1, 24 * 30, current.linkHoras) : current.linkHoras,
    indicadores: { ...current.indicadores, ...input.indicadores },
    limites,
    metas: {
      ...current.metas,
      ...input.metas,
      vendedores: { ...current.metas.vendedores, ...input.metas?.vendedores },
      filiais: { ...current.metas.filiais, ...input.metas?.filiais },
      equipes: { ...current.metas.equipes, ...input.metas?.equipes },
    },
    notificacaoIndividual: { ...current.notificacaoIndividual, ...input.notificacaoIndividual, inicio: time(input.notificacaoIndividual?.inicio, current.notificacaoIndividual.inicio), fim: time(input.notificacaoIndividual?.fim, current.notificacaoIndividual.fim) },
    campanhas: { ...current.campanhas, ...input.campanhas },
    baseUrl: "baseUrl" in input ? String(input.baseUrl || "").trim().slice(0, 200) : current.baseUrl,
    vendedores: Array.isArray(input.vendedores) ? input.vendedores.map((item) => ({
      id: Number(item.id),
      nome: String(item.nome || "").slice(0, 80),
      telefone: String(item.telefone || "").replace(/\D/g, "").slice(0, 15),
      consentimento: Boolean(item.consentimento),
      ativo: Boolean(item.ativo),
    })).filter((item) => item.id > 0) : current.vendedores || [],
  };
  if (!next.weekdays.length) next.weekdays = [0, 1, 2, 3, 4, 5, 6];
  writeJsonConfig(SETTINGS, next);
  return next;
}

export function readState() { return readJsonConfig(STATE, {}); }
export function saveState(state) { writeJsonConfig(STATE, state); return state; }

export function readRuns() { return readJsonConfig(RUNS, []); }
export function saveRun(run) {
  const runs = readRuns();
  const next = [{ ...run, id: run.id || crypto.randomUUID() }, ...runs.filter((item) => item.id !== run.id)].slice(0, 90);
  writeJsonConfig(RUNS, next);
  return next[0];
}

export function readAlerts() { return readJsonConfig(ALERTS, []); }
export function upsertAlerts(incoming, companyId = null) {
  const current = readAlerts();
  const kept = [];
  for (const alert of incoming || []) {
    const previous = current.find((item) => item.chave === alert.chave && (companyId == null || item.empresa == null || Number(item.empresa) === Number(companyId)));
    if (previous && OPEN.has(previous.status)) {
      kept.push({ ...previous, titulo: alert.titulo || previous.titulo || "", contexto: alert.contexto || previous.contexto || "", descricao: alert.descricao, indicadores: alert.indicadores, acao: alert.acao, severidade: alert.severidade, atualizadoEm: new Date().toISOString() });
    } else if (!previous || !OPEN.has(previous.status)) {
      kept.push({ ...alert, id: crypto.randomUUID(), criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() });
    }
  }
  const keys = new Set(kept.map((item) => item.chave));
  const merged = [...kept, ...current.filter((item) => !keys.has(item.chave))].slice(0, 500);
  writeJsonConfig(ALERTS, merged);
  return merged;
}

export function updateAlert(id, patch, user) {
  const alerts = readAlerts();
  const alert = alerts.find((item) => item.id === id);
  if (!alert) {
    const error = new Error("Alerta não encontrado.");
    error.status = 404;
    throw error;
  }
  if (patch.status && !STATUS.has(patch.status)) {
    const error = new Error("Situação inválida.");
    error.status = 400;
    throw error;
  }
  if (patch.status === "ignorado" && !String(patch.motivo || "").trim()) {
    const error = new Error("Informe o motivo para ignorar o alerta.");
    error.status = 400;
    throw error;
  }
  alert.status = patch.status || alert.status;
  alert.motivo = patch.motivo ? String(patch.motivo).slice(0, 300) : alert.motivo;
  alert.responsavel = patch.responsavel ? String(patch.responsavel).slice(0, 80) : alert.responsavel || user?.nome || "";
  alert.atualizadoEm = new Date().toISOString();
  alert.historico = [...(alert.historico || []), { em: alert.atualizadoEm, status: alert.status, usuario: user?.login || user?.nome || "" }];
  writeJsonConfig(ALERTS, alerts);
  return alert;
}

export function rememberLink(reportId, hours) {
  const links = readJsonConfig(LINKS, []);
  const link = { token: crypto.randomBytes(24).toString("hex"), reportId, expiraEm: new Date(Date.now() + hours * 3600000).toISOString() };
  writeJsonConfig(LINKS, [link, ...links].slice(0, 200));
  return link;
}

export function readLink(token) {
  const link = readJsonConfig(LINKS, []).find((item) => item.token === token);
  if (!link) return null;
  if (Date.parse(link.expiraEm) < Date.now()) return { ...link, expirado: true };
  return link;
}

export function rememberSellerSend(key) {
  const sent = readJsonConfig(SELLER_SENDS, {});
  if (sent[key]) return false;
  sent[key] = new Date().toISOString();
  const entries = Object.entries(sent).slice(-400);
  writeJsonConfig(SELLER_SENDS, Object.fromEntries(entries));
  return true;
}

export function expenseKey(text) {
  return String(text || "").trim().toLowerCase().slice(0, 180);
}

export function readExpenseClasses() {
  return readJsonConfig(EXPENSES, {});
}

export function saveExpenseClass(historico, classe, user) {
  const key = expenseKey(historico);
  const name = String(classe || "").trim().slice(0, 40);
  if (!key || !name) {
    const error = new Error("Informe o histórico e a classificação.");
    error.status = 400;
    throw error;
  }
  const all = readExpenseClasses();
  all[key] = { classe: name, confirmada: true, por: user?.nome || user?.login || "", em: new Date().toISOString() };
  writeJsonConfig(EXPENSES, all);
  return all[key];
}
