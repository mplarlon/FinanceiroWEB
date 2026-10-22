import { analyzeBehavioralEvents, explainBehavior } from "./charlie-behavioral-risk-engine.js";
import { listAuditEvents } from "./charlie-audit-store.js";
import { applyMonitorRun } from "./charlie-monitor-store.js";
import { readBehavioralState, saveBehavioralRun } from "./charlie-behavioral-risk-store.js";

function finding(analysis, events) {
  const related = events.filter((event) => analysis.eventIds.includes(event.id));
  const text = explainBehavior({ events: related, criteria: analysis.criteria, baseline: analysis.baseline });
  return {
    regra: `risco:${analysis.id}`, categoria: "auditoria",
    gravidade: analysis.risk.level === "elevado" ? "critico" : analysis.risk.level === "moderado" ? "atencao" : "informativo",
    titulo: text.title,
    descricao: text.explanation,
    recomendacao: text.recommendation,
    registros: text.registros,
    evidencias: { auditCategory: "riscos_comportamentais", behavioralAnalysisId: analysis.id, company: analysis.company, branch: analysis.branch, eventIds: analysis.eventIds, events: related, period: analysis.period, criteria: analysis.criteria, baseline: analysis.baseline, risk: analysis.risk, model: analysis.model, modelVersion: analysis.modelVersion, causalClaim: false },
  };
}

export function runBehavioralRiskAnalysis(options = {}) {
  const started = Date.now(), state = readBehavioralState();
  if (!state.settings.enabled) return { ok: true, skipped: true, reason: "disabled" };
  const events = listAuditEvents({}, { limit: options.limit || 1000 }).reverse();
  const processed = new Set(state.processedEventIds || []), unprocessed = events.filter((event) => !processed.has(event.id));
  const batch = Math.max(1, Math.min(100, Number(options.batchSize) || 50));
  const initialTargetCount = Math.max(1, unprocessed.length - state.settings.minimumSamples);
  const targets = unprocessed.slice(-Math.min(batch, processed.size ? unprocessed.length : initialTargetCount));
  const targetIds = new Set(targets.map((event) => event.id));
  const input = events.map((event) => ({ ...event, analysisTarget: targetIds.has(event.id) }));
  const result = analyzeBehavioralEvents(input, { minimumSamples: state.settings.minimumSamples, scoreThreshold: state.settings.scoreThreshold, percentileMultiplier: state.settings.percentileMultiplier, countThreshold: state.settings.burstCount, windowMinutes: state.settings.burstWindowMinutes, highValueThreshold: state.settings.highValueThreshold, authorizedContexts: options.authorizedContexts || [] });
  if (result.analyses.length) applyMonitorRun({ findings: result.analyses.map((analysis) => finding(analysis, events)), evaluated: [], lacunas: [], anterior: { riscosComportamentais: new Date().toISOString() }, erros: [] });
  const stored = saveBehavioralRun(result, unprocessed.map((event) => event.id), Date.now() - started);
  return { ok: true, analyzedAt: stored.lastRun.at, durationMs: stored.lastRun.durationMs, newEvents: unprocessed.length, analyzedBatch: targets.length, analyses: result.analyses.length, baselines: result.baselines.length, modelVersion: "1.0.0" };
}
