import assert from "node:assert/strict";
import test from "node:test";
import { analyzeEcommerceAdvanced, canEcommerce, ecommerceResults } from "../server/lib/ecommerce-advanced.js";

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
});

test("permissões específicas restringem aprovação e execução", () => {
  const settings = control().settings;
  settings.permissions.approveUserIds = [7]; settings.permissions.executeUserIds = [8];
  assert.equal(canEcommerce({ idusuario: 7, permissao_gerencial: true }, "approve", settings), true);
  assert.equal(canEcommerce({ idusuario: 8, permissao_gerencial: true }, "approve", settings), false);
  assert.equal(canEcommerce({ idusuario: 8, permissao_gerencial: true }, "execute", settings), true);
  assert.equal(canEcommerce({ idusuario: 7, permissao_gerencial: false }, "approve", settings), false);
});
