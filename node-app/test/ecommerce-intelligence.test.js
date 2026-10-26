import assert from "node:assert/strict";
import test from "node:test";
import { buildEcommerceDashboard, identifyMarketplace, normalizeTrayOrder } from "../server/lib/ecommerce-intelligence.js";

test("identifica marketplace sem afirmar origem ausente", () => {
  assert.equal(identifyMarketplace({ marketplace_name: "Mercado Livre Brasil" }), "Mercado Livre");
  assert.equal(identifyMarketplace({ point_sale: "Shopee" }), "Shopee");
  assert.equal(identifyMarketplace({}), "Loja virtual Tray");
});

test("normaliza pedido Tray preservando identificador externo e itens", () => {
  const order = normalizeTrayOrder({
    id: 123,
    status: "Aprovado",
    total: "150.50",
    marketplace_name: "Mercado Livre",
    Customer: { id: 9, name: "Cliente Real" },
    ProductsSold: [{ ProductsSold: { product_id: 77, name: "Rolamento", quantity: 2, price: 50 } }],
  });
  assert.equal(order.externalId, "123");
  assert.equal(order.customerId, "9");
  assert.equal(order.items[0].quantity, 2);
  assert.equal(order.items[0].total, 100);
});

test("dashboard calcula faturamento e não inventa margem", () => {
  const store = {
    sync: { status: "online", lastSuccessAt: "2026-10-26T12:00:00.000Z" },
    orders: {
      "1": { externalId: "1", date: "2026-10-10", status: "Aprovado", marketplace: "Shopee", total: 100, customerName: "Ana", items: [{ externalId: "P1", name: "Produto", reference: "R1", quantity: 2, total: 100 }] },
      "2": { externalId: "2", date: "2026-10-11", status: "Cancelado", marketplace: "Shopee", total: 80, customerName: "Bia", items: [] },
    }, products: {}, customers: {},
  };
  const result = buildEcommerceDashboard({ start: "2026-10-01", end: "2026-10-31" }, store);
  assert.equal(result.metrics.revenue.value, 100);
  assert.equal(result.metrics.orders.value, 2);
  assert.equal(result.metrics.canceledOrders.value, 1);
  assert.equal(result.metrics.contributionMargin.available, false);
  assert.equal(result.channels[0].orders, 1);
});

test("dashboard filtra categoria e marca pelo catálogo sincronizado", () => {
  const store = { sync: {}, products: { P1: { externalId: "P1", category: "Rolamentos", brand: "SKF" } }, customers: {}, orders: {
    O1: { externalId: "O1", date: "2026-10-10", status: "Aprovado", marketplace: "Tray", total: 50, customerName: "Ana", items: [{ externalId: "P1", name: "Produto", reference: "R", quantity: 1, total: 50 }] },
  } };
  assert.equal(buildEcommerceDashboard({ category: "Rolamentos", brand: "SKF" }, store).metrics.orders.value, 1);
  assert.equal(buildEcommerceDashboard({ brand: "Outra" }, store).metrics.orders.value, 0);
});
