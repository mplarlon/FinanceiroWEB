import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { acompanharLucro } from "./charlie-profit-tracker.js";

async function consultar(query, sql, params = []) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function empresa(ator) {
  if (Number(ator?.company) > 0) return { sql: " AND se.IDEMPRESA=?", params: [Number(ator.company)] };
  return { sql: "", params: [] };
}

function numeroOuNulo(valor, faltas) {
  return Number(faltas) > 0 ? null : valor;
}

async function lerErp(deps, ator) {
  const filtro = empresa(ator);
  const rows = await consultar(deps.query, `SELECT FIRST 200 sp.CDPRODUTO, MAX(COALESCE(p.PRODUTO, sp.DESCRICAO)) NOME,
      SUM(CASE WHEN sp.SUBTOTAL IS NOT NULL THEN sp.SUBTOTAL WHEN sp.TOTAL IS NOT NULL THEN sp.TOTAL WHEN sp.QTDPRODUTO IS NOT NULL AND sp.VLUNIT IS NOT NULL THEN sp.QTDPRODUTO * sp.VLUNIT ELSE 0 END) RECEITA,
      SUM(CASE WHEN sp.SUBTOTAL IS NULL AND sp.TOTAL IS NULL AND (sp.QTDPRODUTO IS NULL OR sp.VLUNIT IS NULL) THEN 1 ELSE 0 END) SEM_RECEITA,
      SUM(CASE WHEN sp.VLCUSTOREAL > 0 AND sp.QTDPRODUTO IS NOT NULL THEN sp.QTDPRODUTO * sp.VLCUSTOREAL ELSE 0 END) CUSTO,
      SUM(CASE WHEN sp.VLCUSTOREAL > 0 AND sp.QTDPRODUTO IS NOT NULL THEN 0 ELSE 1 END) SEM_CUSTO,
      SUM(CASE WHEN sp.VLICMS IS NOT NULL AND sp.VLST IS NOT NULL THEN sp.VLICMS + sp.VLST ELSE 0 END) TRIBUTOS,
      SUM(CASE WHEN sp.VLICMS IS NULL OR sp.VLST IS NULL THEN 1 ELSE 0 END) SEM_TRIBUTO,
      SUM(CASE WHEN sp.VLCOMISSAO IS NOT NULL THEN sp.VLCOMISSAO ELSE 0 END) COMISSAO,
      SUM(CASE WHEN sp.VLCOMISSAO IS NULL THEN 1 ELSE 0 END) SEM_COMISSAO,
      COUNT(*) ITENS
    FROM SAIDAPRODUTO sp
    JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE)
      AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
      AND COALESCE(sp.STATUSSE,0)=0${filtro.sql}
    GROUP BY sp.CDPRODUTO
    ORDER BY 3 DESC`, filtro.params);
  if (rows == null) return null;
  return {
    amostra: rows.length >= 200,
    linhas: rows.map((row) => ({
      produtoId: row.CDPRODUTO,
      nome: row.NOME,
      canal: "ERP",
      receita: numeroOuNulo(row.RECEITA, row.SEM_RECEITA),
      custo: numeroOuNulo(row.CUSTO, row.SEM_CUSTO),
      tributos: numeroOuNulo(row.TRIBUTOS, row.SEM_TRIBUTO),
      comissao: numeroOuNulo(row.COMISSAO, row.SEM_COMISSAO),
      taxa: null,
    })),
  };
}

function linhasTray(store) {
  if (!store) return null;
  const linhas = [];
  for (const pedido of Object.values(store.orders || {})) {
    if (/cancel/i.test(String(pedido.status || ""))) continue;
    const canal = String(pedido.marketplace || "").trim() || "Loja virtual Tray";
    for (const item of pedido.items || []) {
      const total = item.total != null ? item.total : (item.unitPrice != null && item.quantity != null ? Number(item.unitPrice) * Number(item.quantity) : null);
      linhas.push({
        produtoId: item.reference || item.externalId,
        nome: item.name,
        canal,
        receita: total,
        custo: null,
        tributos: null,
        comissao: null,
        taxa: null,
      });
    }
  }
  return linhas;
}

export async function painelLucro(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return acompanharLucro(opcoes.fatos);
  const erp = await lerErp(deps, opcoes.ator || {});
  let store = null;
  try {
    store = deps.store ? deps.store() : readEcommerceStore();
  } catch {
    store = null;
  }
  const tray = linhasTray(store);
  return acompanharLucro({
    linhas: erp == null && tray == null ? null : [...(erp?.linhas || []), ...(tray || [])],
    erp,
    pedidosTray: tray,
    amostra: erp?.amostra === true,
    recorte: "O recorte do ERP é de 90 dias.",
  });
}
