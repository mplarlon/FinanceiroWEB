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
  const semValor = normalizeTrayOrder({ id: 124, ProductsSold: [{ ProductsSold: { product_id: 8, name: "Sem preço" } }] });
  assert.equal(semValor.items[0].quantity, null);
  assert.equal(semValor.items[0].total, null);
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
  assert.equal(result.metrics.averageTicket.value, 100);
  assert.equal(result.topProducts[0].revenue, 100);
  assert.equal(result.topProducts[0].quantity, 2);
  assert.equal(result.channels[0].orders, 1);
  assert.equal(result.channels[0].revenue, 100);
  assert.equal(result.channels[0].ticket, 100);
});

test("canal sem valor não vira faturamento nem ticket zero", () => {
  const store = { sync: {}, products: {}, customers: {}, orders: {
    "1": { externalId: "1", date: "2026-10-10", status: "Aprovado", marketplace: "Shopee", total: null, items: [] },
    "2": { externalId: "2", date: "2026-10-11", status: "Aprovado", marketplace: "Shopee", total: 40, items: [] },
    "3": { externalId: "3", date: "2026-10-12", status: "Aprovado", marketplace: "Magalu", total: 0, items: [] },
  } };
  const result = buildEcommerceDashboard({}, store);
  const shopee = result.channels.find((item) => item.marketplace === "Shopee");
  const magalu = result.channels.find((item) => item.marketplace === "Magalu");
  assert.equal(shopee.orders, 2);
  assert.equal(shopee.revenue, null);
  assert.equal(shopee.ticket, null);
  assert.match(shopee.observacao, /sem valor/);
  assert.equal(magalu.revenue, 0);
  assert.equal(magalu.ticket, 0);
  assert.equal(magalu.observacao, null);
  assert.equal(result.metrics.revenue.value, 40);
  assert.equal(result.metrics.revenue.reason, "A soma usa só os pedidos que têm valor.");
  assert.equal(result.metrics.averageTicket.available, false);
  assert.match(result.metrics.averageTicket.reason, /não foi calculado/);
});

test("produto sem valor não entra como receita zero", () => {
  const store = { sync: {}, products: {}, customers: {}, orders: {
    "1": { externalId: "1", date: "2026-10-10", status: "Aprovado", marketplace: "Shopee", total: 10, items: [
      { externalId: "P1", name: "Cabo", reference: "C", quantity: 1, total: null },
      { externalId: "P1", name: "Cabo", reference: "C", quantity: 2, total: 10 },
    ] },
    "2": { externalId: "2", date: "2026-10-11", status: "Aprovado", marketplace: "Shopee", total: 0, items: [
      { externalId: "P2", name: "Luva", reference: "L", quantity: 0, total: 0 },
    ] },
  } };
  const result = buildEcommerceDashboard({}, store);
  const cabo = result.topProducts.find((item) => item.id === "P1");
  const luva = result.topProducts.find((item) => item.id === "P2");
  assert.equal(cabo.revenue, null);
  assert.equal(cabo.quantity, 3);
  assert.match(cabo.observacao, /sem valor/);
  assert.equal(luva.revenue, 0);
  assert.equal(luva.quantity, 0);
  assert.equal(luva.observacao, null);
});

test("dashboard filtra categoria e marca pelo catálogo sincronizado", () => {
  const store = { sync: {}, products: { P1: { externalId: "P1", category: "Rolamentos", brand: "SKF" } }, customers: {}, orders: {
    O1: { externalId: "O1", date: "2026-10-10", status: "Aprovado", marketplace: "Tray", total: 50, customerName: "Ana", items: [{ externalId: "P1", name: "Produto", reference: "R", quantity: 1, total: 50 }] },
  } };
  assert.equal(buildEcommerceDashboard({ category: "Rolamentos", brand: "SKF" }, store).metrics.orders.value, 1);
  assert.equal(buildEcommerceDashboard({ brand: "Outra" }, store).metrics.orders.value, 0);
});
