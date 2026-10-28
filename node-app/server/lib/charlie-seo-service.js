import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { sugerirSeo } from "./charlie-seo.js";

async function consultar(query, sql, params) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

async function nomesPorReferencia(deps, referencias) {
  if (!deps.query) return null;
  const codigos = [...new Set(referencias.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
  if (!codigos.length) return {};
  const mapa = {};
  for (let inicio = 0; inicio < codigos.length; inicio += 80) {
    const lote = codigos.slice(inicio, inicio + 80);
    const marcas = lote.map(() => "?").join(", ");
    const rows = await consultar(deps.query, `SELECT p.CDPRODUTO, p.PRODUTO
      FROM PRODUTO p
      WHERE UPPER(TRIM(p.CDPRODUTO)) IN (${marcas})`, lote);
    if (rows == null) return null;
    for (const row of rows) mapa[String(row.CDPRODUTO || "").trim().toUpperCase()] = row.PRODUTO;
  }
  return mapa;
}

export async function painelSeo(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return sugerirSeo(opcoes.fatos);
  let store = null;
  try {
    store = deps.store ? deps.store() : readEcommerceStore();
  } catch {
    store = null;
  }
  const produtos = store ? Object.values(store.products || {}) : null;
  const nomesErp = opcoes.nomesErp !== undefined ? opcoes.nomesErp : await nomesPorReferencia(deps, (produtos || []).map((item) => item.reference));
  return sugerirSeo({ produtos, nomesErp });
}
