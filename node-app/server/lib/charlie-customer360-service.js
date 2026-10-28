import { loadState } from "./charlie-leads-store.js";
import { montarFichas } from "./charlie-customer360.js";

async function consultar(query, sql, params = []) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function empresa(ator, alias) {
  if (Number(ator?.company) > 0) return { sql: ` AND ${alias}.IDEMPRESA=?`, params: [Number(ator.company)] };
  return { sql: "", params: [] };
}

function numeroOuNulo(valor, faltas) {
  return Number(faltas) > 0 ? null : valor;
}

function dataIso(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${valor.getFullYear()}-${mes}-${dia}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor || ""));
  return match ? match[1] : null;
}

async function lerVendas(deps, ator) {
  const filtro = empresa(ator, "se");
  const rows = await consultar(deps.query, `SELECT x.CDCLIENTE,
      COALESCE(c.CLIENTE, c.RAZAO, x.NOME_PEDIDO) NOME,
      v.VENDEDOR, x.ULTIMA, x.PEDIDOS, x.RECEITA, x.SEM_RECEITA
    FROM (
      SELECT FIRST 200 se.CDCLIENTE,
        MAX(se.CLIENTE) NOME_PEDIDO,
        MAX(se.IDEMPRESA) IDEMPRESA,
        MAX(se.CDVENDEDOR) CDVENDEDOR,
        MAX(se.DTSAIDA) ULTIMA,
        COUNT(*) PEDIDOS,
        SUM(CASE WHEN se.VLTOTAL IS NOT NULL THEN se.VLTOTAL WHEN se.SUBTOTAL IS NOT NULL THEN se.SUBTOTAL ELSE 0 END) RECEITA,
        SUM(CASE WHEN se.VLTOTAL IS NULL AND se.SUBTOTAL IS NULL THEN 1 ELSE 0 END) SEM_RECEITA
      FROM SAIDAESTOQUE se
      WHERE se.DTSAIDA>=DATEADD(-365 DAY TO CURRENT_DATE)
        AND se.DTCANCELAMENTO IS NULL
        AND COALESCE(se.STATUS,0) IN (1,3)
        AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
        AND se.CDCLIENTE IS NOT NULL${filtro.sql}
      GROUP BY se.CDCLIENTE
      ORDER BY MAX(se.DTSAIDA) DESC
    ) x
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=x.CDCLIENTE AND c.IDEMPRESA=x.IDEMPRESA
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=COALESCE(c.CDVENDEDOR, x.CDVENDEDOR)`, filtro.params);
  if (rows == null) return null;
  return {
    amostra: rows.length >= 200,
    vendas: rows.map((row) => ({
      clienteId: row.CDCLIENTE,
      nome: row.NOME,
      vendedor: row.VENDEDOR,
      ultimaCompra: dataIso(row.ULTIMA),
      pedidos: row.PEDIDOS,
      receita: numeroOuNulo(row.RECEITA, row.SEM_RECEITA),
    })),
  };
}

async function lerOrcamentos(deps, ator) {
  const filtro = empresa(ator, "o");
  const rows = await consultar(deps.query, `SELECT x.CDCLIENTE,
      COALESCE(c.CLIENTE, c.RAZAO, x.NOME_ORC) NOME,
      x.ABERTOS, x.ULTIMO, x.VALOR, x.SEM_VALOR
    FROM (
      SELECT o.CDCLIENTE,
        MAX(o.CLIENTE) NOME_ORC,
        MAX(o.IDEMPRESA) IDEMPRESA,
        COUNT(*) ABERTOS,
        MAX(o.DTORC) ULTIMO,
        SUM(CASE WHEN o.VLTOTAL IS NOT NULL THEN o.VLTOTAL ELSE 0 END) VALOR,
        SUM(CASE WHEN o.VLTOTAL IS NULL THEN 1 ELSE 0 END) SEM_VALOR
      FROM ORCAMENTO o
      WHERE o.STATUS=0 AND o.DTCANCELAMENTO IS NULL AND o.CDCLIENTE IS NOT NULL${filtro.sql}
      GROUP BY o.CDCLIENTE
    ) x
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=x.CDCLIENTE AND c.IDEMPRESA=x.IDEMPRESA`, filtro.params);
  if (rows == null) return null;
  return rows.map((row) => ({
    clienteId: row.CDCLIENTE,
    nome: row.NOME,
    abertos: row.ABERTOS,
    ultimo: dataIso(row.ULTIMO),
    valor: numeroOuNulo(row.VALOR, row.SEM_VALOR),
  }));
}

function lerLeads(opcoes) {
  if (opcoes.leads !== undefined) return opcoes.leads;
  try {
    return (loadState().leads || []).map((lead) => ({
      clienteId: lead.clienteId,
      nome: lead.nomeFantasia || lead.razaoSocial || null,
      status: lead.status,
    }));
  } catch {
    return null;
  }
}

export async function painelCliente(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return montarFichas(opcoes.fatos);
  const vendas = await lerVendas(deps, opcoes.ator || {});
  const orcamentos = await lerOrcamentos(deps, opcoes.ator || {});
  return montarFichas({
    vendas: vendas?.vendas ?? null,
    orcamentos,
    leads: lerLeads(opcoes),
    amostra: vendas?.amostra === true,
  });
}
