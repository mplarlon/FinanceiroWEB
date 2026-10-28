import assert from "node:assert/strict";
import test from "node:test";
import {
  parcelInterest,
  totalParcelInterest,
} from "../server/lib/finance-settlement.js";

test("juros do exemplo 175,15 usam dias inteiros", () => {
  assert.equal(parcelInterest(175.15, 5, 26), 227.7);
  assert.equal(parcelInterest(175.15, 5, 25.5), 223.32);
});

test("juros de varias parcelas arredondam igualmente na tela e no servidor", () => {
  const parcels = [
    { value: 83.17, rate: 0.1, days: 1 },
    { value: 83.17, rate: 0.1, days: 1 },
  ];
  assert.equal(parcelInterest(83.17, 0.1, 1), 0.08);
  assert.equal(totalParcelInterest(parcels), 0.16);
});
