import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { aplicarCampos, somaLida, valorJanela, valorLido } from "../server/lib/charlie-sale-value.js";
import { faturamentoVendedor, preverFaturamento } from "../server/lib/charlie-task-actions.js";
import { DEFAULT_MONITOR_SETTINGS, buildFindings } from "../server/lib/charlie-monitor-rules.js";

const ler = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const formula = ler("server/lib/charlie-sale-value.js");
const fontes = [
  "server/lib/charlie-task-actions.js",
  "server/lib/charlie-monitor.js",
  "server/lib/charlie-knowledge.js",
  "server/lib/charlie-profitability.js",
  "server/lib/charlie-predictive-service.js",
  "server/routes/assistant.js",
].map(ler).join("\n");

test("item sem valor não vira zero e zero gravado permanece", () => {
  assert.equal(valorLido(100, 1), null);
  assert.equal(valorLido(0, 0), 0);
  assert.equal(valorLido(null, 0), null);
  assert.equal(valorJanela(null, 0), 0);
  assert.equal(valorJanela(80, 2), null);
  assert.equal(somaLida([{ TOTAL: 10 }, { TOTAL: null }]), null);
  assert.equal(somaLida([{ TOTAL: 0 }, { TOTAL: 15 }]), 15);
  assert.equal(somaLida([]), 0);
});

test("faturamento do assistente não soma vendedor com item sem valor", async () => {
  const incompleto = await faturamentoVendedor({
    query: async () => [{ VENDEDOR: "Ana", PEDIDOS: 2, TOTAL: 100, SEM: 1 }],
  }, { periodo: "mes" });
  assert.equal(incompleto.linhas[0].TOTAL, null);
  assert.equal(incompleto.totais.TOTAL, null);
  assert.match(incompleto.resumo, /não foi somado/);
  const zero = await faturamentoVendedor({
    query: async () => [{ VENDEDOR: "Ana", PEDIDOS: 1, TOTAL: 0, SEM: 0 }],
  }, { periodo: "mes" });
  assert.equal(zero.linhas[0].TOTAL, 0);
  assert.equal(zero.totais.TOTAL, 0);
  const previsao = await preverFaturamento({
    query: async () => [{ DATA: "2026-10-01", VALOR: 10, SEM: 1 }],
  }, { dias: 7 });
  assert.equal(previsao.quantidade, 0);
  assert.match(previsao.resumo, /sem valor/);
});

test("monitor não trata faturamento ausente como queda", () => {
  const base = { bruto: 0, desconto: 0, produtos: [], margemBaixa: [], clientesSumidos: [] };
  const ausente = buildFindings({
    vendas: { ...base, atual: null, anterior: 1000, vendedores: [{ ID: 1, NOME: "Ana", ATUAL: null, ANTERIOR: 1000 }] },
  }, DEFAULT_MONITOR_SETTINGS);
  assert.equal(ausente.some((item) => item.regra === "vendas_queda" || item.regra === "vendedores_queda"), false);
  const zero = buildFindings({
    vendas: { ...base, atual: 0, anterior: 1000, vendedores: [] },
  }, DEFAULT_MONITOR_SETTINGS);
  assert.equal(zero.some((item) => item.regra === "vendas_queda"), true);
});

test("as consultas do assistente não completam o item com zero", () => {
  assert.match(formula, /VLUNIT IS NOT NULL THEN sp\.QTDPRODUTO \* sp\.VLUNIT/);
  assert.doesNotMatch(fontes, /QTDPRODUTO\*sp\.VLUNIT,0/);
  assert.doesNotMatch(fontes, /QTDPRODUTO \* sp\.VLUNIT, 0/);
});

test("relatórios de vendas não completam item sem valor como zero", () => {
  const incompleto = aplicarCampos({ TOTAL: 40, LUCRO: 10, SEM: 1 }, ["TOTAL", "LUCRO"]);
  assert.equal(incompleto.TOTAL, null);
  assert.equal(incompleto.LUCRO, null);
  assert.equal("SEM" in incompleto, false);
  assert.equal(aplicarCampos({ TOTAL: 0, SEM: 0 }, ["TOTAL"]).TOTAL, 0);
  const relatorios = [
    "server/routes/sales.js",
    "server/routes/management-reports.js",
    "server/routes/legacy-sales-stock.js",
    "server/routes/finance-accounts.js",
    "client/src/pages/Overview.jsx",
    "client/src/pages/BusinessDashboard.jsx",
    "client/src/pages/ExecutiveReports.jsx",
  ].map(ler).join("\n");
  assert.match(relatorios, /ITEM_VALOR_SQL/);
  assert.match(relatorios, /não informado/);
  assert.doesNotMatch(relatorios, /QTDPRODUTO\s*\*\s*sp\.VLUNIT,\s*0/);
  assert.doesNotMatch(relatorios, /QTDPRODUTO\*sp\.VLUNIT,0/);
  assert.doesNotMatch(ler("server/routes/legacy-sales-stock.js"), /COALESCE\(VLTOTAL,0\)/);
  assert.doesNotMatch(ler("server/routes/legacy-sales-stock.js"), /COALESCE\(s\.VLTOTAL,0\)/);
  const restantes = [
    "server/lib/charlie-sales-coach-service.js",
    "server/routes/sales.js",
    "server/routes/management-reports.js",
    "server/routes/finance-accounts.js",
    "scripts/smoke-charlie-readonly.js",
  ].map(ler).join("\n");
  assert.doesNotMatch(restantes, /QTDPRODUTO\s*\*\s*sp\.VLUNIT,\s*0/);
  assert.doesNotMatch(ler("server/routes/sales.js"), /COALESCE\(t\.DIVIDA,t\.VALOR,0\)/);
  assert.doesNotMatch(ler("server/routes/management-reports.js"), /COALESCE\(DIVIDA,VALOR,0\)/);
  assert.doesNotMatch(ler("server/routes/management-reports.js"), /COALESCE\(m\.QTDEATUAL,0\)/);
  assert.doesNotMatch(ler("server/routes/finance-accounts.js"), /COALESCE\(ep\.VLTOT,ep\.QTDE\*ep\.VLUNIT,0\)/);
  assert.doesNotMatch(ler("server/lib/charlie-sales-coach-service.js"), /COALESCE\(sp\.SUBTOTAL, sp\.TOTAL, sp\.QTDPRODUTO \* sp\.VLUNIT\)/);
});
