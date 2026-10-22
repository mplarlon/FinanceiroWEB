import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-behavioral-risk.json";
const FEEDBACK = new Set(["irregularidade_confirmada", "operacao_legitima", "falso_positivo", "dados_insuficientes", "necessita_acompanhamento"]);
const empty = () => ({ analyses: [], feedback: [], processedEventIds: [], lastRun: null, settings: { enabled: true, minimumSamples: 8, scoreThreshold: 3.5, percentileMultiplier: 1.5, burstCount: 5, burstWindowMinutes: 30, highValueThreshold: 10000, retention: 1000 } });

export function readBehavioralState() { return { ...empty(), ...readJsonConfig(FILE, empty()) }; }
export function saveBehavioralRun(result, processedEventIds, durationMs) {
  const state = readBehavioralState();
  const index = new Map(state.analyses.map((item) => [item.id, item]));
  for (const analysis of result.analyses || []) index.set(analysis.id, { ...index.get(analysis.id), ...analysis, analyzedAt: new Date().toISOString() });
  state.analyses = [...index.values()].slice(-state.settings.retention);
  state.processedEventIds = [...new Set([...state.processedEventIds, ...processedEventIds])].slice(-5000);
  state.lastRun = { at: new Date().toISOString(), durationMs, analyses: result.analyses?.length || 0, baselines: result.baselines?.length || 0 };
  writeJsonConfig(FILE, state); return state;
}
export function listBehavioralAnalyses(actor = {}, filters = {}) {
  return readBehavioralState().analyses.filter((item) => (!actor.company || Number(item.company) === Number(actor.company)) && (!actor.branch || Number(item.branch) === Number(actor.branch)) && (!filters.risk || item.risk?.level === filters.risk) && (!filters.category || item.category === filters.category)).slice(-Math.max(1, Math.min(500, Number(filters.limit) || 100))).reverse();
}
export function saveBehavioralFeedback(analysisId, input = {}, actor = {}) {
  if (!actor.gerencial) throw Object.assign(new Error("Sem permissão para classificar esta ocorrência."), { status: 403 });
  if (!FEEDBACK.has(input.classification)) throw Object.assign(new Error("Classificação de feedback inválida."), { status: 400 });
  if (!String(input.justification || "").trim()) throw Object.assign(new Error("Informe a justificativa."), { status: 400 });
  const state = readBehavioralState(), analysis = state.analyses.find((item) => item.id === analysisId);
  if (!analysis) throw Object.assign(new Error("Análise comportamental não encontrada."), { status: 404 });
  const feedback = { analysisId, classification: input.classification, justification: String(input.justification).slice(0, 1000), evidenceIds: (input.evidenceIds || analysis.eventIds || []).slice(0, 100), userId: Number(actor.id || 0), at: new Date().toISOString() };
  state.feedback.push(feedback); state.feedback = state.feedback.slice(-2000); analysis.lastFeedback = feedback;
  // Feedback nunca altera automaticamente limiares ou regras críticas.
  writeJsonConfig(FILE, state); return feedback;
}
export function saveBehavioralSettings(input = {}, actor = {}) {
  if (!actor.gerencial) throw Object.assign(new Error("Sem permissão para configurar a análise de riscos."), { status: 403 });
  const state = readBehavioralState(), current = state.settings;
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  state.settings = { enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled), minimumSamples: clamp(input.minimumSamples, 5, 1000, current.minimumSamples), scoreThreshold: clamp(input.scoreThreshold, 1, 10, current.scoreThreshold), percentileMultiplier: clamp(input.percentileMultiplier, 1, 10, current.percentileMultiplier), burstCount: clamp(input.burstCount, 2, 100, current.burstCount), burstWindowMinutes: clamp(input.burstWindowMinutes, 5, 1440, current.burstWindowMinutes), highValueThreshold: clamp(input.highValueThreshold, 0, 1e12, current.highValueThreshold), retention: clamp(input.retention, 100, 10000, current.retention), updatedAt: new Date().toISOString(), updatedBy: Number(actor.id || 0) };
  writeJsonConfig(FILE, state); return state.settings;
}
