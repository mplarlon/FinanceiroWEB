import crypto from "node:crypto";

const DECIMAL = String.raw`\d{1,5}(?:[.,]\d{1,4})?`;
const HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pt-BR,pt;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

const clean = (value, limit = 300) => String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);

export function normalizeLabel(value) {
  return clean(value, 120).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function parseDecimal(value) {
  const raw = String(value || "").trim();
  if (raw.includes(",") && raw.includes(".")) return Number(raw.replace(/\./g, "").replace(",", "."));
  if (raw.includes(",")) return Number(raw.replace(",", "."));
  return Number(raw);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function toCm(value, unit) {
  const number = parseDecimal(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const scale = String(unit || "cm").toLowerCase() === "mm" ? 0.1 : String(unit || "").toLowerCase() === "m" ? 100 : 1;
  const cm = round(number * scale, 2);
  return cm >= 0.4 && cm <= 150 ? cm : null;
}

function toGrams(value, unit) {
  const number = parseDecimal(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const grams = round(/kg/i.test(unit) ? number * 1000 : number, 2);
  return grams >= 1 && grams <= 50000 ? grams : null;
}

export function sizeTokens(value) {
  return [...clean(value, 180).toLowerCase().matchAll(/\d+(?:\/\d+)?/g)].map((match) => match[0]);
}

export function isBulkListing(title, productName) {
  const listing = clean(title, 240).toLowerCase().replace(/[-_]+/g, " ");
  const product = clean(productName, 240).toLowerCase();
  if (!/\b(?:kit|fardo|caixa|embalagem|pacote)\b|\b\d{2,}\s*(?:pe[cç]as|unidades|un)\b/.test(listing)) return false;
  return !(/\bkit\b/.test(product) || /\b\d{2,}\s*(?:pe[cç]as|unidades)\b/.test(product));
}

const LEGAL_SUFFIX = new Set(["LTDA", "LIMITADA", "INDUSTRIA", "COMERCIO", "IMPORTACAO", "EXPORTACAO", "EIRELI", "EPP"]);
const BRAND_NOISE = new Set(["BRASIL", "FERRAMENTAS", "FERRAMENTA", "PRODUTOS", "PRODUTO", "COMERCIAL", "FERRAGENS"]);
const MODEL_STOP = new Set(["RE", "DE", "DO", "DA", "EM", "OS", "AS", "UM", "UN", "NO", "NA", "AO", "OU", "COM", "PARA", "KIT", "SEM", "POR", "DAS", "DOS"]);

function compactAlpha(value) {
  return normalizeLabel(value).replace(/[^A-Z0-9]/g, "");
}

export function brandMatches(brand, text) {
  const key = compactAlpha(brand);
  const hay = compactAlpha(text);
  if (key.length <= 2) return true;
  if (hay.includes(key) || (hay.length >= 6 && key.includes(hay))) return true;
  const words = normalizeLabel(brand).split(/[^A-Z0-9]+/).filter((word) => word.length >= 4 && !LEGAL_SUFFIX.has(word));
  const hayWords = normalizeLabel(text).split(/[^A-Z0-9]+/).filter((word) => word.length >= 4);
  return words.some((word) => hayWords.some((other) => word === other
    || (Math.min(word.length, other.length) >= 6 && (word.startsWith(other) || other.startsWith(word)))));
}

function conflictingBarcode(text, codes) {
  if (!codes.length) return false;
  const labeled = [...String(text).matchAll(/(?:\bean\b|\bgtin\b|c[oó]digo de barras)\D{0,30}(\d{8,14})/gi)];
  if (!labeled.length) return false;
  return labeled.every((match) => !codes.includes(match[1]));
}

export function matchesProduct(product, title, text) {
  const haystack = `${title} ${text}`;
  const codes = barcodeListFromProduct(product);
  if (codes.some((code) => haystack.includes(code))) return true;
  if (conflictingBarcode(haystack, codes)) return false;
  const lower = haystack.toLowerCase();
  const brand = clean(product.brand, 40);
  if (brand.length > 2 && !brandMatches(brand, haystack)) return false;
  const name = product.name || product.productName || "";
  const decimals = [...clean(name, 180).matchAll(/\d+[.,]\d+/g)].map((match) => match[0].replace(",", "."));
  if (decimals.length) {
    const normalized = lower.replace(/(\d),(\d)/g, "$1.$2");
    if (!decimals.some((token) => normalized.includes(token))) return false;
  }
  const sizes = sizeTokens(name);
  const strong = sizes.filter((token) => /^\d{2,}$/.test(token));
  if (strong.length) return strong.some((token) => lower.includes(token));
  if (sizes.length) return sizes.some((token) => lower.includes(token));
  return brand.length > 2;
}

function labeledDimension(text, label) {
  const match = text.match(new RegExp(`${label}\\s*[:=]?\\s*~?\\s*(${DECIMAL})\\s*(mm|cm|m)\\b`, "i"));
  return match ? toCm(match[1], match[2]) : null;
}

function labeledWeight(text) {
  const match = text.match(new RegExp(`peso(?:\\s+do\\s+produto)?\\s*[:=]?\\s*~?\\s*(${DECIMAL})\\s*(kg|g|gramas)\\b`, "i"));
  return match ? toGrams(match[1], match[2]) : null;
}

function unitFirst(text, label) {
  const match = text.match(new RegExp(`${label}\\s*\\(\\s*(mm|cm|m|kg|g|gramas)\\s*\\)\\s*[:=|\\-]?\\s*(${DECIMAL})`, "i"));
  return match ? { value: match[2], unit: match[1] } : null;
}

function unitAfter(text, label) {
  const match = text.match(new RegExp(`${label}\\s*[:=|>]?\\s*~?\\s*(${DECIMAL})\\s*(mm|cm|m|kg|g|gramas)\\b`, "i"));
  return match ? { value: match[1], unit: match[2] } : null;
}

function retailMeasures(text) {
  const bruto = unitAfter(text, "peso\\s+bruto") || unitFirst(text, "peso\\s+bruto");
  const pesoParen = unitFirst(text, "peso");
  const weightGrams = bruto ? toGrams(bruto.value, bruto.unit) : (pesoParen ? toGrams(pesoParen.value, pesoParen.unit) : null);
  const axes = {};
  for (const match of text.matchAll(new RegExp(`(${DECIMAL})\\s*(mm|cm|m)\\s*\\(\\s*(largura|altura|comprimento|profundidade)\\s*\\)`, "gi"))) {
    const cm = toCm(match[1], match[2]);
    if (cm) axes[match[3].toLowerCase()] = cm;
  }
  const eachUnit = text.match(new RegExp(`(${DECIMAL})\\s*(mm|cm|m)\\s*[x×]\\s*(${DECIMAL})\\s*(mm|cm|m)\\s*[x×]\\s*(${DECIMAL})\\s*(mm|cm|m)\\b`, "i"));
  const sharedUnit = text.match(new RegExp(`(${DECIMAL})\\s*[x×]\\s*(${DECIMAL})\\s*[x×]\\s*(${DECIMAL})\\s*(mm|cm|m)\\b`, "i"));
  const boxAfter = text.match(new RegExp(`(${DECIMAL})\\s*[x×]\\s*(${DECIMAL})\\s*[x×]\\s*(${DECIMAL})\\s*(mm|cm|m)?\\s*\\(\\s*c\\s*[x×]\\s*l\\s*[x×]\\s*a\\s*\\)`, "i"));
  const boxBefore = text.match(new RegExp(`\\(\\s*c\\s*[x×]\\s*l\\s*[x×]\\s*a\\s*\\)\\s*(${DECIMAL})\\s*[x×]\\s*(${DECIMAL})\\s*[x×]\\s*(${DECIMAL})\\s*(mm|cm|m)`, "i"));
  const altura = unitFirst(text, "altura");
  const largura = unitFirst(text, "largura");
  const comprimento = unitFirst(text, "comprimento") || unitFirst(text, "profundidade");
  const boxed = eachUnit
    ? { lengthCm: toCm(eachUnit[1], eachUnit[2]), widthCm: toCm(eachUnit[3], eachUnit[4]), heightCm: toCm(eachUnit[5], eachUnit[6]) }
    : sharedUnit
      ? { lengthCm: toCm(sharedUnit[1], sharedUnit[4]), widthCm: toCm(sharedUnit[2], sharedUnit[4]), heightCm: toCm(sharedUnit[3], sharedUnit[4]) }
      : boxAfter
        ? { lengthCm: toCm(boxAfter[1], boxAfter[4] || "cm"), widthCm: toCm(boxAfter[2], boxAfter[4] || "cm"), heightCm: toCm(boxAfter[3], boxAfter[4] || "cm") }
        : boxBefore
          ? { lengthCm: toCm(boxBefore[1], boxBefore[4]), widthCm: toCm(boxBefore[2], boxBefore[4]), heightCm: toCm(boxBefore[3], boxBefore[4]) }
          : {};
  return {
    weightGrams,
    lengthCm: axes.comprimento || axes.profundidade || boxed.lengthCm || (comprimento ? toCm(comprimento.value, comprimento.unit) : null),
    widthCm: axes.largura || boxed.widthCm || (largura ? toCm(largura.value, largura.unit) : null),
    heightCm: axes.altura || boxed.heightCm || (altura ? toCm(altura.value, altura.unit) : null),
  };
}

function productNouns(value) {
  const label = normalizeLabel(expandCatalogName(value));
  return PRODUCT_NOUNS.filter((noun) => label.includes(noun));
}

export function listingSourceConflicts(product = {}, source = "") {
  const wanted = productNouns(product.name || product.productName || "");
  const seen = productNouns(String(source || "").replace(/[-_/]+/g, " "));
  if (!wanted.length || !seen.length) return false;
  return !wanted.some((noun) => seen.includes(noun));
}

export function specPageMatches(product, title, text) {
  const haystack = `${title} ${text}`;
  if (conflictingBarcode(haystack, barcodeListFromProduct(product))) return false;
  const wanted = productNouns(product.name || product.productName || "");
  const seen = productNouns(title);
  if (wanted.length && seen.length && !wanted.some((noun) => seen.includes(noun))) return false;
  return pageShowsCatalogItem(product, title, text) || matchesProduct(product, title, text);
}

export function extractCandidate(product, page) {
  const title = clean(page.title, 180);
  const text = clean(page.text, 12000);
  const name = product.name || product.productName || "";
  if (!title || isBulkListing(title, name) || !specPageMatches(product, title, text)) return null;
  const visible = `${title} ${text}`;
  const retail = retailMeasures(visible);
  const weightGrams = retail.weightGrams || labeledWeight(visible);
  const combo = visible.match(new RegExp(`A:\\s*(${DECIMAL})\\s*cm\\s*x\\s*L:\\s*(${DECIMAL})\\s*cm\\s*x\\s*P:\\s*(${DECIMAL})\\s*cm`, "i"));
  const heightCm = combo ? toCm(combo[1], "cm") : (labeledDimension(visible, "altura") || retail.heightCm);
  const widthCm = combo ? toCm(combo[2], "cm") : (labeledDimension(visible, "largura") || retail.widthCm);
  const lengthCm = combo ? toCm(combo[3], "cm") : (labeledDimension(visible, "comprimento") || labeledDimension(visible, "profundidade") || retail.lengthCm);
  const dimensions = [lengthCm, widthCm, heightCm].filter((value) => value > 0).length;
  if (!weightGrams && dimensions < 2) return null;
  const brand = clean(product.brand, 40).toLowerCase();
  const haystack = `${title} ${text}`.toLowerCase();
  let score = dimensions + (weightGrams ? 3 : 0);
  if (brand && haystack.includes(brand)) score += 4;
  for (const token of sizeTokens(name)) if (haystack.includes(token)) score += 2;
  if (weightGrams && dimensions === 3) score += 2;
  if (/aproximad|~\s*\d|podem variar/i.test(text)) score -= 5;
  if (/peso\s*[:=]?\s*~?\s*\d+[.,]\d{3,}\s*kg\b/i.test(text)) score += 4;
  const anchor = text.toLowerCase().search(/peso|altura|largura|comprimento|profundidade/);
  return {
    title,
    url: page.url,
    weightGrams,
    lengthCm,
    widthCm,
    heightCm,
    score,
    excerpt: text.slice(Math.max(0, anchor), anchor + 280),
  };
}

export function decodeSearchUrl(href) {
  const raw = String(href || "").replace(/&amp;/g, "&");
  const match = raw.match(/[?&]uddg=([^&]+)/);
  let value = match ? decodeURIComponent(match[1]) : raw;
  if (value.startsWith("//")) value = `https:${value}`;
  return value;
}

export function publicHttpUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return null;
  return url.href;
}

export function parseSearchResults(html) {
  const blocks = [...String(html || "").matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set();
  const results = [];
  for (const block of blocks) {
    const url = publicHttpUrl(decodeSearchUrl(block[1]));
    const title = clean(block[2], 180);
    if (!url || !title || seen.has(url) || /duckduckgo\.com|google\./i.test(url)) continue;
    seen.add(url);
    results.push({ title, url });
  }
  return results.slice(0, 8);
}

export function htmlToText(html) {
  return clean(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&times;/gi, "×")
    .replace(/&#215;/g, "×")
    .replace(/&#x0*d7;/gi, "×")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))), 12000);
}

export function searchQuery(product = {}) {
  return [product.brand, product.name || product.productName, "peso altura largura comprimento"]
    .map((part) => clean(part, 80))
    .filter(Boolean)
    .join(" ")
    .slice(0, 180);
}

export function threadKey(value) {
  const raw = String(value || "").toLowerCase().replace(/["”″]/g, "").replace(/\s+/g, "").replace(",", ".");
  const dotted = raw.match(/^(\d+)\.(\d+\/\d+)$/);
  if (dotted) return `${Number(dotted[1])}.${dotted[2]}`;
  if (/^\d\/\d+$/.test(raw)) return raw;
  const glued = raw.match(/^(\d)(\d\/\d+)$/);
  if (glued) return `${glued[1]}.${glued[2]}`;
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw;
}

export function productBitola(value) {
  const text = normalizeLabel(value).replace(/["”″]/g, " ");
  const match = text.match(/(\d{2,3})\s*X\s*(\d+\s+\d+\/\d+|\d+[.,]\d+\/\d+|\d+\/\d+|\d+)/);
  if (!match) return "";
  return `${Number(match[1])}x${threadKey(match[2])}`;
}

export const KRONA_CURTO_SHA256 = "b51f9c5af0e96dc391fecbc8c1eb6e4b842cf397b6335f1edc111364202547be";

const KRONA_CURTO_ROWS = [
  ["20 x 1/2", 37.8, 20],
  ["25 x 3/4", 40, 25],
  ["32 x 1", 47, 32],
  ["40 x 1.1/4", 53.8, 40],
  ["50 x 1.1/2", 63.2, 50],
  ["60 x 2", 70.4, 60],
  ["75 x 2.1/2", 85, 75],
  ["85 x 3", 95, 85],
  ["110 x 4", 116, 110],
];

export function barcodeListFromProduct(product = {}) {
  const found = [];
  for (const value of [...(product.eans || []), product.ean]) {
    for (const code of String(value || "").split(/[^0-9]+/)) {
      if (code.length >= 8 && code.length <= 14 && !found.includes(code)) found.push(code);
    }
  }
  return found;
}

function tradeBrand(brand, name) {
  const raw = normalizeLabel(brand).split(/[^A-Z0-9]+/).filter(Boolean);
  if (raw.some((word) => LEGAL_SUFFIX.has(word))) return "";
  const tokens = brandTokens(brand);
  if (tokens.length !== 1) return "";
  return normalizeLabel(name).includes(tokens[0]) ? "" : tokens[0];
}

export function searchQueries(product = {}) {
  const queries = [];
  const ean = barcodeListFromProduct(product)[0];
  const name = expandCatalogName(product.name || product.productName).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const listing = [tradeBrand(product.brand, name), name].filter(Boolean).join(" ");
  if (ean) {
    const kind = /\badaptador\b/i.test(name) ? "adaptador" : "";
    queries.push([ean, kind, "peso", "dimensões"].filter(Boolean).join(" "));
  }
  const named = [listing, "peso dimensões"].filter(Boolean).join(" ").slice(0, 180);
  if (named) queries.push(named);
  return [...new Set(queries)].slice(0, 2);
}

const BARCODE_PAGES = [
  { code: "7897801300520", title: "Tidao Krona 20x1/2", url: "https://www.tidao.com.br/produto/4152/adaptador-soldcurto-20-x-12-krona-330-b" },
  { code: "7897801300520", title: "Lopes Krona 20x1/2", url: "https://www.distribuidoralopes.com.br/produto/2895/adaptador-soldavel-curto-lr-20mm-x-12-krona" },
];

export function extraLeads(product = {}) {
  const leads = [];
  const label = normalizeLabel(`${product.brand || ""} ${product.name || product.productName || ""}`);
  if (label.includes("KRONA") && label.includes("ADAPTADOR") && label.includes("SOLDA") && !label.includes("FLANGE")) {
    leads.push({
      title: "Adaptador Curto Soldável Krona",
      url: "https://www.krona.com.br/produtos/adaptador-curto-soldavel/",
    });
  }
  const codes = new Set(barcodeListFromProduct(product));
  for (const page of BARCODE_PAGES) {
    if (codes.has(page.code)) leads.push({ title: page.title, url: page.url });
  }
  return leads;
}

export function expandCatalogName(value) {
  return clean(value, 180)
    .replace(/\bFURAD\b/gi, "furadeira")
    .replace(/\bPARAF\b/gi, "parafusadeira")
    .replace(/\bIMPACT\b/gi, "impacto")
    .replace(/\bIMP\b/gi, "impacto")
    .replace(/\bESMERILHAD\b/gi, "esmerilhadeira")
    .replace(/\bASPIRADO\b/gi, "aspirador");
}

const MODEL_WORD = new Set([
  ...MODEL_STOP,
  "IMP", "IMPACT", "IMPACTO", "REV", "POL", "FURAD", "FURA", "PARAF",
  "KIT", "BAT", "BIV", "MM", "CM", "UN", "REF", "COD", "SOL", "NR", "WATT", "VOLT",
]);
const PRODUCT_NOUNS = ["FURADEIRA", "PARAFUSADEIRA", "ESMERILHADEIRA", "ADAPTADOR", "BOLSA", "MARTELETE", "SERRA", "LIXADEIRA", "COMPRESSOR", "SOPRADOR"];
const NAME_NOISE = new Set([
  ...MODEL_WORD,
  ...BRAND_NOISE,
  ...PRODUCT_NOUNS,
  "LONA", "ANGULAR", "ACESS", "LITIO", "PROFISSIONAL", "ELETRICA", "SOLDAVEL", "FERRAMENTA",
  "PECAS", "ACESSORIOS", "ACESSORIO", "BATERIA", "BATERIAS",
]);
const MAINS_VOLTAGE = new Set(["110", "127", "220", "230", "240"]);

function rememberCode(found, letters, digits) {
  if (!letters || !digits || MODEL_WORD.has(letters)) return;
  if (letters.length < 2 || letters.length > 5 || digits.length < 2 || digits.length > 5) return;
  if (letters.length < 3 && digits.length < 3) return;
  const code = `${letters}${digits}`;
  if (!found.includes(code)) found.push(code);
}

export function catalogModelCodes(name) {
  const label = normalizeLabel(name);
  const found = [];
  for (const match of label.matchAll(/\b([A-Z]{2,5})(\d{2,5})(?!\d)/g)) rememberCode(found, match[1], match[2]);
  for (const match of label.matchAll(/\b([A-Z]{2,5})[\s-]+(\d{2,5})(?!\d)/g)) rememberCode(found, match[1], match[2]);
  return found;
}

function brandTokens(brand) {
  return normalizeLabel(brand).split(/[^A-Z0-9]+/).filter((word) => word.length >= 3 && word.length <= 12 && !LEGAL_SUFFIX.has(word) && !BRAND_NOISE.has(word));
}

function namedBrand(brand, name) {
  const full = normalizeLabel(brand);
  const label = normalizeLabel(name);
  if (!full || full.length <= 2 || label.includes(full)) return "";
  const tokens = brandTokens(brand);
  const hay = label.replace(/[^A-Z0-9]/g, "");
  if (tokens.some((word) => hay.includes(word))) return "";
  return [...tokens].sort((left, right) => left.length - right.length)[0] || "";
}

export function photoSearchQueries(product = {}) {
  const name = expandCatalogName(product.name || product.productName).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return [];
  const queries = [];
  const named = [namedBrand(product.brand, name), name].filter(Boolean).join(" ");
  queries.push(named.slice(0, 180));
  const ean = barcodeListFromProduct(product)[0];
  if (ean) queries.push(`${ean} ${name}`.slice(0, 180));
  return [...new Set(queries)].slice(0, 2);
}

function hintedEdge(url) {
  const pair = String(url).match(/(\d{2,4})\s*x\s*(\d{2,4})/i);
  const width = String(url).match(/[?&]w=(\d{2,4})/i);
  const height = String(url).match(/[?&]h=(\d{2,4})/i);
  const edges = [];
  if (pair) edges.push(Number(pair[1]), Number(pair[2]));
  if (width) edges.push(Number(width[1]));
  if (height) edges.push(Number(height[1]));
  return edges.length ? Math.max(...edges) : null;
}

export function listingImageUrl(value, pageUrl) {
  const raw = clean(String(value || "").replace(/&amp;/g, "&"), 800);
  if (!raw) return null;
  let href = raw;
  try { href = new URL(raw, pageUrl || undefined).href; }
  catch { return null; }
  const url = publicHttpUrl(href);
  if (!url || /\.svg(?:$|\?)/i.test(url) || /bing\.com|bing\.net|duckduckgo\.com/i.test(url)) return null;
  if (/logo|icon|sprite|favicon|pixel|placeholder|banner/i.test(url)) return null;
  const edge = hintedEdge(url);
  if (edge != null && edge < 280) return null;
  return url;
}

export function extractListingImage(html, pageUrl) {
  for (const tag of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const raw = tag[0];
    if (!/\b(?:property|name)\s*=\s*["'](?:og:image|twitter:image)(?::secure_url)?["']/i.test(raw)) continue;
    const content = raw.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
    if (!content) continue;
    const url = listingImageUrl(content[1], pageUrl);
    if (url) return url;
  }
  return null;
}

function compactPage(value) {
  return clean(value, 14000).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function measureIdentity(value) {
  const text = clean(value, 14000).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\//g, "");
  const joined = text.replace(/(\d)\s+(?=[A-Z])/g, "$1").replace(/([A-Z])\s+(?=\d)/g, "$1");
  return joined.replace(/[^A-Z0-9]+/g, "X");
}

function identityHasMeasure(identity, token) {
  const compact = String(token).replace(/\//g, "");
  const whole = new RegExp(`(?:^|[^0-9])${compact}(?:[^0-9]|$)`);
  if (compact && whole.test(identity)) return true;
  if (!token.endsWith("0") || token.length < 3) return false;
  return new RegExp(`(?:^|[^0-9])${token.slice(0, -1)}CM`).test(identity);
}

function brandShown(brand, identity) {
  const compact = normalizeLabel(brand).replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 2) return true;
  if (identity.includes(compact) || brandMatches(brand, identity)) return true;
  return brandTokens(brand).some((word) => identity.includes(word));
}

function tradeTokens(product) {
  const name = expandCatalogName(product.name || product.productName);
  const fromName = normalizeLabel(name).split(/[^A-Z0-9]+/).filter((word) => word.length >= 3 && word.length <= 12 && !NAME_NOISE.has(word) && !LEGAL_SUFFIX.has(word) && !/^\d/.test(word));
  const fromBrand = brandTokens(product.brand).filter((word) => !fromName.length || fromName.some((token) => token.includes(word) || word.includes(token)) || word.length <= 5);
  return [...new Set([...fromName, ...fromBrand])];
}

function sharesTradeName(product, identity) {
  const tokens = tradeTokens(product);
  if (!tokens.length) return brandShown(product.brand, identity);
  return tokens.some((word) => identity.includes(word));
}

function sharesNoun(name, identity) {
  const label = normalizeLabel(expandCatalogName(name));
  const nouns = PRODUCT_NOUNS.filter((noun) => label.includes(noun));
  if (nouns.length) {
    return nouns.some((noun) => identity.includes(noun) || (noun.length > 5 && identity.includes(noun.slice(0, 5))));
  }
  return label.split(/[^A-Z0-9]+/).some((word) => word.length >= 5 && !/^\d+$/.test(word) && identity.includes(word));
}

function statedMains(value) {
  return [...normalizeLabel(value).matchAll(/\b(110|127|220|230|240)\s*V\b/g)].map((match) => match[1]);
}

function voltageConflict(name, visible) {
  const wanted = statedMains(name);
  const seen = statedMains(visible);
  if (!wanted.length || !seen.length) return false;
  return seen.every((volt) => !wanted.includes(volt));
}

function conflictingModel(codes, hay) {
  return codes.some((code) => {
    const letters = code.match(/^[A-Z]+/)?.[0] || "";
    const digits = code.slice(letters.length);
    const found = [...hay.matchAll(new RegExp(`${letters}(\\d{2,5})`, "g"))].map((match) => match[1]);
    if (!found.length) return false;
    return found.every((item) => item !== digits && !item.startsWith(digits) && !digits.startsWith(item));
  });
}

function photoIdentityNumbers(name) {
  const label = normalizeLabel(name);
  const watts = new Set([...label.matchAll(/\b(\d{2,4})\s*W\b/g)].map((match) => match[1]));
  const volts = new Set([...label.matchAll(/\b(\d{2,3})\s*V\b/g)].map((match) => match[1]));
  const codes = catalogModelCodes(name);
  const hasAnchor = watts.size > 0 || codes.length > 0;
  const required = [];
  const add = (token) => {
    const compact = String(token).replace(/\//g, "");
    if (compact && !required.includes(compact)) required.push(compact);
  };
  for (const token of sizeTokens(name)) {
    if (token.includes("/")) {
      if (!hasAnchor) add(token);
      continue;
    }
    if (volts.has(token)) {
      if (!(MAINS_VOLTAGE.has(token) && hasAnchor)) add(token);
      continue;
    }
    if (token.length >= 3 || watts.has(token)) add(token);
  }
  for (const match of label.matchAll(/\b(\d{2,3})\s*(?:PECAS|ACESSORIOS|ACES)\b/g)) add(match[1]);
  for (const code of codes) add(code.match(/\d+$/)?.[0] || "");
  for (const match of label.matchAll(/\b(\d+[.,]\d+)\b/g)) add(match[1].replace(/\D/g, ""));
  return required;
}

export function pageShowsCatalogItem(product, title, text) {
  const name = product.name || product.productName || "";
  if (!name || isBulkListing(title, name)) return false;
  const hay = compactPage(`${title} ${text}`);
  if (!hay) return false;
  const ean = barcodeListFromProduct(product)[0];
  if (ean && hay.includes(ean)) return true;
  const body = compactPage(text);
  const identity = body.length > 500 ? compactPage(title) : hay;
  const measures = body.length > 500 ? measureIdentity(title) : measureIdentity(`${title} ${text}`);
  const visible = body.length > 500 ? title : `${title} ${text}`;
  if (voltageConflict(name, visible)) return false;
  const codes = catalogModelCodes(name);
  const codeHit = codes.some((code) => hay.includes(code));
  if (codeHit && sharesNoun(name, identity) && !conflictingModel(codes, hay) && sharesTradeName(product, identity)) return true;
  if (conflictingModel(codes, identity)) return false;
  const required = photoIdentityNumbers(name);
  if (!required.length || !required.every((token) => identityHasMeasure(measures, token))) return false;
  if (!sharesTradeName(product, identity)) return false;
  return sharesNoun(name, identity);
}

function imageBytes(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length < 8000 || bytes.length > 5000000) return null;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return png || jpg || webp ? bytes : null;
}

async function downloadListingImage(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { ...HEADERS, Accept: "image/jpeg,image/png" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (typeof response === "string" || Buffer.isBuffer(response) || !response?.ok) return null;
  if (response.url && !publicHttpUrl(response.url)) return null;
  const type = String(response.headers?.get?.("content-type") || "");
  if (type && !/^image\//i.test(type.split(";")[0].trim()) && !/octet-stream/i.test(type)) return null;
  return imageBytes(Buffer.from(await response.arrayBuffer()));
}

export function parseImageResults(html) {
  const results = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(/\bm="(\{[\s\S]*?\})"/g)) {
    let data;
    try {
      data = JSON.parse(match[1]
        .replace(/&quot;/g, "\"")
        .replace(/&amp;/g, "&")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))));
    } catch { continue; }
    const url = listingImageUrl(data?.murl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: clean(data?.t, 180), url });
  }
  return results.slice(0, 8);
}

export async function fetchCatalogPhoto(product = {}, { fetchImpl = fetch } = {}) {
  const queries = photoSearchQueries(product);
  if (!queries.length) return null;
  for (const query of queries) {
    let images = [];
    try {
      images = parseImageResults(await readPage(fetchImpl, `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`));
    } catch { images = []; }
    let best = null;
    let tries = 0;
    for (const image of images) {
      if (!pageShowsCatalogItem(product, image.title, image.url)) continue;
      tries += 1;
      if (tries > 6) break;
      try {
        const bytes = await downloadListingImage(fetchImpl, image.url);
        if (bytes && (!best || bytes.length > best.length)) best = bytes;
        if (best && best.length >= 100000) break;
      } catch { /* a próxima foto do anúncio segue */ }
    }
    if (best) return best;
  }
  const links = [];
  const seen = new Set();
  const addLink = (link) => {
    const url = publicHttpUrl(link?.url);
    if (!url || seen.has(url) || /\.pdf(?:$|\?)/i.test(url)) return;
    seen.add(url);
    links.push({ title: link.title || "", url });
  };
  for (const query of queries) {
    try {
      parseSearchResults(await readPage(fetchImpl, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)).forEach(addLink);
    } catch { /* a outra busca segue */ }
    try {
      parseBingResults(await readPage(fetchImpl, `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`)).forEach(addLink);
    } catch { /* a outra busca segue */ }
  }
  const ranked = links
    .map((link) => ({ ...link, score: pageShowsCatalogItem(product, link.title, link.url) ? 2 : 0 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
  for (const link of ranked) {
    let html = "";
    try { html = await readPage(fetchImpl, link.url); }
    catch { continue; }
    if (!pageShowsCatalogItem(product, `${link.title} ${link.url}`, htmlToText(html))) continue;
    const image = extractListingImage(html, link.url);
    if (!image) continue;
    try {
      const bytes = await downloadListingImage(fetchImpl, image);
      if (bytes) return bytes;
    } catch { /* a próxima página pode ter a foto */ }
  }
  return null;
}

function bingTarget(href) {
  const code = String(href || "").replace(/&amp;/g, "&").match(/[?&]u=a1([A-Za-z0-9+/=_-]+)/);
  if (!code) return null;
  try { return publicHttpUrl(Buffer.from(code[1], "base64").toString("utf8")); }
  catch { return null; }
}

export function parseBingResults(html) {
  const source = String(html || "");
  const seen = new Set();
  const results = [];
  const push = (url, title) => {
    if (!url || seen.has(url) || /bing\.com|microsoft\.com|duckduckgo\.com/i.test(url)) return;
    seen.add(url);
    results.push({ title: clean(title, 180), url });
  };
  for (const match of source.matchAll(/<a\b[^>]*href="([^"]*u=a1[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    push(bingTarget(match[1]), match[2]);
  }
  if (!results.length) {
    for (const match of source.replace(/&amp;/g, "&").matchAll(/[?&]u=a1([A-Za-z0-9+/=_-]+)/g)) {
      let decoded = "";
      try { decoded = Buffer.from(match[1], "base64").toString("utf8"); }
      catch { continue; }
      push(publicHttpUrl(decoded), "");
    }
  }
  return results.slice(0, 8);
}

export function fichaPdfUrls(html, pageUrl) {
  const found = [];
  for (const match of String(html || "").matchAll(/href="([^"]+\.pdf[^"]*)"/gi)) {
    let href = match[1].replace(/&amp;/g, "&");
    try { href = new URL(href, pageUrl || undefined).href; }
    catch { continue; }
    const url = publicHttpUrl(href);
    if (!url || !/ficha|tecnica|t%C3%A9cnica|pe\d{4,}/i.test(url)) continue;
    if (!found.includes(url)) found.push(url);
  }
  return found.slice(0, 2);
}

export function extractEmbeddedWeight(product, html, pageUrl = "") {
  const source = String(html || "");
  const strong = sizeTokens(product.name || product.productName).filter((token) => /^\d{2,}$/.test(token));
  for (const code of barcodeListFromProduct(product)) {
    const at = source.indexOf(code);
    if (at < 0) continue;
    const window = source.slice(Math.max(0, at - 1500), at + 400);
    const pesoAt = window.search(/"pesoBruto"|"pesoLiquido"/i);
    const around = pesoAt >= 0 ? window.slice(Math.max(0, pesoAt - 250), pesoAt + 80) : window;
    if (/"unidade"\s*:\s*"(?!UN")[^"]+"/i.test(around)) continue;
    const match = window.match(/"pesoBruto"\s*:\s*"?(\d+\.\d+)"?/i)
      || window.match(/"pesoLiquido"\s*:\s*"?(\d+\.\d+)"?/i);
    if (!match) continue;
    const grams = toGrams(match[1], "kg");
    if (!grams) continue;
    if (strong.length && !strong.some((token) => window.includes(token))) continue;
    return {
      title: `Peso do código ${code}`,
      url: pageUrl,
      weightGrams: grams,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      score: 18,
      eanMatch: true,
      excerpt: `pesoBruto ${match[1]} kg`,
    };
  }
  return null;
}

function normalizeText(value) {
  return clean(value, 20000).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

export function specsFromOfficialSheet(product, { text = "", sha256 = "", url = "" } = {}) {
  const label = normalizeLabel(`${product.brand || ""} ${product.name || product.productName || ""}`);
  if (!label.includes("KRONA") || !label.includes("ADAPTADOR") || label.includes("FLANGE")) return null;
  const body = normalizeText(text);
  if (!body.includes("PE000991") || !body.includes("ADAPTADOR SOLDAVEL CURTO")) return null;
  if (sha256 !== KRONA_CURTO_SHA256) return null;
  const key = productBitola(product.name || product.productName);
  const row = KRONA_CURTO_ROWS.find((item) => productBitola(item[0]) === key);
  if (!row) return null;
  const lengthCm = round(row[1] / 10, 2);
  const diameterCm = round(row[2] / 10, 2);
  return {
    title: "Ficha técnica PE000991 Adaptador Soldável Curto",
    url: url || "https://www.krona.com.br/wp-content/uploads/2016/03/PE000991-Ficha-Tecnica-Adaptador-Soldavel-Curto.pdf",
    weightGrams: null,
    lengthCm,
    widthCm: diameterCm,
    heightCm: diameterCm,
    score: 24,
    ficha: true,
    excerpt: `Cota C ${row[1]} mm, D1 ${row[2]} mm`,
  };
}

function mergeSpecFields(candidates) {
  const ranked = [...candidates].sort((left, right) => (right.score || 0) - (left.score || 0));
  const pick = (field, prefer) => ranked.find((item) => prefer(item) && item[field] > 0)?.[field]
    ?? ranked.find((item) => item[field] > 0)?.[field]
    ?? null;
  const weightGrams = pick("weightGrams", (item) => item.eanMatch);
  const lengthCm = pick("lengthCm", (item) => item.ficha);
  const widthCm = pick("widthCm", (item) => item.ficha);
  const heightCm = pick("heightCm", (item) => item.ficha);
  const weight = ranked.find((item) => item.eanMatch && item.weightGrams > 0);
  const ficha = ranked.find((item) => item.ficha && item.lengthCm > 0);
  const format = (value) => String(value).replace(".", ",");
  const parts = [];
  if (weightGrams && weight) parts.push(`Peso de ${format(weightGrams)} g na página do código de barras.`);
  if (lengthCm && ficha) parts.push(`Comprimento de ${format(lengthCm)} cm na ficha PE000991 (cota C).`);
  return {
    weightGrams,
    lengthCm,
    widthCm,
    heightCm,
    source: ficha?.url || weight?.url || ranked.find((item) => item.url)?.url || null,
    detail: parts.join(" "),
  };
}

function categoryWords(value) {
  return normalizeLabel(expandCatalogName(value)).split(/[^A-Z0-9]+/).filter((word) => word.length >= 6);
}

export function categoryScore(category = {}, evidence = "") {
  const evidenceWords = categoryWords(evidence);
  let score = 0;
  for (const word of categoryWords(category.tipoWeb)) {
    for (const other of evidenceWords) {
      if (word === other) score = Math.max(score, word.length + 5);
      else if (word.startsWith(other) || other.startsWith(word)) score = Math.max(score, Math.min(word.length, other.length));
    }
  }
  if (categoryWords(category.grupoWeb).some((word) => evidenceWords.some((other) => word === other || word.startsWith(other) || other.startsWith(word)))) {
    score += 1;
  }
  return score;
}

export function proposeWebCategory(product = {}) {
  const label = normalizeLabel(expandCatalogName(`${product.name || product.productName || ""} ${product.brand || ""}`));
  const kinds = [
    ["PARAFUSADEIRA", "FERRAMENTAS", "PARAFUSADEIRAS"],
    ["FURADEIRA", "FERRAMENTAS", "FURADEIRAS"],
    ["ESMERILHADEIRA", "FERRAMENTAS", "ESMERILHADEIRAS"],
    ["LIXADEIRA", "FERRAMENTAS", "LIXADEIRAS"],
    ["PLAINA", "FERRAMENTAS", "PLAINAS"],
    ["SERRA", "FERRAMENTAS", "SERRAS"],
    ["LAVADORA", "FERRAMENTAS", "LAVADORAS"],
    ["ASPIRADOR", "FERRAMENTAS", "ASPIRADORES"],
    ["MARTELETE", "FERRAMENTAS", "MARTELETES"],
    ["BOLSA", "FERRAMENTAS", "BOLSAS"],
  ];
  const found = kinds.find(([word]) => label.includes(word));
  return found ? { grupoWeb: found[1], tipoWeb: found[2] } : null;
}

function categoryAlreadySet(product = {}) {
  return (product.grupoWebId > 0 && product.tipoWebId > 0)
    || (product.categoryFromProduct && product.grupoWeb && product.tipoWeb);
}

function pickCatalogCategory(catalog, choice, evidence) {
  const chosen = matchWebCategory(catalog, choice?.grupo_web, choice?.subgrupo_web);
  const ranked = [...catalog]
    .map((item) => ({ item, score: categoryScore(item, evidence) }))
    .filter((entry) => entry.score >= 6)
    .sort((left, right) => right.score - left.score);
  if (chosen && categoryScore(chosen, evidence) >= 6) return chosen;
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score)) return ranked[0].item;
  return null;
}

export function matchWebCategory(catalog = [], grupo, subgrupo) {
  const wantedGrupo = normalizeLabel(grupo);
  const wantedTipo = normalizeLabel(subgrupo);
  if (!wantedGrupo || !wantedTipo) return null;
  return catalog.find((item) => normalizeLabel(item.grupoWeb) === wantedGrupo && normalizeLabel(item.tipoWeb) === wantedTipo) || null;
}

export function matchmodulo_removidoCategory(categories = [], grupo, subgrupo) {
  const wantedGrupo = normalizeLabel(grupo);
  const wantedTipo = normalizeLabel(subgrupo);
  const parent = categories.find((item) => normalizeLabel(item.name) === wantedGrupo && !(Number(item.parent_id) > 0)) || null;
  const child = parent
    ? categories.find((item) => normalizeLabel(item.name) === wantedTipo && String(item.parent_id) === String(parent.id)) || null
    : null;
  return { parent, child };
}

export function acceptResearchedSpecs({ choice, candidates, catalog, product }) {
  const selected = candidates.find((item) => item.id === clean(choice?.candidato, 20)) || candidates[0];
  if (!selected) return { ok: false, reason: "A pesquisa não encontrou peso nem medidas deste produto." };
  const specs = {
    weightGrams: selected.weightGrams || null,
    lengthCm: selected.lengthCm || null,
    widthCm: selected.widthCm || null,
    heightCm: selected.heightCm || null,
    source: selected.url,
    grupoWebId: null,
    tipoWebId: null,
    grupoWeb: "",
    tipoWeb: "",
  };
  const currentCategory = categoryAlreadySet(product);
  if (!currentCategory) {
    const evidence = `${product.name || product.productName || ""} ${selected.title || ""}`;
    const category = pickCatalogCategory(catalog, choice, evidence);
    if (category) {
      specs.grupoWebId = category.grupoWebId;
      specs.tipoWebId = category.tipoWebId;
      specs.grupoWeb = category.grupoWeb;
      specs.tipoWeb = category.tipoWeb;
    } else {
      const proposal = proposeWebCategory(product);
      if (proposal) {
        specs.grupoWeb = proposal.grupoWeb;
        specs.tipoWeb = proposal.tipoWeb;
      }
    }
  }
  return { ok: true, specs };
}

async function readPage(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (typeof response === "string") return response;
  if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
  return response.text();
}

async function readBinary(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (typeof response === "string" || Buffer.isBuffer(response)) return Buffer.from(response);
  if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 8000000) throw new Error("PDF grande demais.");
  return buffer;
}

async function defaultParsePdf(buffer) {
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
  const parsed = await pdfParse(buffer);
  return {
    text: parsed?.text || "",
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function researchProductSpecs(product = {}, { fetchImpl = fetch, catalog = [], chat = null, parsePdf = defaultParsePdf } = {}) {
  const queries = searchQueries(product);
  if (!queries.length) return { ok: false, reason: "O produto não tem nome para pesquisar." };
  const name = product.name || product.productName;
  const links = [];
  const seen = new Set();
  const addLink = (link) => {
    const url = publicHttpUrl(link?.url);
    if (!url || seen.has(url) || isBulkListing(`${link?.title || ""} ${url}`, name)) return;
    if (/google\.|microsoft\.|bing\.|duckduckgo\.|erome\.|zhihu\.|facebook\.|instagram\./i.test(url)) return;
    seen.add(url);
    links.push({ title: link.title || "", url });
  };
  extraLeads(product).forEach(addLink);
  let searchFailed = 0;
  for (const query of queries) {
    try {
      parseSearchResults(await readPage(fetchImpl, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`)).forEach(addLink);
    } catch { searchFailed += 1; }
    try {
      parseBingResults(await readPage(fetchImpl, `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`)).forEach(addLink);
    } catch { searchFailed += 1; }
  }
  links.sort((left, right) => Number(specPageMatches(product, right.title || "", "")) - Number(specPageMatches(product, left.title || "", "")));
  const pages = [];
  for (const link of links) {
    if (pages.some((item) => item.url === link.url)) continue;
    pages.push(link);
    if (pages.length >= 8) break;
  }
  const candidates = [];
  const pdfs = [];
  const pushCandidate = (candidate) => {
    if (!candidate) return;
    candidates.push({ ...candidate, id: `c${candidates.length + 1}` });
  };
  for (const link of pages) {
    pushCandidate(extractCandidate(product, { title: link.title, url: link.url, text: "" }));
    let html = "";
    try { html = await readPage(fetchImpl, link.url); }
    catch { continue; }
    for (const pdf of fichaPdfUrls(html, link.url)) {
      if (!pdfs.includes(pdf)) pdfs.push(pdf);
    }
    pushCandidate(extractCandidate(product, { ...link, text: htmlToText(html) }));
    pushCandidate(extractEmbeddedWeight(product, html, link.url));
  }
  for (const pdfUrl of pdfs.slice(0, 2)) {
    try {
      const buffer = await readBinary(fetchImpl, pdfUrl);
      if (buffer.slice(0, 4).toString() !== "%PDF") continue;
      const parsed = await parsePdf(buffer);
      pushCandidate(specsFromOfficialSheet(product, { ...parsed, url: pdfUrl }));
    } catch { /* a próxima ficha pode ter a tabela */ }
  }
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates.length) {
    const reason = searchFailed && !links.length
      ? "A pesquisa na internet falhou. Sem resposta."
      : "A pesquisa não encontrou peso nem medidas compatíveis com este produto.";
    const proposal = categoryAlreadySet(product) ? null : proposeWebCategory(product);
    if (!proposal) return { ok: false, reason };
    return {
      ok: true,
      specs: {
        weightGrams: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        source: null,
        grupoWebId: null,
        tipoWebId: null,
        grupoWeb: proposal.grupoWeb,
        tipoWeb: proposal.tipoWeb,
        detail: reason,
      },
    };
  }
  let choice = { candidato: candidates[0].id, grupo_web: "", subgrupo_web: "" };
  if (typeof chat === "function") {
    try {
      const content = await chat({
        maxTokens: 180,
        temperature: 0,
        timeoutMs: 120000,
        format: {
          type: "object",
          properties: {
            candidato: { type: "string" },
            grupo_web: { type: "string" },
            subgrupo_web: { type: "string" },
          },
          required: ["candidato", "grupo_web", "subgrupo_web"],
        },
        messages: [
          {
            role: "system",
            content: "Você escolhe a ficha técnica de um produto e responde só JSON. Use apenas um id da lista de candidatos. Não invente peso nem medida. Grupo e subgrupo só podem ser um par existente na lista de categorias, quando o produto ainda não tiver os dois. Se já tiver, devolva os nomes atuais.",
          },
          {
            role: "user",
            content: JSON.stringify({
              produto: clean(product.name || product.productName, 180),
              marca: clean(product.brand, 80),
              categoriaAtual: product.grupoWeb && product.tipoWeb ? `${product.grupoWeb} > ${product.tipoWeb}` : "",
              categorias: catalog.map((item) => ({ grupo_web: item.grupoWeb, subgrupo_web: item.tipoWeb })),
              candidatos: candidates.map((item) => ({
                id: item.id,
                titulo: item.title,
                peso_g: item.weightGrams,
                comprimento_cm: item.lengthCm,
                largura_cm: item.widthCm,
                altura_cm: item.heightCm,
                trecho: item.excerpt,
              })),
            }),
          },
        ],
      });
      if (content) choice = { ...choice, ...JSON.parse(content) };
    } catch { /* a ficha de maior correspondência segue */ }
  }
  const accepted = acceptResearchedSpecs({ choice, candidates, catalog, product });
  if (!accepted.ok) return accepted;
  const merged = mergeSpecFields(candidates);
  accepted.specs = {
    ...accepted.specs,
    weightGrams: merged.weightGrams,
    lengthCm: merged.lengthCm,
    widthCm: merged.widthCm,
    heightCm: merged.heightCm,
    source: merged.source || accepted.specs.source,
    detail: merged.detail,
  };
  return accepted;
}
