import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import {
  acceptListingSuggestion,
  composeListingSuggestion,
  contentPayload,
} from "./marketplace-booster.js";

const FILE = "charlie_tecnospeed_review.json";
const CHANNEL = "Fila hub Tecnospeed";
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

const emptyState = () => ({ version: 1, analyzedAt: null, limitations: [], items: {} });
const text = (value, limit = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const code = (value) => text(value, 80).toUpperCase().replace(/\s+/g, "");
const itemId = (key) => `TS-${crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 12)}`;
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positive = (value) => {
  const n = num(value);
  return n != null && n > 0 ? n : null;
};

export const TECNOSPEED_VIEW_SQL = `
  SELECT FIRST 800
    PRODUCTID, PRODUCTNAME, SKU, NAME, CATEGORYID, BRAND, DESCRIPTION,
    WIDTH, HEIGHT, LENGTH, WEIGHT, PRICE, STOCK, ACTIVE, EAN,
    MEASUREMENTUNIT, MEANSUREMENTUNIT, NCM, UNITMULTIPLIER,
    VOLTAGE, SIZE, LISTINGTYPE, SALEPRICE, MODEL, COLOR, POTENCY,
    PRODUTOCADASTRADO, ITS_INTEGRACAO_ERRO, DH_SUBIU_ITS
  FROM PRODUTOS_TECNOSPEED
`;

export const TECNOSPEED_TRAY_ID_SQL = `
  SELECT FIRST 1 CDPRODUTO, ID_TECNOSPEED, PRODUTOWEB, URL_FOTO_ITS
  FROM PRODUTO
  WHERE CDPRODUTO = ?
`;

export function readTecnospeedReview() {
  const stored = readJsonConfig(FILE, emptyState());
  return { ...emptyState(), ...stored, items: stored.items || {}, limitations: stored.limitations || [] };
}

export function saveTecnospeedReview(state) {
  return writeJsonConfig(FILE, state);
}

export function mapTecnospeedRow(row = {}) {
  return {
    productId: text(row.PRODUCTID, 40),
    productName: text(row.PRODUCTNAME || row.NAME, 180),
    sku: text(row.SKU || row.PRODUCTID, 80),
    name: text(row.NAME || row.PRODUCTNAME, 180),
    categoryId: text(row.CATEGORYID, 40),
    brand: text(row.BRAND, 100),
    description: row.DESCRIPTION == null ? null : text(row.DESCRIPTION, 5000),
    width: positive(row.WIDTH),
    height: positive(row.HEIGHT),
    length: positive(row.LENGTH),
    weight: positive(row.WEIGHT),
    price: positive(row.PRICE),
    stock: Math.max(0, num(row.STOCK) || 0),
    active: Number(row.ACTIVE) !== 0,
    ean: text(row.EAN, 20).replace(/\D/g, "").slice(0, 14),
    unit: text(row.MEANSUREMENTUNIT || row.MEASUREMENTUNIT, 20) || "un",
    ncm: text(row.NCM, 20),
    voltage: text(row.VOLTAGE, 40),
    size: text(row.SIZE, 40),
    listingType: text(row.LISTINGTYPE, 80),
    salePrice: positive(row.SALEPRICE),
    model: text(row.MODEL, 100),
    color: text(row.COLOR, 40),
    potency: text(row.POTENCY, 40),
    registered: Number(row.PRODUTOCADASTRADO) !== 0,
    integrationError: Number(row.ITS_INTEGRACAO_ERRO) !== 0,
    lastUploadAt: text(row.DH_SUBIU_ITS, 40) || null,
    imageUrl: text(row.URL_FOTO_ITS || row.IMAGEURL, 500) || null,
  };
}

export function aggregateTecnospeedRows(rows = []) {
  const byId = new Map();
  for (const raw of rows) {
    const mapped = mapTecnospeedRow(raw);
    if (!mapped.productId) continue;
    const prior = byId.get(mapped.productId);
    if (!prior) {
      byId.set(mapped.productId, mapped);
      continue;
    }
    byId.set(mapped.productId, {
      ...prior,
      stock: Math.max(prior.stock, mapped.stock),
      price: prior.price || mapped.price,
      description: (prior.description && prior.description.length >= (mapped.description || "").length)
        ? prior.description
        : mapped.description,
      categoryId: prior.categoryId || mapped.categoryId,
      weight: prior.weight || mapped.weight,
      width: prior.width || mapped.width,
      height: prior.height || mapped.height,
      length: prior.length || mapped.length,
      brand: prior.brand || mapped.brand,
      imageUrl: prior.imageUrl || mapped.imageUrl,
      registered: prior.registered || mapped.registered,
      integrationError: prior.integrationError || mapped.integrationError,
      lastUploadAt: prior.lastUploadAt || mapped.lastUploadAt,
    });
  }
  return [...byId.values()].sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name, "pt-BR"));
}

function measureText(product = {}) {
  const parts = [];
  if (product.length) parts.push(`comprimento ${product.length}`);
  if (product.width) parts.push(`largura ${product.width}`);
  if (product.height) parts.push(`altura ${product.height}`);
  if (product.weight) parts.push(`peso ${product.weight}`);
  return parts.join(", ");
}

export function listingFactsFromTecnospeed(product = {}) {
  return {
    nome: text(product.name || product.productName, 180),
    marca: text(product.brand, 80),
    referencia: text(product.sku || product.productId, 80),
    categoria: text(product.categoryId, 80),
    modelo: text(product.model, 80),
    codigoFabricante: "",
    medidas: measureText(product),
    voltagem: text(product.voltage, 40),
    cor: text(product.color, 40),
    potencia: text(product.potency, 40),
  };
}

export function uploadGaps(product = {}) {
  const missing = [];
  if (!text(product.name || product.productName)) missing.push("nome");
  if (!(product.price > 0)) missing.push("preço");
  if (product.stock == null || !(product.stock >= 0) || !Number.isFinite(product.stock)) missing.push("estoque");
  if (!text(product.categoryId) || !(Number(product.categoryId) > 0)) missing.push("categoria");
  if (!(product.weight > 0)) missing.push("peso");
  for (const field of ["length", "width", "height"]) {
    if (!(product[field] > 0)) missing.push(field === "length" ? "comprimento" : field === "width" ? "largura" : "altura");
  }
  return missing;
}

export function analyzeTecnospeedProducts(products = [], { trayProducts = [] } = {}) {
  const limitations = [
    "A leitura usa só a view PRODUTOS_TECNOSPEED, a mesma fila do integrador que sobe ao hub.",
    "A revisão do texto é feita pelo Ollama. Sem Ollama ativo o item não avança para aprovação.",
    "O Ollama só pode usar fatos do cadastro. Categoria, peso e medidas continuam no ERP.",
    "Produto novo na Tray exige categoria, peso e medidas positivos. Sem isso a subida fica bloqueada.",
  ];
  const trayIndex = new Map();
  for (const product of trayProducts) {
    for (const key of [product.externalId, product.reference, product.sku].map(code).filter(Boolean)) {
      if (!trayIndex.has(key)) trayIndex.set(key, product);
    }
  }

  const findings = [];
  for (const product of products) {
    const tray = trayIndex.get(code(product.sku))
      || trayIndex.get(code(product.productId))
      || null;
    const gaps = uploadGaps(product);
    const name = product.name || product.productName || "";
    const description = product.description || "";
    const problems = [];

    if (!text(name) || text(name).length < 12) {
      problems.push({ type: "title", problem: text(name) ? "Título pouco informativo" : "Título ausente", priority: "high" });
    } else if (product.brand && !text(name).toLowerCase().includes(text(product.brand, 40).toLowerCase())) {
      problems.push({ type: "title", problem: "Título sem a marca cadastrada", priority: "medium" });
    }
    if (description.length < 40) {
      problems.push({
        type: "description",
        problem: description ? "Descrição insuficiente" : "Descrição ausente",
        priority: "high",
      });
    }
    if (!problems.length) {
      problems.push({
        type: tray ? "refresh" : "upload",
        problem: tray
          ? "Já existe na Tray; revisar texto antes de atualizar"
          : gaps.length
            ? `Preparar texto; falta no ERP para criar: ${gaps.join(", ")}`
            : "Pronto para revisar e subir à Tray",
        priority: gaps.length && !tray ? "high" : "medium",
      });
    }

    for (const entry of problems) {
      const id = itemId(`${product.productId}:${entry.type}:${entry.problem}`);
      const canUpload = Boolean(tray) || gaps.length === 0;
      findings.push({
        id,
        productId: product.productId,
        sku: product.sku,
        productName: name || product.productId,
        marketplace: CHANNEL,
        type: entry.type,
        problem: entry.problem,
        priority: entry.priority,
        execution: "tray_upload",
        product,
        trayId: tray?.externalId || null,
        gaps,
        canUpload,
        evidence: {
          price: product.price,
          stock: product.stock,
          descriptionLength: description.length,
          categoryId: product.categoryId || null,
          trayId: tray?.externalId || null,
          registered: product.registered,
          gaps,
        },
        recommendation: canUpload
          ? "Pedir a revisão do Ollama a partir do cadastro da view e, após aprovação, subir à Tray."
          : "O Ollama revisa o texto agora. Complete categoria, peso e medidas no Automec antes da criação na Tray.",
        limitation: canUpload
          ? null
          : "Sem categoria/peso/medidas a criação na Tray fica bloqueada. Atualização de anúncio existente continua liberada quando houver ID na loja.",
      });
    }
  }

  const ordered = findings.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || a.productName.localeCompare(b.productName, "pt-BR"));
  const visible = ordered.slice(0, 200);
  if (ordered.length > visible.length) {
    limitations.push(`A análise encontrou ${ordered.length} itens. A lista guarda os 200 de maior prioridade.`);
  }
  if (!products.length) limitations.push("A view PRODUTOS_TECNOSPEED não retornou produtos nesta leitura.");
  return { findings: visible, limitations, products };
}

export function mergeTecnospeedState(previous = emptyState(), analysis, at = new Date().toISOString()) {
  const state = { ...emptyState(), ...previous, items: { ...(previous.items || {}) } };
  const seen = new Set();
  for (const finding of analysis.findings || []) {
    seen.add(finding.id);
    const prior = state.items[finding.id];
    state.items[finding.id] = {
      ...finding,
      status: prior?.status && prior.status !== "open" ? prior.status : "open",
      suggestion: prior?.suggestion || null,
      previous: prior?.previous || null,
      result: prior?.result || null,
      history: prior?.history || [{ at, event: "identified", actor: "Charlie" }],
      identifiedAt: prior?.identifiedAt || at,
      updatedAt: at,
    };
  }
  for (const [id, prior] of Object.entries(state.items)) {
    if (seen.has(id) || prior.status !== "open") continue;
    state.items[id] = {
      ...prior,
      status: "resolved",
      updatedAt: at,
      history: [...(prior.history || []), { at, event: "resolved", actor: "Charlie" }],
    };
  }
  state.analyzedAt = at;
  state.limitations = analysis.limitations || [];
  return state;
}

function actorId(actor = {}) {
  return actor?.id || actor?.idusuario || null;
}

function requireItem(state, id) {
  const item = state.items?.[id];
  if (!item) throw Object.assign(new Error("Item não encontrado."), { status: 404 });
  return item;
}

function withHistory(state, item, event, extra = {}) {
  const next = {
    ...item,
    ...extra,
    updatedAt: event.at,
    history: [...(item.history || []), { at: event.at, event: event.event, actor: event.actor }],
  };
  return { ...state, items: { ...state.items, [item.id]: next } };
}

export function tecnospeedFacts(state, id) {
  const item = requireItem(state, id);
  return { item, facts: listingFactsFromTecnospeed(item.product || {}) };
}

export function recordTecnospeedSuggestion(state, id, suggestion, actor, at = new Date().toISOString()) {
  const item = requireItem(state, id);
  if (item.execution !== "tray_upload") {
    throw Object.assign(new Error(item.limitation || "Este item não recebe texto para subida."), { status: 409 });
  }
  if (item.status === "uploaded") {
    throw Object.assign(new Error("O item já foi enviado. Gere outra análise se precisar revisar de novo."), { status: 409 });
  }
  return withHistory(state, item, { at, event: "suggested", actor: actorId(actor) }, {
    suggestion,
    status: item.status === "approved" ? "approved" : "suggested",
  });
}

export function decideTecnospeedItem(state, id, decision, actor, at = new Date().toISOString()) {
  const item = requireItem(state, id);
  if (!["open", "suggested"].includes(item.status)) {
    throw Object.assign(new Error("O item já foi decidido."), { status: 409 });
  }
  if (!actorId(actor)) throw Object.assign(new Error("Usuário autenticado é obrigatório."), { status: 403 });
  if (decision === "approve" && !item.suggestion) {
    throw Object.assign(new Error("Gere a sugestão da IA antes de aprovar."), { status: 409 });
  }
  return withHistory(state, item, {
    at,
    event: decision === "approve" ? "approved" : "rejected",
    actor: actorId(actor),
  }, { status: decision === "approve" ? "approved" : "rejected" });
}

export function buildTrayPayloadFromTecnospeed(item = {}) {
  const product = item.product || {};
  const suggestion = item.suggestion || {};
  const content = contentPayload(suggestion);
  const gaps = uploadGaps({
    ...product,
    name: content.name || product.name,
  });
  const payload = {
    name: content.name || text(product.name || product.productName, 120),
    description_small: content.description_small || text(product.description, 300),
    description: content.description || text(product.description, 5000),
    reference: text(product.sku || product.productId, 100),
    ean: text(product.ean, 14),
    brand: text(product.brand, 100),
    model: text(product.model, 100),
    category_id: Number(product.categoryId) || 0,
    price: Number(product.price) || 0,
    promotional_price: Number(product.salePrice) || 0,
    stock: Number(product.stock) || 0,
    weight: Number(product.weight) || 0,
    length: Number(product.length) || 0,
    width: Number(product.width) || 0,
    height: Number(product.height) || 0,
    available: product.active === false ? 0 : 1,
    metatag: content.name ? content.name.slice(0, 70) : text(product.name, 70),
    keywords: content.keywords || "",
  };
  return { payload, gaps, content };
}

export function markTecnospeedUploaded(state, id, actor, { previous, result, trayId, mode }, at = new Date().toISOString()) {
  const item = requireItem(state, id);
  if (item.status !== "approved") throw Object.assign(new Error("A subida exige aprovação."), { status: 409 });
  if (item.execution !== "tray_upload") {
    throw Object.assign(new Error(item.limitation || "Este item não sobe automaticamente."), { status: 409 });
  }
  return withHistory(state, item, { at, event: "uploaded", actor: actorId(actor) }, {
    status: "uploaded",
    trayId: trayId || item.trayId || null,
    previous: previous || item.previous || null,
    result: { ok: true, mode, ...(result || {}) },
  });
}

export function markTecnospeedFailed(state, id, actor, error, at = new Date().toISOString()) {
  const item = state.items?.[id];
  if (!item) return state;
  return withHistory(state, item, { at, event: "failed", actor: actorId(actor) }, {
    result: { ok: false, error: text(error, 300) },
  });
}

export function markTecnospeedBlocked(state, id, actor, reason, at = new Date().toISOString()) {
  const item = requireItem(state, id);
  return withHistory(state, item, { at, event: "blocked", actor: actorId(actor) }, {
    status: "blocked",
    result: { ok: false, blocked: true, error: text(reason, 300) },
  });
}

export function composeTecnospeedSuggestion(facts = {}) {
  return composeListingSuggestion(facts);
}

export function acceptTecnospeedSuggestion(suggestion = {}, facts = {}) {
  return acceptListingSuggestion(suggestion, facts);
}

export function parseOllamaReview(content, facts = {}) {
  if (!content) {
    return { ok: false, reason: "O Ollama não respondeu. Verifique se o serviço e o modelo estão ativos." };
  }
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return { ok: false, reason: "O Ollama retornou um formato inválido. Tente revisar de novo." };
  }
  const guarded = acceptTecnospeedSuggestion({ ...parsed, source: "ollama" }, facts);
  if (!guarded.ok) {
    return {
      ok: false,
      reason: `${guarded.reason} A revisão do Ollama foi recusada; sem texto inventado o item não avança.`,
    };
  }
  return { ok: true, suggestion: { ...guarded.suggestion, source: "ollama" } };
}

export async function reviewTecnospeedWithOllama(facts, chat = null) {
  if (typeof chat !== "function") {
    throw Object.assign(new Error("A revisão exige o Ollama."), { status: 503 });
  }
  let content;
  try {
    content = await chat({
      maxTokens: 700,
      temperature: 0.1,
      format: {
        type: "object",
        properties: {
          name: { type: "string" },
          description_small: { type: "string" },
          description: { type: "string" },
          keywords: { type: "string" },
        },
        required: ["name", "description_small", "description", "keywords"],
      },
      messages: [
        {
          role: "system",
          content: "Você revisa anúncios de e-commerce em português do Brasil e responde só JSON. Use exclusivamente os fatos recebidos. Melhore título e descrição para marketplace sem inventar número, medida, material, compatibilidade, certificação, garantia ou benefício. Não use HTML.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    });
  } catch (error) {
    throw Object.assign(
      new Error(`O Ollama não revisou o produto. ${error.message || "Serviço indisponível."}`),
      { status: error.status || 503 },
    );
  }
  const reviewed = parseOllamaReview(content, facts);
  if (!reviewed.ok) {
    throw Object.assign(new Error(reviewed.reason), { status: 422 });
  }
  return reviewed.suggestion;
}

export function publicTecnospeedReview(state = readTecnospeedReview()) {
  return {
    analyzedAt: state.analyzedAt,
    limitations: state.limitations || [],
    items: Object.values(state.items || {})
      .filter((item) => !["resolved"].includes(item.status))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
        || String(a.productName).localeCompare(String(b.productName), "pt-BR")),
  };
}
