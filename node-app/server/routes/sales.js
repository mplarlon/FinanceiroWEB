import express from "express";
import { query, withDatabase } from "../db.js";
import { saleItemCost } from "../lib/sale-cost.js";
import { ITEM_SEM_SQL, ITEM_VALOR_SQL, aplicarCampos, valorJanela } from "../lib/charlie-sale-value.js";

const TITULO_VALOR = "CASE WHEN t.DIVIDA IS NOT NULL THEN t.DIVIDA WHEN t.VALOR IS NOT NULL THEN t.VALOR END";
const TITULO_SEM = "CASE WHEN t.DIVIDA IS NULL AND t.VALOR IS NULL THEN 1 ELSE 0 END";

const SOMA_ITEM = `SUM(${ITEM_VALOR_SQL})`;
const SEM_ITEM = `SUM(${ITEM_SEM_SQL}) AS SEM`;

const router = express.Router();
const cache = new Map();
const TTL = 120_000;

function cached(key, factory) {
  const found = cache.get(key);
  if (found && Date.now() - found.created < TTL) return Promise.resolve(found.payload);
  return factory().then(payload => {
    cache.set(key, { created: Date.now(), payload });
    return payload;
  });
}

function numberArg(req, name, fallback = null, min, max) {
  const raw = req.query[name];
  let value = raw === undefined || raw === "" || raw === "todos" || raw === "null"
    ? fallback : Number(raw);
  if (!Number.isFinite(value)) value = fallback;
  if (value !== null && min !== undefined) value = Math.max(min, value);
  if (value !== null && max !== undefined) value = Math.min(max, value);
  return value;
}

function dateOnly(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function period(req) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = numberArg(req, "dias", 30, 1, 1460);
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - days + 1);
  let start = dateOnly(req.query.data_inicio, defaultStart);
  let endInclusive = dateOnly(req.query.data_fim, today);
  if (endInclusive < start) [start, endInclusive] = [endInclusive, start];
  const end = new Date(endInclusive);
  end.setDate(end.getDate() + 1);
  return { start, end, days };
}

function filters(req) {
  const { start, end, days } = period(req);
  const where = [
    "se.DTSAIDA >= ?",
    "se.DTSAIDA < ?",
    "se.DTCANCELAMENTO IS NULL",
    // Mesmas regras operacionais do Automec: somente vendas efetivadas.
    "COALESCE(se.STATUS,0) IN (1,3)",
    "(se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)",
    "COALESCE(sp.STATUSSE,0)=0",
  ];
  const params = [start, end];
  const numeric = [
    ["loja", "se.IDEMPRESA"], ["vendedor", "se.CDVENDEDOR"],
    ["grupo", "p.CDGRUPO"], ["fornecedor", "p.CDFORNECEDOR"]
  ];
  for (const [name, column] of numeric) {
    const value = numberArg(req, name);
    if (value !== null) { where.push(`${column} = ?`); params.push(value); }
  }
  if (req.query.produto) { where.push("sp.CDPRODUTO = ?"); params.push(String(req.query.produto).trim()); }
  if (req.query.marca) {
    const value = Number(req.query.marca);
    if (Number.isInteger(value)) { where.push("p.CDFORNECEDOR = ?"); params.push(value); }
    else { where.push("UPPER(p.MARCA) = UPPER(?)"); params.push(String(req.query.marca).trim()); }
  }
  return { where: where.join(" AND "), params, start, end, days };
}

const salesFrom = `
  FROM SAIDAPRODUTO sp
  JOIN SAIDAESTOQUE se ON se.NRPEDIDO = sp.NRPEDIDO AND se.IDEMPRESA = sp.IDEMPRESA
  LEFT JOIN PRODUTO p ON p.CDPRODUTO = sp.CDPRODUTO`;

function receivablesFilters(req, start, end) {
  const where = [
    "COALESCE(t.DTMOV,t.DTLOG)>=?",
    "COALESCE(t.DTMOV,t.DTLOG)<?",
    "t.STATUS IN (1,2)",
    // Há registros legados em ORIGEM com bytes inválidos para o charset do
    // banco. Compare em OCTETS para que um texto corrompido não derrube todo
    // o resumo executivo com "Malformed string".
    "CAST(t.ORIGEM AS VARCHAR(255) CHARACTER SET OCTETS) STARTING WITH CAST('Venda' AS VARCHAR(5) CHARACTER SET OCTETS)",
  ];
  const params = [start, end];
  const company = numberArg(req, "loja");
  const seller = numberArg(req, "vendedor");
  if (company !== null) { where.push("t.IDEMPRESA=?"); params.push(company); }
  if (seller !== null) { where.push("t.CDVEND=?"); params.push(seller); }
  return { where: where.join(" AND "), params };
}

async function getOptions(db) {
  const lojas = await query(db, `SELECT FIRST 100 c.IDEMPRESA AS ID,c.NOMEEMPRESA AS NOME FROM CONFIGURACAO c ORDER BY c.IDEMPRESA`);
  const vendedores = await query(db, `SELECT FIRST 200 v.CDVENDEDOR AS ID,v.VENDEDOR AS NOME FROM VENDEDOR v ORDER BY v.VENDEDOR`);
  const produtos = await query(db, `SELECT FIRST 300 p.CDPRODUTO AS ID,p.PRODUTO AS NOME FROM PRODUTO p WHERE p.INATIVO=0 OR p.INATIVO IS NULL ORDER BY p.PRODUTO`);
  const grupos = await query(db, `SELECT FIRST 200 g.CDGRUPO AS ID,g.GRUPOS AS NOME FROM GRUPOS g ORDER BY g.GRUPOS`);
  const marcas = await query(db, `SELECT FIRST 300 f.CDFORNECEDOR AS ID,COALESCE(f.FORNECEDOR,f.FANTASIA) AS NOME FROM FORNECEDOR f WHERE EXISTS (SELECT 1 FROM PRODUTO p WHERE p.CDFORNECEDOR=f.CDFORNECEDOR) ORDER BY f.FORNECEDOR`);
  const fornecedores = await query(db, `SELECT FIRST 300 f.CDFORNECEDOR AS ID,COALESCE(f.FORNECEDOR,f.FANTASIA) AS NOME FROM FORNECEDOR f ORDER BY f.FORNECEDOR`);
  return { ok: true, cache_ttl: TTL / 1000, lojas, vendedores, produtos, grupos, marcas, fornecedores };
}

async function getSummary(db, req) {
  const f = filters(req);
  const custoItem = await saleItemCost(db, "sp", "p");
  const financial = receivablesFilters(req, f.start, f.end);
  const orderTotals = `SELECT se.NRPEDIDO,se.IDEMPRESA,
    COALESCE(se.VLTOTAL,se.SUBTOTAL,0) AS FATURAMENTO,
    SUM(COALESCE(sp.QTDPRODUTO,0)*${custoItem}) AS CUSTO
    ${salesFrom} WHERE ${f.where}
    GROUP BY se.NRPEDIDO,se.IDEMPRESA,se.VLTOTAL,se.SUBTOTAL`;
  const costs = (await query(db, `SELECT SUM(x.CUSTO) AS CUSTO FROM (${orderTotals}) x`, f.params))[0] || {};
  // O faturamento gerencial segue o financeiro do Automec e considera
  // os titulos de venda abertos e quitados.
  const rows = await query(db, `SELECT COUNT(DISTINCT t.NRPEDIDO) AS QTD_VENDAS,
    SUM(${TITULO_VALOR}) AS FATURAMENTO, SUM(${TITULO_SEM}) AS SEM
    FROM CTARECEBER t WHERE ${financial.where}`, financial.params);
  const kpi = { ...(rows[0] || {}), CUSTO: costs.CUSTO };
  const faturamento = valorJanela(kpi.FATURAMENTO, kpi.SEM);
  const custo = kpi.CUSTO == null || kpi.CUSTO === "" || !Number.isFinite(Number(kpi.CUSTO)) ? null : Number(kpi.CUSTO);
  const lucro = faturamento == null || custo == null ? null : Math.round((faturamento - custo) * 100) / 100;
  const quantidade = Number(kpi.QTD_VENDAS || 0);
  const margem = faturamento == null || lucro == null ? null : faturamento ? lucro / faturamento * 100 : 0;
  const duration = Math.max(1, Math.round((f.end - f.start) / 86_400_000));
  const previousStart = new Date(f.start);
  previousStart.setDate(previousStart.getDate() - duration);
  const previousFinancial = receivablesFilters(req, previousStart, f.start);
  const previous = await query(db, `SELECT SUM(${TITULO_VALOR}) AS FATURAMENTO, SUM(${TITULO_SEM}) AS SEM
    FROM CTARECEBER t WHERE ${previousFinancial.where}`, previousFinancial.params);
  const previousTotal = valorJanela(previous[0]?.FATURAMENTO, previous[0]?.SEM);
  const variation = faturamento == null || previousTotal == null || !(previousTotal > 0) ? null : (faturamento - previousTotal) / previousTotal * 100;
  const minimumMargin = numberArg(req, "margem_minima", 25);
  const target = numberArg(req, "meta", 120000);
  const alertas = [];
  if (margem != null && margem < minimumMargin) alertas.push({ tipo: "margem", nivel: "danger",
    titulo: "Margem abaixo do minimo", valor: margem, limite: minimumMargin });
  if (variation !== null && variation < -10) alertas.push({ tipo: "queda_vendas",
    nivel: "warning", titulo: "Queda de vendas", valor: variation, limite: -10 });
  return {
    ok: true, cache_ttl: TTL / 1000,
    periodo: { inicio: iso(f.start), fim: iso(new Date(f.end - 1)), dias: f.days },
    kpis: {
      faturamento_total: faturamento, ticket_medio: faturamento == null ? null : quantidade ? faturamento / quantidade : 0,
      quantidade_vendas: quantidade, margem_lucro: margem, lucro_bruto: lucro, meta: target,
      realizado_pct: faturamento == null || !target ? null : faturamento / target * 100,
      variacao_periodo_pct: variation, produtos_sem_giro: null
    }, alertas
  };
}

async function getCharts(db, req, includeHeatmap = false) {
  const f = filters(req);
  const custoItem = await saleItemCost(db, "sp", "p");
  const limit = numberArg(req, "limite", 15, 5, 50);
  // O driver nativo do Firebird não suporta consultas concorrentes na mesma
  // conexão. Execute cada série em sequência para manter a conexão válida.
  const diario = await query(db, `SELECT FIRST 730 CAST(se.DTSAIDA AS DATE) AS DIA,
      COUNT(DISTINCT se.NRPEDIDO) AS QTD_VENDAS,
      ${SOMA_ITEM} AS FATURAMENTO,
      ${SOMA_ITEM} -
      SUM(COALESCE(sp.QTDPRODUTO, 0) * ${custoItem}) AS LUCRO_BRUTO,
      ${SEM_ITEM}
      ${salesFrom} WHERE ${f.where} GROUP BY CAST(se.DTSAIDA AS DATE) ORDER BY DIA`, f.params);
  const por_loja = await query(db, `SELECT FIRST ${limit} se.IDEMPRESA AS ID,
      c.NOMEEMPRESA AS NOME,
      COUNT(DISTINCT CAST(se.NRPEDIDO AS VARCHAR(20)) || '-' || CAST(se.IDEMPRESA AS VARCHAR(20))) AS QTD,
      ${SOMA_ITEM} AS TOTAL, ${SEM_ITEM} ${salesFrom}
      LEFT JOIN CONFIGURACAO c ON c.IDEMPRESA = se.IDEMPRESA WHERE ${f.where}
      GROUP BY se.IDEMPRESA, c.NOMEEMPRESA ORDER BY TOTAL DESC`, f.params);
  const por_vendedor = await query(db, `SELECT FIRST ${limit} se.CDVENDEDOR AS ID,
      COALESCE(v.VENDEDOR, 'Sem vendedor') AS NOME,
      COUNT(DISTINCT CAST(se.NRPEDIDO AS VARCHAR(20)) || '-' || CAST(se.IDEMPRESA AS VARCHAR(20))) AS QTD,
      ${SOMA_ITEM} AS TOTAL, ${SEM_ITEM} ${salesFrom}
      LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = se.CDVENDEDOR WHERE ${f.where}
      GROUP BY se.CDVENDEDOR, v.VENDEDOR ORDER BY TOTAL DESC`, f.params);
  const top_produtos = await query(db, `SELECT FIRST ${limit} sp.CDPRODUTO AS CODIGO,
      COALESCE(p.PRODUTO, sp.DESCRICAO, sp.CDPRODUTO) AS PRODUTO,
      COALESCE(g.GRUPOS, 'Sem grupo') AS GRUPO,
      COALESCE(fr.FORNECEDOR, fr.FANTASIA, p.FORNECEDOR, p.FORNECEDORCONV, p.MARCA, 'Sem fornecedor') AS MARCA,
      SUM(COALESCE(sp.QTDPRODUTO, 0)) AS QTD,
      ${SOMA_ITEM} AS TOTAL,
      ${SOMA_ITEM} -
      SUM(COALESCE(sp.QTDPRODUTO, 0) * ${custoItem}) AS LUCRO,
      ${SEM_ITEM}
      ${salesFrom} LEFT JOIN GRUPOS g ON g.CDGRUPO=p.CDGRUPO
      LEFT JOIN FORNECEDOR fr ON fr.CDFORNECEDOR=p.CDFORNECEDOR WHERE ${f.where}
      GROUP BY sp.CDPRODUTO,p.PRODUTO,sp.DESCRICAO,g.GRUPOS,fr.FORNECEDOR,fr.FANTASIA,
      p.FORNECEDOR,p.FORNECEDORCONV,p.MARCA ORDER BY TOTAL DESC`, f.params);
  const curva_abc = await query(db, `SELECT FIRST 100 sp.CDPRODUTO AS CODIGO,
      COALESCE(p.PRODUTO, sp.DESCRICAO, sp.CDPRODUTO) AS PRODUTO,
      ${SOMA_ITEM} AS TOTAL, ${SEM_ITEM} ${salesFrom}
      WHERE ${f.where} GROUP BY sp.CDPRODUTO,p.PRODUTO,sp.DESCRICAO ORDER BY TOTAL DESC`, f.params);
  const payload = {
    ok: true, cache_ttl: TTL / 1000,
    periodo: { inicio: iso(f.start), fim: iso(new Date(f.end - 1)), dias: f.days },
    diario: diario.map((row) => aplicarCampos(row, ["FATURAMENTO", "LUCRO_BRUTO"])),
    por_loja: por_loja.map((row) => aplicarCampos(row, ["TOTAL"])),
    por_vendedor: por_vendedor.map((row) => aplicarCampos(row, ["TOTAL"])),
    top_produtos: top_produtos.map((row) => aplicarCampos(row, ["TOTAL", "LUCRO"])),
    curva_abc: curva_abc.map((row) => aplicarCampos(row, ["TOTAL"])),
    heatmap: [], produtos_sem_giro: []
  };
  if (includeHeatmap) payload.heatmap = await getHeatmap(db, req);
  return payload;
}

async function getHeatmap(db, req) {
  const f = filters(req);
  const rows = await query(db, `SELECT EXTRACT(WEEKDAY FROM se.DTSAIDA) AS DIA_SEMANA,
    EXTRACT(HOUR FROM se.HORAPED) AS HORA,
    ${SOMA_ITEM} AS TOTAL, ${SEM_ITEM}
    ${salesFrom} WHERE ${f.where}
    GROUP BY EXTRACT(WEEKDAY FROM se.DTSAIDA),EXTRACT(HOUR FROM se.HORAPED)
    ORDER BY DIA_SEMANA,HORA`, f.params);
  return rows.map((row) => aplicarCampos(row, ["TOTAL"]));
}

// Cadastros antigos estão em NONE. Um byte inválido para o charset da conexão
// aborta a consulta com "Malformed string" e derruba o painel inteiro.
const legacyText = (expression, size) =>
  `CAST(CAST(${expression} AS VARCHAR(${size}) CHARACTER SET OCTETS) AS VARCHAR(${size}) CHARACTER SET NONE)`;

async function overviewProductNames(db, products) {
  const codes = [...new Set(products
    .map((item) => item.CODIGO)
    .filter((code) => code !== null && code !== undefined && String(code).trim() !== ""))];
  if (!codes.length) return new Map();
  const rows = await query(db, `SELECT p.CDPRODUTO AS CODIGO,
    NULLIF(TRIM(${legacyText("p.PRODUTO", 70)}), '') AS NOME
    FROM PRODUTO p WHERE p.CDPRODUTO IN (${codes.map(() => "?").join(",")})`, codes);
  return new Map(rows.map((row) => [String(row.CODIGO).trim(), String(row.NOME || "").trim()]));
}

// Quantidades e valores saem sem texto. O nome é lido depois, só dos códigos
// do ranking, para um cadastro corrompido não derrubar o painel.
async function getOverviewCharts(db, req) {
  const f = filters(req);
  const financial = receivablesFilters(req, f.start, f.end);
  const limit = numberArg(req, "limite", 5, 3, 10);
  const diario = await query(db, `SELECT FIRST 730 CAST(COALESCE(t.DTMOV,t.DTLOG) AS DATE) AS DIA,
    COUNT(DISTINCT t.NRPEDIDO) AS QTD_VENDAS,
    SUM(${TITULO_VALOR}) AS FATURAMENTO, SUM(${TITULO_SEM}) AS SEM
    FROM CTARECEBER t WHERE ${financial.where}
    GROUP BY CAST(COALESCE(t.DTMOV,t.DTLOG) AS DATE) ORDER BY DIA`, financial.params);
  const products = await query(db, `SELECT FIRST ${limit} sp.CDPRODUTO AS CODIGO,
    SUM(COALESCE(sp.QTDPRODUTO, 0)) AS QTD,
    ${SOMA_ITEM} AS TOTAL, ${SEM_ITEM}
    ${salesFrom} WHERE ${f.where}
    GROUP BY sp.CDPRODUTO ORDER BY TOTAL DESC`, f.params);
  let names = new Map();
  try {
    names = await overviewProductNames(db, products);
  } catch {
    names = new Map();
  }
  return {
    ok: true,
    diario: diario.map((row) => aplicarCampos(row, ["FATURAMENTO"])),
    top_produtos: products.map(item => {
      const code = String(item.CODIGO ?? "").trim();
      const name = names.get(code) || "";
      return {
        ...aplicarCampos(item, ["TOTAL"]),
        NOME: name,
        PRODUTO: name || `Produto ${code}`,
      };
    }),
  };
}

function endpoint(name, factory) {
  return async (req, res) => {
    try {
      const key = `${name}?${new URLSearchParams(req.query).toString()}`;
      res.json(await cached(key, () => withDatabase(db => factory(db, req))));
    } catch (error) {
      res.status(500).json({ ok: false, erro: error.message });
    }
  };
}

router.get("/options", endpoint("options", getOptions));
router.get("/views", (_req, res) => res.json({ ok: true, arquivo: "sales_dashboard_views.sql",
  views: ["VW_DASH_VENDAS_ITENS", "VW_DASH_VENDAS_DIA", "VW_DASH_VENDAS_PRODUTO"],
  observacao: "Arquivo SQL pronto para aplicar no Firebird quando desejar materializar agregacoes." }));
router.get("/summary", endpoint("summary", getSummary));
router.get("/charts", endpoint("charts", getCharts));
router.get("/overview", endpoint("overview", getOverviewCharts));
router.get("/heatmap", endpoint("heatmap", async (db, req) => ({ ok: true, heatmap: await getHeatmap(db, req) })));
router.get("/all", endpoint("all", async (db, req) => {
  const options = await getOptions(db);
  const summary = await getSummary(db, req);
  const charts = await getCharts(db, req, true);
  return { ...options, ...summary, ...charts };
}));
router.get("/sem-giro", endpoint("sem-giro", async (db, req) => {
  const limit = numberArg(req, "limite", 15, 5, 50);
  const days = numberArg(req, "sem_giro_dias", 90, 1, 2000);
  const products = await query(db, `SELECT FIRST ${limit} p.CDPRODUTO AS CODIGO,p.PRODUTO,
    COALESCE(g.GRUPOS,'Sem grupo') AS GRUPO,
    COALESCE(fr.FORNECEDOR,fr.FANTASIA,p.FORNECEDOR,p.FORNECEDORCONV,p.MARCA,'Sem fornecedor') AS MARCA,
    COALESCE(m.QTDEATUAL,0) AS ESTOQUE,MAX(CAST(se.DTSAIDA AS DATE)) AS ULTIMA_VENDA,
    CASE WHEN MAX(CAST(se.DTSAIDA AS DATE)) IS NULL THEN 99999
    ELSE DATEDIFF(DAY,MAX(CAST(se.DTSAIDA AS DATE)),CURRENT_DATE) END AS DIAS_SEM_VENDA
    FROM PRODUTO p LEFT JOIN (SELECT CDPRODUTO,SUM(QTDEATUAL) QTDEATUAL FROM MOVIMENTO GROUP BY CDPRODUTO) m
    ON m.CDPRODUTO=p.CDPRODUTO LEFT JOIN GRUPOS g ON g.CDGRUPO=p.CDGRUPO
    LEFT JOIN FORNECEDOR fr ON fr.CDFORNECEDOR=p.CDFORNECEDOR
    LEFT JOIN SAIDAPRODUTO sp ON sp.CDPRODUTO=p.CDPRODUTO
    LEFT JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    AND se.DTCANCELAMENTO IS NULL WHERE (p.INATIVO=0 OR p.INATIVO IS NULL) AND COALESCE(m.QTDEATUAL,0)>0
    GROUP BY p.CDPRODUTO,p.PRODUTO,g.GRUPOS,fr.FORNECEDOR,fr.FANTASIA,p.FORNECEDOR,
    p.FORNECEDORCONV,p.MARCA,m.QTDEATUAL HAVING MAX(CAST(se.DTSAIDA AS DATE)) IS NULL
    OR DATEDIFF(DAY,MAX(CAST(se.DTSAIDA AS DATE)),CURRENT_DATE)>=${days}
    ORDER BY DIAS_SEM_VENDA DESC,ESTOQUE DESC`);
  return { ok: true, cache_ttl: TTL / 1000, produtos_sem_giro: products };
}));

export default router;
