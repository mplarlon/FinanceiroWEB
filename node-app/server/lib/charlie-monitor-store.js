import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../config.js";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { normalizeMonitorSettings } from "./charlie-monitor-rules.js";

const SETTINGS_FILE = "charlie-monitor.json";
const ALERTS_FILE = "charlie-alerts.json";
const LOG_FILE = "charlie-monitor-log.json";
const OPEN = new Set(["novo", "visualizado", "em_analise", "acao_preparada", "aguardando_confirmacao", "em_tratamento", "nao_resolvido"]);
const CLOSED = new Set(["resolvido", "descartado"]);

const emptyAlerts = () => ({ alertas: [], lacunas: [], anterior: {} });
const emptyLog = () => ({ execucoes: [] });

export function readMonitorSettings() {
  return normalizeMonitorSettings(readJsonConfig(SETTINGS_FILE, {}));
}

export function saveMonitorSettings(input, userId) {
  const next = normalizeMonitorSettings({ ...readMonitorSettings(), ...input, limites: { ...readMonitorSettings().limites, ...(input.limites || {}) }, monitores: { ...readMonitorSettings().monitores, ...(input.monitores || {}) } });
  writeJsonConfig(SETTINGS_FILE, { ...next, atualizadoEm: new Date().toISOString(), atualizadoPor: Number(userId || 0) });
  return readMonitorSettings();
}

function readAlerts() {
  const state = readJsonConfig(ALERTS_FILE, emptyAlerts());
  return { alertas: state.alertas || [], lacunas: state.lacunas || [], anterior: state.anterior || {} };
}

function writeAlerts(state) {
  writeJsonConfig(ALERTS_FILE, state);
  return state;
}

export function listMonitorAlerts() {
  return readAlerts().alertas;
}

export function readMonitorSnapshot() {
  return readAlerts().anterior || {};
}

export function userCanSeeCategory(settings, userId) {
  const notified = settings.notificados || [];
  if (!notified.length) return true;
  return notified.includes(Number(userId));
}

export function visibleMonitorAlerts(userId, { situacao, categoria } = {}) {
  const settings = readMonitorSettings();
  if (!userCanSeeCategory(settings, userId)) return [];
  return listMonitorAlerts().filter((item) => {
    if (!settings.categorias.includes(item.categoria)) return false;
    if (situacao && item.situacao !== situacao) return false;
    if (categoria && item.categoria !== categoria) return false;
    return true;
  });
}

export function attentionCount(userId) {
  return visibleMonitorAlerts(userId).filter((item) => OPEN.has(item.situacao)).length;
}

export function reduceMonitorAlerts(alerts, findings, evaluated, now = new Date().toISOString(), settings = readMonitorSettings()) {
  const next = (alerts || []).map((item) => ({ ...item, historico: [...(item.historico || [])], retornos: [...(item.retornos || [])] }));
  const evaluatedSet = new Set(evaluated || []);
  const seen = new Set();
  for (const finding of findings || []) {
    seen.add(finding.regra);
    const current = next.find((item) => item.regra === finding.regra && OPEN.has(item.situacao));
    if (current) {
      const changed = current.descricao !== finding.descricao;
      Object.assign(current, publicFields(finding), { atualizadoEm: now, vistoEm: now, ia: changed ? "pendente" : current.ia, narrativa: changed ? null : current.narrativa });
      continue;
    }
    const previous = [...next].reverse().find((item) => item.regra === finding.regra && CLOSED.has(item.situacao));
    if (previous?.situacao === "descartado" && !settings.reabrirDescartados) continue;
    if (previous) {
      previous.historico.push({ em: now, de: previous.situacao, para: "novo", motivo: "reincidencia" });
      Object.assign(previous, publicFields(finding), {
        situacao: "novo",
        atualizadoEm: now,
        vistoEm: now,
        resolvidoEm: null,
        motivoDescarte: previous.motivoDescarte || "",
        reincidencias: Number(previous.reincidencias || 0) + 1,
        ia: "pendente",
        narrativa: null,
      });
      continue;
    }
    next.push({
      id: next.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
      ...publicFields(finding),
      situacao: "novo",
      criadoEm: now,
      atualizadoEm: now,
      vistoEm: now,
      resolvidoEm: null,
      reincidencias: 0,
      motivoDescarte: "",
      historico: [{ em: now, de: null, para: "novo", motivo: "identificado" }],
      retornos: [],
      ia: "pendente",
      narrativa: null,
    });
  }
  for (const item of next) {
    if (!OPEN.has(item.situacao) || seen.has(item.regra) || !evaluatedSet.has(item.regra)) continue;
    item.historico.push({ em: now, de: item.situacao, para: "resolvido", motivo: "condicao_encerrada" });
    item.situacao = "resolvido";
    item.resolvidoEm = now;
    item.atualizadoEm = now;
    item.tempoResolucaoMs = Math.max(0, Date.parse(now) - Date.parse(item.criadoEm || now));
  }
  return next.slice(-400);
}

function publicFields(finding) {
  return {
    regra: finding.regra,
    categoria: finding.categoria,
    gravidade: finding.gravidade,
    titulo: finding.titulo,
    descricao: finding.descricao,
    recomendacao: finding.recomendacao,
    registros: finding.registros || [],
    evidencias: finding.evidencias || {},
    dominio: finding.dominio || null,
    statusTitulo: finding.status || null,
  };
}

export function applyMonitorRun({ findings, evaluated, lacunas, anterior, erros }) {
  const now = new Date().toISOString();
  const settings = readMonitorSettings();
  const state = readAlerts();
  state.alertas = reduceMonitorAlerts(state.alertas, findings, evaluated, now, settings);
  state.lacunas = lacunas || [];
  state.anterior = { ...state.anterior, ...anterior };
  writeAlerts(state);
  const log = readJsonConfig(LOG_FILE, emptyLog());
  log.execucoes.push({
    em: now,
    achados: (findings || []).length,
    avaliadas: evaluated || [],
    lacunas: (lacunas || []).length,
    erros: erros || [],
  });
  log.execucoes = log.execucoes.slice(-80);
  writeJsonConfig(LOG_FILE, log);
  return { em: now, alertas: state.alertas, lacunas: state.lacunas };
}

export function updateAlertNarrative(id, narrativa, ia) {
  const state = readAlerts();
  const alert = state.alertas.find((item) => item.id === Number(id));
  if (!alert) return null;
  alert.narrativa = narrativa || null;
  alert.ia = ia;
  alert.atualizadoEm = new Date().toISOString();
  writeAlerts(state);
  return alert;
}

export function pendingNarratives(limit = 6) {
  return listMonitorAlerts().filter((item) => OPEN.has(item.situacao) && item.ia === "pendente" && item.gravidade !== "informativo").slice(0, limit);
}

const SITUACOES = new Set(["visualizado", "em_analise", "acao_preparada", "aguardando_confirmacao", "em_tratamento", "resolvido", "nao_resolvido", "descartado"]);

export function updateMonitorAlert(id, userId, patch = {}) {
  const state = readAlerts();
  const alert = state.alertas.find((item) => item.id === Number(id));
  if (!alert) return null;
  const settings = readMonitorSettings();
  if (!userCanSeeCategory(settings, userId) || !settings.categorias.includes(alert.categoria)) return null;
  const now = new Date().toISOString();
  if (patch.situacao) {
    if (!SITUACOES.has(patch.situacao))
      throw Object.assign(new Error("Situação de acompanhamento inválida."), { status: 400 });
    if (patch.situacao === "descartado" && !String(patch.motivo || "").trim())
      throw Object.assign(new Error("Informe o motivo do descarte."), { status: 400 });
    alert.historico.push({ em: now, de: alert.situacao, para: patch.situacao, usuario: Number(userId || 0), motivo: String(patch.motivo || "").slice(0, 300) });
    alert.situacao = patch.situacao;
    if (patch.situacao === "descartado") alert.motivoDescarte = String(patch.motivo || "").slice(0, 300);
    if (patch.situacao === "resolvido") {
      alert.resolvidoEm = now;
      alert.tempoResolucaoMs = Math.max(0, Date.parse(now) - Date.parse(alert.criadoEm || now));
    }
  }
  if (patch.retorno) {
    alert.retornos.push({
      em: now,
      usuario: Number(userId || 0),
      tipo: ["util", "irrelevante"].includes(patch.retorno) ? patch.retorno : "util",
      comentario: String(patch.comentario || "").slice(0, 400),
    });
  }
  if (patch.tratamento) {
    alert.tratamentos ||= [];
    const treatment = {
      em: now,
      usuario: Number(userId || 0),
      recomendacaoId: patch.tratamento.recomendacaoId || null,
      acao: patch.tratamento.acao || null,
      tarefaId: Number(patch.tratamento.tarefaId || 0) || null,
      resultado: String(patch.tratamento.resultado || "").slice(0, 500),
      situacaoProblema: patch.tratamento.situacaoProblema || alert.situacao,
    };
    const duplicate = alert.tratamentos.some((item) => item.tarefaId === treatment.tarefaId && item.resultado === treatment.resultado);
    if (!duplicate) alert.tratamentos.push(treatment);
    alert.tratamentos = alert.tratamentos.slice(-100);
  }
  alert.atualizadoEm = now;
  writeAlerts(state);
  return alert;
}

export function listMonitorLog() {
  return readJsonConfig(LOG_FILE, emptyLog()).execucoes.slice().reverse();
}

export function listMonitorGaps() {
  return readAlerts().lacunas || [];
}

export function acquireMonitorLock(directory = dataDir, ttlMs = 15 * 60 * 1000) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "charlie-monitor.lock");
  const owner = `${os.hostname()}:${process.pid}:${Date.now()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, JSON.stringify({ owner, expiresAt: Date.now() + ttlMs }));
      fs.closeSync(fd);
      return { file, owner };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let current = { expiresAt: 0 };
      try { current = JSON.parse(fs.readFileSync(file, "utf8")); } catch { current = { expiresAt: 0 }; }
      if (Number(current.expiresAt) > Date.now()) return null;
      try { fs.unlinkSync(file); } catch { return null; }
    }
  }
  return null;
}

export function releaseMonitorLock(directory = dataDir, owner) {
  const file = path.join(directory || dataDir, "charlie-monitor.lock");
  try {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!owner || current.owner === owner) fs.unlinkSync(file);
  } catch { /* o lock já foi liberado */ }
}
