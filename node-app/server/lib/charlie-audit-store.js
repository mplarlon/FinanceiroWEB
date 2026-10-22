import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { defaultAuditRules } from "./charlie-audit-engine.js";

const EVENTS = "charlie-business-audit-events.json";
const RULES = "charlie-audit-rules.json";
const INVESTIGATIONS = "charlie-audit-investigations.json";
const forbidden = /senha|password|token|secret|credential|chave|pix|agencia|conta|iban|swift/i;

function sanitize(value, key = "") {
  if (forbidden.test(key)) return "[PROTEGIDO]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]));
  return typeof value === "string" ? value.slice(0, 1000) : value ?? null;
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  return value;
}
function canonical(value) { return JSON.stringify(ordered(value)); }

export function appendAuditEvent(input = {}) {
  const state = readJsonConfig(EVENTS, { events: [] });
  const previousHash = state.events.at(-1)?.hash || null;
  const event = sanitize({
    id: crypto.randomUUID(), occurredAt: input.occurredAt || new Date().toISOString(), capturedAt: new Date().toISOString(),
    type: input.type, operation: input.operation || "update", entity: String(input.entity || "").toUpperCase(), recordId: String(input.recordId || ""),
    company: input.company || null, branch: input.branch || null, actor: input.actor?.id ? { id: Number(input.actor.id), name: String(input.actor.name || "").slice(0, 120), sector: String(input.actor.sector || "").slice(0, 80) || null, profile: String(input.actor.profile || "").slice(0, 80) || null } : null,
    actorKnown: Boolean(input.actor?.id), origin: String(input.origin || "ERP").slice(0, 60), correlationId: input.correlationId || crypto.randomUUID(),
    previous: input.previous || {}, next: input.next || {}, changedFields: input.changedFields || [], justification: input.justification || null,
    authorization: input.authorization?.id ? { id: String(input.authorization.id), type: input.authorization.type || null } : null,
    companyScopeVerified: input.companyScopeVerified !== false, previousHash,
  });
  event.hash = crypto.createHash("sha256").update(`${previousHash || "GENESIS"}:${canonical(event)}`).digest("hex");
  state.events.push(event);
  const retention = readAuditSettings().retentionEvents;
  if (state.events.length > retention) {
    const removed = state.events.slice(0, state.events.length - retention);
    state.anchorHash = removed.at(-1)?.hash || state.anchorHash || null;
    state.events = state.events.slice(-retention);
  }
  writeJsonConfig(EVENTS, state);
  return event;
}

export function listAuditEvents(actor = {}, filters = {}) {
  const state = readJsonConfig(EVENTS, { events: [] });
  return state.events.filter((event) => (!actor.company || Number(event.company) === Number(actor.company)) && (!actor.branch || Number(event.branch) === Number(actor.branch)) && (!filters.type || event.type === filters.type) && (!filters.entity || event.entity === String(filters.entity).toUpperCase())).slice(-Math.max(1, Math.min(500, Number(filters.limit) || 100))).reverse();
}

export function verifyAuditChain() {
  const state = readJsonConfig(EVENTS, { events: [] });
  const events = state.events;
  let previousHash = state.anchorHash || null;
  for (const event of events) {
    const { hash, ...unsigned } = event;
    const expected = crypto.createHash("sha256").update(`${previousHash || "GENESIS"}:${canonical(unsigned)}`).digest("hex");
    if (hash !== expected || unsigned.previousHash !== previousHash) return { valid: false, brokenAt: event.id, checked: events.indexOf(event) };
    previousHash = hash;
  }
  return { valid: true, checked: events.length, lastHash: previousHash };
}

export function readAuditSettings() {
  const stored = readJsonConfig(RULES, {});
  return { enabled: stored.enabled !== false, intervalMinutes: Math.max(5, Math.min(1440, Number(stored.intervalMinutes) || 15)), retentionEvents: Math.max(100, Math.min(50000, Number(stored.retentionEvents) || 5000)), independentReview: stored.independentReview !== false, reviewers: stored.reviewers || [], rules: stored.rules?.length ? stored.rules : defaultAuditRules(), updatedAt: stored.updatedAt || null, updatedBy: stored.updatedBy || null };
}

export function saveAuditSettings(input, actor = {}) {
  const current = readAuditSettings();
  const rules = (input.rules || current.rules).map((rule) => ({ ...rule, enabled: rule.enabled !== false, version: Number(rule.version || 1) + (JSON.stringify(current.rules.find((item) => item.id === rule.id)?.parameters) !== JSON.stringify(rule.parameters) ? 1 : 0) }));
  const next = { ...current, ...input, rules, updatedAt: new Date().toISOString(), updatedBy: Number(actor.id || 0) };
  writeJsonConfig(RULES, next);
  return readAuditSettings();
}

export function saveInvestigation(input, actor = {}) {
  const state = readJsonConfig(INVESTIGATIONS, { investigations: [] });
  let item = state.investigations.find((entry) => entry.alertId === Number(input.alertId));
  if (!item) {
    item = { id: crypto.randomUUID(), alertId: Number(input.alertId), eventId: input.eventId || null, eventActorId: Number(input.eventActorId || 0) || null, status: "nova", openedAt: new Date().toISOString(), openedBy: Number(actor.id || 0), history: [], evidenceConsulted: [] };
    state.investigations.push(item);
  }
  if (input.status && input.status !== item.status) {
    if (["resolvida", "descartada"].includes(input.status) && !String(input.justification || "").trim()) throw Object.assign(new Error("Informe uma justificativa para encerrar a investigação."), { status: 400 });
    if (["resolvida", "descartada"].includes(input.status) && readAuditSettings().independentReview && Number(item.eventActorId) === Number(actor.id)) throw Object.assign(new Error("A política exige revisão independente para o encerramento."), { status: 403 });
    item.history.push({ at: new Date().toISOString(), from: item.status, to: input.status, userId: Number(actor.id || 0), justification: String(input.justification || "").slice(0, 500) });
    item.status = input.status; if (["resolvida", "descartada"].includes(input.status)) item.closedAt = new Date().toISOString();
  }
  if (input.note) item.history.push({ at: new Date().toISOString(), action: "nota", userId: Number(actor.id || 0), note: String(input.note).slice(0, 1000) });
  if (input.evidenceId && !item.evidenceConsulted.includes(input.evidenceId)) item.evidenceConsulted.push(input.evidenceId);
  writeJsonConfig(INVESTIGATIONS, state);
  return item;
}

export function listInvestigations(actor = {}) {
  if (!actor.gerencial) return [];
  return readJsonConfig(INVESTIGATIONS, { investigations: [] }).investigations.slice().reverse();
}
