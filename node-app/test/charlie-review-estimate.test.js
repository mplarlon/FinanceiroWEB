import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_RESEARCH_MS,
  formatDuration,
  medianDurationMs,
  rememberReviewDuration,
  reviewTimeLabel,
  typicalReviewMs,
} from "../server/lib/review-estimate.js";

test("a estimativa usa a mediana das revisões já medidas", () => {
  assert.equal(medianDurationMs([60000, 180000, 120000]), 120000);
  assert.equal(typicalReviewMs([4000, 90000, 800000]), 90000);
  assert.equal(typicalReviewMs([]), BASELINE_RESEARCH_MS);
  assert.equal(typicalReviewMs([], false), 90000);
});

test("a lista de durações guarda só as doze últimas válidas", () => {
  const stored = rememberReviewDuration([10000, 20000], 30000);
  assert.deepEqual(stored, [10000, 20000, 30000]);
  const long = rememberReviewDuration(Array.from({ length: 12 }, (_, index) => (index + 1) * 10000), 130000);
  assert.equal(long.length, 12);
  assert.equal(long.at(-1), 130000);
  assert.equal(long[0], 20000);
});

test("o texto da estimativa conta o que falta e avisa quando passa do prazo", () => {
  assert.equal(formatDuration(20000), "menos de 1 min");
  assert.equal(formatDuration(180000), "3 min");
  assert.equal(formatDuration(3 * 3600000 + 3 * 60000), "3 h 3 min");
  assert.equal(reviewTimeLabel({ typicalMs: 180000, units: 61 }), "estimativa de 3 h 3 min");
  assert.equal(reviewTimeLabel({ typicalMs: 180000, units: 1, running: true, elapsedMs: 60000 }), "estimativa de 2 min");
  assert.equal(reviewTimeLabel({ typicalMs: 180000, units: 1, running: true, elapsedMs: 200000 }), "há 3 min, passou da estimativa");
  assert.equal(reviewTimeLabel({ typicalMs: 180000, units: 0 }), "");
});
