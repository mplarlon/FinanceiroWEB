const MIN_MS = 5000;
const MAX_MS = 720000;
const SAMPLE_LIMIT = 12;

export const BASELINE_RESEARCH_MS = 3 * 60 * 1000;
export const BASELINE_TEXT_MS = 90 * 1000;

export function sanitizeDurations(durations) {
  return (Array.isArray(durations) ? durations : [])
    .map((value) => Math.round(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= MIN_MS && value <= MAX_MS)
    .slice(-SAMPLE_LIMIT);
}

export function rememberReviewDuration(durations, ms) {
  return sanitizeDurations([...(Array.isArray(durations) ? durations : []), ms]);
}

export function medianDurationMs(durations) {
  const samples = sanitizeDurations(durations).sort((left, right) => left - right);
  if (!samples.length) return null;
  const middle = Math.floor(samples.length / 2);
  if (samples.length % 2) return samples[middle];
  return Math.round((samples[middle - 1] + samples[middle]) / 2);
}

export function typicalReviewMs(durations, needsResearch = true) {
  return medianDurationMs(durations) ?? (needsResearch ? BASELINE_RESEARCH_MS : BASELINE_TEXT_MS);
}

export function formatDuration(ms) {
  const minutes = Math.round(Math.max(0, Number(ms) || 0) / 60000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return minutes === 1 ? "1 min" : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return hours === 1 ? "1 h" : `${hours} h`;
  return `${hours} h ${rest} min`;
}

export function reviewTimeLabel({
  typicalMs,
  elapsedMs = 0,
  running = false,
  units = 1,
} = {}) {
  const unitsLeft = Math.max(0, Number(units) || 0);
  if (!running && unitsLeft <= 0) return "";
  const typical = Math.max(0, Number(typicalMs) || 0);
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (running && unitsLeft <= 1 && elapsed > typical) {
    return `há ${formatDuration(elapsed)}, passou da estimativa`;
  }
  const waiting = running ? Math.max(0, unitsLeft - 1) : unitsLeft;
  const current = running ? (elapsed > typical ? Math.round(typical * 0.2) : typical - elapsed) : 0;
  const total = waiting * typical + current;
  return `estimativa de ${formatDuration(total)}`;
}
