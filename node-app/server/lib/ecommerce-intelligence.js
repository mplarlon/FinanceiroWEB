import { readJsonConfig, writeJsonConfig } from "./json-config.js";

export const ECOMMERCE_DATA_FILE = "ecommerce_intelligence.json";

const emptyStore = () => ({
  version: 1,
  orders: {},
  products: {},
  customers: {},
  sync: { status: "never", lastSuccessAt: null, lastAttemptAt: null, cursor: null, errors: [] },
});

const text = (value) => String(value ?? "").trim();
const number = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

export function readEcommerceStore() {
  const stored = readJsonConfig(ECOMMERCE_DATA_FILE, emptyStore());
  return { ...emptyStore(), ...stored, orders: stored.orders || {}, products: stored.products || {}, customers: stored.customers || {} };
}

export function identifyMarketplace(order = {}) {
  const raw = text(first(
    order.marketplace_name, order.marketplace, order.channel, order.sales_channel,
    order.point_sale, order.PointSale?.name, order.Store?.name, order.source,
  ));
  const value = raw.toLowerCase();
  if (value.includes("mercado livre") || value.includes("mercadolivre")) return "Mercado Livre";
  if (value.includes("shopee")) return "Shopee";
  if (value.includes("amazon")) return "Amazon";
  if (value.includes("magalu") || value.includes("magazine luiza")) return "Magalu";
  if (Array.isArray(order.MlOrder) && order.MlOrder.length) return "Mercado Livre";
  return raw || "Loja virtual Tray";
}

function normalizeItems(order = {}) {
  const raw = first(order.ProductsSolds, order.ProductsSold, order.products, order.items, order.OrderProducts, []);
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => entry?.ProductsSold || entry?.Product || entry).filter(Boolean).map((item) => ({
    externalId: text(first(item.product_id, item.id, item.Product?.id)),
    reference: text(first(item.reference, item.sku, item.Product?.reference)),
    name: text(first(item.name, item.product_name, item.Product?.name)) || "Produto sem descrição",
    quantity: number(first(item.quantity, item.amount, item.qty)) ?? 0,
    unitPrice: number(first(item.price, item.unit_price, item.value)),
    total: number(first(item.total, item.total_price)) ?? ((number(first(item.price, item.unit_price)) ?? 0) * (number(first(item.quantity, item.amount)) ?? 0)),
  }));
}

export function normalizeTrayOrder(order = {}) {
  const externalId = text(first(order.id, order.order_id, order.number));
  if (!externalId) return null;
  const status = text(first(order.status, order.status_name, order.Status?.name, order.status_id)) || "Indisponível";
  const dateValue = first(order.modified, order.updated_at, order.date, order.created_at);
  const customer = order.Customer || order.customer || {};
  return {
    externalId,
    number: text(first(order.number, order.id)),
    marketplace: identifyMarketplace(order),
    status,
    date: dateValue ? String(dateValue) : null,
    total: number(first(order.total, order.total_order, order.partial_total, order.payment_value)),
    freight: number(first(order.shipment_value, order.shipping_cost, order.freight, order.Shipping?.cost)),
    discount: number(first(order.discount, order.discount_value)),
    payment: text(first(order.payment_method, order.Payment?.payment_method, order.payment)),
    customerId: text(first(order.customer_id, customer.id)),
    customerName: text(first(order.customer_name, customer.name)),
    items: normalizeItems(order),
    source: "tray",
    rawUpdatedAt: text(first(order.modified, order.updated_at)),
  };
}

function normalizeProduct(product = {}) {
  const externalId = text(first(product.id, product.product_id));
  if (!externalId) return null;
  return {
    externalId,
    reference: text(first(product.reference, product.sku)),
    name: text(product.name) || "Produto sem descrição",
    category: text(first(product.category_name, product.Category?.name)),
    brand: text(first(product.brand, product.Brand?.name)),
    price: number(product.price),
    cost: number(first(product.cost_price, product.cost)),
    stock: number(product.stock),
    updatedAt: text(first(product.modified, product.updated_at)),
  };
}

function normalizeCustomer(customer = {}) {
  const externalId = text(first(customer.id, customer.customer_id));
  if (!externalId) return null;
  return { externalId, name: text(customer.name), email: text(customer.email), updatedAt: text(first(customer.modified, customer.updated_at)) };
}

export function mergeEcommerceData({ orders = [], products = [], customers = [], mode = "incremental", at = new Date().toISOString() } = {}) {
  const store = readEcommerceStore();
  let inserted = 0;
  let updated = 0;
  for (const raw of orders) {
    const item = normalizeTrayOrder(raw);
    if (!item) continue;
    if (store.orders[item.externalId]) updated += 1; else inserted += 1;
    store.orders[item.externalId] = { ...store.orders[item.externalId], ...item, synchronizedAt: at };
  }
  for (const raw of products) {
    const item = normalizeProduct(raw);
    if (item) store.products[item.externalId] = { ...store.products[item.externalId], ...item, synchronizedAt: at };
  }
  for (const raw of customers) {
    const item = normalizeCustomer(raw);
    if (item) store.customers[item.externalId] = { ...store.customers[item.externalId], ...item, synchronizedAt: at };
  }
  store.sync = { ...store.sync, status: "online", mode, lastAttemptAt: at, lastSuccessAt: at, cursor: at, errors: [] };
  writeJsonConfig(ECOMMERCE_DATA_FILE, store);
  return { store, result: { inserted, updated, total: Object.keys(store.orders).length } };
}

export function recordEcommerceSyncFailure(error, at = new Date().toISOString()) {
  const store = readEcommerceStore();
  store.sync = {
    ...store.sync,
    status: "error",
    lastAttemptAt: at,
    errors: [{ at, message: String(error?.message || error).slice(0, 500) }, ...(store.sync.errors || [])].slice(0, 20),
  };
  writeJsonConfig(ECOMMERCE_DATA_FILE, store);
  return store.sync;
}

function metric(value, available = true, reason = null) {
  return { value: available ? value : null, available, reason: available ? null : reason };
}

export function buildEcommerceDashboard(filters = {}, store = readEcommerceStore()) {
  const start = filters.start ? new Date(`${filters.start}T00:00:00`) : null;
  const end = filters.end ? new Date(`${filters.end}T23:59:59.999`) : null;
  const orderList = Object.values(store.orders).filter((order) => {
    const date = order.date ? new Date(String(order.date).replace(" ", "T")) : null;
    if (start && (!date || date < start)) return false;
    if (end && (!date || date > end)) return false;
    if (filters.marketplace && order.marketplace !== filters.marketplace) return false;
    if (filters.status && order.status !== filters.status) return false;
    if (filters.customer && !`${order.customerName} ${order.customerId}`.toLowerCase().includes(String(filters.customer).toLowerCase())) return false;
    if (filters.product && !order.items.some((item) => `${item.name} ${item.reference}`.toLowerCase().includes(String(filters.product).toLowerCase()))) return false;
    if (filters.category && !order.items.some((item) => String(store.products?.[item.externalId]?.category || "").toLowerCase().includes(String(filters.category).toLowerCase()))) return false;
    if (filters.brand && !order.items.some((item) => String(store.products?.[item.externalId]?.brand || "").toLowerCase().includes(String(filters.brand).toLowerCase()))) return false;
    return true;
  });
  const canceled = orderList.filter((order) => /cancel|cancelad/i.test(order.status));
  const pending = orderList.filter((order) => /pend|aguard|abert|novo|analis/i.test(order.status));
  const valid = orderList.filter((order) => !/cancel|cancelad/i.test(order.status));
  const withTotal = valid.filter((order) => order.total !== null);
  const revenue = withTotal.reduce((sum, order) => sum + order.total, 0);
  const channels = new Map();
  for (const order of valid) {
    const current = channels.get(order.marketplace) || { marketplace: order.marketplace, revenue: 0, orders: 0 };
    current.orders += 1;
    if (order.total !== null) current.revenue += order.total;
    channels.set(order.marketplace, current);
  }
  const products = new Map();
  for (const order of valid) for (const item of order.items || []) {
    const key = item.externalId || item.reference || item.name;
    const current = products.get(key) || { id: key, name: item.name, reference: item.reference, quantity: 0, revenue: 0 };
    current.quantity += item.quantity || 0;
    current.revenue += item.total || 0;
    products.set(key, current);
  }
  const ranked = [...products.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);
  const hasOrders = orderList.length > 0;
  const hasTotals = withTotal.length > 0;
  const insufficient = hasOrders ? "A API não forneceu valores monetários para os pedidos filtrados." : "Nenhum pedido sincronizado para os filtros selecionados.";
  return {
    generatedAt: new Date().toISOString(),
    source: "Tray (dados sincronizados)",
    sync: store.sync,
    filters: {
      marketplaces: [...new Set(Object.values(store.orders).map((item) => item.marketplace))].sort(),
      statuses: [...new Set(Object.values(store.orders).map((item) => item.status))].sort(),
      categories: [...new Set(Object.values(store.products).map((item) => item.category).filter(Boolean))].sort(),
      brands: [...new Set(Object.values(store.products).map((item) => item.brand).filter(Boolean))].sort(),
    },
    metrics: {
      revenue: metric(revenue, hasTotals, insufficient),
      orders: metric(orderList.length, true),
      averageTicket: metric(hasTotals && valid.length ? revenue / valid.length : null, hasTotals && valid.length > 0, insufficient),
      contributionMargin: metric(null, false, "Custos, impostos e comissões ainda não estão consolidados na Fase 1."),
      operatingProfit: metric(null, false, "Dados suficientes de custos operacionais não estão disponíveis."),
      canceledOrders: metric(canceled.length, true),
      pendingOrders: metric(pending.length, true),
    },
    channels: [...channels.values()].sort((a, b) => b.revenue - a.revenue),
    topProducts: ranked.slice(0, 10),
    lowProducts: ranked.length ? [...ranked].sort((a, b) => a.quantity - b.quantity).slice(0, 10) : [],
    unavailable: ["margem de contribuição", "lucro operacional", "risco de ruptura", "estoque parado", "oportunidades da IA", "receita incremental"],
  };
}
