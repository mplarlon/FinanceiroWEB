export const ITEM_FIELDS = [
  { id: "nome", label: "Nome" },
  { id: "preço", label: "Preço" },
  { id: "estoque", label: "Estoque" },
  { id: "categoria", label: "Categoria" },
  { id: "peso", label: "Peso" },
  { id: "comprimento", label: "Comprimento" },
  { id: "largura", label: "Largura" },
  { id: "altura", label: "Altura" },
];

const RESEARCHABLE = new Set(["categoria", "peso", "comprimento", "largura", "altura"]);

export function itemNeedsResearch(item = {}) {
  const gaps = Array.isArray(item.gaps)
    ? item.gaps
    : itemReadiness(item).checks.filter((check) => !check.ok).map((check) => check.id);
  return gaps.some((gap) => RESEARCHABLE.has(gap));
}

function text(value) {
  return String(value || "").trim();
}

function inferGaps(item = {}) {
  const product = item.product || {};
  const missing = [];
  if (!text(product.name || item.productName)) missing.push("nome");
  if (!(Number(product.price) > 0)) missing.push("preço");
  const stock = Number(product.stock);
  if (product.stock == null || !Number.isFinite(stock) || stock < 0) missing.push("estoque");
  const hasCategory = (text(product.grupoWeb) && text(product.tipoWeb))
    || Number(product.categoryId) > 0
    || Number(product.modulo_removidoCategoryId) > 0;
  if (!hasCategory) missing.push("categoria");
  if (!(Number(product.weight) > 0)) missing.push("peso");
  if (!(Number(product.length) > 0)) missing.push("comprimento");
  if (!(Number(product.width) > 0)) missing.push("largura");
  if (!(Number(product.height) > 0)) missing.push("altura");
  return missing;
}

export function itemReadiness(item = {}, researching = false) {
  const gaps = new Set(Array.isArray(item.gaps) ? item.gaps : inferGaps(item));
  const checks = ITEM_FIELDS.map((field) => {
    const missing = gaps.has(field.id);
    return {
      ...field,
      ok: !missing,
      searching: Boolean(researching && missing && RESEARCHABLE.has(field.id)),
    };
  });
  const done = checks.filter((check) => check.ok).length;
  const searching = checks.filter((check) => check.searching).length;
  return {
    checks,
    done,
    searching,
    pending: checks.length - done,
    total: checks.length,
  };
}
