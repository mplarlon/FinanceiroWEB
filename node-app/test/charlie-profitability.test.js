import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPACT_TYPES,
  allocateAmount,
  calculateProfitability,
  investigateOccurrence,
  robustAnomaly,
} from "../server/lib/charlie-profitability.js";

test("calcula margem bruta e contribuição negativa sem chamar IA", () => {
  const result = calculateProfitability({
    quantity: 1, grossRevenue: 150, historicalUnitCost: 130,
    taxes: 15, commission: 7.5, freightPaid: 5,
    taxesAvailable: true, commissionAvailable: true, freightAvailable: true,
  }, { minimumMarginPercent: 10 });
  assert.equal(result.netRevenue, 150);
  assert.equal(result.grossMargin, 20);
  assert.equal(result.variableExpenses, 27.5);
  assert.equal(result.contributionMargin, -7.5);
  assert.equal(result.classification, IMPACT_TYPES.VERIFIED_LOSS);
  assert.equal(result.complete, true);
});

test("desconto reduz receita líquida e não é contado duas vezes", () => {
  const result = calculateProfitability({
    quantity: 2, grossRevenue: 200, discount: 20, historicalUnitCost: 50,
    taxes: 10, commission: 5, taxesAvailable: true, commissionAvailable: true, freightAvailable: true,
  }, { minimumMarginPercent: 30 });
  assert.equal(result.netRevenue, 180);
  assert.equal(result.cogs, 100);
  assert.equal(result.contributionMargin, 65);
  assert.equal(result.marginPercent, 36.11);
});

test("frete coletivo é rateado e preserva exatamente o total", () => {
  const allocated = allocateAmount(10, [{ revenue: 50 }, { revenue: 30 }, { revenue: 20 }]);
  assert.deepEqual(allocated, [5, 3, 2]);
  assert.equal(allocated.reduce((sum, value) => sum + value, 0), 10);
});

test("custo atual é identificado como estimativa e componente ausente", () => {
  const result = calculateProfitability({ quantity: 2, grossRevenue: 100, currentUnitCost: 30, taxesAvailable: false, commissionAvailable: false, freightAvailable: false });
  assert.equal(result.cogs, 60);
  assert.equal(result.costSource, "custo_atual_estimado");
  assert.deepEqual(result.missing, ["custo_historico", "tributos", "comissao", "frete"]);
  assert.equal(result.complete, false);
});

test("margem inferior à meta não é chamada de prejuízo verificado", () => {
  const result = calculateProfitability({ quantity: 1, grossRevenue: 100, historicalUnitCost: 85, taxesAvailable: true, commissionAvailable: true, freightAvailable: true }, { minimumMarginPercent: 20 });
  assert.equal(result.contributionMargin, 15);
  assert.equal(result.classification, IMPACT_TYPES.INSUFFICIENT_MARGIN);
});

test("anomalia robusta exige histórico e detecta desvio auditável", () => {
  assert.equal(robustAnomaly([10, 11, 12], 30).reason, "historico_insuficiente");
  const result = robustAnomaly([9, 10, 10, 11, 12, 10], 40);
  assert.equal(result.anomalous, true);
  assert.equal(result.method, "z_score_modificado_mad");
});

test("investigação expõe composição, fontes e ressalva contábil", () => {
  const occurrence = { type: IMPACT_TYPES.VERIFIED_LOSS, netRevenue: 150, cogs: 130, grossMargin: 20, taxes: 15, commission: 7.5, freightPaid: 5, freightCharged: 0, variableExpenses: 27.5, contributionMargin: -7.5, marginPercent: -5, evidence: ["SAIDAPRODUTO"], missing: [], disclaimer: "não é lucro líquido" };
  const result = investigateOccurrence(occurrence);
  assert.equal(result.composition.margemContribuicao, -7.5);
  assert.deepEqual(result.evidence, ["SAIDAPRODUTO"]);
  assert.match(result.disclaimer, /lucro líquido/);
});
