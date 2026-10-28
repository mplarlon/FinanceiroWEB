import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const engine = await import("../server/lib/charlie-breakfast-engine.js");
const service = fs.readFileSync(new URL("../server/lib/charlie-breakfast-service.js", import.meta.url), "utf8");

test("venda sem valor não vira o menor faturamento", () => {
  const ranked = engine.rankSellers([
    { companyId: 1, sellerId: 1, seller: "Ana", orders: 2, revenue: 100 },
    { companyId: 1, sellerId: 2, seller: "Bia", orders: 1, revenue: null },
    { companyId: 1, sellerId: 3, seller: "Caio", orders: 1, revenue: 0 },
  ], 1);
  const bia = ranked.ranking.find((item) => item.nome === "Bia");
  assert.equal(bia.faturamento, null);
  assert.equal(bia.posicao, null);
  assert.equal(bia.ticket, null);
  assert.equal(ranked.menor.nome, "Caio");
  assert.equal(ranked.ranking[0].nome, "Ana");
});

test("variação e meta não tratam valor ausente como zero", () => {
  assert.equal(engine.variation(null, 100).texto, "sem base comparável");
  assert.equal(engine.variation(123, 0).texto, "sem base comparável");
  assert.equal(engine.variation(0, 100).percentual, -100);
  const meta = engine.assessGoal(1000, null, "2026-10-21", "teste");
  assert.equal(meta.realizado, null);
  assert.equal(meta.atingimento, null);
  assert.match(meta.texto, /sem valor/);
  const report = engine.composeBreakfast({
    reference: "2026-10-21",
    companyId: 1,
    salesDay: [{ companyId: 1, sellerId: 1, seller: "Ana", orders: 1, revenue: null }],
    quotesPeriod: [{ status: 0, count: 1, value: null, companyId: 1 }],
    openTotal: { count: 1, value: null },
  });
  assert.equal(report.vendas.ontem, null);
  assert.equal(report.ranking[0].faturamento, null);
  assert.equal(report.orcamentos.valor, null);
  assert.equal(report.orcamentos.valorAberto, null);
  assert.match(report.texto, /Há venda sem valor/);
  assert.equal(engine.money(null), "não informado");
  assert.match(engine.money(0), /0,00/);
});

test("a consulta do café não completa item sem total", () => {
  assert.match(service, /sp\.VLUNIT IS NOT NULL THEN sp\.QTDPRODUTO \* sp\.VLUNIT/);
  assert.doesNotMatch(service, /COALESCE\(sp\.TOTAL,sp\.QTDPRODUTO\*sp\.VLUNIT,0\)/);
  assert.doesNotMatch(service, /SUM\(COALESCE\(VLTOTAL,0\)\)/);
  assert.doesNotMatch(service, /SUM\(COALESCE\(o\.VLTOTAL,0\)\)/);
});
