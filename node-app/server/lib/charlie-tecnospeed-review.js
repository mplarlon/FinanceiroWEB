import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import {
  acceptListingSuggestion,
  composeListingSuggestion,
  contentPayload,
  modulo_removidoMetatag,
} from "./marketplace-booster.js";
import { resetOllamaAvailability } from "./ollama.js";
import { matchWebCategory } from "./product-web-specs.js";
import { sanitizeDurations } from "./review-estimate.js";

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

export function availableFrommodulo_removidoFlag(value) {
  return Number(value) === -1 ? 0 : 1;
}

export const TECNOSPEED_AVAILABLE_SQL = `
  SELECT COALESCE(INATIVA_modulo_removido, 0) AS INATIVA_modulo_removido
  FROM PRODUTO
  WHERE CDPRODUTO = ?
`;

export const TECNOSPEED_modulo_removido_ID_SQL = `
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
    // A view chama de ACTIVE a coluna INATIVA_modulo_removido. -1 tira o produto da loja.
    active: Number(row.ACTIVE) !== -1,
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

function trimNumber(value) {
  return String(Number(Number(value).toFixed(4)));
}

function measureText(product = {}) {
  const parts = [];
  if (product.length) parts.push(`comprimento ${trimNumber(product.length)} cm`);
  if (product.width) parts.push(`largura ${trimNumber(product.width)} cm`);
  if (product.height) parts.push(`altura ${trimNumber(product.height)} cm`);
  if (product.weight) parts.push(`peso ${trimNumber(product.weight)} g, ${trimNumber(product.weight / 1000)} kg`);
  return parts.join(", ");
}

export function categoryLabel(product = {}) {
  if (text(product.grupoWeb) && text(product.tipoWeb)) return `${text(product.grupoWeb, 80)} > ${text(product.tipoWeb, 80)}`;
  return text(product.categoryId, 80);
}

export function hasWebCategory(product = {}) {
  const names = Boolean(text(product.grupoWeb) && text(product.tipoWeb));
  if (product.grupoWebId > 0 && product.tipoWebId > 0 && names) return true;
  return Boolean(product.categoryFromProduct && names);
}

export function listingFactsFromTecnospeed(product = {}) {
  return {
    nome: text(product.name || product.productName, 180),
    marca: text(product.brand, 80),
    referencia: text(product.sku || product.productId, 80),
    categoria: categoryLabel(product),
    fontePesquisa: text(product.specSource, 300),
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
  if (!hasWebCategory(product) && !(Number(product.categoryId) > 0) && !(Number(product.modulo_removidoCategoryId) > 0)) missing.push("categoria");
  if (!(product.weight > 0)) missing.push("peso");
  for (const field of ["length", "width", "height"]) {
    if (!(product[field] > 0)) missing.push(field === "length" ? "comprimento" : field === "width" ? "largura" : "altura");
  }
  return missing;
}

export function reviewMessages(modulo_removido, gaps = []) {
  const canUpload = Boolean(modulo_removido) || gaps.length === 0;
  if (canUpload) {
    return {
      canUpload: true,
      recommendation: "Pedir a revisão do Charlie a partir do cadastro da view e, após aprovação, subir à modulo_removido.",
      limitation: null,
    };
  }
  return {
    canUpload: false,
    recommendation: "A revisão pesquisa o produto na internet e preenche grupo web, subgrupo web, peso e medidas que ainda faltam.",
    limitation: "A categoria é o grupo e o subgrupo web. Peso e medidas confirmados na pesquisa são gravados no produto. Sem esses dados a criação na modulo_removido continua bloqueada.",
  };
}

export function applyWebCategory(product = {}, row = {}) {
  const grupoWebId = positive(row.CDGRUPOWEB);
  const tipoWebId = positive(row.CDTIPOWEB);
  const grupoWebName = text(row.GRUPOWEB, 80);
  const tipoWebName = text(row.TIPOWEB, 80);
  const hasWeb = grupoWebId > 0 && tipoWebId > 0 && Boolean(grupoWebName && tipoWebName);
  const modulo_removidoCategoryId = positive(row.ID_modulo_removido) || product.modulo_removidoCategoryId || null;
  if (hasWeb) {
    return {
      ...product,
      grupoWebId,
      tipoWebId,
      grupoWeb: grupoWebName,
      tipoWeb: tipoWebName,
      categoryFromProduct: false,
      modulo_removidoCategoryId,
      specSource: product.specSource || null,
    };
  }
  const grupoProduto = text(row.GRUPO_PRODUTO, 80);
  const subgrupoProduto = text(row.SUBGRUPO, 80);
  if (grupoProduto && subgrupoProduto) {
    return {
      ...product,
      grupoWebId: null,
      tipoWebId: null,
      grupoWeb: grupoProduto,
      tipoWeb: subgrupoProduto,
      categoryFromProduct: true,
      modulo_removidoCategoryId,
      specSource: product.specSource || null,
    };
  }
  return {
    ...product,
    grupoWebId: grupoWebId || product.grupoWebId || null,
    tipoWebId: tipoWebId || product.tipoWebId || null,
    grupoWeb: grupoWebName || product.grupoWeb || "",
    tipoWeb: tipoWebName || product.tipoWeb || "",
    modulo_removidoCategoryId,
    specSource: product.specSource || null,
  };
}

export function prepareProductForResearch(product = {}, catalog = []) {
  if (!(product.grupoWebId > 0) || !(product.tipoWebId > 0) || !catalog.length) return product;
  const known = catalog.some((item) => Number(item.grupoWebId) === Number(product.grupoWebId)
    && Number(item.tipoWebId) === Number(product.tipoWebId));
  if (known) return product;
  return {
    ...product,
    grupoWebId: null,
    tipoWebId: null,
    grupoWeb: "",
    tipoWeb: "",
    categoryFromProduct: false,
    modulo_removidoCategoryId: null,
  };
}

export function categoryFromProductGroup(product = {}, catalog = []) {
  if (!product.categoryFromProduct) return { product, matched: false };
  const match = matchWebCategory(catalog, product.grupoWeb, product.tipoWeb);
  if (!match) return { product, matched: false };
  return {
    product: {
      ...product,
      grupoWebId: match.grupoWebId,
      tipoWebId: match.tipoWebId,
      grupoWeb: match.grupoWeb,
      tipoWeb: match.tipoWeb,
      categoryFromProduct: false,
    },
    matched: true,
  };
}

export function webCategorySql(count) {
  const marks = Array.from({ length: count }, () => "?").join(", ");
  return `
    SELECT p.CDPRODUTO, p.CDGRUPOWEB, g.GRUPOWEB, p.CDTIPOWEB, t.TIPOWEB, ci.ID_modulo_removido,
      gr.GRUPOS AS GRUPO_PRODUTO, tp.TIPO AS SUBGRUPO
    FROM PRODUTO p
    LEFT JOIN GRUPO_WEB g ON g.CDGRUPOWEB = p.CDGRUPOWEB
    LEFT JOIN TIPO_WEB t ON t.CDTIPOWEB = p.CDTIPOWEB AND t.CDGRUPOWEB = p.CDGRUPOWEB
    LEFT JOIN CATEGORIAS_INTEGRACAO ci ON ci.CDGRUPOWEB = p.CDGRUPOWEB
      AND ci.CDTIPOWEB = p.CDTIPOWEB AND COALESCE(ci.PAI, '') <> ''
    LEFT JOIN GRUPOS gr ON gr.CDGRUPO = p.CDGRUPO
    LEFT JOIN TIPO tp ON tp.CDTIPO = p.CDTIPO
    WHERE p.CDPRODUTO IN (${marks})
  `;
}

export const WEB_CATALOG_SQL = `
  SELECT g.CDGRUPOWEB, g.GRUPOWEB, t.CDTIPOWEB, t.TIPOWEB
  FROM TIPO_WEB t
  JOIN GRUPO_WEB g ON g.CDGRUPOWEB = t.CDGRUPOWEB
  WHERE COALESCE(g.INATIVO, 0) = 0 AND COALESCE(t.INATIVO, 0) = 0
`;

function refreshGapProblem(item, gaps) {
  const problems = (item.problems || []).map((problem) => {
    if (/falta no ERP para criar/i.test(problem)) {
      return gaps.length ? `Preparar texto; falta no ERP para criar: ${gaps.join(", ")}` : "Pronto para revisar e subir à modulo_removido";
    }
    return problem;
  });
  const unique = [...new Set(problems)];
  return { problems: unique, problem: unique.join("; ") };
}

export function applyResearchedSpecs(item = {}, specs = {}) {
  const product = { ...(item.product || {}) };
  const filled = [];
  if (!hasWebCategory(product) && specs.grupoWebId > 0 && specs.tipoWebId > 0) {
    product.grupoWebId = specs.grupoWebId;
    product.tipoWebId = specs.tipoWebId;
    product.grupoWeb = text(specs.grupoWeb, 80);
    product.tipoWeb = text(specs.tipoWeb, 80);
    filled.push("categoria");
  }
  if (!(product.weight > 0) && specs.weightGrams > 0) {
    product.weight = specs.weightGrams;
    filled.push("peso");
  }
  if (!(product.length > 0) && specs.lengthCm > 0) {
    product.length = specs.lengthCm;
    filled.push("comprimento");
  }
  if (!(product.width > 0) && specs.widthCm > 0) {
    product.width = specs.widthCm;
    filled.push("largura");
  }
  if (!(product.height > 0) && specs.heightCm > 0) {
    product.height = specs.heightCm;
    filled.push("altura");
  }
  if (specs.source) product.specSource = specs.source;
  const gaps = uploadGaps({ ...product, name: product.name || item.productName });
  const messages = reviewMessages(item.modulo_removidoId, gaps);
  const problem = refreshGapProblem(item, gaps);
  const lead = specs.origin === "cadastro" ? "Cadastro já tinha" : "Pesquisa preencheu";
  const note = filled.length
    ? `${lead} ${filled.join(", ")}.${specs.detail ? ` ${specs.detail}` : ""}`
    : (specs.origin === "cadastro"
      ? (item.specNote || "")
      : "A pesquisa não trouxe dado novo além do que já estava no cadastro.");
  return {
    ...item,
    ...problem,
    product,
    gaps,
    ...messages,
    specSource: specs.source || item.specSource || null,
    specNote: note,
    researchedAt: new Date().toISOString(),
    filled,
    evidence: { ...(item.evidence || {}), gaps, category: categoryLabel(product) },
  };
}

export function productSpecUpdate(sku, item = {}) {
  const product = item.product || {};
  const filled = new Set(item.filled || []);
  const sets = [];
  const params = [];
  if (filled.has("peso") && product.weight > 0) {
    sets.push("PESOBRUTO = IIF(COALESCE(PESOBRUTO, 0) > 0, PESOBRUTO, ?)");
    params.push(Number((product.weight / 1000).toFixed(4)));
  }
  if (filled.has("largura") && product.width > 0) {
    sets.push("LARGURAWEB = IIF(COALESCE(LARGURAWEB, 0) > 0, LARGURAWEB, ?)");
    params.push(product.width);
  }
  if (filled.has("altura") && product.height > 0) {
    sets.push("ALTURAWEB = IIF(COALESCE(ALTURAWEB, 0) > 0, ALTURAWEB, ?)");
    params.push(product.height);
  }
  if (filled.has("comprimento") && product.length > 0) {
    sets.push("PROFUNDIDADEWEB = IIF(COALESCE(PROFUNDIDADEWEB, 0) > 0, PROFUNDIDADEWEB, ?)");
    params.push(product.length);
  }
  if (filled.has("categoria") && product.grupoWebId > 0 && product.tipoWebId > 0) {
    sets.push("CDGRUPOWEB = IIF(COALESCE(CDGRUPOWEB, 0) > 0, CDGRUPOWEB, ?)");
    params.push(product.grupoWebId);
    sets.push("CDTIPOWEB = IIF(COALESCE(CDTIPOWEB, 0) > 0, CDTIPOWEB, ?)");
    params.push(product.tipoWebId);
  }
  const codeValue = text(sku, 40);
  if (!sets.length || !codeValue) return null;
  params.push(codeValue);
  return { sql: `UPDATE PRODUTO SET ${sets.join(", ")} WHERE CDPRODUTO = ?`, params };
}

export const PRODUCT_MEASURE_SQL = `
  SELECT FIRST 1 PESOBRUTO, LARGURAWEB, ALTURAWEB, PROFUNDIDADEWEB, CODIGOBARRA, CODBARRA_FULL
  FROM PRODUTO
  WHERE CDPRODUTO = ?
`;

export function barcodeList(row = {}, product = {}) {
  const found = [];
  for (const value of [row.CODIGOBARRA, product.ean, ...(product.eans || []), row.CODBARRA_FULL]) {
    for (const code of String(value || "").split(/[^0-9]+/)) {
      if (code.length >= 8 && code.length <= 14 && !found.includes(code)) found.push(code);
    }
  }
  return found;
}

export function applyStoredMeasures(item = {}, row = {}) {
  const product = { ...(item.product || {}) };
  const eans = barcodeList(row, product);
  const grams = !(product.weight > 0) && Number(row.PESOBRUTO) > 0
    ? Math.round(Number(row.PESOBRUTO) * 100000) / 100
    : null;
  const specs = {
    origin: "cadastro",
    weightGrams: grams,
    lengthCm: !(product.length > 0) ? positive(row.PROFUNDIDADEWEB) : null,
    widthCm: !(product.width > 0) ? positive(row.LARGURAWEB) : null,
    heightCm: !(product.height > 0) ? positive(row.ALTURAWEB) : null,
  };
  const hasSpec = [specs.weightGrams, specs.lengthCm, specs.widthCm, specs.heightCm].some((value) => value > 0);
  const next = hasSpec ? applyResearchedSpecs({ ...item, product }, specs) : { ...item, product };
  next.product = { ...(next.product || product), eans };
  return next;
}

export function analyzeTecnospeedProducts(products = [], { modulo_removidoProducts = [] } = {}) {
  const limitations = [
    "A leitura usa só a view PRODUTOS_TECNOSPEED, a mesma fila do integrador que sobe ao hub.",
    "A categoria do anúncio é o grupo web e o subgrupo web do produto. Sem os dois, a revisão usa o grupo e o subgrupo do cadastro.",
    "A revisão pesquisa peso e medidas na internet e grava no produto só o que a página do mesmo item confirmar.",
    "A revisão do texto é feita pelo Charlie. Sem o modelo local ativo o item não avança para aprovação.",
    "Se o produto não tiver foto, a revisão copia a foto do anúncio do mesmo item. Ela não inventa imagem.",
    "Produto novo na modulo_removido exige grupo web, subgrupo web, peso e medidas. Sem isso a criação fica bloqueada.",
  ];
  const modulo_removidoIndex = new Map();
  for (const product of modulo_removidoProducts) {
    for (const key of [product.externalId, product.reference, product.sku].map(code).filter(Boolean)) {
      if (!modulo_removidoIndex.has(key)) modulo_removidoIndex.set(key, product);
    }
  }

  const findings = [];
  for (const product of products) {
    const modulo_removido = modulo_removidoIndex.get(code(product.sku))
      || modulo_removidoIndex.get(code(product.productId))
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
        type: modulo_removido ? "refresh" : "upload",
        problem: modulo_removido
          ? "Já existe na modulo_removido; revisar texto antes de atualizar"
          : gaps.length
            ? `Preparar texto; falta no ERP para criar: ${gaps.join(", ")}`
            : "Pronto para revisar e subir à modulo_removido",
        priority: gaps.length && !modulo_removido ? "high" : "medium",
      });
    }

    const priority = problems.some((entry) => entry.priority === "high")
      ? "high"
      : problems.some((entry) => entry.priority === "medium") ? "medium" : "low";
    const lead = problems.find((entry) => entry.priority === priority) || problems[0];
    const problemText = [...new Set(problems.map((entry) => entry.problem))].join("; ");
    const id = itemId(String(product.productId || product.sku || name));
    const messages = reviewMessages(modulo_removido, gaps);
    findings.push({
        id,
        productId: product.productId,
        sku: product.sku,
        productName: name || product.productId,
        marketplace: CHANNEL,
        type: lead.type,
        problem: problemText,
        problems: problems.map((entry) => entry.problem),
        priority,
        execution: "modulo_removido_upload",
        product,
        modulo_removidoId: modulo_removido?.externalId || null,
        gaps,
        canUpload: messages.canUpload,
        evidence: {
          price: product.price,
          stock: product.stock,
          descriptionLength: description.length,
          categoryId: product.categoryId || null,
          modulo_removidoId: modulo_removido?.externalId || null,
          registered: product.registered,
          gaps,
        },
        recommendation: messages.recommendation,
        limitation: messages.limitation,
    });
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

export async function persistProposedCategory(specs = {}, catalog = [], tx) {
  if (Number(specs.grupoWebId) > 0 && Number(specs.tipoWebId) > 0) return specs;
  const grupoName = text(specs.grupoWeb, 80);
  const tipoName = text(specs.tipoWeb, 80);
  if (!grupoName || !tipoName || !tx?.singleton || !tx?.execute) return specs;
  const known = matchWebCategory(catalog, grupoName, tipoName);
  if (known) {
    return {
      ...specs,
      grupoWebId: known.grupoWebId,
      tipoWebId: known.tipoWebId,
      grupoWeb: known.grupoWeb,
      tipoWeb: known.tipoWeb,
    };
  }
  let grupo = await tx.singleton(
    "SELECT FIRST 1 CDGRUPOWEB, GRUPOWEB FROM GRUPO_WEB WHERE COALESCE(INATIVO, 0) = 0 AND UPPER(GRUPOWEB) = UPPER(?)",
    [grupoName],
  );
  let grupoId = Number(grupo?.CDGRUPOWEB);
  if (!(grupoId > 0)) {
    const next = await tx.singleton("SELECT COALESCE(MAX(CDGRUPOWEB), 0) + 1 AS ID FROM GRUPO_WEB");
    grupoId = Number(next?.ID);
    if (!(grupoId > 0)) return specs;
    await tx.execute(
      "INSERT INTO GRUPO_WEB (CDGRUPOWEB, GRUPOWEB, DTALTER, INATIVO) VALUES (?, ?, CURRENT_TIMESTAMP, 0)",
      [grupoId, grupoName],
    );
  }
  let tipo = await tx.singleton(
    "SELECT FIRST 1 CDTIPOWEB, TIPOWEB FROM TIPO_WEB WHERE CDGRUPOWEB = ? AND COALESCE(INATIVO, 0) = 0 AND UPPER(TIPOWEB) = UPPER(?)",
    [grupoId, tipoName],
  );
  let tipoId = Number(tipo?.CDTIPOWEB);
  if (!(tipoId > 0)) {
    const next = await tx.singleton("SELECT COALESCE(MAX(CDTIPOWEB), 0) + 1 AS ID FROM TIPO_WEB");
    tipoId = Number(next?.ID);
    if (!(tipoId > 0)) return specs;
    await tx.execute(
      "INSERT INTO TIPO_WEB (CDTIPOWEB, TIPOWEB, DTALTER, INATIVO, CDGRUPOWEB) VALUES (?, ?, CURRENT_TIMESTAMP, 0, ?)",
      [tipoId, tipoName, grupoId],
    );
  }
  return {
    ...specs,
    grupoWebId: grupoId,
    tipoWebId: tipoId,
    grupoWeb: text(grupo?.GRUPOWEB, 80) || grupoName,
    tipoWeb: text(tipo?.TIPOWEB, 80) || tipoName,
  };
}

function keepResearchedProduct(incoming = {}, prior = {}) {
  const product = { ...(incoming || {}) };
  const old = prior?.product || {};
  for (const field of ["weight", "length", "width", "height"]) {
    if (!(product[field] > 0) && old[field] > 0) product[field] = old[field];
  }
  if (!(product.grupoWebId > 0) && old.grupoWebId > 0) {
    product.grupoWebId = old.grupoWebId;
    product.tipoWebId = old.tipoWebId;
    product.grupoWeb = old.grupoWeb;
    product.tipoWeb = old.tipoWeb;
    product.categoryFromProduct = false;
  } else if (!text(product.grupoWeb) && text(old.grupoWeb) && text(old.tipoWeb)) {
    product.grupoWeb = old.grupoWeb;
    product.tipoWeb = old.tipoWeb;
    product.categoryFromProduct = Boolean(old.categoryFromProduct);
  }
  if (!product.specSource && (old.specSource || prior?.specSource)) product.specSource = old.specSource || prior.specSource;
  return product;
}

export function mergeTecnospeedState(previous = emptyState(), analysis, at = new Date().toISOString()) {
  const state = { ...emptyState(), ...previous, items: { ...(previous.items || {}) } };
  const seen = new Set();
  for (const finding of analysis.findings || []) {
    seen.add(finding.id);
    const prior = state.items[finding.id];
    const product = keepResearchedProduct(finding.product, prior);
    const gaps = uploadGaps({ ...product, name: product.name || finding.productName });
    const messages = reviewMessages(finding.modulo_removidoId, gaps);
    state.items[finding.id] = {
      ...finding,
      status: prior?.status && prior.status !== "open" ? prior.status : "open",
      product,
      gaps,
      canUpload: messages.canUpload,
      recommendation: messages.recommendation,
      limitation: messages.limitation,
      suggestion: prior?.suggestion || null,
      specSource: prior?.specSource || finding.specSource || null,
      specNote: prior?.specNote || "",
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
  if (item.execution !== "modulo_removido_upload") {
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
  if (!actorId(actor)) throw Object.assign(new Error("Usuário autenticado é obrigatório."), { status: 403 });
  if (decision === "unapprove") {
    if (item.status !== "approved") {
      throw Object.assign(new Error("Só um item aprovado pode ser desaprovado."), { status: 409 });
    }
    return withHistory(state, item, { at, event: "unapproved", actor: actorId(actor) }, { status: "suggested" });
  }
  if (!["open", "suggested"].includes(item.status)) {
    throw Object.assign(new Error("O item já foi decidido."), { status: 409 });
  }
  if (decision === "approve" && !item.suggestion) {
    throw Object.assign(new Error("Gere a sugestão da IA antes de aprovar."), { status: 409 });
  }
  return withHistory(state, item, {
    at,
    event: decision === "approve" ? "approved" : "rejected",
    actor: actorId(actor),
  }, { status: decision === "approve" ? "approved" : "rejected" });
}

export function buildmodulo_removidoPayloadFromTecnospeed(item = {}) {
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
    category_id: Number(product.modulo_removidoCategoryId) || Number(product.categoryId) || 0,
    price: Number(product.price) || 0,
    promotional_price: Number(product.salePrice) || 0,
    stock: Number(product.stock) || 0,
    weight: Number(product.weight) || 0,
    length: Number(product.length) || 0,
    width: Number(product.width) || 0,
    height: Number(product.height) || 0,
    available: product.active === false ? 0 : 1,
  };
  const metatag = content.metatag || modulo_removidoMetatag(payload.name);
  if (metatag) payload.metatag = metatag;
  return { payload, gaps, content };
}

export function markTecnospeedUploaded(state, id, actor, { previous, result, modulo_removidoId, mode }, at = new Date().toISOString()) {
  const item = requireItem(state, id);
  if (item.status !== "approved") throw Object.assign(new Error("A subida exige aprovação."), { status: 409 });
  if (item.execution !== "modulo_removido_upload") {
    throw Object.assign(new Error(item.limitation || "Este item não sobe automaticamente."), { status: 409 });
  }
  return withHistory(state, item, { at, event: "uploaded", actor: actorId(actor) }, {
    status: "uploaded",
    modulo_removidoId: modulo_removidoId || item.modulo_removidoId || null,
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
    return { ok: false, reason: "O Ollama não respondeu nesta revisão. Tente o item de novo." };
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
      ok: true,
      fallback: true,
      reason: guarded.reason,
      suggestion: composeTecnospeedSuggestion(facts),
    };
  }
  return { ok: true, suggestion: { ...guarded.suggestion, source: "ollama" } };
}

export async function reviewTecnospeedWithOllama(facts, chat = null) {
  if (typeof chat !== "function") {
    throw Object.assign(new Error("A revisão exige o Ollama."), { status: 503 });
  }
  const payload = {
    maxTokens: 400,
    temperature: 0.1,
    timeoutMs: 360000,
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
        content: "Você revisa anúncios de modulo_removido em português do Brasil e responde só JSON. Use exclusivamente os fatos recebidos. Peso e medidas que já estiverem nos fatos podem entrar no texto. Não invente outro número, material, compatibilidade, certificação, garantia ou benefício. Não use HTML.",
      },
      { role: "user", content: JSON.stringify(facts) },
    ],
  };
  let content;
  try {
    const started = Date.now();
    content = await chat(payload);
    if (!content && Date.now() - started < 8000) {
      resetOllamaAvailability();
      content = await chat(payload);
    }
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
  return {
    suggestion: reviewed.suggestion,
    notice: reviewed.fallback ? `${reviewed.reason} O texto do cadastro foi mantido.` : "",
  };
}

export function collapseTecnospeedItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = code(item.productId || item.sku || item.productName || item.id);
    const listed = Array.isArray(item.problems) && item.problems.length
      ? item.problems
      : String(item.problem || "").split(";");
    const problems = listed.map((entry) => text(entry, 180)).filter(Boolean);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...item, problems: [...new Set(problems)] });
      continue;
    }
    const merged = [...new Set([...current.problems, ...problems])];
    const primary = (PRIORITY_RANK[item.priority] ?? 9) < (PRIORITY_RANK[current.priority] ?? 9) ? item : current;
    groups.set(key, { ...primary, problems: merged, problem: merged.join("; ") });
  }
  return [...groups.values()].map((item) => ({ ...item, problem: item.problems.join("; ") }));
}

export const TECNOSPEED_CHARACTERISTIC = "tecnospeed";

export function tecnospeedRemovalTarget(item = {}) {
  const sku = text(item.sku || item.product?.sku || "", 40);
  const productId = text(item.productId || "", 40);
  const family = /^F(\d+)$/i.exec(productId);
  const codeValue = family ? "" : (sku || productId);
  if (!family && !codeValue) {
    throw Object.assign(new Error("O item não tem código de produto para remover a característica."), { status: 422 });
  }
  return {
    sku: codeValue,
    familyId: family ? Number(family[1]) : null,
    name: text(item.productName, 180),
  };
}

export function matchingmodulo_removidoProductId(products = [], reference = "") {
  const wanted = text(reference, 100).toUpperCase();
  if (!wanted) return null;
  const match = products.find((product) => text(product?.reference, 100).toUpperCase() === wanted);
  const id = text(match?.id || match?.product_id, 40);
  return id || null;
}

export function tecnospeedRemovalMessage(name, { characteristicsRemoved = 0, flagCleared = 0, modulo_removidoDeleted = false } = {}) {
  const label = text(name, 180) || "O produto";
  const modulo_removido = modulo_removidoDeleted ? " O anúncio foi excluído da modulo_removido." : "";
  if (!characteristicsRemoved && !flagCleared && !modulo_removidoDeleted) return "";
  if (characteristicsRemoved && flagCleared) {
    return `${label} saiu da fila. A característica tecnospeed foi retirada do cadastro e a marcação que também o mantinha na view foi desligada.${modulo_removido}`;
  }
  if (characteristicsRemoved) {
    return `Característica tecnospeed retirada de ${label}. O produto saiu da fila do hub.${modulo_removido}`;
  }
  if (flagCleared) {
    return `${label} não tinha a característica tecnospeed. A marcação que o mantinha na fila foi desligada.${modulo_removido}`;
  }
  return `${label} saiu da fila.${modulo_removido}`;
}

export async function removeTecnospeedCharacteristic(tx, target) {
  const caracter = await tx.singleton(
    "SELECT FIRST 1 CDCARACTER FROM CARACTERISTICAS WHERE CARACTERISTICAS = ?",
    [TECNOSPEED_CHARACTERISTIC],
  );
  if (!caracter?.CDCARACTER) {
    throw Object.assign(new Error("A característica tecnospeed não está cadastrada."), { status: 422 });
  }
  const id = caracter.CDCARACTER;
  const param = target.familyId || target.sku;
  const productWhere = target.familyId
    ? "CDPRODUTO IN (SELECT CDPRODUTO FROM PRODUTO WHERE CDFAMILIA = ?)"
    : "CDPRODUTO = ?";
  const productTableWhere = target.familyId ? "CDFAMILIA = ?" : "CDPRODUTO = ?";
  const links = await tx.singleton(
    `SELECT COUNT(*) AS QTD FROM PRODUTOCARACTER WHERE ${productWhere} AND CDCARACTER = ?`,
    [param, id],
  );
  const characteristicsRemoved = Number(links?.QTD || 0);
  if (characteristicsRemoved) {
    await tx.execute(
      `DELETE FROM PRODUTOCARACTER WHERE ${productWhere} AND CDCARACTER = ?`,
      [param, id],
    );
  }
  const flags = await tx.singleton(
    `SELECT COUNT(*) AS QTD FROM PRODUTO WHERE ${productTableWhere} AND COALESCE(INATIVA_modulo_removido, 0) = -1`,
    [param],
  );
  const flagCleared = Number(flags?.QTD || 0);
  if (flagCleared) {
    await tx.execute(
      `UPDATE PRODUTO SET INATIVA_modulo_removido = 0 WHERE ${productTableWhere} AND COALESCE(INATIVA_modulo_removido, 0) = -1`,
      [param],
    );
  }
  return { characteristicsRemoved, flagCleared };
}

export function forgetTecnospeedProduct(state, item) {
  requireItem(state, item.id);
  const keys = new Set([code(item.productId), code(item.sku), code(item.id)].filter(Boolean));
  const items = {};
  for (const [id, current] of Object.entries(state.items || {})) {
    if ([code(current.productId), code(current.sku), code(id)].some((key) => key && keys.has(key))) continue;
    items[id] = current;
  }
  return { ...state, items };
}

export function publicTecnospeedReview(state = readTecnospeedReview()) {
  const items = collapseTecnospeedItems(Object.values(state.items || {}).filter((item) => item.status !== "resolved"));
  return {
    analyzedAt: state.analyzedAt,
    limitations: state.limitations || [],
    reviewDurations: sanitizeDurations(state.reviewDurations),
    items: items.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
      || String(a.productName).localeCompare(String(b.productName), "pt-BR")),
  };
}
