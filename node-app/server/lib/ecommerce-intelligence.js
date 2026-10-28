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
  return list.map((entry) => entry?.ProductsSold || entry?.Product || entry).filter(Boolean).map((item) => {
    const quantity = number(first(item.quantity, item.amount, item.qty));
    const unitPrice = number(first(item.price, item.unit_price, item.value));
    const explicitTotal = number(first(item.total, item.total_price));
    return {
      externalId: text(first(item.product_id, item.id, item.Product?.id)),
      reference: text(first(item.reference, item.sku, item.Product?.reference)),
      name: text(first(item.name, item.product_name, item.Product?.name)) || "Produto sem descrição",
      quantity,
      unitPrice,
      total: explicitTotal != null ? explicitTotal : (unitPrice != null && quantity != null ? unitPrice * quantity : null),
    };
  });
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

function httpsImage(value) {
  const url = text(value);
  if (/^https:\/\//i.test(url)) return url;
  if (/^http:\/\/images\.tcdn\.com\.br\//i.test(url)) return `https://${url.slice("http://".length)}`;
  return "";
}

function imageUrlFromEntry(entry) {
  if (entry && typeof entry === "object") {
    const thumbs = entry.thumbs || {};
    return httpsImage(first(
      thumbs["90"]?.https, thumbs["180"]?.https, thumbs["30"]?.https, entry.https,
      thumbs["90"]?.http, thumbs["180"]?.http, thumbs["30"]?.http, entry.http, entry.image,
    ));
  }
  return httpsImage(entry);
}

function imageObservation(product) {
  const list = [product.ProductImage, product.ProductImages, product.images].find(Array.isArray);
  if (list) {
    const imageCount = list.filter((entry) => {
      const value = text(entry?.https || entry?.http || entry?.image || entry);
      return value && value !== "0";
    }).length;
    const imageUrl = list.map(imageUrlFromEntry).find(Boolean) || null;
    return { imagesObserved: true, imageCount, imageUrl };
  }
  if ("image" in product || "picture" in product || "url_image" in product) {
    const value = text(first(product.image, product.picture, product.url_image));
    const imageUrl = httpsImage(value) || null;
    return { imagesObserved: true, imageCount: imageUrl ? 1 : (value && value !== "0" ? 1 : 0), imageUrl };
  }
  return null;
}

function characteristicObservation(product) {
  const key = ["ProductCharacteristic", "characteristics", "technical_information", "additional_info"].find((name) => name in product);
  if (!key) return null;
  const raw = product[key];
  const list = Array.isArray(raw) ? raw : [raw];
  const characteristics = list.map((entry) => text(entry?.value || entry?.description || entry?.name || entry)).filter(Boolean).join("; ");
  return { characteristicsObserved: true, characteristics };
}

export function normalizeTrayProduct(product = {}) {
  const externalId = text(first(product.id, product.product_id));
  if (!externalId) return null;
  const item = {
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
  if ("description" in product) item.description = text(product.description);
  if ("description_small" in product || "descriptionSmall" in product) item.descriptionSmall = text(first(product.description_small, product.descriptionSmall));
  if ("model" in product) item.model = text(product.model);
  if ("available" in product) item.available = number(product.available);
  for (const field of ["weight", "length", "width", "height"]) if (field in product) item[field] = number(product[field]);
  return { ...item, ...imageObservation(product), ...characteristicObservation(product) };
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
    const item = normalizeTrayProduct(raw);
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
  return { value: available ? value : null, available, reason: reason || null };
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
    const current = channels.get(order.marketplace) || { marketplace: order.marketplace, orders: 0, comValor: 0, soma: 0 };
    current.orders += 1;
    if (order.total !== null && Number.isFinite(Number(order.total))) {
      current.comValor += 1;
      current.soma += Number(order.total);
    }
    channels.set(order.marketplace, current);
  }
  const products = new Map();
  for (const order of valid) for (const item of order.items || []) {
    const key = item.externalId || item.reference || item.name;
    const current = products.get(key) || { id: key, name: item.name, reference: item.reference, linhas: 0, comQuantidade: 0, quantity: 0, comValor: 0, soma: 0 };
    current.linhas += 1;
    if (item.quantity != null && Number.isFinite(Number(item.quantity))) {
      current.comQuantidade += 1;
      current.quantity += Number(item.quantity);
    }
    if (item.total != null && Number.isFinite(Number(item.total))) {
      current.comValor += 1;
      current.soma += Number(item.total);
    }
    products.set(key, current);
  }
  const ranked = [...products.values()].map((item) => ({
    id: item.id,
    name: item.name,
    reference: item.reference,
    quantity: item.comQuantidade === item.linhas ? item.quantity : null,
    revenue: item.comValor === item.linhas ? item.soma : null,
    observacao: item.comValor > 0 && item.comValor < item.linhas ? "Há item sem valor neste produto." : null,
  })).sort((a, b) => (b.quantity ?? Number.NEGATIVE_INFINITY) - (a.quantity ?? Number.NEGATIVE_INFINITY) || (b.revenue ?? Number.NEGATIVE_INFINITY) - (a.revenue ?? Number.NEGATIVE_INFINITY));
  const hasOrders = orderList.length > 0;
  const hasTotals = withTotal.length > 0;
  const parcial = hasTotals && withTotal.length < valid.length;
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
      revenue: metric(revenue, hasTotals, hasTotals ? (parcial ? "A soma usa só os pedidos que têm valor." : null) : insufficient),
      orders: metric(orderList.length, true),
      averageTicket: metric(
        !parcial && hasTotals && valid.length ? revenue / valid.length : null,
        !parcial && hasTotals && valid.length > 0,
        parcial ? "Há pedido sem valor no período. O ticket médio não foi calculado." : insufficient,
      ),
      contributionMargin: metric(null, false, "Custos, impostos e comissões ainda não estão consolidados na Fase 1."),
      operatingProfit: metric(null, false, "Dados suficientes de custos operacionais não estão disponíveis."),
      canceledOrders: metric(canceled.length, true),
      pendingOrders: metric(pending.length, true),
    },
    channels: [...channels.values()].map((channel) => {
      const completo = channel.orders > 0 && channel.comValor === channel.orders;
      return {
        marketplace: channel.marketplace,
        orders: channel.orders,
        revenue: completo ? channel.soma : null,
        ticket: completo ? channel.soma / channel.orders : null,
        observacao: channel.comValor > 0 && channel.comValor < channel.orders ? "Há pedido sem valor neste canal." : null,
      };
    }).sort((a, b) => (b.revenue ?? Number.NEGATIVE_INFINITY) - (a.revenue ?? Number.NEGATIVE_INFINITY) || b.orders - a.orders),
    topProducts: ranked.slice(0, 10),
    lowProducts: ranked.length ? [...ranked].sort((a, b) => (a.quantity ?? Number.POSITIVE_INFINITY) - (b.quantity ?? Number.POSITIVE_INFINITY)).slice(0, 10) : [],
    unavailable: ["margem de contribuição", "lucro operacional", "risco de ruptura", "estoque parado", "oportunidades da IA", "receita incremental"],
  };
}
