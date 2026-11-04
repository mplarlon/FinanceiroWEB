import assert from "node:assert/strict";
import test from "node:test";
import { matchesReviewFilter, reviewFilterCount } from "../client/src/lib/charlie-review-queue.js";

const items = [
  { id: "1", status: "open" },
  { id: "2", status: "suggested" },
  { id: "3", status: "approved" },
  { id: "4", status: "uploaded" },
  { id: "5", status: "rejected" },
  { id: "6", status: "blocked" },
  { id: "7", status: "failed" },
  { id: "8" },
];

test("o filtro principal mostra o que ainda pede decisão", () => {
  assert.deepEqual(items.filter((item) => matchesReviewFilter(item, "pending")).map((item) => item.id), ["1", "2", "6", "7", "8"]);
  assert.equal(matchesReviewFilter(items[2], "pending"), false);
  assert.equal(matchesReviewFilter(items[3], "pending"), false);
  assert.equal(matchesReviewFilter(items[4], "pending"), false);
});

test("aprovados, enviados e rejeitados ficam em listas próprias", () => {
  assert.equal(reviewFilterCount(items, "approved"), 1);
  assert.equal(reviewFilterCount(items, "uploaded"), 1);
  assert.equal(reviewFilterCount(items, "rejected"), 1);
  assert.equal(reviewFilterCount(items, "all"), items.length);
  assert.equal(reviewFilterCount(items, "pending"), 5);
});
