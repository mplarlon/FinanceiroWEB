import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { readEcommerceStore } from "./ecommerce-intelligence.js";

const FILE = "ecommerce_intelligence_control.json";
const defaults = () => ({
  settings: { mode: "analysis", minimumMargin: 15, maximumAutomaticChange: 5, inactiveCustomerDays: 60, autoAnalysis: true, notifications: true, dailyReportTime: "07:00", timezone: "America/Sao_Paulo", protectedProducts: [], notification: { email: false, whatsapp: false, emails: "", phones: "", sendReal: false, whatsappTemplate: "" }, permissions: { approveUserIds: [], executeUserIds: [], configureUserIds: [] } },
  opportunities: {}, actions: {}, campaigns: {}, runs: [],
});
const read = () => { const value = readJsonConfig(FILE, defaults()); return { ...defaults(), ...value, settings: { ...defaults().settings, ...(value.settings || {}), notification: { ...defaults().settings.notification, ...(value.settings?.notification || {}) }, permissions: { ...defaults().settings.permissions, ...(value.settings?.permissions || {}) } }, opportunities: value.opportunities || {}, actions: value.actions || {}, campaigns: value.campaigns || {}, runs: value.runs || [] }; };
const save = (value) => writeJsonConfig(FILE, value);
const num = (value) => { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
const id = (prefix, key) => `${prefix}-${crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 12)}`;
const margin = (price, cost) => price > 0 && cost !== null ? ((price - cost) / price) * 100 : null;

function valorLido(valor) {
  return valor != null && Number.isFinite(Number(valor)) ? Number(valor) : null;
}

function productSales(store) {
  const map = new Map();
  for (const order of Object.values(store.orders || {})) {
    if (/cancel/i.test(order.status)) continue;
    for (const item of order.items || []) {
      const key = item.externalId || item.reference;
      if (!key) continue;
      const current = map.get(key) || { linhas: 0, comQuantidade: 0, quantidade: 0, comValor: 0, soma: 0, lastSaleAt: null, channels: {} };
      current.linhas += 1;
      const quantidade = valorLido(item.quantity);
      const total = valorLido(item.total);
      if (quantidade != null) {
        current.comQuantidade += 1;
        current.quantidade += quantidade;
      }
      if (total != null) {
        current.comValor += 1;
        current.soma += total;
      }
      current.lastSaleAt = !current.lastSaleAt || String(order.date) > current.lastSaleAt ? order.date : current.lastSaleAt;
      const canal = order.marketplace || "Loja virtual Tray";
      if (current.channels[canal] !== null) current.channels[canal] = quantidade == null ? null : (current.channels[canal] || 0) + quantidade;
      map.set(key, current);
    }
  }
  const fechado = new Map();
  for (const [key, current] of map) {
    fechado.set(key, {
      quantity: current.comQuantidade === current.linhas ? current.quantidade : null,
      revenue: current.comValor === current.linhas ? current.soma : null,
      lastSaleAt: current.lastSaleAt,
      channels: current.channels,
    });
  }
  return fechado;
}

export function analyzeEcommerceAdvanced(store = readEcommerceStore(), control = read(), options = {}) {
  const sales = productSales(store);
  const products = Object.values(store.products || {}).map((product) => {
    const sold = sales.get(product.externalId) || { quantity: 0, revenue: 0, lastSaleAt: null, channels: {} };
    const contributionMargin = margin(num(product.price), num(product.cost));
    const dailyDemand = sold.quantity == null ? null : sold.quantity / 90;
    const coverageDays = dailyDemand > 0 && product.stock !== null && product.stock !== undefined ? Number(product.stock) / dailyDemand : null;
    const risk = sold.quantity == null ? null : coverageDays == null ? "low" : coverageDays < 15 ? "high" : coverageDays < 30 ? "medium" : "low";
    return { ...product, ...sold, contributionMargin, dailyDemand, coverageDays, stockRisk: risk, estimated: true };
  });
  const opportunities = [];
  for (const product of products) {
    if (product.contributionMargin !== null && product.contributionMargin < 0) opportunities.push({ key: `negative-margin:${product.externalId}`, productId: product.externalId, product, type: "pricing", priority: "critical", description: `${product.name} apresenta margem de contribuição estimada negativa.`, potentialValue: product.quantity == null ? null : Math.abs((product.price - product.cost) * product.quantity), confidence: "high", evidence: { price: product.price, cost: product.cost, margin: product.contributionMargin }, recommendation: "Revisar preço e custos antes de novas vendas." });
    else if (product.contributionMargin !== null && product.contributionMargin < control.settings.minimumMargin) opportunities.push({ key: `low-margin:${product.externalId}`, productId: product.externalId, product, type: "pricing", priority: "high", description: `${product.name} está abaixo da margem mínima configurada.`, potentialValue: null, confidence: "high", evidence: { margin: product.contributionMargin, target: control.settings.minimumMargin }, recommendation: "Simular reajuste dentro dos limites autorizados." });
    if (product.stockRisk === "high") opportunities.push({ key: `rupture:${product.externalId}`, productId: product.externalId, product, type: "inventory", priority: "critical", description: `${product.name} pode ficar sem estoque antes de 15 dias.`, potentialValue: product.dailyDemand == null || num(product.price) == null ? null : product.dailyDemand * Number(product.price) * 15, confidence: product.quantity >= 3 ? "medium" : "low", evidence: { stock: product.stock, dailyDemand: product.dailyDemand, coverageDays: product.coverageDays }, recommendation: "Preparar solicitação de compra para aprovação." });
    if (product.stock > 0 && product.quantity === 0) opportunities.push({ key: `idle:${product.externalId}`, productId: product.externalId, product, type: "campaign", priority: "medium", description: `${product.name} possui estoque e nenhuma venda no histórico sincronizado.`, potentialValue: null, confidence: "medium", evidence: { stock: product.stock, synchronizedHistory: true }, recommendation: "Avaliar campanha sem reduzir a margem mínima." });
  }
  const customerOrders = new Map();
  for (const order of Object.values(store.orders || {})) {
    if (!order.customerId || /cancel/i.test(order.status) || !order.date) continue;
    const current = customerOrders.get(order.customerId) || { customerId: order.customerId, customerName: order.customerName, dates: [], pedidos: 0, comValor: 0, soma: 0 };
    current.pedidos += 1;
    current.dates.push(String(order.date));
    const total = valorLido(order.total);
    if (total != null) {
      current.comValor += 1;
      current.soma += total;
    }
    customerOrders.set(order.customerId, current);
  }
  const cutoff = Date.now() - control.settings.inactiveCustomerDays * 86400000;
  for (const customer of customerOrders.values()) {
    customer.dates.sort(); const lastPurchaseAt = customer.dates.at(-1); const lastTime = Date.parse(String(lastPurchaseAt).replace(" ", "T"));
    const media = customer.comValor === customer.pedidos && customer.dates.length ? customer.soma / customer.dates.length : null;
    if (customer.dates.length >= 2 && Number.isFinite(lastTime) && lastTime < cutoff) opportunities.push({ key: `customer-recovery:${customer.customerId}`, customerId: customer.customerId, type: "customer_recovery", priority: "medium", description: `${customer.customerName || `Cliente ${customer.customerId}`} não compra há mais de ${control.settings.inactiveCustomerDays} dias.`, potentialValue: media, confidence: "medium", evidence: { lastPurchaseAt, priorOrders: customer.dates.length, historicalAverage: media }, recommendation: "Criar tarefa no CRM e preparar contato conforme consentimento e preferências." });
  }
  const now = new Date().toISOString();
  for (const candidate of opportunities) {
    const opportunityId = id("OP", candidate.key);
    const { product, ...publicCandidate } = candidate;
    control.opportunities[opportunityId] = { id: opportunityId, status: control.opportunities[opportunityId]?.status || "identified", responsible: control.opportunities[opportunityId]?.responsible || null, identifiedAt: control.opportunities[opportunityId]?.identifiedAt || now, updatedAt: now, ...publicCandidate };
    const actionId = id("ACT", candidate.key);
    if (!control.actions[actionId]) {
      const targetPrice = candidate.type === "pricing" && product?.cost > 0 ? Number((product.cost / (1 - control.settings.minimumMargin / 100)).toFixed(2)) : null;
      control.actions[actionId] = { id: actionId, opportunityId, type: candidate.type === "pricing" ? "price" : candidate.type === "inventory" ? "purchase_request" : candidate.type === "customer_recovery" ? "crm_task" : "campaign_draft", priority: candidate.priority, description: candidate.description, impact: candidate.potentialValue, recommendation: candidate.recommendation, status: "pending", responsible: null, productId: candidate.productId || null, customerId: candidate.customerId || null, channel: "Tray", previousValue: product?.price ?? null, newValue: targetPrice, justification: `Gerada pela análise ${candidate.key}; exige aprovação.`, createdAt: now, createdBy: "Charlie", history: [{ at: now, event: "created", actor: "Charlie" }] };
    }
    if (candidate.type === "campaign") {
      const campaignId = id("CMP", candidate.key);
      if (!control.campaigns[campaignId]) control.campaigns[campaignId] = { id: campaignId, name: `Giro de estoque — ${product.name}`, objective: "Reduzir estoque parado com margem protegida", productIds: [product.externalId], audience: "Clientes elegíveis conforme LGPD e preferências de contato", start: null, end: null, target: null, estimatedMargin: product.contributionMargin, description: "Rascunho criado pelo Charlie; preço e comunicação dependem de aprovação.", status: "draft", createdAt: now, createdBy: "Charlie", externalCommunicationAuthorized: false };
    }
  }
  control.runs.unshift({ id: id("RUN", `${now}:${products.length}`), at: now, products: products.length, opportunities: opportunities.length });
  control.runs = control.runs.slice(0, 100);
  if (options.persist !== false) save(control);
  return { products, opportunities: Object.values(control.opportunities), settings: control.settings };
}

export function ecommerceControl() { return read(); }
export function canEcommerce(actor = {}, operation, settings = read().settings) {
  if (!actor?.permissao_gerencial) return false;
  const field = operation === "approve" ? "approveUserIds" : operation === "execute" ? "executeUserIds" : "configureUserIds";
  const configured = (settings.permissions?.[field] || []).map(Number).filter((value) => value > 0);
  return !configured.length || configured.includes(Number(actor.idusuario || actor.id));
}
export function saveEcommerceSettings(input = {}) {
  const state = read();
  const allowedModes = ["analysis", "manual", "automatic"];
  state.settings = { ...state.settings,
    mode: allowedModes.includes(input.mode) ? input.mode : state.settings.mode,
    minimumMargin: Math.max(0, Math.min(90, Number(input.minimumMargin ?? state.settings.minimumMargin))),
    maximumAutomaticChange: Math.max(0, Math.min(20, Number(input.maximumAutomaticChange ?? state.settings.maximumAutomaticChange))),
    inactiveCustomerDays: Math.max(15, Math.min(730, Number(input.inactiveCustomerDays ?? state.settings.inactiveCustomerDays))),
    autoAnalysis: input.autoAnalysis === undefined ? state.settings.autoAnalysis : Boolean(input.autoAnalysis),
    notifications: input.notifications === undefined ? state.settings.notifications : Boolean(input.notifications),
    dailyReportTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyReportTime || "") ? input.dailyReportTime : state.settings.dailyReportTime,
    notification: { ...state.settings.notification, ...(input.notification || {}) },
    permissions: { ...state.settings.permissions, ...(input.permissions || {}) },
  }; save(state); return state.settings;
}

export function createEcommerceAction(input = {}, actor = {}) {
  const state = read(); const now = new Date().toISOString();
  if (!input.type || !input.description) throw Object.assign(new Error("Tipo e descrição são obrigatórios."), { status: 400 });
  const key = input.idempotencyKey || `${input.type}:${input.productId || "general"}:${input.channel || "tray"}:${input.newValue ?? ""}`;
  const actionId = id("ACT", key);
  if (state.actions[actionId] && !["rejected", "reverted", "failed"].includes(state.actions[actionId].status)) return { action: state.actions[actionId], duplicate: true };
  state.actions[actionId] = { id: actionId, type: input.type, priority: input.priority || "medium", description: input.description, impact: input.impact || null, recommendation: input.recommendation || null, status: "pending", responsible: input.responsible || null, productId: input.productId || null, channel: input.channel || "Tray", previousValue: num(input.previousValue), newValue: num(input.newValue), justification: input.justification || "", createdAt: now, createdBy: actor.id || null, history: [{ at: now, event: "created", actor: actor.id || "Charlie" }] };
  save(state); return { action: state.actions[actionId], duplicate: false };
}

export function decideEcommerceAction(actionId, decision, actor = {}, reason = "") {
  const state = read(); const action = state.actions[actionId];
  if (!action) throw Object.assign(new Error("Ação não encontrada."), { status: 404 });
  if (action.status !== "pending") throw Object.assign(new Error("A ação já foi decidida."), { status: 409 });
  if (!actor.id) throw Object.assign(new Error("Usuário autenticado é obrigatório."), { status: 403 });
  action.status = decision === "approve" ? "approved" : "rejected";
  action.history.push({ at: new Date().toISOString(), event: action.status, actor: actor.id, reason }); save(state); return action;
}

export function markEcommerceAction(actionId, status, result, actor = {}) {
  const state = read(); const action = state.actions[actionId];
  if (!action) throw Object.assign(new Error("Ação não encontrada."), { status: 404 });
  action.status = status; action.result = result; action.history.push({ at: new Date().toISOString(), event: status, actor: actor.id || "system", result }); save(state); return action;
}

export function prepareCampaign(input = {}, actor = {}) {
  const state = read(); const now = new Date().toISOString();
  const campaignId = id("CMP", `${input.name}:${(input.productIds || []).sort().join(",")}:${input.start || ""}`);
  state.campaigns[campaignId] = { id: campaignId, name: String(input.name || "Campanha sugerida pelo Charlie"), objective: input.objective || "Giro de estoque com margem protegida", productIds: input.productIds || [], audience: input.audience || "Clientes elegíveis conforme LGPD e preferências de contato", start: input.start || null, end: input.end || null, target: num(input.target), estimatedMargin: num(input.estimatedMargin), description: input.description || "Rascunho sujeito à aprovação.", status: "draft", createdAt: now, createdBy: actor.id || null, externalCommunicationAuthorized: false }; save(state); return state.campaigns[campaignId];
}

export function ecommerceResults(state = read()) {
  const actions = Object.values(state.actions); const opportunities = Object.values(state.opportunities);
  const executed = actions.filter((item) => item.status === "executed");
  const receitasObservadas = executed.map((item) => valorLido(item.result?.observedRevenue));
  const potenciais = opportunities.map((item) => valorLido(item.potentialValue));
  const potencialIncompleto = potenciais.some((item) => item == null);
  return { opportunities: opportunities.length, convertedOpportunities: opportunities.filter((item) => item.status === "converted").length, actions: actions.length, executedActions: executed.length, rejectedActions: actions.filter((item) => item.status === "rejected").length, successfulActions: executed.filter((item) => item.result?.ok !== false).length, campaigns: Object.values(state.campaigns).length, observedRevenue: receitasObservadas.some((item) => item == null) ? null : receitasObservadas.reduce((sum, item) => sum + item, 0), estimatedRevenue: potenciais.reduce((sum, item) => sum + (item == null ? 0 : item), 0), estimatedRevenueObservacao: potencialIncompleto ? "A soma usa só as oportunidades que têm valor." : null, attributionNotice: "Estimativas são separadas de resultados observados e não atribuem automaticamente vendas ao Charlie." };
}

export function faturamentoDoDia(orders = [], day) {
  const dayOrders = orders.filter((item) => String(item.date || "").slice(0, 10) === day && !/cancel/i.test(item.status || ""));
  const completos = dayOrders.map((item) => valorLido(item.total));
  return { orders: dayOrders.length, revenue: completos.some((item) => item == null) ? null : completos.reduce((sum, item) => sum + item, 0) };
}

export function ecommerceDailyReport(analysis = analyzeEcommerceAdvanced()) {
  const store = readEcommerceStore(); const orders = Object.values(store.orders); const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); const day = yesterday.toISOString().slice(0, 10);
  const dia = faturamentoDoDia(orders, day);
  const limitations = ["Comparações históricas exigem janela sincronizada suficiente.", "Margens são estimativas quando impostos e taxas do canal não estão disponíveis."];
  if (dia.revenue == null) limitations.push("Há pedido do dia sem valor. O faturamento não foi somado.");
  return { title: "CHARLIE — RELATÓRIO DIÁRIO DO E-COMMERCE", date: day, revenue: dia.revenue, orders: dia.orders, negativeMargin: analysis.products.filter((item) => item.contributionMargin !== null && item.contributionMargin < 0).length, ruptureRisk: analysis.products.filter((item) => item.stockRisk === "high").length, opportunities: analysis.opportunities.filter((item) => !["converted", "dismissed"].includes(item.status)).length, limitations, generatedAt: new Date().toISOString() };
}
