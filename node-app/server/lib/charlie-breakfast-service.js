import { query, withReadOnlyDatabase } from "../db.js";
import { saleItemCost } from "./sale-cost.js";
import { readJsonConfig } from "./json-config.js";
import { ollamaChat } from "./ollama.js";
import {
  addDays,
  assertBreakfastAccess,
  chartDateLabel,
  accountClassificationLabel,
  composeBreakfast,
  isoDay,
  mondayOf,
  monthBounds,
  narrativeAccepts,
  rangeFor,
  referenceDay,
  renderMessage,
  saoPauloParts,
  sellerMessage,
} from "./charlie-breakfast-engine.js";
import { channelPlan, deliverReport } from "./charlie-breakfast-delivery.js";
import { loadConfig as loadWhatsApp, sendTemplate } from "../routes/whatsapp.js";
import {
  readSettings,
  rememberLink,
  rememberSellerSend,
  saveRun,
  upsertAlerts,
} from "./charlie-breakfast-store.js";

const TIMEOUT = 20000;
const cache = new Map();

export function salesWhere(alias = "se", companyId = null) {
  return `${alias}.DTCANCELAMENTO IS NULL AND COALESCE(${alias}.STATUS,0) IN (1,3) AND (${alias}.STATUS_ORC IS NULL OR ${alias}.STATUS_ORC<>0) AND COALESCE(sp.STATUSSE,0)=0${companyId ? ` AND ${alias}.IDEMPRESA=?` : ""}`;
}

async function rows(db, sql, params) {
  return query(db, sql, params, { timeoutMs: TIMEOUT });
}

async function optional(db, sql, params) {
  try { return await rows(db, sql, params); }
  catch (error) { return { erro: String(error.message || error) }; }
}

function companyParams(range, companyId) {
  const params = [range.start, range.end];
  if (companyId) params.push(companyId);
  return params;
}

async function inOrder(steps) {
  const results = [];
  for (const step of steps) results.push(await step());
  return results;
}

async function salesBySeller(db, range, companyId) {
  const custoItem = await saleItemCost(db, "sp", "p");
  const data = await optional(db, `SELECT se.CDVENDEDOR ID, COALESCE(v.VENDEDOR,'Sem vendedor') NOME,
    COUNT(DISTINCT se.NRPEDIDO) PEDIDOS,
    SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) FATURAMENTO,
    SUM(COALESCE(sp.QTDPRODUTO,0)*${custoItem}) CUSTO
    FROM SAIDAESTOQUE se
    JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${salesWhere("se", companyId)}
    GROUP BY se.CDVENDEDOR, v.VENDEDOR`, companyParams(range, companyId));
  if (data.erro) return [];
  return data.map((row) => ({ companyId, sellerId: Number(row.ID || 0), seller: row.NOME, orders: Number(row.PEDIDOS || 0), revenue: Number(row.FATURAMENTO || 0), cost: Number(row.CUSTO || 0) }));
}

async function series(db, range, companyId) {
  const data = await optional(db, `SELECT CAST(se.DTSAIDA AS DATE) DIA, SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) TOTAL
    FROM SAIDAESTOQUE se
    JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${salesWhere("se", companyId)}
    GROUP BY CAST(se.DTSAIDA AS DATE) ORDER BY 1`, companyParams(range, companyId));
  if (data.erro) return [];
  return data.map((row) => {
    const date = isoDay(row.DIA);
    return { date, label: chartDateLabel(date), revenue: Number(row.TOTAL || 0) };
  });
}

async function quoteStatus(db, range, companyId) {
  const params = [range.start, range.end];
  const company = companyId ? " AND IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT STATUS, COUNT(*) QTD, SUM(COALESCE(VLTOTAL,0)) TOTAL
    FROM ORCAMENTO WHERE DTORC>=? AND DTORC<? AND DTCANCELAMENTO IS NULL${company} GROUP BY STATUS`, params);
  if (data.erro) return [];
  return data.map((row) => ({ status: Number(row.STATUS), count: Number(row.QTD || 0), value: Number(row.TOTAL || 0), companyId }));
}

export async function buildBreakfastReport(db, options = {}) {
  const settings = options.settings || readSettings();
  const reference = options.reference || referenceDay(options.now || new Date());
  const companyId = options.companyId ? Number(options.companyId) : null;
  const depositId = options.depositId ? Number(options.depositId) : null;
  const cacheKey = `${reference}|${companyId || 0}|${depositId || 0}`;
  const cached = cache.get(cacheKey);
  if (!options.fresh && cached && Date.now() - cached.at < 120000) return cached.report;
  const day = rangeFor(reference, reference);
  const previous = rangeFor(addDays(reference, -1), addDays(reference, -1));
  const bounds = monthBounds(reference);
  const month = rangeFor(bounds.start, reference);
  const chart = rangeFor(addDays(reference, -13), reference);
  const week = rangeFor(mondayOf(reference), reference);
  const companies = await optional(db, "SELECT IDEMPRESA, NOMEEMPRESA FROM CONFIGURACAO ORDER BY IDEMPRESA", []);
  const companyName = Array.isArray(companies) ? companies.find((item) => Number(item.IDEMPRESA) === companyId)?.NOMEEMPRESA : null;
  const [salesDay, salesPrevious, salesMonth, salesWeek, evolution, quotesPeriod, quotesMonth, quotesBySeller, quotesBySellerMonth, openTotalRows, openBySeller, openQuotes, critical, aging, idleCustom, top, bottom, negative, movements, movementSummaryRows, baskets, financeReceiveOverdue, financeReceiveOpen, financePayOverdue, financePayOpen, inactive, purchasesIdleRows, expenseRows, deposits] = await inOrder([
    () => salesBySeller(db, day, companyId),
    () => salesBySeller(db, previous, companyId),
    () => salesBySeller(db, month, companyId),
    () => salesBySeller(db, week, companyId),
    () => series(db, chart, companyId),
    () => quoteStatus(db, day, companyId),
    () => quoteStatus(db, month, companyId),
    () => quoteSellers(db, day, companyId),
    () => quoteSellers(db, month, companyId),
    () => openTotal(db, companyId),
    () => openSellers(db, companyId),
    () => openList(db, companyId),
    () => stockCritical(db, companyId, depositId),
    () => stockAging(db, companyId, depositId),
    () => Number(settings.limites?.semGiroDias) === 90 ? null : stockIdle(db, companyId, settings.limites.semGiroDias, depositId),
    () => productRank(db, day, companyId, "DESC"),
    () => productRank(db, day, companyId, "ASC"),
    () => stockNegative(db, companyId, depositId),
    () => manualMovements(db, day, companyId),
    () => movementSummary(db, day, companyId),
    () => settings.indicadores?.vendaAgregada ? basketsOf(db, day, companyId) : [],
    () => financeSum(db, "CTARECEBER", "COALESCE(DIVIDA,VALOR,0)", "DTVENC<CURRENT_DATE", companyId),
    () => financeSum(db, "CTARECEBER", "COALESCE(DIVIDA,VALOR,0)", "DTVENC BETWEEN CURRENT_DATE AND DATEADD(7 DAY TO CURRENT_DATE)", companyId),
    () => financeSum(db, "CTAPAGAR", "COALESCE(VALOR,TOTAL,0)", "DTVENC<CURRENT_DATE", companyId),
    () => financeSum(db, "CTAPAGAR", "COALESCE(VALOR,TOTAL,0)", "DTVENC BETWEEN CURRENT_DATE AND DATEADD(7 DAY TO CURRENT_DATE)", companyId),
    () => inactiveCustomers(db, companyId, settings.limites?.clienteInativoDias),
    () => purchasesIdle(db, companyId),
    () => expenseLines(db, companyId),
    () => optional(db, "SELECT d.CDDEPOSITO, d.DEPOSITO, c.IDEMPRESA FROM DEPOSITO d LEFT JOIN CONFIGURACAO c ON c.CDDEPOSITO=d.CDDEPOSITO ORDER BY d.DEPOSITO", []),
  ]);
  const openQuotesReady = await enrichQuotes(db, openQuotes, companyId);
  const expenses = Array.isArray(expenseRows) ? expenseRows.filter((row) => !String(row.HISTORICO || "").trim().toUpperCase().startsWith("VALE")).map((row) => {
    const classification = accountClassificationLabel(row);
    return {
      historico: String(row.HISTORICO || "").slice(0, 180),
      valor: Number(row.TOTAL || 0),
      quantidade: Number(row.QTD || 0),
      classe: classification.classe,
      confirmada: classification.confirmada,
      origem: classification.origem,
      texto: classification.texto,
    };
  }) : null;
  const filialName = depositId && Array.isArray(deposits) ? deposits.find((item) => Number(item.CDDEPOSITO) === depositId)?.DEPOSITO : null;
  const idle = idleCustom || (aging && !aging.erro ? { value: aging["90"]?.capital ?? null, count: aging["90"]?.quantidade ?? null } : aging);
  const legacy = readJsonConfig("management_reports.json", {});
  const report = composeBreakfast({
    now: options.now,
    reference,
    companyId,
    companyName: companyName || (companyId ? `Empresa ${companyId}` : "Todas as empresas autorizadas"),
    settings,
    salesDay,
    salesPrevious,
    salesMonth,
    salesWeek,
    series: evolution,
    quotesPeriod,
    quotesMonth,
    quotesBySeller,
    quotesBySellerMonth,
    openTotal: openTotalRows,
    openBySeller,
    openQuotes: openQuotesReady,
    stockCritical: critical,
    stockIdle: idle,
    stockAging: aging,
    stockTop: top,
    stockBottom: bottom,
    stockNegative: negative,
    movements,
    movementSummary: movementSummaryRows,
    baskets,
    purchasesIdle: Array.isArray(purchasesIdleRows) ? purchasesIdleRows : null,
    expenses,
    finance: {
      receivableOverdue: financeReceiveOverdue,
      receivableOpen: financeReceiveOpen,
      payableOverdue: financePayOverdue,
      payableOpen: financePayOpen,
      contracts: null,
    },
    inactiveCustomers: inactive,
    legacyGoals: legacy.goals || {},
    legacySellerGoals: legacy.seller_goals || {},
    link: options.link || null,
    filialId: depositId,
    filialName: filialName || (depositId ? `Depósito ${depositId}` : null),
  });
  report.empresas = Array.isArray(companies) ? companies.map((item) => ({ id: Number(item.IDEMPRESA), nome: item.NOMEEMPRESA })) : [];
  report.filiais = Array.isArray(deposits) ? deposits.map((item) => ({ id: Number(item.CDDEPOSITO), nome: item.DEPOSITO, empresa: item.IDEMPRESA == null ? null : Number(item.IDEMPRESA) })) : [];
  report.limitesConsulta = {
    orcamentos: quotesPeriod.erro || null,
    estoqueParado: idle?.erro || null,
    inativos: inactive == null ? "Dado indisponível para esta análise." : null,
  };
  cache.set(cacheKey, { at: Date.now(), report });
  return report;
}

async function quoteSellers(db, range, companyId) {
  const params = [range.start, range.end];
  const company = companyId ? " AND o.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT o.CDVENDEDOR ID, COALESCE(v.VENDEDOR,'Sem vendedor') NOME,
    SUM(CASE WHEN o.STATUS IN (0,1) THEN 1 ELSE 0 END) QTD,
    SUM(CASE WHEN o.STATUS IN (0,1) THEN COALESCE(o.VLTOTAL,0) ELSE 0 END) TOTAL,
    SUM(CASE WHEN o.STATUS=1 THEN 1 ELSE 0 END) CONVERTIDOS
    FROM ORCAMENTO o LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=o.CDVENDEDOR
    WHERE o.DTORC>=? AND o.DTORC<? AND o.DTCANCELAMENTO IS NULL${company}
    GROUP BY o.CDVENDEDOR, v.VENDEDOR`, params);
  if (data.erro) return [];
  return data.map((row) => ({ companyId, sellerId: Number(row.ID || 0), seller: row.NOME, count: Number(row.QTD || 0), value: Number(row.TOTAL || 0), converted: Number(row.CONVERTIDOS || 0) }));
}

async function openTotal(db, companyId) {
  const params = [];
  const company = companyId ? " AND IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT COUNT(*) QTD, SUM(COALESCE(VLTOTAL,0)) TOTAL FROM ORCAMENTO WHERE STATUS=0 AND DTCANCELAMENTO IS NULL${company}`, params);
  if (data.erro) return null;
  return { count: Number(data[0]?.QTD || 0), value: Number(data[0]?.TOTAL || 0) };
}

async function openSellers(db, companyId) {
  const params = [];
  const company = companyId ? " AND o.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT o.CDVENDEDOR ID, COALESCE(v.VENDEDOR,'Sem vendedor') NOME, COUNT(*) QTD, SUM(COALESCE(o.VLTOTAL,0)) TOTAL
    FROM ORCAMENTO o LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=o.CDVENDEDOR
    WHERE o.STATUS=0 AND o.DTCANCELAMENTO IS NULL${company}
    GROUP BY o.CDVENDEDOR, v.VENDEDOR ORDER BY 4 DESC`, params);
  if (data.erro) return [];
  return data.map((row) => ({ companyId, sellerId: Number(row.ID || 0), seller: row.NOME, count: Number(row.QTD || 0), value: Number(row.TOTAL || 0) }));
}

async function openList(db, companyId) {
  const params = [];
  const company = companyId ? " AND o.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT FIRST 25 o.NRORCAMENTO, o.IDEMPRESA, o.CDCLIENTE, o.CDVENDEDOR, COALESCE(v.VENDEDOR,'Sem vendedor') VENDEDOR,
    COALESCE(c.CLIENTE,c.RAZAO,o.CLIENTE) CLIENTE, o.DTORC, o.VLTOTAL, o.TOTALLUCRO
    FROM ORCAMENTO o
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=o.CDVENDEDOR
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=o.CDCLIENTE
    WHERE o.STATUS=0 AND o.DTCANCELAMENTO IS NULL${company}
    ORDER BY o.VLTOTAL DESC`, params);
  if (data.erro) return [];
  return data.map((row) => ({ companyId: Number(row.IDEMPRESA), number: row.NRORCAMENTO, customerId: Number(row.CDCLIENTE || 0), sellerId: Number(row.CDVENDEDOR || 0), seller: row.VENDEDOR, customer: row.CLIENTE, date: row.DTORC, value: Number(row.VLTOTAL || 0), profit: row.TOTALLUCRO == null ? null : Number(row.TOTALLUCRO) }));
}

async function stockCritical(db, companyId, depositId) {
  const params = [];
  let company = "";
  if (companyId) { company += " AND c.IDEMPRESA=?"; params.push(companyId); }
  if (depositId) { company += " AND m.CDDEPOSITO=?"; params.push(depositId); }
  const data = await optional(db, `SELECT FIRST 80 m.CDPRODUTO, MAX(p.PRODUTO) PRODUTO, SUM(m.QTDEATUAL) ESTOQUE, MAX(m.QTDEMINIMA) MINIMO, MAX(COALESCE(p.VLCUSTOMEDIO,0)) CUSTO
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    LEFT JOIN CONFIGURACAO c ON c.CDDEPOSITO=m.CDDEPOSITO
    WHERE COALESCE(p.INATIVO,0)=0 AND (m.QTDEATUAL<=0 OR (m.QTDEMINIMA>0 AND m.QTDEATUAL<=m.QTDEMINIMA))${company}
    GROUP BY m.CDPRODUTO`, params);
  if (!Array.isArray(data) || !data.length) return [];
  const ids = data.map((row) => row.CDPRODUTO);
  const marks = ids.map(() => "?").join(",");
  const salesParams = [...ids];
  if (companyId) salesParams.push(companyId);
  const sales = await optional(db, `SELECT sp.CDPRODUTO, SUM(COALESCE(sp.QTDPRODUTO,0)) QTD
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    WHERE sp.CDPRODUTO IN (${marks}) AND se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE) AND ${salesWhere("se", companyId)}
    GROUP BY sp.CDPRODUTO`, salesParams);
  const sold = new Map((Array.isArray(sales) ? sales : []).map((row) => [String(row.CDPRODUTO), Number(row.QTD || 0)]));
  return data.map((row) => ({ companyId, depositId: depositId || null, productId: row.CDPRODUTO, product: row.PRODUTO, stock: Number(row.ESTOQUE || 0), minimum: Number(row.MINIMO || 0), cost: Number(row.CUSTO || 0), qty90: sold.get(String(row.CDPRODUTO)) || 0 }));
}

async function stockSnapshot(db, companyId, depositId) {
  const params = [];
  let company = "";
  if (companyId) { company += " AND c.IDEMPRESA=?"; params.push(companyId); }
  if (depositId) { company += " AND m.CDDEPOSITO=?"; params.push(depositId); }
  const balances = await optional(db, `SELECT m.CDPRODUTO, SUM(m.QTDEATUAL*COALESCE(p.VLCUSTOMEDIO,0)) CAPITAL
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    LEFT JOIN CONFIGURACAO c ON c.CDDEPOSITO=m.CDDEPOSITO
    WHERE m.QTDEATUAL>0 AND COALESCE(p.INATIVO,0)=0${company}
    GROUP BY m.CDPRODUTO`, params);
  if (balances?.erro) return { erro: balances.erro };
  const sales = await optional(db, `SELECT sp.CDPRODUTO, MAX(se.DTSAIDA) ULTIMA
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0) AND COALESCE(sp.STATUSSE,0)=0
      AND se.DTSAIDA>=DATEADD(-180 DAY TO CURRENT_DATE)
    GROUP BY sp.CDPRODUTO`, []);
  if (sales?.erro) return { erro: sales.erro };
  const lastSale = new Map((Array.isArray(sales) ? sales : []).map((row) => [String(row.CDPRODUTO), row.ULTIMA]));
  return { balances: Array.isArray(balances) ? balances : [], lastSale };
}

function ageDays(value, now) {
  if (!value) return 99999;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? (now - time) / 86400000 : 99999;
}

async function stockIdle(db, companyId, days, depositId) {
  const safeDays = Math.max(1, Math.min(365, Number(days) || 90));
  const snapshot = await stockSnapshot(db, companyId, depositId);
  if (snapshot.erro) return { value: null, count: null, erro: snapshot.erro };
  const now = Date.now();
  let value = 0;
  let count = 0;
  for (const row of snapshot.balances) {
    if (ageDays(snapshot.lastSale.get(String(row.CDPRODUTO)), now) < safeDays) continue;
    value += Number(row.CAPITAL || 0);
    count += 1;
  }
  return { value, count };
}

async function productRank(db, range, companyId, direction) {
  const data = await optional(db, `SELECT FIRST 5 sp.CDPRODUTO, MAX(COALESCE(p.PRODUTO,sp.DESCRICAO)) PRODUTO,
    SUM(COALESCE(sp.QTDPRODUTO,0)) QTD, SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) TOTAL
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${salesWhere("se", companyId)}
    GROUP BY sp.CDPRODUTO ORDER BY QTD ${direction === "ASC" ? "ASC" : "DESC"}`, companyParams(range, companyId));
  if (data.erro) return [];
  return data.map((row) => ({ product: row.PRODUTO, quantity: Number(row.QTD || 0), revenue: Number(row.TOTAL || 0) }));
}

async function stockNegative(db, companyId, depositId) {
  const params = [];
  let company = "";
  if (companyId) { company += " AND c.IDEMPRESA=?"; params.push(companyId); }
  if (depositId) { company += " AND m.CDDEPOSITO=?"; params.push(depositId); }
  const data = await optional(db, `SELECT COUNT(*) QTD FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    LEFT JOIN CONFIGURACAO c ON c.CDDEPOSITO=m.CDDEPOSITO
    WHERE m.QTDEATUAL<0 AND COALESCE(p.INATIVO,0)=0${company}`, params);
  if (data.erro) return null;
  return Number(data[0]?.QTD || 0);
}

async function manualMovements(db, range, companyId) {
  const params = [range.start, range.end];
  const company = companyId ? " AND m.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT FIRST 40 m.CDPRODUTO, MAX(p.PRODUTO) PRODUTO, SUM(COALESCE(m.QTENTRADA,0)) ENTRADAS, SUM(COALESCE(m.QTSAIDA,0)) SAIDAS, MAX(m.HISTORICO) HISTORICO
    FROM MOV_PRODUTO m LEFT JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE m.DTMOVIMENTO>=? AND m.DTMOVIMENTO<? AND m.TIPOMOVIMENTO=5
      AND (m.HISTORICO CONTAINING 'AJUSTE' OR m.HISTORICO CONTAINING 'INVENT' OR m.HISTORICO CONTAINING 'BAIXA')${company}
    GROUP BY m.CDPRODUTO`, params);
  if (data.erro) return [];
  return data.map((row) => ({ product: row.PRODUTO || row.CDPRODUTO, entries: Number(row.ENTRADAS || 0), exits: Number(row.SAIDAS || 0), history: row.HISTORICO || "" }));
}

async function basketsOf(db, range, companyId) {
  const data = await optional(db, `SELECT FIRST 300 se.NRPEDIDO, se.IDEMPRESA, sp.CDPRODUTO, COALESCE(p.PRODUTO,sp.DESCRICAO,sp.CDPRODUTO) PRODUTO
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${salesWhere("se", companyId)}`, companyParams(range, companyId));
  if (data.erro) return [];
  return data.map((row) => ({ companyId: row.IDEMPRESA, orderId: row.NRPEDIDO, productId: row.CDPRODUTO, product: row.PRODUTO }));
}

async function financeSum(db, table, amount, where, companyId) {
  const params = [];
  const company = companyId ? " AND IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT SUM(${amount}) TOTAL FROM ${table} WHERE STATUS=1 AND ${where}${company}`, params);
  if (data.erro) return null;
  return Number(data[0]?.TOTAL || 0);
}

async function inactiveCustomers(db, companyId, days) {
  const safeDays = Math.max(1, Math.min(730, Number(days) || 60));
  const params = [];
  const company = companyId ? " AND se.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT COUNT(*) QTD FROM (
      SELECT se.CDCLIENTE FROM SAIDAESTOQUE se
      WHERE se.DTCANCELAMENTO IS NULL AND se.CDCLIENTE>0 AND COALESCE(se.STATUS,0) IN (1,3)
        AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0) AND se.DTSAIDA>=DATEADD(-730 DAY TO CURRENT_DATE)${company}
      GROUP BY se.CDCLIENTE
      HAVING MAX(se.DTSAIDA)<DATEADD(-${safeDays} DAY TO CURRENT_DATE)
    )`, params);
  if (data.erro) return null;
  return Number(data[0]?.QTD || 0);
}

async function stockAging(db, companyId, depositId) {
  const snapshot = await stockSnapshot(db, companyId, depositId);
  if (snapshot.erro) return { erro: snapshot.erro };
  const now = Date.now();
  const bands = { 30: { quantidade: 0, capital: 0 }, 60: { quantidade: 0, capital: 0 }, 90: { quantidade: 0, capital: 0 } };
  for (const row of snapshot.balances) {
    const age = ageDays(snapshot.lastSale.get(String(row.CDPRODUTO)), now);
    const capital = Number(row.CAPITAL || 0);
    for (const days of [30, 60, 90]) {
      if (age < days) continue;
      bands[days].quantidade += 1;
      bands[days].capital += capital;
    }
  }
  return bands;
}

async function movementSummary(db, range, companyId) {
  const params = [range.start, range.end];
  const company = companyId ? " AND IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT SUM(COALESCE(QTENTRADA,0)) ENTRADAS, SUM(COALESCE(QTSAIDA,0)) SAIDAS,
    SUM(CASE WHEN HISTORICO CONTAINING 'DEVOL' THEN COALESCE(QTENTRADA,0) ELSE 0 END) DEVOLUCOES,
    SUM(CASE WHEN HISTORICO CONTAINING 'TRANSF' THEN COALESCE(QTSAIDA,0)+COALESCE(QTENTRADA,0) ELSE 0 END) TRANSFERENCIAS
    FROM MOV_PRODUTO WHERE DTMOVIMENTO>=? AND DTMOVIMENTO<? AND TIPOMOVIMENTO=5${company}`, params);
  if (data.erro) return null;
  const row = data[0] || {};
  return { entradas: Number(row.ENTRADAS || 0), saidas: Number(row.SAIDAS || 0), devolucoes: Number(row.DEVOLUCOES || 0), transferencias: Number(row.TRANSFERENCIAS || 0) };
}

async function purchasesIdle(db, companyId) {
  const params = [];
  const company = companyId ? " AND ee.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const bought = await optional(db, `SELECT ep.CDPRODUTO, MAX(COALESCE(p.PRODUTO, ep.CDPRODUTO)) PRODUTO, SUM(COALESCE(ep.QTDE,0)) QTD, SUM(COALESCE(ep.VLTOT, ep.QTDE*ep.VLUNIT, 0)) TOTAL
    FROM ENTRESTOQUE ee JOIN ENTRPRODUTO ep ON ep.IDENTRADA=ee.IDENTRADA AND ep.IDEMPRESA=ee.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=ep.CDPRODUTO
    WHERE ee.DTCANCELAMENTO IS NULL AND ee.DTENTRADA>=DATEADD(-90 DAY TO CURRENT_DATE)${company}
    GROUP BY ep.CDPRODUTO`, params);
  if (bought?.erro || !Array.isArray(bought)) return null;
  const sold = await optional(db, `SELECT sp.CDPRODUTO
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    WHERE se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE)
      AND se.DTCANCELAMENTO IS NULL AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0) AND COALESCE(sp.STATUSSE,0)=0
    GROUP BY sp.CDPRODUTO`, []);
  if (sold?.erro || !Array.isArray(sold)) return null;
  const soldIds = new Set(sold.map((row) => String(row.CDPRODUTO)));
  return bought
    .filter((row) => !soldIds.has(String(row.CDPRODUTO)))
    .sort((a, b) => Number(b.TOTAL || 0) - Number(a.TOTAL || 0))
    .slice(0, 12)
    .map((row) => ({ produto: row.PRODUTO, quantidade: Number(row.QTD || 0), valor: Number(row.TOTAL || 0) }));
}

async function expenseLines(db, companyId) {
  const params = [];
  const company = companyId ? " AND t.IDEMPRESA=?" : "";
  if (companyId) params.push(companyId);
  const data = await optional(db, `SELECT FIRST 30 t.HISTORICO, t.CDCONTA, c.CONTA, t.CDSUBCONTA, s.SUBCONTA,
    t.CDSUBSUBCONTA, ss.SUBSUBCONTA, t.CDSUBSUBSUBCONTA, sss.SUBSUBSUBCONTA,
    SUM(COALESCE(t.VALOR,t.TOTAL,0)) TOTAL, COUNT(*) QTD
    FROM CTAPAGAR t
    LEFT JOIN CONTAS c ON c.CDCONTA=t.CDCONTA
    LEFT JOIN SUBCONTAS s ON s.CDCONTA=t.CDCONTA AND s.CDSUBCONTA=t.CDSUBCONTA
    LEFT JOIN SUBSUBCONTAS ss ON ss.CDCONTA=t.CDCONTA AND ss.CDSUBCONTA=t.CDSUBCONTA AND ss.CDSUBSUBCONTA=t.CDSUBSUBCONTA
    LEFT JOIN SUBSUBSUBCONTAS sss ON sss.CDCONTA=t.CDCONTA AND sss.CDSUBCONTA=t.CDSUBCONTA AND sss.CDSUBSUBCONTA=t.CDSUBSUBCONTA AND sss.CDSUBSUBSUBCONTA=t.CDSUBSUBSUBCONTA
    WHERE t.STATUS=1 AND t.DTVENC>=DATEADD(-30 DAY TO CURRENT_DATE)
      AND COALESCE(t.STATUSVALE,0) NOT IN (1,2)${company}
    GROUP BY t.HISTORICO, t.CDCONTA, c.CONTA, t.CDSUBCONTA, s.SUBCONTA, t.CDSUBSUBCONTA, ss.SUBSUBCONTA, t.CDSUBSUBSUBCONTA, sss.SUBSUBSUBCONTA
    ORDER BY 10 DESC`, params);
  if (data.erro) return null;
  return data;
}

async function enrichQuotes(db, quotes, companyId) {
  if (!Array.isArray(quotes) || !quotes.length) return quotes || [];
  const customers = [...new Set(quotes.map((item) => Number(item.customerId)).filter((item) => item > 0))];
  const numbers = [...new Set(quotes.map((item) => Number(item.number)).filter((item) => item > 0))];
  const history = new Map();
  if (customers.length) {
    const params = [...customers];
    const company = companyId ? " AND IDEMPRESA=?" : "";
    if (companyId) params.push(companyId);
    const data = await optional(db, `SELECT CDCLIENTE, COUNT(*) QTD, SUM(CASE WHEN STATUS=1 THEN 1 ELSE 0 END) CONV
      FROM ORCAMENTO WHERE DTCANCELAMENTO IS NULL AND STATUS IN (0,1,2) AND CDCLIENTE IN (${customers.map(() => "?").join(",")})${company}
      GROUP BY CDCLIENTE`, params);
    if (Array.isArray(data)) for (const row of data) history.set(Number(row.CDCLIENTE), row);
  }
  const stock = new Map();
  if (numbers.length) {
    const params = [...numbers];
    const company = companyId ? " AND op.IDEMPRESA=?" : "";
    if (companyId) params.push(companyId);
    const data = await optional(db, `SELECT op.NRORCAMENTO, op.IDEMPRESA,
      SUM(CASE WHEN COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO=op.CDPRODUTO),0)<=0 THEN 1 ELSE 0 END) SEM
      FROM ORCPROD op WHERE op.NRORCAMENTO IN (${numbers.map(() => "?").join(",")})${company}
      GROUP BY op.NRORCAMENTO, op.IDEMPRESA`, params);
    if (Array.isArray(data)) for (const row of data) stock.set(`${row.NRORCAMENTO}|${row.IDEMPRESA}`, row);
  }
  return quotes.map((quote) => {
    const past = history.get(Number(quote.customerId));
    const missing = stock.get(`${quote.number}|${quote.companyId}`);
    return {
      ...quote,
      historicoOrcamentos: past ? Number(past.QTD || 0) : null,
      historicoConvertidos: past ? Number(past.CONV || 0) : null,
      semEstoque: missing ? Number(missing.SEM || 0) : 0,
    };
  });
}

export async function listSellers(db) {
  const data = await optional(db, "SELECT CDVENDEDOR, VENDEDOR, TELEFONE, CELULAR FROM VENDEDOR ORDER BY VENDEDOR", []);
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    id: Number(row.CDVENDEDOR),
    nome: row.VENDEDOR,
    telefone: String(row.CELULAR || row.TELEFONE || "").replace(/\D/g, ""),
  }));
}

async function leitura(report) {
  const raw = await ollamaChat({
    messages: [
      { role: "system", content: "Resuma em no máximo duas frases curtas, só com o que está na lista. Não crie número, percentual, nome ou causa. Se não houver o que dizer, responda: sem leitura." },
      { role: "user", content: JSON.stringify({ observacoes: report.observacoes, prioridades: report.prioridades }) },
    ],
    temperature: 0,
    maxTokens: 280,
  });
  const texto = String(raw || "").trim();
  if (!texto || !narrativeAccepts(texto, report) || /^sem leitura\.?$/i.test(texto) || /dado indisponível/i.test(texto)) return { fonte: "regras", texto: null };
  return { fonte: "ollama", texto };
}

export async function runBreakfast({ companyId = null, depositId = null, reference = null, now = new Date(), reason = "manual", send = false, user, settings = readSettings() } = {}) {
  assertBreakfastAccess(user || { permissao_gerencial: true, nome: "agenda" }, companyId, settings);
  const base = await withReadOnlyDatabase((db) => buildBreakfastReport(db, { companyId, depositId, reference, now, settings, fresh: true }));
  const draft = saveRun({ ...base, motivo: reason, em: new Date().toISOString(), entrega: null });
  const link = rememberLink(draft.id, settings.linkHoras);
  const baseUrl = (settings.baseUrl || process.env.DASHBOARD_PUBLIC_URL || "http://localhost:805").replace(/\/$/, "");
  draft.link = `${baseUrl}/?cafe=${link.token}`;
  draft.texto = renderMessage(draft);
  draft.leitura = await leitura(draft);
  upsertAlerts(draft.alertas, companyId);
  let entrega = { email: "desligado", whatsapp: "desligado", motivos: ["Envio não solicitado."], enviados: [] };
  if (send) {
    try { entrega = await deliverReport(draft, settings); }
    catch (error) { entrega = { email: "falha", whatsapp: "falha", motivos: [error.message], enviados: [] }; }
  }
  draft.entrega = entrega;
  const saved = saveRun(draft);
  return { report: saved, entrega };
}

export function sellerNotices(report, settings, now = new Date()) {
  if (!report || !settings.notificacaoIndividual?.ativo) return [];
  const parts = saoPauloParts(now);
  return (settings.vendedores || []).map((seller) => sellerMessage(seller, report, settings, parts));
}

export async function dispatchSellerNotices(report, settings, now = new Date()) {
  const notices = [];
  let plan = { whatsapp: "desligado" };
  try { plan = channelPlan(settings); } catch { plan = { whatsapp: "desligado" }; }
  for (const message of sellerNotices(report, settings, now)) {
    if (!message.enviar) { notices.push(message); continue; }
    if (!rememberSellerSend(message.chave)) {
      notices.push({ ...message, enviar: false, motivo: "Mensagem já registrada para este evento." });
      continue;
    }
    if (plan.whatsapp !== "real") {
      notices.push({ ...message, canal: "simulado", motivo: "Recado autorizado e registrado em simulação. O disparo real depende do canal liberado e do modelo aprovado." });
      continue;
    }
    try {
      const config = loadWhatsApp();
      await sendTemplate(config, message.telefone, settings.templateWhatsapp, [
        message.nome,
        String(message.quantidadeAberta ?? 0),
        report.link || "Abra o ERP no Charlie Daily",
      ], undefined, settings.templateIdioma || "pt_BR");
      notices.push({ ...message, canal: "real", motivo: "enviado" });
    } catch (error) {
      notices.push({ ...message, canal: "falha", motivo: error.message });
    }
  }
  return notices;
}

export function clearBreakfastCache() { cache.clear(); }
