import assert from "node:assert/strict";
import test from "node:test";
import { analyzeEcommerceAdvanced, canEcommerce, ecommerceResults, faturamentoDoDia } from "../server/lib/ecommerce-advanced.js";

const control = () => ({ settings: { mode: "manual", minimumMargin: 20, maximumAutomaticChange: 5, inactiveCustomerDays: 60, protectedProducts: [], permissions: { approveUserIds: [], executeUserIds: [], configureUserIds: [] } }, opportunities: {}, actions: {}, campaigns: {}, runs: [] });

test("análise de e-commerce calcula margem, ruptura e ações sem Ollama", () => {
  const store = {
    products: { P1: { externalId: "P1", name: "Rolamento", price: 90, cost: 100, stock: 1 } },
    orders: { O1: { status: "Aprovado", date: "2026-10-20", marketplace: "Tray", items: [{ externalId: "P1", quantity: 90, total: 8100 }] } },
  };
  const state = control();
  const result = analyzeEcommerceAdvanced(store, state, { persist: false });
  assert.equal(result.products[0].contributionMargin < 0, true);
  assert.equal(result.products[0].stockRisk, "high");
  assert.equal(result.opportunities.length, 2);
  assert.equal(Object.values(state.actions).some((item) => item.type === "price" && item.status === "pending"), true);
  assert.equal(Object.values(state.actions).some((item) => item.type === "purchase_request"), true);
});

test("resultados separam receita observada de potencial estimado", () => {
  const state = control();
  state.opportunities.OP = { id: "OP", status: "identified", potentialValue: 500 };
  state.actions.ACT = { id: "ACT", status: "executed", result: { ok: true, observedRevenue: 120 } };
  const result = ecommerceResults(state);
  assert.equal(result.observedRevenue, 120);
  assert.equal(result.estimatedRevenue, 500);
  state.actions.SEM = { id: "SEM", status: "executed", result: {} };
  assert.equal(ecommerceResults(state).observedRevenue, null);
  state.opportunities.VAZIO = { id: "VAZIO", status: "identified", potentialValue: null };
  const parcial = ecommerceResults(state);
  assert.equal(parcial.estimatedRevenue, 500);
  assert.match(parcial.estimatedRevenueObservacao, /só as oportunidades/);
  state.opportunities.ZERO = { id: "ZERO", status: "identified", potentialValue: 0 };
  assert.equal(ecommerceResults(state).estimatedRevenue, 500);
  assert.match(result.attributionNotice, /não atribuem automaticamente/i);
});

test("recuperação de cliente cria tarefa CRM sem enviar comunicação", () => {
  const store = { products: {}, orders: {
    O1: { customerId: "C1", customerName: "Cliente", status: "Aprovado", date: "2025-01-10", total: 100, items: [] },
    O2: { customerId: "C1", customerName: "Cliente", status: "Aprovado", date: "2025-02-10", total: 200, items: [] },
  } };
  const state = control();
  analyzeEcommerceAdvanced(store, state, { persist: false });
  const action = Object.values(state.actions).find((item) => item.type === "crm_task");
  assert.equal(Boolean(action), true);
  assert.equal(action.status, "pending");
  assert.equal(action.impact, 150);
});

test("pedido sem valor não vira média de recuperação nem estoque parado", () => {
  const store = {
    products: {
      P1: { externalId: "P1", name: "Cabo", price: 10, cost: 4, stock: 5 },
      P2: { externalId: "P2", name: "Luva", price: 10, cost: 4, stock: 5 },
    },
    orders: {
      O1: { customerId: "C1", customerName: "Cliente", status: "Aprovado", date: "2025-01-10", total: 100, marketplace: "Shopee", items: [{ externalId: "P1", quantity: 2, total: null }] },
      O2: { customerId: "C1", customerName: "Cliente", status: "Aprovado", date: "2025-02-10", total: null, marketplace: "Shopee", items: [{ externalId: "P2", quantity: null, total: 10 }] },
    },
  };
  const state = control();
  const result = analyzeEcommerceAdvanced(store, state, { persist: false });
  const cabo = result.products.find((item) => item.externalId === "P1");
  const luva = result.products.find((item) => item.externalId === "P2");
  const recuperacao = result.opportunities.find((item) => item.type === "customer_recovery");
  assert.equal(cabo.revenue, null);
  assert.equal(cabo.quantity, 2);
  assert.equal(luva.quantity, null);
  assert.equal(luva.stockRisk, null);
  assert.equal(result.opportunities.some((item) => item.type === "campaign"), false);
  assert.equal(recuperacao.potentialValue, null);
  assert.equal(recuperacao.evidence.historicalAverage, null);
  assert.equal(Object.values(state.actions).find((item) => item.type === "crm_task").impact, null);
  assert.equal(faturamentoDoDia([{ date: "2026-10-26", status: "Aprovado", total: 10 }, { date: "2026-10-26", status: "Aprovado", total: 0 }], "2026-10-26").revenue, 10);
  assert.equal(faturamentoDoDia([{ date: "2026-10-26", status: "Aprovado", total: 10 }, { date: "2026-10-26", status: "Aprovado", total: null }], "2026-10-26").revenue, null);
});

test("permissões específicas restringem aprovação e execução", () => {
  const settings = control().settings;
  settings.permissions.approveUserIds = [7]; settings.permissions.executeUserIds = [8];
  assert.equal(canEcommerce({ idusuario: 7, permissao_gerencial: true }, "approve", settings), true);
  assert.equal(canEcommerce({ idusuario: 8, permissao_gerencial: true }, "approve", settings), false);
  assert.equal(canEcommerce({ idusuario: 8, permissao_gerencial: true }, "execute", settings), true);
  assert.equal(canEcommerce({ idusuario: 7, permissao_gerencial: false }, "approve", settings), false);
});
