import { normalizeCnpj } from "./charlie-leads-cnpj.js";

async function optional(query, sql, params) {
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return null;
  }
}

export async function localizarCliente(query, cnpj) {
  const documento = normalizeCnpj(cnpj);
  if (!query || !documento) return { verificado: false, documento };
  const rows = await optional(query, `
    SELECT FIRST 1 CDCLIENTE, COALESCE(CLIENTE, RAZAO) NOME, CGC, INATIVO, UF, CDVENDEDOR
    FROM CLIENTE
    WHERE REPLACE(REPLACE(REPLACE(COALESCE(CGC, ''), '.', ''), '/', ''), '-', '') = ?
  `, [documento]);
  if (rows == null) return { verificado: false, documento };
  const row = rows[0];
  if (!row) return { verificado: true, documento, existe: false };
  const clienteId = Number(row.CDCLIENTE);
  const vendas = await optional(query, `
    SELECT COUNT(*) QTD, MAX(DTSAIDA) ULTIMA,
      SUM(CASE WHEN COALESCE(VLTOTAL, SUBTOTAL) IS NOT NULL THEN COALESCE(VLTOTAL, SUBTOTAL) ELSE 0 END) TOTAL,
      SUM(CASE WHEN VLTOTAL IS NULL AND SUBTOTAL IS NULL THEN 1 ELSE 0 END) SEM
    FROM SAIDAESTOQUE WHERE CDCLIENTE = ? AND DTCANCELAMENTO IS NULL
  `, [clienteId]);
  const orcamentos = await optional(query, `
    SELECT COUNT(*) QTD FROM ORCAMENTO
    WHERE CDCLIENTE = ? AND STATUS = 0 AND DTCANCELAMENTO IS NULL
  `, [clienteId]);
  const quantidadeVendas = Number(vendas?.[0]?.QTD || 0);
  const ultima = vendas?.[0]?.ULTIMA ? new Date(vendas[0].ULTIMA) : null;
  const dias = ultima ? (Date.now() - ultima.getTime()) / 86400000 : null;
  let situacao = "cadastrado_sem_compra";
  if (quantidadeVendas > 0 && dias != null && dias <= 180) situacao = "cliente_ativo";
  else if (quantidadeVendas > 0) situacao = "cliente_inativo";
  return {
    verificado: true,
    documento,
    existe: true,
    clienteId,
    nome: String(row.NOME || "").trim(),
    inativo: Number(row.INATIVO || 0) === 1,
    uf: String(row.UF || "").trim(),
    vendedorId: row.CDVENDEDOR == null ? null : Number(row.CDVENDEDOR),
    vendas: quantidadeVendas,
    ultimaCompra: ultima ? ultima.toISOString() : null,
    faturamentoRegistrado: vendas == null || Number(vendas[0]?.SEM) > 0 || vendas[0]?.TOTAL == null ? null : Number(vendas[0].TOTAL),
    orcamentosAbertos: orcamentos == null ? null : Number(orcamentos[0]?.QTD || 0),
    situacao,
  };
}

export async function contextoGeografico(query, uf, municipio) {
  if (!query) return { disponivel: false };
  const compradoresUf = uf ? await optional(query, `
    SELECT COUNT(DISTINCT se.CDCLIENTE) QTD
    FROM SAIDAESTOQUE se
    JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
    WHERE se.DTCANCELAMENTO IS NULL AND UPPER(TRIM(c.UF)) = ?
  `, [String(uf).toUpperCase()]) : null;
  const mesmaCidade = uf && municipio ? await optional(query, `
    SELECT COUNT(DISTINCT se.CDCLIENTE) QTD
    FROM SAIDAESTOQUE se
    JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
    LEFT JOIN MUNICIPIO m ON m.CDMUNICIPIO = c.CDMUNICIPIO
    WHERE se.DTCANCELAMENTO IS NULL AND UPPER(TRIM(c.UF)) = ?
      AND UPPER(TRIM(COALESCE(m.MUNICIPIO, ''))) = ?
  `, [String(uf).toUpperCase(), String(municipio).toUpperCase()]) : null;
  const ticket = uf ? await optional(query, `
    SELECT AVG(TOTAL) MEDIA, SUM(OMITIDO) OMITIDOS FROM (
      SELECT
        CASE WHEN SUM(CASE WHEN se.VLTOTAL IS NULL AND se.SUBTOTAL IS NULL THEN 1 ELSE 0 END) = 0 THEN SUM(COALESCE(se.VLTOTAL, se.SUBTOTAL)) ELSE NULL END TOTAL,
        CASE WHEN SUM(CASE WHEN se.VLTOTAL IS NULL AND se.SUBTOTAL IS NULL THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END OMITIDO
      FROM SAIDAESTOQUE se
      JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
      WHERE se.DTCANCELAMENTO IS NULL AND UPPER(TRIM(c.UF)) = ?
      GROUP BY se.CDCLIENTE
    )
  `, [String(uf).toUpperCase()]) : null;
  return {
    disponivel: compradoresUf != null || mesmaCidade != null,
    compradoresUf: compradoresUf == null ? null : Number(compradoresUf[0]?.QTD || 0),
    clientesMesmaCidade: mesmaCidade == null ? null : Number(mesmaCidade[0]?.QTD || 0),
    ticketMedioUf: ticket?.[0]?.MEDIA == null ? null : Number(ticket[0].MEDIA),
    ticketMedioOmitidos: ticket == null ? null : Number(ticket[0]?.OMITIDOS || 0),
  };
}

export async function listarVendedores(query) {
  if (!query) return [];
  const rows = await optional(query, `
    SELECT FIRST 300 CDVENDEDOR, VENDEDOR FROM VENDEDOR ORDER BY VENDEDOR
  `, []);
  return (rows || []).map((row) => ({ id: Number(row.CDVENDEDOR), nome: String(row.VENDEDOR || "").trim() }));
}

export async function sugerirProdutosErp(query, termos = []) {
  if (!query) return { disponivel: false, produtos: [] };
  const produtos = [];
  for (const termo of termos.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)) {
    const rows = await optional(query, `
      SELECT FIRST 8 CDPRODUTO, PRODUTO FROM PRODUTO
      WHERE (INATIVO = 0 OR INATIVO IS NULL) AND PRODUTO CONTAINING ?
    `, [termo.slice(0, 40)]);
    if (rows == null) return { disponivel: false, produtos };
    for (const row of rows) {
      const codigo = String(row.CDPRODUTO || "").trim();
      if (!codigo || produtos.some((item) => item.codigo === codigo)) continue;
      produtos.push({ codigo, nome: String(row.PRODUTO || "").trim(), origem: "PRODUTO", termo });
    }
  }
  return { disponivel: true, produtos };
}

export async function localizarOrcamento(query, numero) {
  if (!query || !numero) return null;
  const rows = await optional(query, `
    SELECT FIRST 1 NRORCAMENTO, IDEMPRESA, CDCLIENTE, VLTOTAL
    FROM ORCAMENTO WHERE NRORCAMENTO = ? AND DTCANCELAMENTO IS NULL
  `, [Number(numero)]);
  if (!rows?.[0]) return null;
  return {
    numero: rows[0].NRORCAMENTO,
    empresa: rows[0].IDEMPRESA == null ? null : Number(rows[0].IDEMPRESA),
    clienteId: rows[0].CDCLIENTE == null ? null : Number(rows[0].CDCLIENTE),
    valor: rows[0].VLTOTAL == null ? null : Number(rows[0].VLTOTAL),
  };
}

export async function localizarPedido(query, numero) {
  if (!query || !numero) return null;
  const rows = await optional(query, `
    SELECT NRPEDIDO, IDEMPRESA, MIN(CDCLIENTE) CDCLIENTE,
      SUM(CASE WHEN COALESCE(VLTOTAL, SUBTOTAL) IS NOT NULL THEN COALESCE(VLTOTAL, SUBTOTAL) ELSE 0 END) TOTAL,
      SUM(CASE WHEN VLTOTAL IS NULL AND SUBTOTAL IS NULL THEN 1 ELSE 0 END) SEM
    FROM SAIDAESTOQUE
    WHERE NRPEDIDO = ? AND DTCANCELAMENTO IS NULL
    GROUP BY NRPEDIDO, IDEMPRESA
  `, [Number(numero)]);
  if (!rows?.[0]) return null;
  return {
    numero: rows[0].NRPEDIDO,
    empresa: rows[0].IDEMPRESA == null ? null : Number(rows[0].IDEMPRESA),
    clienteId: rows[0].CDCLIENTE == null ? null : Number(rows[0].CDCLIENTE),
    valor: Number(rows[0].SEM) > 0 || rows[0].TOTAL == null ? null : Number(rows[0].TOTAL),
  };
}

export async function ufsMelhoresClientes(query) {
  if (!query) return [];
  const rows = await optional(query, `
    SELECT FIRST 5 UPPER(TRIM(c.UF)) UF,
      SUM(CASE WHEN COALESCE(se.VLTOTAL, se.SUBTOTAL) IS NOT NULL THEN COALESCE(se.VLTOTAL, se.SUBTOTAL) ELSE 0 END) TOTAL
    FROM SAIDAESTOQUE se
    JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
    WHERE se.DTCANCELAMENTO IS NULL AND se.DTSAIDA >= DATEADD(-365 DAY TO CURRENT_DATE)
      AND c.UF IS NOT NULL AND TRIM(c.UF) <> ''
    GROUP BY UPPER(TRIM(c.UF))
    HAVING SUM(CASE WHEN se.VLTOTAL IS NULL AND se.SUBTOTAL IS NULL THEN 1 ELSE 0 END) = 0
    ORDER BY 2 DESC
  `, []);
  return (rows || []).map((row) => ({ uf: String(row.UF || "").toLowerCase(), total: row.TOTAL == null ? null : Number(row.TOTAL) })).filter((item) => item.uf && item.total != null);
}
