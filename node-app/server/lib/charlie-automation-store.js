import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "../config.js";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { stripSensitive } from "./charlie-task-store.js";

const FILE = "charlie-automations.json";
const LOCK = "charlie-automations.lock";
const ACTIVE = new Set(["ativa", "falhou"]);

export const emptyAutomationState = () => ({ nextId: 1, automacoes: [], execucoes: [] });
const clone = (value) => JSON.parse(JSON.stringify(value));

function load(deps = {}) {
  const store = deps.automationStore || deps.store;
  if (store) return store.state;
  return readJsonConfig(FILE, emptyAutomationState());
}

function persist(deps, state) {
  state.automacoes = state.automacoes.slice(-500);
  state.execucoes = state.execucoes.slice(-2000);
  const store = deps.automationStore || deps.store;
  if (store) store.state = state;
  else writeJsonConfig(FILE, state);
  return state;
}

export function createAutomationMemoryStore(initial = emptyAutomationState()) {
  return { state: clone(initial) };
}

export function saveAutomation(input, deps = {}) {
  const state = load(deps);
  const now = new Date().toISOString();
  const previous = input.id ? state.automacoes.find((item) => item.id === Number(input.id)) : null;
  const configKeys = ["nome", "objetivo", "modalidade", "acao", "parametros", "agenda", "fusoHorario", "condicao", "destinatarios", "politicaConfirmacao", "repeticaoAlertaMinutos", "dataInicio", "dataFim"];
  const configChanged = !previous || configKeys.some((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(input[key] ?? previous[key] ?? null));
  const version = previous ? Number(previous.versao || 1) + (configChanged ? 1 : 0) : 1;
  const item = stripSensitive({
    ...previous,
    ...input,
    id: previous?.id || state.nextId++,
    versao: version,
    criadaEm: previous?.criadaEm || now,
    atualizadaEm: now,
    historicoConfiguracao: (configChanged ? [
      ...(previous?.historicoConfiguracao || []),
      { versao: version, em: now, usuario: Number(input.atualizadaPor || input.criadaPor || 0) },
    ] : (previous?.historicoConfiguracao || [])).slice(-30),
  });
  const index = state.automacoes.findIndex((entry) => entry.id === item.id);
  if (index >= 0) state.automacoes[index] = item;
  else state.automacoes.push(item);
  persist(deps, state);
  return clone(item);
}

export function getAutomation(id, deps = {}) {
  return clone(load(deps).automacoes.find((item) => item.id === Number(id)) || null);
}

export function listAutomations(user, filters = {}, deps = {}) {
  const gerencial = Boolean(user?.gerencial);
  return load(deps).automacoes
    .filter((item) => gerencial || item.criadaPor === Number(user?.id || 0))
    .filter((item) => !filters.status || item.status === filters.status)
    .slice().reverse().map(clone);
}

export function listDueAutomations(now = Date.now(), deps = {}) {
  return load(deps).automacoes.filter((item) => ACTIVE.has(item.status)
    && item.proximaExecucao && Date.parse(item.proximaExecucao) <= now).map(clone);
}

export function addAutomationExecution(automationId, input, deps = {}) {
  const state = load(deps);
  const now = new Date().toISOString();
  const execution = stripSensitive({
    id: crypto.randomUUID(), automacaoId: Number(automationId), criadaEm: now, ...input,
  });
  const index = state.execucoes.findIndex((item) => item.id === execution.id);
  if (index >= 0) state.execucoes[index] = execution;
  else state.execucoes.push(execution);
  persist(deps, state);
  return clone(execution);
}

export function listAutomationExecutions(automationId, deps = {}) {
  return load(deps).execucoes.filter((item) => item.automacaoId === Number(automationId)).slice().reverse().map(clone);
}

export function hasExecutionKey(key, deps = {}) {
  return load(deps).execucoes.some((item) => item.chaveIdempotencia === key && !["falhou", "ignorada"].includes(item.status));
}

export function acquireAutomationLock(ttlMs = 10 * 60 * 1000, directory = dataDir) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, LOCK);
  const owner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, JSON.stringify({ owner, expiresAt: Date.now() + ttlMs }));
      fs.closeSync(fd);
      return { file, owner };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let current = {};
      try { current = JSON.parse(fs.readFileSync(file, "utf8")); } catch { current = {}; }
      if (Number(current.expiresAt) > Date.now()) return null;
      try { fs.unlinkSync(file); } catch { return null; }
    }
  }
  return null;
}

export function releaseAutomationLock(lock) {
  if (!lock?.file) return;
  try {
    const current = JSON.parse(fs.readFileSync(lock.file, "utf8"));
    if (current.owner === lock.owner) fs.unlinkSync(lock.file);
  } catch { /* já liberado */ }
}
