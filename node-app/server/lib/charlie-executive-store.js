import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-executive.json";
const STATUSES = new Set(["planejado", "aguardando_aprovacao", "em_execucao", "concluido", "parcialmente_concluido", "suspenso", "cancelado"]);
const empty = () => ({ plans: [], preferences: [], meetings: [], decisions: [], verifications: [], snapshots: [] });
const clone = (value) => JSON.parse(JSON.stringify(value));

function load(deps = {}) {
  if (deps.store) return deps.store.state;
  return readJsonConfig(FILE, empty());
}

function persist(state, deps = {}) {
  state.plans = state.plans.slice(-200);
  state.meetings = state.meetings.slice(-100);
  state.decisions = state.decisions.slice(-200);
  state.verifications = state.verifications.slice(-500);
  state.snapshots = state.snapshots.slice(-80);
  if (deps.store) deps.store.state = state;
  else writeJsonConfig(FILE, state);
  return state;
}

export function createExecutiveMemoryStore(initial = empty()) {
  return { state: clone({ ...empty(), ...initial }) };
}

export function sameExecutiveScope(item, actor = {}) {
  if (!item) return false;
  if (actor.company && item.company && Number(item.company) !== Number(actor.company)) return false;
  if (actor.branch && item.branch && Number(item.branch) !== Number(actor.branch)) return false;
  if (!actor.gerencial && Number(item.ownerUserId || item.userId) !== Number(actor.id)) return false;
  return true;
}

function preferenceKey(actor = {}) {
  return `${Number(actor.id || 0)}:${actor.company || 0}:${actor.branch || 0}`;
}

export function getExecutivePreferences(actor = {}, deps = {}) {
  return clone(load(deps).preferences.find((item) => item.key === preferenceKey(actor)) || null);
}

export function saveExecutivePreferences(actor = {}, input = {}, deps = {}) {
  const state = load(deps);
  const key = preferenceKey(actor);
  const current = state.preferences.find((item) => item.key === key);
  const next = {
    key,
    userId: Number(actor.id || 0),
    company: actor.company || null,
    branch: actor.branch || null,
    favoriteIndicators: (input.favoriteIndicators || current?.favoriteIndicators || []).map((item) => String(item).slice(0, 80)).slice(0, 20),
    sectors: (input.sectors || current?.sectors || []).map((item) => String(item).slice(0, 40)).slice(0, 8),
    summaryFrequency: ["diaria", "semanal", "mensal", null].includes(input.summaryFrequency) ? input.summaryFrequency : current?.summaryFrequency || null,
    criteria: input.criteria || current?.criteria || null,
    alertTypes: (input.alertTypes || current?.alertTypes || []).map((item) => String(item).slice(0, 40)).slice(0, 8),
    format: ["executivo", "compacto"].includes(input.format) ? input.format : current?.format || "executivo",
    reportFormat: ["nenhum", "excel", "pdf", "csv"].includes(input.reportFormat) ? input.reportFormat : current?.reportFormat || "nenhum",
    updatedAt: new Date().toISOString(),
  };
  if (current) Object.assign(current, next);
  else state.preferences.push(next);
  persist(state, deps);
  return clone(next);
}

export function saveExecutiveSnapshot(actor = {}, scope, briefing, deps = {}) {
  const state = load(deps);
  const key = `${actor.company || 0}:${actor.branch || 0}:${scope}`;
  const item = {
    key,
    company: actor.company || null,
    branch: actor.branch || null,
    scope,
    updatedAt: briefing.updatedAt || new Date().toISOString(),
    period: briefing.period,
    signals: (briefing.priorities || []).concat(briefing.critical || [], briefing.attention || [], briefing.opportunities || []).slice(0, 40).map((signal) => ({
      id: signal.id, title: signal.title, detail: signal.detail, severity: signal.severity, score: signal.score, area: signal.area, kind: signal.kind, source: signal.source,
    })),
  };
  const index = state.snapshots.findIndex((entry) => entry.key === key);
  if (index >= 0) state.snapshots[index] = item;
  else state.snapshots.push(item);
  persist(state, deps);
  return clone(item);
}

export function readExecutiveSnapshot(actor = {}, scope, deps = {}) {
  const key = `${actor.company || 0}:${actor.branch || 0}:${scope}`;
  return clone(load(deps).snapshots.find((item) => item.key === key) || null);
}

export function saveExecutivePlan(plan, deps = {}) {
  const state = load(deps);
  const current = plan.id ? state.plans.find((item) => item.id === plan.id) : null;
  const saved = { ...current, ...plan, id: current?.id || plan.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
  if (!STATUSES.has(saved.status)) throw Object.assign(new Error("Situação de plano inválida."), { status: 400 });
  if (current) Object.assign(current, saved);
  else state.plans.push(saved);
  persist(state, deps);
  return clone(saved);
}

export function listExecutivePlans(actor = {}, deps = {}) {
  return load(deps).plans.filter((item) => sameExecutiveScope(item, actor)).map(clone).reverse();
}

export function getExecutivePlan(id, actor = {}, deps = {}) {
  const item = load(deps).plans.find((plan) => plan.id === id);
  if (!sameExecutiveScope(item, actor)) return null;
  return clone(item);
}

export function saveExecutiveMeeting(meeting, deps = {}) {
  const state = load(deps);
  const current = meeting.id ? state.meetings.find((item) => item.id === meeting.id) : null;
  const saved = { ...current, ...meeting, id: current?.id || meeting.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
  if (current) Object.assign(current, saved);
  else state.meetings.push(saved);
  persist(state, deps);
  return clone(saved);
}

export function activeExecutiveMeeting(actor = {}, conversationId, deps = {}) {
  if (!conversationId) return null;
  return clone([...load(deps).meetings].reverse().find((item) => sameExecutiveScope({ ...item, ownerUserId: item.userId }, actor) && String(item.conversationId) === String(conversationId) && item.status === "em_andamento") || null);
}

export function saveExecutiveDecision(decision, deps = {}) {
  const state = load(deps);
  const saved = { id: crypto.randomUUID(), ...decision, createdAt: new Date().toISOString() };
  state.decisions.push(saved);
  persist(state, deps);
  return clone(saved);
}

export function listExecutiveDecisions(actor = {}, deps = {}) {
  return load(deps).decisions.filter((item) => sameExecutiveScope({ ...item, ownerUserId: item.userId }, actor)).map(clone).reverse();
}

export function saveExecutiveVerification(verification, deps = {}) {
  const state = load(deps);
  const saved = { id: crypto.randomUUID(), ...verification, at: new Date().toISOString() };
  state.verifications.push(saved);
  persist(state, deps);
  return clone(saved);
}

export function listExecutiveVerifications(planId, actor = {}, deps = {}) {
  const plan = getExecutivePlan(planId, actor, deps);
  if (!plan) return [];
  return load(deps).verifications.filter((item) => item.planId === planId).map(clone);
}
