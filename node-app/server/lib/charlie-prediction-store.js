import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-predictions.json";
const read = () => readJsonConfig(FILE, { predictions: [] });

export function savePrediction(input, actor = {}) {
  const state = read();
  const prediction = { id: crypto.randomUUID(), generatedAt: new Date().toISOString(), userId: Number(actor.id || 0), company: actor.company || null, branch: actor.branch || null, ...input };
  state.predictions.unshift(prediction);
  state.predictions = state.predictions.slice(0, 500);
  writeJsonConfig(FILE, state);
  return prediction;
}

export function listPredictions(actor = {}, limit = 50) {
  return read().predictions.filter((item) => (!actor.company || Number(item.company) === Number(actor.company)) && (!actor.branch || Number(item.branch) === Number(actor.branch)) && (actor.gerencial || Number(item.userId) === Number(actor.id))).slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

export function updatePredictionActual(id, actual, actor = {}) {
  const state = read();
  const item = state.predictions.find((entry) => entry.id === id && (!actor.company || Number(entry.company) === Number(actor.company)));
  if (!item) return null;
  item.actual = Number(actual); item.actualRecordedAt = new Date().toISOString();
  writeJsonConfig(FILE, state);
  return item;
}
