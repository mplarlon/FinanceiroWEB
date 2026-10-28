import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "ecommerce_marketplace_booster.json";
const STORE_CHANNEL = "Loja virtual Tray";
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const CONTENT_TYPES = new Set(["title", "description", "characteristics"]);

const emptyState = () => ({ version: 1, analyzedAt: null, limitations: [], findings: {} });
const text = (value, limit = 500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
const code = (value) => text(value, 80).toUpperCase().replace(/\s+/g, "");
const findingId = (key) => `MB-${crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 12)}`;
const timeOf = (value) => {
  const time = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(time) ? time : null;
};
const includes = (host, part) => text(part, 80).length > 1 && text(host, 300).toLowerCase().includes(text(part, 80).toLowerCase());

export function readMarketplaceBooster() {
  const stored = readJsonConfig(FILE, emptyState());
  return { ...emptyState(), ...stored, findings: stored.findings || {}, limitations: stored.limitations || [] };
}

export function saveMarketplaceBooster(state) {
  return writeJsonConfig(FILE, state);
}

export const ERP_STOCK_SQL = `SELECT FIRST 2000 CDPRODUTO, PRODUTO, MARCA, CDPRODFABR, CODIGOBARRA, TEM_FOTO, COMPRIMENTO, LARGURA, ESPESSURA, PESOUNIT, ESTOQUE
  FROM (
    SELECT p.CDPRODUTO, p.PRODUTO, COALESCE(p.MARCA, '') AS MARCA, COALESCE(p.CDPRODFABR, '') AS CDPRODFABR,
      COALESCE(p.CODIGOBARRA, '') AS CODIGOBARRA,
      CASE WHEN NULLIF(TRIM(p.FOTO), '') IS NOT NULL OR NULLIF(TRIM(p.URL_FOTO_ITS), '') IS NOT NULL THEN 1 ELSE 0 END AS TEM_FOTO,
      p.COMPRIMENTO, p.LARGURA, p.ESPESSURA, p.PESOUNIT,
      COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO = p.CDPRODUTO), 0) AS ESTOQUE
    FROM PRODUTO p
    WHERE p.INATIVO = 0 OR p.INATIVO IS NULL
  ) catalogo
  WHERE ESTOQUE > 0
  ORDER BY ESTOQUE DESC`;

export function mapErpBoosterRow(row = {}) {
  const numberOrNull = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  return {
    code: text(row.CDPRODUTO, 40),
    name: text(row.PRODUTO, 120),
    brand: text(row.MARCA, 80),
    manufacturerCode: text(row.CDPRODFABR, 40),
    barcode: text(row.CODIGOBARRA, 40),
    hasImage: Number(row.TEM_FOTO) === 1,
    length: numberOrNull(row.COMPRIMENTO),
    width: numberOrNull(row.LARGURA),
    thickness: numberOrNull(row.ESPESSURA),
    weight: numberOrNull(row.PESOUNIT),
    stock: Number(row.ESTOQUE) || 0,
  };
}

function measureText(source = {}) {
  const parts = [];
  if (source.length) parts.push(`comprimento ${source.length}`);
  if (source.width) parts.push(`largura ${source.width}`);
  if (source.thickness) parts.push(`espessura ${source.thickness}`);
  if (source.weight) parts.push(`peso ${source.weight}`);
  return parts.join(", ");
}

function collectSales(orders = {}) {
  const byProduct = new Map();
  let min = null;
  let max = null;
  for (const order of Object.values(orders)) {
    if (/cancel/i.test(order?.status || "")) continue;
    const time = timeOf(order?.date);
    if (time != null) {
      min = min == null ? time : Math.min(min, time);
      max = max == null ? time : Math.max(max, time);
    }
    for (const item of order?.items || []) {
      const id = text(item.externalId, 40);
      if (!id) continue;
      const current = byProduct.get(id) || { quantity: 0, events: [] };
      current.quantity += Number(item.quantity || 0);
      current.events.push({ time, quantity: Number(item.quantity || 0), marketplace: text(order.marketplace, 80) || STORE_CHANNEL });
      byProduct.set(id, current);
    }
  }
  return { byProduct, spanDays: min != null && max != null ? (max - min) / 86400000 : 0 };
}

function indexErp(erpProducts = []) {
  const map = new Map();
  for (const product of erpProducts) {
    if (!product || !(product.stock > 0)) continue;
    for (const key of [product.code, product.manufacturerCode, product.barcode]) {
      const normalized = code(key);
      if (!normalized) continue;
      const current = map.get(normalized);
      if (!current || product.stock > current.stock) map.set(normalized, product);
    }
  }
  return map;
}

function trayCodes(product) {
  return [product.externalId, product.reference].map(code).filter(Boolean);
}

function matchedErp(product, erpIndex) {
  for (const key of trayCodes(product)) if (erpIndex.has(key)) return erpIndex.get(key);
  return null;
}

function pushFinding(findings, input) {
  const key = `${input.type}:${input.problem}:${input.productId || input.reference || input.productName}:${input.marketplace}`;
  findings.push({
    id: findingId(key),
    productId: input.productId || null,
    productName: text(input.productName, 180) || "Produto sem descrição",
    reference: text(input.reference, 80),
    marketplace: input.marketplace || STORE_CHANNEL,
    problem: input.problem,
    priority: input.priority,
    type: input.type,
    evidence: input.evidence || {},
    recommendation: input.recommendation,
    execution: input.execution,
    limitation: input.limitation || null,
  });
}

function listingFacts(product, erp) {
  const measures = measureText({
    length: product.length || erp?.length,
    width: product.width || erp?.width,
    thickness: erp?.thickness,
    weight: product.weight || erp?.weight,
  });
  return {
    nome: text(erp?.name || product.name, 180),
    marca: text(product.brand || erp?.brand, 80),
    referencia: text(product.reference || erp?.code, 80),
    categoria: text(product.category, 80),
    modelo: text(product.model, 80),
    codigoFabricante: text(erp?.manufacturerCode, 40),
    medidas: measures,
  };
}

export function composeListingSuggestion(facts = {}) {
  const base = text(facts.nome, 180) || "Produto";
  const name = [base, !includes(base, facts.marca) ? facts.marca : "", !includes(base, facts.codigoFabricante) ? facts.codigoFabricante : ""]
    .map((part) => text(part, 80)).filter(Boolean).join(" ").slice(0, 120);
  const sentences = [name];
  if (facts.marca) sentences.push(`Marca cadastrada: ${facts.marca}.`);
  if (facts.referencia) sentences.push(`Referência: ${facts.referencia}.`);
  if (facts.categoria) sentences.push(`Categoria: ${facts.categoria}.`);
  if (facts.modelo) sentences.push(`Modelo cadastrado: ${facts.modelo}.`);
  if (facts.medidas) sentences.push(`Medidas informadas no cadastro: ${facts.medidas}.`);
  sentences.push("Confira a compatibilidade antes da compra.");
  const description = sentences.join(" ");
  const keywords = [...new Set([facts.nome, facts.marca, facts.referencia, facts.categoria, facts.modelo, facts.codigoFabricante]
    .flatMap((part) => text(part, 80).split(/[^\p{L}\p{N}]+/u))
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 2))].slice(0, 12).join(", ").slice(0, 255);
  return {
    name,
    description_small: description.slice(0, 300),
    description: description.slice(0, 5000),
    keywords,
    source: "cadastro",
  };
}

function numberTokens(value) {
  return [...String(value || "").matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(",", "."));
}

export function acceptListingSuggestion(suggestion = {}, facts = {}) {
  const allowed = new Set(numberTokens(JSON.stringify(facts)));
  const produced = `${suggestion.name || ""} ${suggestion.description || ""} ${suggestion.description_small || ""} ${suggestion.keywords || ""}`;
  const extra = numberTokens(produced).filter((token) => !allowed.has(token));
  const unit = produced.match(/\d+(?:[.,]\d+)?\s*(mm|cm|kg|g|pol|polegadas)\b/i);
  const measures = text(facts.medidas, 200).toLowerCase();
  if (extra.length || (unit && !measures.includes(unit[1].toLowerCase()))) {
    return { ok: false, reason: "A sugestão trouxe número ou unidade que não está no cadastro." };
  }
  const safe = composeListingSuggestion(facts);
  return {
    ok: true,
    suggestion: {
      name: text(suggestion.name, 120) || safe.name,
      description_small: text(suggestion.description_small, 300) || safe.description_small,
      description: text(suggestion.description, 5000) || safe.description,
      keywords: text(suggestion.keywords, 255) || safe.keywords,
      source: suggestion.source || "ollama",
    },
  };
}

export function analyzeMarketplaceListings(store = {}, { erpProducts = [], erpError = "", minimumMargin = 15 } = {}) {
  const products = Object.values(store.products || {});
  const sales = collectSales(store.orders || {});
  const erpIndex = indexErp(erpProducts);
  const findings = [];
  const limitations = [
    "Preço de concorrente não entra nesta análise. Não há consulta externa de mercado.",
    "O texto sincronizado é o anúncio da loja Tray. A API não separa título e descrição por marketplace.",
  ];
  const descriptionObserved = products.some((product) => "description" in product || "descriptionSmall" in product);
  const imagesObserved = products.some((product) => product.imagesObserved === true);
  if (products.length && !descriptionObserved) limitations.push("A sincronização ainda não gravou a descrição dos anúncios. Descrição vazia não foi transformada em problema.");
  if (products.length && !imagesObserved) limitations.push("A sincronização ainda não gravou as imagens dos anúncios. Falta de foto não foi transformada em problema.");
  if (erpError) limitations.push("O cadastro do ERP não foi lido. Produtos com estoque e sem anúncio ficaram de fora desta análise.");
  else if (!erpProducts.length) limitations.push("Nenhum produto com estoque positivo foi retornado pelo ERP nesta leitura.");
  if (sales.spanDays < 30) limitations.push("O histórico sincronizado tem menos de 30 dias. Queda de venda e estoque sem venda não foram afirmados.");

  for (const product of products) {
    const erp = matchedErp(product, erpIndex);
    const sold = sales.byProduct.get(product.externalId) || { quantity: 0, events: [] };
    const name = product.name || "";
    if (!text(name) || name === "Produto sem descrição") {
      pushFinding(findings, { type: "title", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Título ausente", priority: "high", evidence: { name }, recommendation: "Montar o título com nome, marca e referência que já existem no cadastro.", execution: "tray_content" });
    } else if (text(name).length < 12) {
      pushFinding(findings, { type: "title", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Título pouco informativo", priority: "high", evidence: { name, length: text(name).length }, recommendation: "Completar o título com marca ou código de fabricante já cadastrados, quando existirem.", execution: "tray_content" });
    } else if (product.brand && !includes(name, product.brand)) {
      pushFinding(findings, { type: "title", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Título sem a marca cadastrada", priority: "medium", evidence: { name, brand: product.brand }, recommendation: "Incluir a marca já gravada no cadastro do anúncio.", execution: "tray_content" });
    }

    if ("description" in product || "descriptionSmall" in product) {
      const description = `${product.description || ""} ${product.descriptionSmall || ""}`.trim();
      if (description.length < 40) {
        pushFinding(findings, { type: "description", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: description ? "Descrição insuficiente" : "Descrição ausente", priority: "high", evidence: { length: description.length }, recommendation: "Reescrever a descrição só com nome, marca, referência, categoria e medidas já cadastradas.", execution: "tray_content" });
      } else if (erp && measureText(erp)) {
        const missingMeasure = measureText(erp).split(", ").filter((part) => {
          const measure = String(part.split(" ").at(-1) || "").replace(".", "\\.");
          return measure && !new RegExp(`(?<![\\d])${measure}(?![\\d])`).test(description);
        });
        if (missingMeasure.length) {
          pushFinding(findings, { type: "characteristics", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Medidas do cadastro não aparecem na descrição", priority: "medium", evidence: { measures: missingMeasure }, recommendation: "Incluir na descrição apenas as medidas já gravadas no ERP ou na Tray.", execution: "tray_content" });
        }
      }
    }
    if (product.imagesObserved === true && Number(product.imageCount) === 0) {
      pushFinding(findings, { type: "image", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Sem imagem", priority: "high", evidence: { imageCount: 0 }, recommendation: "Enviar a imagem pelo cadastro da Tray. Este comando não publica arquivo de foto.", execution: "manual", limitation: "A atualização autorizada deste módulo altera texto do anúncio. A imagem continua manual." });
    }
    if (product.characteristicsObserved === true && text(product.characteristics).length < 3) {
      pushFinding(findings, { type: "characteristics", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Sem características técnicas", priority: "medium", evidence: { characteristics: product.characteristics || "" }, recommendation: "Preencher características somente com dados já existentes no cadastro.", execution: "tray_content" });
    }

    const price = Number(product.price);
    const cost = product.cost == null ? null : Number(product.cost);
    if (price > 0 && cost != null && Number.isFinite(cost)) {
      const margin = ((price - cost) / price) * 100;
      if (margin < 0) pushFinding(findings, { type: "margin", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Rentabilidade negativa", priority: "high", evidence: { price, cost, margin: Number(margin.toFixed(1)) }, recommendation: "Revisar preço e custo na inteligência de preços. O Booster não altera preço.", execution: "manual", limitation: "Alteração de preço permanece na ação de preço já existente, com limite e aprovação." });
      else if (margin < Number(minimumMargin)) pushFinding(findings, { type: "margin", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Rentabilidade abaixo da margem mínima", priority: "medium", evidence: { price, cost, margin: Number(margin.toFixed(1)), minimumMargin: Number(minimumMargin) }, recommendation: "Simular o reajuste na inteligência de preços antes de qualquer alteração.", execution: "manual", limitation: "Alteração de preço permanece na ação de preço já existente, com limite e aprovação." });
    }

    if (sales.spanDays >= 30 && Number(product.stock) > 0 && sold.quantity === 0) {
      pushFinding(findings, { type: "idle", productId: product.externalId, productName: name, reference: product.reference, marketplace: STORE_CHANNEL, problem: "Estoque sem venda no histórico sincronizado", priority: "medium", evidence: { stock: product.stock, historyDays: Math.round(sales.spanDays) }, recommendation: "Revisar título, descrição e exposição. Nenhuma campanha é publicada por este achado.", execution: "manual" });
    }
    const dated = sold.events.filter((event) => event.time != null);
    if (dated.length >= 2) {
      const start = Math.min(...dated.map((event) => event.time));
      const end = Math.max(...dated.map((event) => event.time));
      if (end - start >= 28 * 86400000) {
        const mid = start + (end - start) / 2;
        const older = dated.filter((event) => event.time < mid);
        const newer = dated.filter((event) => event.time >= mid);
        const olderQty = older.reduce((sum, event) => sum + event.quantity, 0);
        const newerQty = newer.reduce((sum, event) => sum + event.quantity, 0);
        if (olderQty >= 2 && newerQty === 0) {
          const channel = older.reduce((best, event) => {
            best.set(event.marketplace, (best.get(event.marketplace) || 0) + event.quantity);
            return best;
          }, new Map());
          const marketplace = [...channel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || STORE_CHANNEL;
          pushFinding(findings, { type: "decline", productId: product.externalId, productName: name, reference: product.reference, marketplace, problem: "Queda de vendas", priority: olderQty >= 4 ? "high" : "medium", evidence: { olderQty, newerQty, historyDays: Math.round((end - start) / 86400000), marketplace }, recommendation: "Analisar o anúncio e o preço desse canal. Nenhuma alteração é aplicada só por este achado.", execution: "manual" });
        }
      }
    }
  }

  const listed = new Set(products.flatMap(trayCodes));
  const unlisted = [];
  const seenErp = new Set();
  for (const product of erpProducts.filter((item) => item?.stock > 0).sort((a, b) => b.stock - a.stock)) {
    if (seenErp.has(product.code)) continue;
    seenErp.add(product.code);
    const keys = [product.code, product.manufacturerCode, product.barcode].map(code).filter(Boolean);
    if (keys.some((key) => listed.has(key))) continue;
    unlisted.push(product);
  }
  const selectedUnlisted = unlisted.slice(0, 40);
  if (unlisted.length > selectedUnlisted.length) limitations.push(`Há ${unlisted.length} produtos com estoque sem anúncio correspondente. A lista mostra os 40 de maior estoque.`);
  for (const product of selectedUnlisted) {
    pushFinding(findings, {
      type: "unlisted", productId: null, productName: product.name, reference: product.code, marketplace: "Sem anúncio",
      problem: "Estoque no ERP sem anúncio na Tray", priority: "high",
      evidence: { stock: product.stock, code: product.code, brand: product.brand, hasImage: product.hasImage },
      recommendation: product.hasImage ? "Preparar o anúncio com os dados do ERP e publicar manualmente na Tray." : "Preparar o anúncio com os dados do ERP. O cadastro também está sem foto.",
      execution: "manual",
      limitation: "A criação do anúncio exige categoria, peso e medidas aceitos pela Tray. Este módulo não publica o produto novo.",
    });
  }

  const ordered = findings.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.productName.localeCompare(b.productName, "pt-BR"));
  const visible = ordered.slice(0, 200);
  if (ordered.length > visible.length) limitations.push(`A análise encontrou ${ordered.length} achados. A lista guarda os 200 de maior prioridade.`);
  return { findings: visible, limitations };
}

export function mergeBoosterState(previous = emptyState(), analysis, at = new Date().toISOString()) {
  const state = { ...emptyState(), ...previous, findings: { ...(previous.findings || {}) } };
  const seen = new Set();
  for (const finding of analysis.findings || []) {
    seen.add(finding.id);
    const prior = state.findings[finding.id];
    state.findings[finding.id] = {
      ...finding,
      status: prior?.status && prior.status !== "open" ? prior.status : "open",
      suggestion: prior?.suggestion || null,
      previous: prior?.previous || null,
      history: prior?.history || [{ at, event: "identified", actor: "Charlie" }],
      identifiedAt: prior?.identifiedAt || at,
      updatedAt: at,
    };
  }
  for (const [id, prior] of Object.entries(state.findings)) {
    if (seen.has(id) || prior.status !== "open") continue;
    state.findings[id] = { ...prior, status: "resolved", updatedAt: at, history: [...(prior.history || []), { at, event: "resolved", actor: "Charlie" }] };
  }
  state.analyzedAt = at;
  state.limitations = analysis.limitations || [];
  return state;
}

function requireFinding(state, id) {
  const finding = state.findings?.[id];
  if (!finding) throw Object.assign(new Error("Achado não encontrado."), { status: 404 });
  return finding;
}

function withHistory(state, finding, event, actor, extra = {}) {
  const next = { ...finding, ...extra, updatedAt: event.at, history: [...(finding.history || []), { at: event.at, event: event.event, actor: event.actor }] };
  return { ...state, findings: { ...state.findings, [finding.id]: next } };
}

export function boosterFacts(state, id, store = {}, erpProducts = []) {
  const finding = requireFinding(state, id);
  const product = Object.values(store.products || {}).find((item) => item.externalId === finding.productId) || { name: finding.productName, reference: finding.reference, externalId: finding.productId };
  const erp = matchedErp(product, indexErp(erpProducts)) || erpProducts.find((item) => item.code === finding.reference) || null;
  return { finding, facts: listingFacts(product, erp), product };
}

export function recordBoosterSuggestion(state, id, suggestion, actor, at = new Date().toISOString()) {
  const finding = requireFinding(state, id);
  if (!CONTENT_TYPES.has(finding.type) && finding.type !== "unlisted") throw Object.assign(new Error("Este achado não recebe texto de anúncio."), { status: 409 });
  if (["applied"].includes(finding.status)) throw Object.assign(new Error("Reverta a aplicação antes de gerar outra sugestão."), { status: 409 });
  return withHistory(state, finding, { at, event: "suggested", actor: actorId(actor) }, actor, { suggestion, status: finding.status === "approved" ? "approved" : "suggested" });
}

export function decideBoosterFinding(state, id, decision, actor, at = new Date().toISOString()) {
  const finding = requireFinding(state, id);
  if (!["open", "suggested"].includes(finding.status)) throw Object.assign(new Error("O achado já foi decidido."), { status: 409 });
  if (!actorId(actor)) throw Object.assign(new Error("Usuário autenticado é obrigatório."), { status: 403 });
  if (decision === "approve" && CONTENT_TYPES.has(finding.type) && !finding.suggestion) throw Object.assign(new Error("Gere a sugestão antes de aprovar a alteração do anúncio."), { status: 409 });
  return withHistory(state, finding, { at, event: decision === "approve" ? "approved" : "rejected", actor: actorId(actor) }, actor, { status: decision === "approve" ? "approved" : "rejected" });
}

export function contentPayload(suggestion = {}) {
  const payload = {};
  if (typeof suggestion.name === "string" && suggestion.name) payload.name = text(suggestion.name, 120);
  if (typeof suggestion.description === "string") payload.description = text(suggestion.description, 5000);
  if (typeof suggestion.description_small === "string") payload.description_small = text(suggestion.description_small, 500);
  if (typeof suggestion.keywords === "string" && suggestion.keywords) payload.keywords = text(suggestion.keywords, 255);
  if (payload.name) payload.metatag = payload.name.slice(0, 70);
  return payload;
}

export function markBoosterApplied(state, id, actor, { previous, result }, at = new Date().toISOString()) {
  const finding = requireFinding(state, id);
  if (finding.status !== "approved") throw Object.assign(new Error("A aplicação exige aprovação."), { status: 409 });
  if (finding.execution !== "tray_content") throw Object.assign(new Error(finding.limitation || "Este achado fica para execução manual."), { status: 409 });
  return withHistory(state, finding, { at, event: "applied", actor: actorId(actor) }, actor, { status: "applied", previous: previous || finding.previous || null, result: result || { ok: true } });
}

export function markBoosterManual(state, id, actor, at = new Date().toISOString()) {
  const finding = requireFinding(state, id);
  if (finding.execution === "tray_content") throw Object.assign(new Error("Este achado pode ser aplicado na Tray após aprovação."), { status: 409 });
  return withHistory(state, finding, { at, event: "manual", actor: actorId(actor) }, actor, { status: "manual", result: { ok: true, manual: true, limitation: finding.limitation } });
}

export function markBoosterReverted(state, id, actor, result, at = new Date().toISOString()) {
  const finding = requireFinding(state, id);
  if (finding.status !== "applied" || !finding.previous) throw Object.assign(new Error("Não há conteúdo anterior para restaurar."), { status: 409 });
  return withHistory(state, finding, { at, event: "reverted", actor: actorId(actor) }, actor, { status: "reverted", result: result || { ok: true } });
}

export function markBoosterFailed(state, id, actor, error, at = new Date().toISOString()) {
  const finding = state.findings?.[id];
  if (!finding) return state;
  return withHistory(state, finding, { at, event: "failed", actor: actorId(actor) }, actor, { result: { ok: false, error: text(error, 300) } });
}

function actorId(actor = {}) {
  return actor?.id || actor?.idusuario || null;
}

export function previousContent(product = {}) {
  return {
    name: product.name && product.name !== "Produto sem descrição" ? product.name : "",
    description: "description" in product ? product.description || "" : null,
    description_small: "descriptionSmall" in product ? product.descriptionSmall || "" : null,
  };
}
