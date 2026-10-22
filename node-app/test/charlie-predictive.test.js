import test from "node:test";
import assert from "node:assert/strict";
import {
  assessCustomerInactivity,
  backtest,
  errorMetrics,
  forecastSeries,
  forecastStock,
  normalizeSeries,
  predictiveMethods,
  projectCashFlow,
  simulateFinancialScenario,
  simulatePriceScenario,
} from "../server/lib/charlie-predictive-engine.js";
import { planAutomation } from "../server/lib/charlie-automation-plan.js";

const days = (count, mapper = (index) => 100 + index * 3) => Array.from({ length: count }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), value: mapper(index) }));

test("extrai, agrega duplicidades e identifica lacunas sem inventar registros", () => {
  const result = normalizeSeries([{ date: "2026-01-01", value: 10 }, { date: "2026-01-01", value: 5 }, { date: "2026-01-03", value: 8 }], { minimumRecords: 2 });
  assert.equal(result.points.length, 3);
  assert.deepEqual(result.points.map((x) => x.value), [15, 0, 8]);
  assert.equal(result.quality.duplicates, 1);
  assert.equal(result.quality.gaps, 1);
});

test("rejeita previsão sem fundamento estatístico", () => {
  const result = forecastSeries(days(5), { horizon: 7, minimumRecords: 14 });
  assert.equal(result.ok, false);
  assert.equal(result.quality.status, "insuficiente");
});

test("previsão de faturamento seleciona método validado e produz intervalo", () => {
  const result = forecastSeries(days(90), { horizon: 30, minimumRecords: 28 });
  assert.equal(result.ok, true);
  assert.equal(result.forecasts.length, 30);
  assert.ok(predictiveMethods.includes(result.model));
  assert.ok(result.interval.lower <= result.total && result.total <= result.interval.upper);
  assert.ok(result.validation.samples >= 3);
  assert.equal(typeof result.validation.beatsNaive, "boolean");
});

test("backtesting temporal não usa o ponto futuro no treinamento", () => {
  const values = days(40).map((x) => x.value);
  const result = backtest(values, "linear_trend", { minimumTrain: 14 });
  assert.equal(result.samples, 26);
  assert.ok(result.metrics.mae < 0.01);
});

test("métricas tratam séries próximas de zero sem MAPE", () => {
  const metrics = errorMetrics([0, 0, 1], [1, 0, 1]);
  assert.equal(metrics.mae, 0.33);
  assert.equal(metrics.wape, 100);
  assert.equal("mape" in metrics, false);
});

test("projeção de caixa aponta a primeira data negativa e preserva conceitos", () => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const d0 = today.toISOString().slice(0, 10), d1 = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const result = projectCashFlow({ openingBalance: 100, receivables: [{ date: d1, value: 30 }], payables: [{ date: d0, value: 150 }], horizon: 2 });
  assert.equal(result.firstNegativeDate, d0);
  assert.equal(result.closingBalance, -20);
});

test("previsão de estoque diferencia cobertura, risco e compra sugerida", () => {
  const [item] = forecastStock([{ product: "A", onHand: 20, reserved: 5, inbound: 2, dailyDemand: 3, leadTimeDays: 10 }], { safetyDays: 5 });
  assert.equal(item.available, 15);
  assert.equal(item.coverageDays, 5);
  assert.equal(item.risk, "alto");
  assert.equal(item.suggestedPurchase, 28);
});

test("sugestão de compra nunca fica negativa", () => {
  const [item] = forecastStock([{ onHand: 100, dailyDemand: 1, leadTimeDays: 5, inbound: 20 }]);
  assert.equal(item.suggestedPurchase, 0);
});

test("inatividade não apresenta probabilidade e exige histórico para classificação forte", () => {
  const result = assessCustomerInactivity([{ customer: "A", lastPurchase: "2026-01-01", intervals: [10, 10, 10] }, { customer: "B", lastPurchase: "2026-01-01", intervals: [10] }], new Date("2026-02-01T00:00:00Z"));
  assert.equal(result[0].classification, "risco_inatividade");
  assert.equal(result[1].classification, "reducao_observada");
  assert.equal("probability" in result[0], false);
});

test("simulação de preços mantém quantidade constante e calcula margem sem alterar entrada", () => {
  const source = [{ product: "A", price: 100, cost: 60, variableExpense: 10, quantity: 2 }];
  const result = simulatePriceScenario(source, { priceChangePercent: 10, costChangePercent: 5 });
  assert.equal(result.current.revenue, 200);
  assert.equal(result.simulated.revenue, 220);
  assert.equal(result.simulated.contribution, 74);
  assert.equal(source[0].price, 100);
  assert.match(result.assumptions.join(" "), /Quantidades vendidas mantidas/);
});

test("cenário financeiro aplica efeitos acumulados sem modificar projeção base", () => {
  const base = [{ date: "2026-11-01", balance: 50000 }, { date: "2026-11-02", balance: 45000 }];
  const result = simulateFinancialScenario(base, [{ date: "2026-11-01", value: -20000 }]);
  assert.deepEqual(result.map((x) => x.simulatedBalance), [30000, 25000]);
  assert.equal(base[0].balance, 50000);
});

test("intervalo só é marcado validado após amostra mínima", () => {
  const result = forecastSeries(days(30, (index) => 80 + Math.sin(index) * 5), { horizon: 7, minimumRecords: 14 });
  assert.equal(result.ok, true);
  assert.equal(result.interval.statisticallyValidated, true);
});

test("reutiliza o agendador existente para previsões recorrentes", () => {
  const plan = planAutomation("Toda segunda-feira às 8h faça uma previsão do fluxo de caixa dos próximos 30 dias", { id: 7, gerencial: true }, { now: new Date("2026-10-20T12:00:00Z") });
  assert.equal(plan.ok, true);
  assert.equal(plan.automacao.acao, "preditivo.fluxo_caixa");
  assert.equal(plan.automacao.parametros.dias, 30);
  assert.equal(plan.automacao.politicaConfirmacao, "automatica_leitura");
});
