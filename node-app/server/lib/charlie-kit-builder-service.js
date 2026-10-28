import { sugerirKits } from "./charlie-kit-builder.js";

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

async function lerPares(deps, ator) {
  const filtro = empresa(ator);
  const rows = await consultar(deps.query, `SELECT FIRST 200 a.CDPRODUTO A, b.CDPRODUTO B, COUNT(*) PEDIDOS
    FROM SAIDAPRODUTO a
    JOIN SAIDAPRODUTO b ON b.NRPEDIDO=a.NRPEDIDO AND b.IDEMPRESA=a.IDEMPRESA AND b.CDPRODUTO>a.CDPRODUTO
    JOIN SAIDAESTOQUE se ON se.NRPEDIDO=a.NRPEDIDO AND se.IDEMPRESA=a.IDEMPRESA
    WHERE se.DTSAIDA>=DATEADD(-365 DAY TO CURRENT_DATE)
      AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
      AND COALESCE(a.STATUSSE,0)=0
      AND COALESCE(b.STATUSSE,0)=0${filtro.sql}
    GROUP BY a.CDPRODUTO, b.CDPRODUTO
    HAVING COUNT(*)>=2
    ORDER BY COUNT(*) DESC`, filtro.params);
  if (rows == null) return null;
  return { pares: rows.map((row) => ({ a: row.A, b: row.B, pedidos: Number(row.PEDIDOS) })), amostra: rows.length >= 200 };
}

async function lerCadastro(deps, codigos) {
  if (!codigos.length) return {};
  const mapa = {};
  let custosDisponiveis = true;
  for (let inicio = 0; inicio < codigos.length; inicio += 80) {
    const lote = codigos.slice(inicio, inicio + 80);
    const marcas = lote.map(() => "?").join(", ");
    const rows = await consultar(deps.query, `SELECT p.CDPRODUTO, p.PRODUTO,
      (SELECT FIRST 1 pp.PRECO FROM PRODUTOPRECO pp
        WHERE pp.CDPRODUTO=p.CDPRODUTO
          AND pp.IDPRECO=COALESCE(p.IDPRECO,1)
          AND pp.CDUNIDADE=COALESCE(NULLIF(TRIM(p.CDUNIDVENDA),''), NULLIF(TRIM(p.CDUNIDADE),''), 'UN')) PRECO,
      (SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m
        JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0
        WHERE m.CDPRODUTO=p.CDPRODUTO) SALDO
      FROM PRODUTO p
      WHERE UPPER(TRIM(p.CDPRODUTO)) IN (${marcas})`, lote);
    if (rows == null) return null;
    const custos = await consultar(deps.query, `SELECT CDPRODUTO, VLCUSTOMEDIO FROM PRODUTO WHERE UPPER(TRIM(CDPRODUTO)) IN (${marcas})`, lote);
    if (custos == null) custosDisponiveis = false;
    const custoDe = new Map((custos || []).map((row) => [String(row.CDPRODUTO || "").trim().toUpperCase(), row.VLCUSTOMEDIO]));
    for (const row of rows) {
      const id = String(row.CDPRODUTO || "").trim().toUpperCase();
      mapa[id] = { nome: row.PRODUTO, preco: row.PRECO, custo: custosDisponiveis ? custoDe.get(id) : null, saldo: row.SALDO };
    }
  }
  return mapa;
}

async function lerKits(deps) {
  const rows = await consultar(deps.query, "SELECT CDKIT, CDPRODUTO FROM PRODKIT");
  return rows?.map((row) => ({ kit: row.CDKIT, produtoId: row.CDPRODUTO })) ?? null;
}

export async function painelKits(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return sugerirKits(opcoes.fatos);
  const lidos = await lerPares(deps, opcoes.ator || {});
  const pares = lidos?.pares ?? null;
  const codigos = [...new Set((pares || []).flatMap((item) => [item.a, item.b].map((codigo) => String(codigo || "").trim().toUpperCase()).filter(Boolean)))];
  const [cadastro, kits] = await Promise.all([
    pares == null ? null : lerCadastro(deps, codigos),
    lerKits(deps),
  ]);
  return sugerirKits({ pares, cadastro, kits, amostra: lidos?.amostra === true });
}
