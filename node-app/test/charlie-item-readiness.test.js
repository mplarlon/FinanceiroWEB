import assert from "node:assert/strict";
import test from "node:test";
import { itemReadiness } from "../client/src/lib/charlie-item-readiness.js";

test("a prontidão conta o que já está no item e o que ainda falta", () => {
  const readiness = itemReadiness({
    productName: "Bolsa",
    gaps: ["categoria", "peso", "comprimento", "largura", "altura"],
  });
  assert.equal(readiness.total, 8);
  assert.equal(readiness.done, 3);
  assert.equal(readiness.pending, 5);
  assert.equal(readiness.searching, 0);
  assert.deepEqual(
    readiness.checks.filter((check) => !check.ok).map((check) => check.id),
    ["categoria", "peso", "comprimento", "largura", "altura"],
  );
});

test("durante a pesquisa os campos que faltam ficam em andamento", () => {
  const readiness = itemReadiness({
    gaps: ["peso", "largura"],
  }, true);
  assert.equal(readiness.done, 6);
  assert.equal(readiness.searching, 2);
  assert.equal(readiness.checks.find((check) => check.id === "peso").searching, true);
  assert.equal(readiness.checks.find((check) => check.id === "nome").searching, false);
});

test("item sem lacunas está completo", () => {
  const readiness = itemReadiness({ gaps: [] }, true);
  assert.equal(readiness.done, 8);
  assert.equal(readiness.pending, 0);
  assert.equal(readiness.searching, 0);
});

test("sem a lista de lacunas a prontidão lê o cadastro do produto", () => {
  const readiness = itemReadiness({
    productName: "Bolsa",
    product: { price: 10, stock: 2, weight: 500 },
  });
  assert.deepEqual(
    readiness.checks.filter((check) => !check.ok).map((check) => check.id),
    ["categoria", "comprimento", "largura", "altura"],
  );
});
