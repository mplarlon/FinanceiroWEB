import crypto from "node:crypto";
import { query } from "../db.js";
import { evaluateAuditEvent, findFinancialDuplicates } from "./charlie-audit-engine.js";
import { appendAuditEvent, listAuditEvents, readAuditSettings } from "./charlie-audit-store.js";
import { applyMonitorRun } from "./charlie-monitor-store.js";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const STATE = "charlie-audit-engine-state.json";

function recordRows(occurrence) {
  const evidence = occurrence.evidence || {};
  const records = evidence.records;
  if (Array.isArray(records) && records.some((row) => row.partyId != null)) {
    const seen = new Set();
    const rows = [];
    for (const row of records) {
      const key = `${row.domain}:${row.partyId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        CODIGO: row.partyId,
        NOME: String(row.partyName || "").replace(/\s+/g, " ").trim(),
        DOCUMENTO: row.document || "",
        PARCELA: row.installment,
        VALOR: row.amount,
        DETALHE: [row.document ? `doc ${String(row.document).trim()}` : "", row.installment != null && row.installment !== "" ? `parcela ${row.installment}` : ""].filter(Boolean).join(" · "),
      });
    }
    return rows;
  }
  const [code, table, unit] = String(evidence.recordId || "").split(":");
  if (String(evidence.entity || "").toUpperCase() === "PRODUTOPRECO" && code) {
    return [{
      CODIGO: code,
      NOME: String(evidence.next?.productName || "").replace(/\s+/g, " ").trim(),
      DETALHE: [table ? `tabela ${table}` : "", unit || ""].filter(Boolean).join(", "),
      VALOR: evidence.criteria?.variationPercent ?? null,
    }];
  }
  return [{ CODIGO: evidence.recordId, NOME: evidence.entity, VALOR: evidence.criteria?.variationPercent ?? null }];
}

function finding(occurrence) {
  const evidence = { ...occurrence.evidence, auditCategory: occurrence.category, classification: occurrence.classification };
  return {
    regra: `auditoria:${occurrence.fingerprint}`, categoria: "auditoria", gravidade: occurrence.severity,
    titulo: occurrence.title, descricao: occurrence.summary, recomendacao: occurrence.recommendation,
    registros: recordRows(occurrence),
    evidencias: evidence, dominio: null, status: null,
  };
}

export function processAuditEvent(event, options = {}) {
  const settings = readAuditSettings();
  if (!settings.enabled) return { event, occurrences: [], alerts: [] };
  const occurrences = evaluateAuditEvent(event, settings.rules);
  if (!occurrences.length) return { event, occurrences, alerts: [] };
  const result = applyMonitorRun({ findings: occurrences.map(finding), evaluated: [], lacunas: options.gaps || [], anterior: { auditoria: event.occurredAt }, erros: [] });
  const alerts = result.alertas.filter((alert) => occurrences.some((item) => alert.regra === `auditoria:${item.fingerprint}`));
  return { event, occurrences, alerts };
}

export function captureAndAudit(input) {
  const event = appendAuditEvent(input);
  return processAuditEvent(event);
}

function duplicateFingerprint(group) {
  return crypto.createHash("sha256").update(group.map((row) => `${row.domain}:${row.id}`).sort().join("|")).digest("hex");
}

export async function runAuditCycle(db, options = {}) {
  const started = Date.now(), settings = readAuditSettings();
  if (!settings.enabled) return { ok: true, skipped: true, checkedAt: new Date().toISOString() };
  const state = readJsonConfig(STATE, { duplicateFingerprints: [], lastCheckedAt: null });
  const gaps = [
    { id: "external-history", texto: "Alterações feitas fora dos serviços instrumentados só são auditadas retrospectivamente quando o Firebird mantém histórico confiável." },
    { id: "human-identity", texto: "Quando estações compartilham a credencial do Firebird, o usuário humano não pode ser inferido sem propagação pela aplicação." },
  ];
  const duplicateRule = settings.rules.find((rule) => rule.type === "financial_duplicate" && rule.enabled);
  let duplicateGroups = [];
  if (duplicateRule) {
    const receiving = await query(db, `SELECT FIRST 1000 'receber' DOMINIO, t.CONTROLE ID, t.CDCLIENTE PESSOA,
      COALESCE(c.CLIENTE, '') NOME, TRIM(t.NRDOC) DOCUMENTO, t.PARCELA, t.VALOR, CAST(t.DTVENC AS DATE) VENCIMENTO
      FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE
      WHERE t.STATUS=1 AND t.DTVENC>=DATEADD(-90 DAY TO CURRENT_DATE)
      ORDER BY t.DTVENC DESC`, [], { timeoutMs: 20000 });
    const paying = await query(db, `SELECT FIRST 1000 'pagar' DOMINIO, t.CONTROLE ID, t.CDFORNECEDOR PESSOA,
      COALESCE(f.FORNECEDOR, '') NOME, TRIM(t.NOTAFISCAL) DOCUMENTO, t.PARCELA, t.VALOR, CAST(t.DTVENC AS DATE) VENCIMENTO
      FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR
      WHERE t.STATUS=1 AND t.DTVENC>=DATEADD(-90 DAY TO CURRENT_DATE)
      ORDER BY t.DTVENC DESC`, [], { timeoutMs: 20000 });
    duplicateGroups = findFinancialDuplicates([...receiving, ...paying].map((row) => ({ domain: row.DOMINIO, id: row.ID, partyId: row.PESSOA, partyName: String(row.NOME || "").trim(), document: row.DOCUMENTO, installment: row.PARCELA, amount: row.VALOR, dueDate: row.VENCIMENTO })), duplicateRule);
    const known = new Set(state.duplicateFingerprints || []);
    for (const group of duplicateGroups) {
      const fingerprint = duplicateFingerprint(group.records);
      if (known.has(fingerprint)) continue;
      const party = group.records[0] || {};
      const kind = party.domain === "pagar" ? "fornecedor" : "cliente";
      const who = party.partyName ? `${party.partyId} - ${String(party.partyName).trim()}` : (party.partyId != null ? String(party.partyId) : "");
      const event = appendAuditEvent({ type: "financial_duplicate", operation: "detect", entity: party.domain === "pagar" ? "CTAPAGAR" : "CTARECEBER", recordId: group.records.map((row) => row.id).join(","), origin: "CHARLIE_AUDIT_PERIODIC", previous: {}, next: { possibleDuplicate: true, count: group.records.length, partyId: party.partyId ?? null, partyName: party.partyName || null }, companyScopeVerified: false });
      const summary = who
        ? `${group.records.length} títulos do ${kind} ${who} coincidem em documento, parcela, valor e vencimento. A duplicidade ainda precisa ser confirmada.`
        : `${group.records.length} títulos possuem documento, pessoa, parcela, valor e vencimento coincidentes. A duplicidade ainda precisa ser confirmada.`;
      const occurrence = { fingerprint, ruleId: duplicateRule.id, ruleVersion: duplicateRule.version, eventId: event.id, category: "financeiro", severity: duplicateRule.severity, title: "Possível duplicidade financeira", summary, recommendation: "Confira documentos de origem e lançamentos antes de qualquer correção.", classification: "possivel_duplicidade", evidence: { eventId: event.id, eventHash: event.hash, occurredAt: event.occurredAt, entity: event.entity, recordId: event.recordId, criteria: group.evidence.criteria, records: group.records, rule: { id: duplicateRule.id, version: duplicateRule.version } } };
      applyMonitorRun({ findings: [finding(occurrence)], evaluated: [], lacunas: gaps, anterior: { auditoria: event.occurredAt }, erros: [] });
      known.add(fingerprint);
    }
    state.duplicateFingerprints = [...known].slice(-1000);
  }
  // Processa eventos capturados que ainda não passaram pelo motor (útil após reinício).
  const processed = new Set(state.processedEventIds || []);
  let evaluatedEvents = 0;
  for (const event of listAuditEvents({}, { limit: 500 }).reverse()) {
    if (processed.has(event.id) || event.type === "financial_duplicate") continue;
    processAuditEvent(event, { gaps }); processed.add(event.id); evaluatedEvents += 1;
  }
  state.processedEventIds = [...processed].slice(-5000);
  state.lastCheckedAt = new Date().toISOString(); state.durationMs = Date.now() - started;
  state.mode = "periodic_incremental"; state.duplicateGroups = duplicateGroups.length;
  writeJsonConfig(STATE, state);
  return { ok: true, checkedAt: state.lastCheckedAt, mode: state.mode, durationMs: state.durationMs, evaluatedEvents, duplicateGroups: duplicateGroups.length, gaps };
}

export function auditEngineStatus() {
  return { ...readJsonConfig(STATE, { lastCheckedAt: null, mode: "periodic_incremental" }), settings: readAuditSettings() };
}
