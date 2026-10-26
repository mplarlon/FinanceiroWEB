import express from "express";
import { readJsonConfig, writeJsonConfig } from "../lib/json-config.js";
import { suggestTrayProduct } from "../lib/tray-product-ai.js";
import { trayPasswordMatches } from "../lib/tray-access.js";
import { deliverReport } from "../lib/charlie-breakfast-delivery.js";
import {
  buildEcommerceDashboard,
  mergeEcommerceData,
  readEcommerceStore,
  recordEcommerceSyncFailure,
} from "../lib/ecommerce-intelligence.js";
import {
  analyzeEcommerceAdvanced,
  canEcommerce,
  createEcommerceAction,
  decideEcommerceAction,
  ecommerceControl,
  ecommerceDailyReport,
  ecommerceResults,
  markEcommerceAction,
  prepareCampaign,
  saveEcommerceSettings,
} from "../lib/ecommerce-advanced.js";

const router = express.Router();
const CONFIG_FILE = "tray_config.json";
const STATE_FILE = "tray_sync_state.json";
const SECRET_FIELDS = ["access_token", "refresh_token", "consumer_secret", "webhook_secret"];
const EDITABLE_FIELDS = ["api_address", "store_host", "store_id", "consumer_key", "auto_sync", "sync_interval_minutes", ...SECRET_FIELDS];

router.get("/acesso", (req, res) =>
  res.json({ ok: true, liberado: Boolean(req.dashboardSession?.trayUnlocked) }),
);

router.post("/acesso", (req, res) => {
  if (!process.env.DASHBOARD_TRAY_PASSWORD)
    return res.status(503).json({ ok: false, erro: "Configure DASHBOARD_TRAY_PASSWORD no servidor antes de liberar o e-commerce." });
  if (!trayPasswordMatches(req.body?.senha))
    return res.status(401).json({ ok: false, erro: "Senha do e-commerce inválida." });
  req.dashboardSession.trayUnlocked = true;
  res.json({ ok: true, liberado: true });
});

router.use((req, res, next) => {
  if (req.path === "/webhook" || req.dashboardSession?.trayUnlocked) return next();
  return res.status(403).json({
    ok: false,
    ecommerce_password_required: true,
    erro: "Informe a senha para abrir o e-commerce.",
  });
});

function config() {
  return readJsonConfig(CONFIG_FILE, {});
}

function publicConfig(value = config()) {
  return {
    api_address: value.api_address || "",
    store_host: value.store_host || "",
    store_id: value.store_id || "",
    consumer_key: value.consumer_key || "",
    has_access_token: Boolean(value.access_token),
    has_refresh_token: Boolean(value.refresh_token),
    has_consumer_secret: Boolean(value.consumer_secret),
    has_webhook_secret: Boolean(value.webhook_secret),
    auto_sync: Boolean(value.auto_sync),
    sync_interval_minutes: Number(value.sync_interval_minutes || 15),
    access_token_expires_at: value.access_token_expires_at || "",
    webhook_url: value.webhook_url || "/api/tray/webhook",
  };
}

function safeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); }
  catch { throw Object.assign(new Error("Informe uma URL de API válida."), { status: 400 }); }
  if (url.protocol !== "https:") throw Object.assign(new Error("A API da Tray deve usar HTTPS."), { status: 400 });
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local"))
    throw Object.assign(new Error("Endereço de API local não é permitido."), { status: 400 });
  return url.href.replace(/\/$/, "");
}

function saveTokens(payload, current = config()) {
  const next = {
    ...current,
    access_token: payload.access_token || current.access_token,
    refresh_token: payload.refresh_token || current.refresh_token,
    access_token_expires_at: payload.date_expiration_access_token || current.access_token_expires_at,
    refresh_token_expires_at: payload.date_expiration_refresh_token || current.refresh_token_expires_at,
    api_address: payload.api_host ? safeBaseUrl(payload.api_host) : current.api_address,
    store_id: String(payload.store_id || current.store_id || ""),
  };
  writeJsonConfig(CONFIG_FILE, next);
  return next;
}

async function refreshTokens(current = config()) {
  if (!current.refresh_token) throw Object.assign(new Error("Refresh token não configurado. Autorize novamente o aplicativo."), { status: 401 });
  const url = new URL(`${safeBaseUrl(current.api_address)}/auth`);
  url.searchParams.set("refresh_token", current.refresh_token);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw Object.assign(new Error(payload.message || payload.name || "Não foi possível renovar o token da Tray."), { status: response.status || 502 });
  return saveTokens(payload, current);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function trayRequest(endpoint, query = {}, options = {}, authRetried = false, attempt = 0) {
  let current = config();
  if (current.access_token_expires_at && new Date(String(current.access_token_expires_at).replace(" ", "T")) <= new Date()) current = await refreshTokens(current);
  const apiAddress = safeBaseUrl(current.api_address);
  if (!current.access_token) throw Object.assign(new Error("Access token da Tray ainda não configurado."), { status: 400 });
  const url = new URL(`${apiAddress}/${String(endpoint).replace(/^\//, "")}`);
  url.searchParams.set("access_token", current.access_token);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: "application/json", ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && !authRetried && current.refresh_token) {
      await refreshTokens(current);
      return trayRequest(endpoint, query, options, true, attempt);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * (2 ** attempt));
      return trayRequest(endpoint, query, options, authRetried, attempt + 1);
    }
    if (!response.ok || Number(payload?.code) >= 400) {
      const reason = payload?.message || payload?.name || payload?.causes?.[0] || `HTTP ${response.status}`;
      throw Object.assign(new Error(`Tray: ${typeof reason === "string" ? reason : JSON.stringify(reason)}`), { status: response.status || 502 });
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error("A Tray demorou mais de 25 segundos para responder."), { status: 504 });
    throw error;
  } finally { clearTimeout(timer); }
}

async function readTrayPages(endpoint, query = {}, { maxPages = 3000 } = {}) {
  const records = [];
  let page = 1;
  let lastPayload = {};
  while (page <= maxPages) {
    lastPayload = await trayRequest(endpoint, { ...query, limit: 50, page });
    const singular = endpoint === "orders" ? "Order" : endpoint === "products" ? "Product" : "Customer";
    const current = itemsFrom(lastPayload, singular, `${singular}s`);
    records.push(...current);
    const totalPages = Number(lastPayload?.paging?.total_pages || lastPayload?.paging?.pages || 0);
    if (!current.length || current.length < 50 || (totalPages && page >= totalPages)) break;
    page += 1;
    await wait(350);
  }
  return records;
}

let synchronizationInFlight = null;

async function performTraySynchronization({ mode = "incremental" } = {}) {
  const at = new Date().toISOString();
  const stored = readEcommerceStore();
  // A Tray documenta o filtro `modified` como data/intervalo. Repetimos o dia
  // do último cursor para não perder alterações próximas da virada; o merge por
  // ID externo torna essa sobreposição idempotente.
  const modified = mode === "incremental" && stored.sync?.cursor ? String(stored.sync.cursor).slice(0, 10) : undefined;
  try {
    const [orders, products, customers] = await Promise.all([
      readTrayPages("orders", { sort: "id_asc", modified }),
      readTrayPages("products", { sort: "id_asc", modified }),
      readTrayPages("customers", { sort: "id_asc", modified }),
    ]);
    return mergeEcommerceData({ orders, products, customers, mode, at });
  } catch (error) {
    recordEcommerceSyncFailure(error, at);
    throw error;
  }
}

export function synchronizeTray(options = {}) {
  if (synchronizationInFlight) return synchronizationInFlight;
  synchronizationInFlight = performTraySynchronization(options).finally(() => { synchronizationInFlight = null; });
  return synchronizationInFlight;
}

export async function processTrayWebhookEvents() {
  const events = readJsonConfig("tray_webhooks.json", []);
  let processed = 0;
  for (const event of events.filter((item) => item.status === "pending").reverse()) {
    const scope = String(event.scope_name || "").toLowerCase();
    const endpoint = scope.includes("order") || scope.includes("pedido") ? "orders" : scope.includes("product") || scope.includes("produto") ? "products" : scope.includes("customer") || scope.includes("cliente") ? "customers" : null;
    if (!endpoint || !event.scope_id) { event.status = "ignored"; event.error = "Escopo sem endpoint de leitura mapeado."; continue; }
    try {
      const payload = await trayRequest(`${endpoint}/${encodeURIComponent(event.scope_id)}`);
      const singular = endpoint === "orders" ? "Order" : endpoint === "products" ? "Product" : "Customer";
      const records = itemsFrom(payload, singular, `${singular}s`);
      mergeEcommerceData({ [endpoint]: records, mode: "webhook", at: new Date().toISOString() });
      event.status = "processed"; event.processedAt = new Date().toISOString(); processed += 1;
    } catch (error) {
      event.attempts = Number(event.attempts || 0) + 1; event.error = error.message; event.status = event.attempts >= 5 ? "failed" : "pending";
    }
  }
  writeJsonConfig("tray_webhooks.json", events.slice(0, 500));
  return { processed, pending: events.filter((item) => item.status === "pending").length, failed: events.filter((item) => item.status === "failed").length };
}

async function executeApprovedPriceAction(action, actor = { id: "Charlie" }) {
  const control = ecommerceControl();
  if (!action || action.status !== "approved") throw Object.assign(new Error("A ação precisa estar aprovada e ainda não executada."), { status: 409 });
  if (action.type !== "price") {
    const destinations = { purchase_request: "Charlie Abastecimento", crm_task: "Charlie Comercial/CRM", campaign_draft: "Campanhas" };
    if (!destinations[action.type]) throw Object.assign(new Error("Tipo de ação sem executor autorizado."), { status: 400 });
    return markEcommerceAction(action.id, "prepared", { ok: true, preparedOnly: true, destination: destinations[action.type], notice: "Rascunho preparado; nenhuma compra, campanha ou comunicação externa foi executada." }, actor);
  }
  if (!action.productId) throw Object.assign(new Error("Produto da alteração de preço não informado."), { status: 400 });
  if (control.settings.protectedProducts.includes(String(action.productId))) throw Object.assign(new Error("Produto protegido contra alteração automática."), { status: 403 });
  const base = Number(action.previousValue); const next = Number(action.newValue);
  const change = base > 0 ? Math.abs((next - base) / base) * 100 : Infinity;
  if (!(next > 0) || change > control.settings.maximumAutomaticChange) throw Object.assign(new Error("Alteração fora do limite financeiro configurado."), { status: 422 });
  const result = await trayRequest(`products/${encodeURIComponent(action.productId)}`, {}, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Product: { price: next } }) });
  return markEcommerceAction(action.id, "executed", { ok: true, tray: result }, actor);
}

export async function runEcommerceDailyIfDue(now = new Date()) {
  const control = ecommerceControl();
  if (!control.settings.autoAnalysis) return { skipped: true, reason: "disabled" };
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: control.settings.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`; const clock = `${parts.hour}:${parts.minute}`;
  const state = readJsonConfig("ecommerce_daily_state.json", {});
  if (clock < control.settings.dailyReportTime || state.lastDay === day) return { skipped: true, reason: state.lastDay === day ? "already-run" : "not-due" };
  const report = ecommerceDailyReport();
  const notification = control.settings.notification || {};
  let delivery = { email: "desligado", whatsapp: "desligado", enviados: [] };
  if (control.settings.notifications && (notification.email || notification.whatsapp)) {
    const text = `${report.title}\nFaturamento: R$ ${report.revenue.toFixed(2)}\nPedidos: ${report.orders}\nMargem negativa: ${report.negativeMargin}\nRisco de ruptura: ${report.ruptureRisk}\nOportunidades: ${report.opportunities}`;
    delivery = await deliverReport({ referencia: report.date, texto: text, vendas: { ontem: report.revenue, mes: null }, meta: {}, orcamentos: {}, ranking: [], rankingMes: [], observacoes: report.limitations, alertas: [] }, { canais: { email: Boolean(notification.email), whatsapp: Boolean(notification.whatsapp) }, emails: notification.emails, whatsapp: notification.phones, enviarReal: Boolean(notification.sendReal), templateWhatsapp: notification.whatsappTemplate, templateIdioma: "pt_BR" });
  }
  writeJsonConfig("ecommerce_daily_state.json", { lastDay: day, lastRunAt: now.toISOString(), report, delivery });
  return { ok: true, report, delivery };
}

async function exchangeCode(code) {
  const current = config();
  if (!current.consumer_key || !current.consumer_secret) throw Object.assign(new Error("Configure consumer key e consumer secret antes de autorizar."), { status: 400 });
  const body = new URLSearchParams({ consumer_key: current.consumer_key, consumer_secret: current.consumer_secret, code: String(code || "") });
  const response = await fetch(`${safeBaseUrl(current.api_address)}/auth`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw Object.assign(new Error(payload.message || payload.name || "A Tray não gerou as chaves de acesso."), { status: response.status || 502 });
  return saveTokens(payload, current);
}

function itemsFrom(payload, singular, plural) {
  const raw = payload?.[plural] || payload?.[singular] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((item) => item?.[singular] || item).filter(Boolean);
}

router.get("/config", (_req, res) => {
  const current = config();
  res.json({ ok: true, config: publicConfig(current), conectado: Boolean(current.api_address && current.access_token), estado: readJsonConfig(STATE_FILE, {}) });
});

router.put("/config", (req, res) => {
  try {
    const current = config();
    const next = { ...current };
    for (const field of EDITABLE_FIELDS) {
      if (!(field in (req.body || {}))) continue;
      const value = field === "auto_sync" ? Boolean(req.body[field]) : field === "sync_interval_minutes" ? Math.max(5, Math.min(1440, Number(req.body[field] || 15))) : String(req.body[field] || "").trim();
      if (SECRET_FIELDS.includes(field) && !value) continue;
      next[field] = value;
    }
    if (next.api_address) next.api_address = safeBaseUrl(next.api_address);
    writeJsonConfig(CONFIG_FILE, next);
    res.json({ ok: true, config: publicConfig(next), conectado: Boolean(next.api_address && next.access_token) });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});

router.post("/autorizar", async (req, res) => {
  try {
    const next = await exchangeCode(req.body?.code);
    res.json({ ok: true, mensagem: "Aplicativo autorizado e tokens armazenados.", config: publicConfig(next), conectado: true });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/renovar-token", async (_req, res) => {
  try { const next = await refreshTokens(); res.json({ ok: true, mensagem: "Token renovado.", config: publicConfig(next) }); }
  catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/testar", async (_req, res) => {
  try {
    const payload = await trayRequest("products", { limit: 1, page: 1 });
    const total = Number(payload?.paging?.total || itemsFrom(payload, "Product", "Products").length);
    const state = { ...readJsonConfig(STATE_FILE, {}), ultima_conexao: new Date().toISOString(), status: "online" };
    writeJsonConfig(STATE_FILE, state);
    res.json({ ok: true, mensagem: "Conexão com a Tray realizada com sucesso.", total_produtos: total, estado: state });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.get("/resumo", async (_req, res) => {
  try {
    const [ordersPayload, productsPayload, customersPayload] = await Promise.all([
      trayRequest("orders", { limit: 20, page: 1, sort: "id_desc" }),
      trayRequest("products", { limit: 20, page: 1, sort: "id_desc" }),
      trayRequest("customers", { limit: 1, page: 1, sort: "id_desc" }),
    ]);
    const orders = itemsFrom(ordersPayload, "Order", "Orders");
    const products = itemsFrom(productsPayload, "Product", "Products");
    const state = { ultima_sincronizacao: new Date().toISOString(), status: "online", pedidos_lidos: orders.length, produtos_lidos: products.length };
    writeJsonConfig(STATE_FILE, state);
    res.json({
      ok: true,
      totais: {
        pedidos: Number(ordersPayload?.paging?.total || orders.length),
        produtos: Number(productsPayload?.paging?.total || products.length),
        clientes: Number(customersPayload?.paging?.total || itemsFrom(customersPayload, "Customer", "Customers").length),
      },
      pedidos: orders.slice(0, 10), produtos: products.slice(0, 10), estado: state,
    });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/sincronizar", async (req, res) => {
  try {
    const mode = req.body?.mode === "initial" ? "initial" : "incremental";
    const synced = await synchronizeTray({ mode });
    res.json({ ok: true, mensagem: "Sincronização da Tray concluída.", resultado: synced.result, estado: synced.store.sync });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.get("/intelligence/dashboard", (req, res) => {
  try {
    res.json({ ok: true, dashboard: buildEcommerceDashboard(req.query || {}) });
  } catch (error) { res.status(400).json({ ok: false, erro: error.message }); }
});

router.get("/intelligence/analysis", (_req, res) => {
  try { res.json({ ok: true, analysis: analyzeEcommerceAdvanced() }); }
  catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});

router.get("/intelligence/control", (_req, res) => {
  const control = ecommerceControl();
  res.json({ ok: true, settings: control.settings, opportunities: Object.values(control.opportunities), actions: Object.values(control.actions), campaigns: Object.values(control.campaigns), results: ecommerceResults(control) });
});

router.get("/intelligence/actions/:id", (req, res) => {
  const action = ecommerceControl().actions[req.params.id];
  if (!action) return res.status(404).json({ ok: false, erro: "Ação não encontrada." });
  res.json({ ok: true, action });
});

router.put("/intelligence/settings", (req, res) => {
  try { if (!canEcommerce(req.dashboardSession?.user, "configure")) return res.status(403).json({ ok: false, erro: "Sem permissão específica para configurar o e-commerce." }); res.json({ ok: true, settings: saveEcommerceSettings(req.body || {}) }); }
  catch (error) { res.status(400).json({ ok: false, erro: error.message }); }
});

router.post("/intelligence/actions", (req, res) => {
  try { res.status(201).json({ ok: true, ...createEcommerceAction(req.body || {}, req.dashboardSession?.user) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});

router.post("/intelligence/actions/:id/decision", (req, res) => {
  try {
    if (!canEcommerce(req.dashboardSession?.user, "approve")) return res.status(403).json({ ok: false, erro: "Sem permissão específica para aprovar ações de e-commerce." });
    const decision = req.body?.decision;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ ok: false, erro: "Decisão inválida." });
    res.json({ ok: true, action: decideEcommerceAction(req.params.id, decision, req.dashboardSession.user, req.body?.reason) });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});

router.post("/intelligence/actions/:id/execute", async (req, res) => {
  const actor = req.dashboardSession?.user;
  try {
    if (!canEcommerce(actor, "execute")) return res.status(403).json({ ok: false, erro: "Sem permissão específica para executar ações de e-commerce." });
    const control = ecommerceControl(); const action = control.actions[req.params.id];
    if (!action) return res.status(404).json({ ok: false, erro: "Ação não encontrada." });
    res.json({ ok: true, action: await executeApprovedPriceAction(action, actor) });
  } catch (error) { try { markEcommerceAction(req.params.id, "failed", { ok: false, error: error.message }, actor); } catch { /* ação inexistente não gera segundo erro */ } res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/intelligence/actions/:id/revert", async (req, res) => {
  const actor = req.dashboardSession?.user;
  try {
    if (!canEcommerce(actor, "execute")) return res.status(403).json({ ok: false, erro: "Sem permissão específica para reverter ações de e-commerce." });
    const action = ecommerceControl().actions[req.params.id];
    if (!action || action.status !== "executed" || action.type !== "price" || !(action.previousValue > 0)) return res.status(409).json({ ok: false, erro: "Ação não reversível no estado atual." });
    const result = await trayRequest(`products/${encodeURIComponent(action.productId)}`, {}, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Product: { price: action.previousValue } }) });
    res.json({ ok: true, action: markEcommerceAction(action.id, "reverted", { ok: true, tray: result }, actor) });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/intelligence/campaigns", (req, res) => {
  try { res.status(201).json({ ok: true, campaign: prepareCampaign(req.body || {}, req.dashboardSession?.user) }); }
  catch (error) { res.status(400).json({ ok: false, erro: error.message }); }
});

router.get("/intelligence/daily-report", (_req, res) => {
  try { res.json({ ok: true, report: ecommerceDailyReport() }); }
  catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
});

router.get("/pedidos", async (req, res) => {
  try {
    const payload = await trayRequest("orders", { limit: Math.min(50, Number(req.query.limit || 30)), page: Math.max(1, Number(req.query.page || 1)), sort: req.query.sort || "id_desc", status: req.query.status, modified: req.query.modified });
    res.json({ ok: true, pedidos: itemsFrom(payload, "Order", "Orders"), paging: payload.paging || {} });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.get("/produtos", async (req, res) => {
  try {
    const payload = await trayRequest("products", { limit: Math.min(50, Number(req.query.limit || 30)), page: Math.max(1, Number(req.query.page || 1)), sort: req.query.sort || "id_desc", name: req.query.busca, reference: req.query.referencia });
    res.json({ ok: true, produtos: itemsFrom(payload, "Product", "Products"), paging: payload.paging || {} });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/produtos/sugerir", async (req, res) => {
  try { res.json({ ok: true, sugestao: await suggestTrayProduct(req.body || {}), gerado_por: "ollama" }); }
  catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});

router.post("/produtos", async (req, res) => {
  try {
    const source = req.body || {};
    const Product = {
      name: String(source.name || "").trim().slice(0, 120),
      description_small: String(source.description_small || "").trim().slice(0, 500),
      description: String(source.description || "").trim().slice(0, 5000),
      reference: String(source.reference || "").trim().slice(0, 100),
      ean: String(source.ean || "").replace(/\D/g, "").slice(0, 14),
      brand: String(source.brand || "").trim().slice(0, 100),
      model: String(source.model || "").trim().slice(0, 100),
      category_id: Number(source.category_id), price: Number(source.price), cost_price: Number(source.cost_price || 0),
      promotional_price: Number(source.promotional_price || 0), stock: Number(source.stock),
      weight: Number(source.weight), length: Number(source.length), width: Number(source.width), height: Number(source.height),
      available: source.available === false || Number(source.available) === 0 ? 0 : 1,
      metatag: String(source.meta_title || "").trim().slice(0, 70),
      keywords: String(source.keywords || "").trim().slice(0, 255),
    };
    const missing = [];
    if (!Product.name) missing.push("nome");
    if (!Product.reference) missing.push("referência");
    if (!(Product.category_id > 0)) missing.push("categoria");
    if (!(Product.price > 0)) missing.push("preço");
    if (Product.stock < 0 || !Number.isFinite(Product.stock)) missing.push("estoque");
    for (const field of ["weight", "length", "width", "height"]) if (!(Product[field] > 0)) missing.push(field);
    if (missing.length) return res.status(400).json({ ok: false, erro: `Preencha os campos obrigatórios: ${missing.join(", ")}.` });
    const payload = await trayRequest("products", {}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Product }) });
    const log = readJsonConfig("tray_products_created.json", []);
    writeJsonConfig("tray_products_created.json", [{ criado_em: new Date().toISOString(), tray_id: payload.id, reference: Product.reference, name: Product.name, usuario: req.dashboardSession?.user?.idusuario || null }, ...log].slice(0, 500));
    res.status(201).json({ ok: true, mensagem: "Produto criado na Tray.", id: payload.id, retorno: payload });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.put("/produtos/:id", async (req, res) => {
  try {
    const Product = {};
    for (const field of ["stock", "price", "promotional_price", "available"]) if (req.body?.[field] !== undefined && req.body[field] !== "") Product[field] = Number(req.body[field]);
    if (!Object.keys(Product).length) return res.status(400).json({ ok: false, erro: "Informe estoque, preço ou disponibilidade." });
    const payload = await trayRequest(`products/${encodeURIComponent(req.params.id)}`, {}, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Product }) });
    res.json({ ok: true, mensagem: "Produto atualizado na Tray.", retorno: payload });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.put("/pedidos/:id", async (req, res) => {
  try {
    const Order = {};
    for (const field of ["status_id", "sending_code", "sending_date", "tracking_url", "store_note"]) if (req.body?.[field] !== undefined && req.body[field] !== "") Order[field] = req.body[field];
    if (!Object.keys(Order).length) return res.status(400).json({ ok: false, erro: "Informe status ou dados de rastreio." });
    const payload = await trayRequest(`orders/${encodeURIComponent(req.params.id)}`, {}, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Order }) });
    res.json({ ok: true, mensagem: "Pedido atualizado na Tray.", retorno: payload });
  } catch (error) { res.status(error.status || 502).json({ ok: false, erro: error.message }); }
});

router.post("/webhook", express.urlencoded({ extended: true }), async (req, res) => {
  const current = config();
  const supplied = String(req.query.secret || req.headers["x-tray-webhook-secret"] || "");
  if (!current.webhook_secret || supplied !== current.webhook_secret) return res.status(401).json({ ok: false });
  const event = { id: `${req.body?.scope_name || "event"}:${req.body?.scope_id || "unknown"}:${req.body?.act || "change"}`, recebido_em: new Date().toISOString(), scope_name: req.body?.scope_name, scope_id: req.body?.scope_id, seller_id: req.body?.seller_id, act: req.body?.act, status: "pending", attempts: 0 };
  const events = readJsonConfig("tray_webhooks.json", []);
  writeJsonConfig("tray_webhooks.json", [event, ...events.filter((item) => !(item.id === event.id && item.status === "pending"))].slice(0, 500));
  res.json({ ok: true });
});

router.get("/eventos", (_req, res) => res.json({ ok: true, eventos: readJsonConfig("tray_webhooks.json", []).slice(0, 100) }));

export function startTrayScheduler() {
  let running = false;
  const tick = async () => {
    const current = config();
    try { await runEcommerceDailyIfDue(); } catch (error) { console.error(`[tray-daily] ${error.message}`); }
    if (running || !current.auto_sync || !current.api_address || !current.access_token) return;
    const state = readJsonConfig(STATE_FILE, {});
    const interval = Math.max(5, Number(current.sync_interval_minutes || 15)) * 60_000;
    if (state.ultima_sincronizacao && Date.now() - new Date(state.ultima_sincronizacao).getTime() < interval) return;
    running = true;
    try {
      await processTrayWebhookEvents();
      const synced = await synchronizeTray({ mode: "incremental" });
      const control = ecommerceControl();
      if (control.settings.autoAnalysis) analyzeEcommerceAdvanced();
      if (control.settings.mode === "automatic") {
        for (const action of Object.values(ecommerceControl().actions).filter((item) => item.status === "approved" && item.type === "price")) {
          try { await executeApprovedPriceAction(action, { id: "Charlie" }); }
          catch (error) { markEcommerceAction(action.id, "failed", { ok: false, error: error.message }, { id: "Charlie" }); }
        }
      }
      writeJsonConfig(STATE_FILE, { ...state, ultima_sincronizacao: synced.store.sync.lastSuccessAt, status: "online", total_pedidos: synced.result.total, erro: "" });
    } catch (error) {
      writeJsonConfig(STATE_FILE, { ...state, ultima_tentativa: new Date().toISOString(), status: "erro", erro: error.message });
    } finally { running = false; }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  tick();
  return timer;
}

export default router;
