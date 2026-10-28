import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { conferirCatalogo } from "./charlie-google-shopping.js";

async function consultar(query, sql, params) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

async function precosPorReferencia(deps, referencias) {
  if (!deps.query) return null;
  const codigos = [...new Set(referencias.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
  if (!codigos.length) return {};
  const mapa = {};
  for (let inicio = 0; inicio < codigos.length; inicio += 80) {
    const lote = codigos.slice(inicio, inicio + 80);
    const marcas = lote.map(() => "?").join(", ");
    const rows = await consultar(deps.query, `SELECT p.CDPRODUTO, pp.PRECO
      FROM PRODUTO p
      LEFT JOIN PRODUTOPRECO pp ON pp.CDPRODUTO=p.CDPRODUTO
        AND pp.IDPRECO=COALESCE(p.IDPRECO,1)
        AND pp.CDUNIDADE=COALESCE(NULLIF(TRIM(p.CDUNIDVENDA),''), NULLIF(TRIM(p.CDUNIDADE),''), 'UN')
      WHERE UPPER(TRIM(p.CDPRODUTO)) IN (${marcas})`, lote);
    if (rows == null) return null;
    for (const row of rows) mapa[String(row.CDPRODUTO || "").trim().toUpperCase()] = row.PRECO;
  }
  return mapa;
}

export async function painelShopping(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return conferirCatalogo(opcoes.fatos);
  let store = null;
  try {
    store = deps.store ? deps.store() : readEcommerceStore();
  } catch {
    store = null;
  }
  const produtos = store ? Object.values(store.products || {}) : null;
  const precosErp = opcoes.precosErp !== undefined ? opcoes.precosErp : await precosPorReferencia(deps, (produtos || []).map((item) => item.reference));
  return conferirCatalogo({
    produtos,
    precosErp,
    errosTray: store?.sync?.errors || [],
  });
}
