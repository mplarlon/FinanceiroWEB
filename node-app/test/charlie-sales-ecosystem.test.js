import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_WIDGETS,
  SALES_MENU,
  defaultDashboardLayout,
  describeEcommercePermissions,
  findSalesMenuItem,
  listSalesAlerts,
  listSalesAudit,
  moveDashboardWidget,
  normalizeDashboardLayout,
  toggleDashboardWidget,
  normalizeSalesSection,
  salesMenuItems,
  summarizeSalesDashboard,
} from "../client/src/lib/charlie-sales-ecosystem.js";

test("o menu do Charlie Sales reserva os módulos pedidos e aponta os que já funcionam", () => {
  const items = salesMenuItems();
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.equal(items.length, 31);
  assert.deepEqual(SALES_MENU.map((group) => group.label), ["Visão geral", "Vendas", "Loja online", "Novos clientes", "Gestão", "Administração"]);
  assert.equal(findSalesMenuItem("intelligence").kind, "intelligence");
  assert.equal(findSalesMenuItem("loja").kind, "store");
  assert.equal(findSalesMenuItem("leads").kind, "leads");
  assert.equal(findSalesMenuItem("dashboard").kind, "dashboard");
  assert.equal(findSalesMenuItem("booster").kind, "booster");
  assert.equal(findSalesMenuItem("hunter").kind, "hunter");
  assert.equal(findSalesMenuItem("whatsapp").kind, "whatsapp");
  assert.equal(findSalesMenuItem("quotes").kind, "quotes");
  assert.equal(findSalesMenuItem("recovery").kind, "recovery");
  assert.equal(findSalesMenuItem("precos").kind, "prices");
  assert.equal(findSalesMenuItem("radar").kind, "radar");
  assert.equal(findSalesMenuItem("rebuy").kind, "rebuy");
  assert.equal(findSalesMenuItem("estoque").kind, "stock");
  assert.equal(findSalesMenuItem("campanhas").kind, "campaigns");
  assert.equal(findSalesMenuItem("autopilot").kind, "autopilot");
  assert.equal(findSalesMenuItem("match").kind, "match");
  assert.equal(findSalesMenuItem("signals").kind, "signals");
  assert.equal(findSalesMenuItem("compras").kind, "purchasing");
  assert.equal(findSalesMenuItem("coach").kind, "coach");
  assert.equal(findSalesMenuItem("shopping").kind, "shopping");
  assert.equal(findSalesMenuItem("seo").kind, "seo");
  assert.equal(findSalesMenuItem("kits").kind, "kits");
  assert.equal(findSalesMenuItem("lucro").kind, "lucro");
  assert.equal(findSalesMenuItem("customer360").kind, "customer360");
  assert.equal(findSalesMenuItem("mission").kind, "mission");
  assert.equal(findSalesMenuItem("automacoes").kind, "automations");
  assert.equal(normalizeSalesSection("inexistente"), "dashboard");
  for (const item of items.filter((entry) => entry.kind === "planned")) {
    assert.equal(Number.isInteger(item.stage), true);
    assert.equal(item.summary.length > 20, true);
  }
});

test("a disposição dos indicadores aceita ordem, ocultação e indicadores novos", () => {
  const original = defaultDashboardLayout();
  const moved = moveDashboardWidget(original, "orders", -1);
  assert.equal(original[0].id, "revenue");
  assert.equal(moved[0].id, "orders");
  assert.equal(moved[1].id, "revenue");
  assert.deepEqual(moveDashboardWidget(original, "revenue", -1).map((item) => item.id), original.map((item) => item.id));

  const hidden = toggleDashboardWidget(original, "criticalAlerts");
  assert.equal(hidden.find((item) => item.id === "criticalAlerts").visible, false);
  assert.equal(original.find((item) => item.id === "criticalAlerts").visible, true);

  const normalized = normalizeDashboardLayout([
    { id: "desconhecido", visible: true },
    { id: "orders", visible: false },
    { id: "orders", visible: true },
    { id: "revenue", visible: true },
  ]);
  assert.equal(normalized[0].id, "orders");
  assert.equal(normalized[0].visible, false);
  assert.equal(normalized.filter((item) => item.id === "orders").length, 1);
  assert.equal(normalized.length, DASHBOARD_WIDGETS.length);
  assert.equal(normalized.some((item) => item.id === "desconhecido"), false);
  assert.deepEqual(normalizeDashboardLayout(null).map((item) => item.id), DASHBOARD_WIDGETS.map((item) => item.id));
});

test("o dashboard usa somente valores lidos e preserva margem indisponível", () => {
  const dashboard = {
    metrics: {
      revenue: { available: true, value: 1000 },
      orders: { available: true, value: 4 },
      averageTicket: { available: true, value: 250 },
      contributionMargin: { available: false, reason: "Custos, impostos e comissões ainda não estão consolidados." },
    },
    channels: [
      { marketplace: "Tray", orders: 3, revenue: 800 },
      { marketplace: "Mercado Livre", orders: 1, revenue: 200 },
    ],
  };
  const control = {
    opportunities: [
      { id: "1", status: "identified", priority: "critical", type: "pricing", productId: "p1" },
      { id: "2", status: "identified", priority: "high", type: "inventory", productId: "p1" },
      { id: "3", status: "identified", priority: "medium", type: "customer_recovery", customerId: "c1" },
      { id: "4", status: "converted", priority: "medium", type: "customer_recovery", customerId: "c2" },
      { id: "5", status: "dismissed", priority: "critical", type: "pricing", productId: "p9" },
    ],
    results: { executedActions: 2 },
  };
  const summary = summarizeSalesDashboard(dashboard, control);
  assert.equal(summary.revenue.value, 1000);
  assert.equal(summary.orders.value, 4);
  assert.equal(summary.averageTicket.value, 250);
  assert.equal(summary.contributionMargin.available, false);
  assert.equal(summary.contributionMargin.value, null);
  assert.match(summary.contributionMargin.reason, /Custos/);
  assert.equal(summary.opportunities.value, 3);
  assert.equal(summary.recoveredCustomers.value, 1);
  assert.equal(summary.problemProducts.value, 1);
  assert.equal(summary.criticalAlerts.value, 1);
  assert.equal(summary.executedActions.value, 2);
  assert.equal(summary.marketplaces.value.length, 2);

  const missing = summarizeSalesDashboard(null, null);
  for (const id of DASHBOARD_WIDGETS.map((item) => item.id)) {
    assert.equal(missing[id].available, false);
    assert.equal(missing[id].value, null);
  }
  const partial = summarizeSalesDashboard(dashboard, {});
  assert.equal(partial.revenue.available, true);
  assert.equal(partial.opportunities.available, false);
  assert.equal(partial.executedActions.value, null);
});

test("alertas, auditoria e permissões leem o controle sem completar lacuna", () => {
  const alerts = listSalesAlerts([
    { id: "a", status: "dismissed", priority: "critical" },
    { id: "b", status: "identified", priority: "medium", updatedAt: "2026-10-01" },
    { id: "c", status: "identified", priority: "critical", updatedAt: "2026-10-02" },
    { id: "d", status: "converted", priority: "high" },
  ]);
  assert.deepEqual(alerts.map((item) => item.id), ["c", "b"]);

  const audit = listSalesAudit([
    { id: "ACT-1", description: "Ajustar preço", history: [{ at: "2026-10-02T10:00:00.000Z", event: "approved", actor: "7" }, { at: "2026-10-01T10:00:00.000Z", event: "created", actor: "Charlie" }] },
    { id: "ACT-2", description: "Sem histórico", status: "pending", createdAt: "2026-10-03T10:00:00.000Z", createdBy: "9" },
  ]);
  assert.equal(audit[0].actionId, "ACT-2");
  assert.equal(audit[1].event, "approved");
  assert.equal(audit.length, 3);

  assert.equal(describeEcommercePermissions({}).approve, "Qualquer usuário com permissão gerencial");
  assert.equal(describeEcommercePermissions({ executeUserIds: [4, 0, "8"] }).execute, "4, 8");
});
