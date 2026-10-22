import { query } from "../db.js";
import { assessCustomerInactivity, forecastSeries, forecastStock, projectCashFlow, simulateFinancialScenario, simulatePriceScenario } from "./charlie-predictive-engine.js";

const CACHE_TTL = Math.max(30000, Number(process.env.CHARLIE_PREDICTIVE_CACHE_MS) || 300000);
const cache = new Map();
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

async function cached(key, load) {
  const found = cache.get(key);
  if (found && Date.now() - found.at < CACHE_TTL) return structuredClone(found.value);
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  return structuredClone(value);
}

function scope(actor, alias = "se") {
  const clauses = [], params = [];
  if (Number(actor?.company) > 0) { clauses.push(`${alias}.IDEMPRESA=?`); params.push(Number(actor.company)); }
  // Filial só é aplicada quando o cadastro de sessão a fornece e a tabela possui o mesmo campo.
  if (Number(actor?.branch) > 0) { clauses.push(`${alias}.IDFILIAL=?`); params.push(Number(actor.branch)); }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
}

const timeout = { timeoutMs: Math.max(5000, Number(process.env.CHARLIE_PREDICTIVE_TIMEOUT_MS) || 25000) };

export async function revenueForecast(db, actor, options = {}) {
  const historyDays = Math.max(60, Math.min(1095, Number(options.historyDays) || 365));
  const horizon = Math.max(1, Math.min(366, Number(options.horizon) || 30));
  const company = scope(actor);
  const rows = await cached(`revenue:${actor?.company}:${actor?.branch}:${historyDays}`, () => query(db, `
    SELECT CAST(se.DTSAIDA AS DATE) DATA,
      COALESCE(SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)),0) VALOR
    FROM SAIDAESTOQUE se
    JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    WHERE se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE)
      AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
      AND COALESCE(se.STATUS,0) IN (1,3)${company.sql}
    GROUP BY CAST(se.DTSAIDA AS DATE) ORDER BY 1`, [-historyDays, ...company.params], timeout));
  return forecastSeries(rows, { dateField: "DATA", valueField: "VALOR", horizon, minimumRecords: 28 });
}

export async function cashFlowForecast(db, actor, options = {}) {
  const horizon = Math.max(1, Math.min(180, Number(options.horizon) || 30));
  // As tabelas financeiras legadas não têm um identificador uniforme de filial; o escopo
  // gerencial é imposto pela sessão e pelo usuário de banco somente leitura do Charlie.
  const [balanceRow] = await query(db, "SELECT COALESCE(SUM(COALESCE(VALOR,0)),0) TOTAL FROM MOV_BANCARIO", [], timeout);
  const receivables = await query(db, `SELECT CAST(t.DTVENC AS DATE) DATA,
      COALESCE(SUM(COALESCE(t.VALOR,0)-COALESCE(t.VLPAGO,0)-COALESCE(t.VLDESCONTO,0)),0) VALOR
    FROM CTARECEBER t WHERE t.STATUS=1 AND t.DTVENC BETWEEN CURRENT_DATE AND DATEADD(? DAY TO CURRENT_DATE)
    GROUP BY CAST(t.DTVENC AS DATE)`, [horizon], timeout);
  const payables = await query(db, `SELECT CAST(t.DTVENC AS DATE) DATA,
      COALESCE(SUM(COALESCE(t.VALOR,0)-COALESCE(t.VLPAGO,0)-COALESCE(t.VLDESCONTO,0)),0) VALOR
    FROM CTAPAGAR t WHERE t.STATUS=1 AND t.DTVENC BETWEEN CURRENT_DATE AND DATEADD(? DAY TO CURRENT_DATE)
    GROUP BY CAST(t.DTVENC AS DATE)`, [horizon], timeout);
  const normalize = (rows) => rows.map((row) => ({ date: row.DATA, value: row.VALOR }));
  const base = projectCashFlow({ openingBalance: balanceRow?.TOTAL, receivables: normalize(receivables), payables: normalize(payables), horizon, receiptRate: 0.95 });
  return {
    horizon,
    scenarios: {
      optimistic: projectCashFlow({ openingBalance: balanceRow?.TOTAL, receivables: normalize(receivables), payables: normalize(payables), horizon, receiptRate: 1, paymentRate: 1 }),
      base,
      conservative: projectCashFlow({ openingBalance: balanceRow?.TOTAL, receivables: normalize(receivables), payables: normalize(payables), horizon, receiptRate: 0.85, paymentRate: 1 }),
    },
    quality: { status: receivables.length || payables.length ? "adequada" : "limitada", records: receivables.length + payables.length },
    assumptions: ["Saldo bancário, títulos a receber e títulos a pagar são conceitos distintos.", "Cenário base considera recebimento de 95% no vencimento; conservador, 85%; otimista, 100%.", "A projeção não altera lançamentos."],
  };
}

export async function stockRiskForecast(db, actor, options = {}) {
  const historyDays = Math.max(30, Math.min(365, Number(options.historyDays) || 90));
  const company = scope(actor);
  const rows = await query(db, `SELECT FIRST 500 sp.CDPRODUTO,
      COALESCE(p.PRODUTO,sp.DESCRICAO,'Produto') PRODUTO,
      COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO=sp.CDPRODUTO),0) ESTOQUE,
      COALESCE(SUM(sp.QTDPRODUTO),0)/CAST(? AS NUMERIC(18,4)) DEMANDA_DIA,
      COALESCE((SELECT MAX(m.QTDEMINIMA) FROM MOVIMENTO m WHERE m.CDPRODUTO=sp.CDPRODUTO),0) ESTOQUE_MINIMO
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE) AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(sp.STATUSSE,0)=0${company.sql}
    GROUP BY sp.CDPRODUTO,p.PRODUTO,sp.DESCRICAO
    ORDER BY 4 DESC`, [historyDays, -historyDays, ...company.params], timeout);
  const items = rows.map((row) => ({ productId: row.CDPRODUTO, product: row.PRODUTO, onHand: row.ESTOQUE, reserved: 0, inbound: 0, dailyDemand: row.DEMANDA_DIA, leadTimeDays: Number(options.leadTimeDays) || 15, minimumStock: row.ESTOQUE_MINIMO }));
  return { generatedAt: new Date().toISOString(), items: forecastStock(items, { safetyDays: options.safetyDays ?? 7 }), quality: { status: rows.length >= 10 ? "adequada" : rows.length ? "limitada" : "insuficiente", records: rows.length }, assumptions: ["Reservas, compras em trânsito e lead time são considerados zero/padrão quando não há cadastro estruturado disponível.", "Dias de cobertura são estimativas, não uma data certa de ruptura."] };
}

export async function customerInactivityForecast(db, actor, options = {}) {
  const historyDays = Math.max(180, Math.min(1095, Number(options.historyDays) || 365));
  const company = scope(actor);
  const rows = await query(db, `SELECT FIRST 500 se.CDCLIENTE, COALESCE(c.CLIENTE,se.CLIENTE,'Cliente') CLIENTE,
      MAX(se.DTSAIDA) ULTIMA_COMPRA, COUNT(DISTINCT CAST(se.DTSAIDA AS DATE)) DIAS_COMPRA,
      COALESCE(SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)),0) VALOR
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
    WHERE se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE) AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0${company.sql}
    GROUP BY se.CDCLIENTE,c.CLIENTE,se.CLIENTE HAVING COUNT(DISTINCT CAST(se.DTSAIDA AS DATE))>=2
    ORDER BY 5 DESC`, [-historyDays, ...company.params], timeout);
  const customers = rows.map((row) => ({ customerId: row.CDCLIENTE, customer: row.CLIENTE, lastPurchase: row.ULTIMA_COMPRA, value: n(row.VALOR), intervals: Array(Math.max(0, n(row.DIAS_COMPRA) - 1)).fill(historyDays / Math.max(1, n(row.DIAS_COMPRA) - 1)) }));
  return { generatedAt: new Date().toISOString(), customers: assessCustomerInactivity(customers).slice(0, 100), quality: { status: rows.length >= 10 ? "adequada" : rows.length ? "limitada" : "insuficiente", records: rows.length }, assumptions: ["A classificação compara o tempo desde a última compra ao intervalo histórico médio.", "Não é exibida probabilidade numérica porque o modelo não foi calibrado como classificador probabilístico."] };
}

export async function priceSimulation(db, actor, input = {}) {
  const ids = [...new Set((input.productIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
  if (!ids.length) throw Object.assign(new Error("Informe ao menos um produto para a simulação."), { status: 400 });
  const marks = ids.map(() => "?").join(",");
  const rows = await query(db, `SELECT p.CDPRODUTO, p.PRODUTO,
      COALESCE((SELECT FIRST 1 pp.PRECO FROM PRODUTOPRECO pp WHERE pp.CDPRODUTO=p.CDPRODUTO ORDER BY pp.IDPRECO),0) PRECO,
      COALESCE(p.VLCUSTOMEDIO,0) CUSTO FROM PRODUTO p WHERE p.CDPRODUTO IN (${marks})`, ids, timeout);
  const items = rows.map((row) => ({ productId: row.CDPRODUTO, product: row.PRODUTO, price: row.PRECO, cost: row.CUSTO, variableExpense: n(input.variableExpensePerUnit), quantity: n(input.quantity) || 1 }));
  return simulatePriceScenario(items, input);
}

export function financialSimulation(cashForecast, input = {}) {
  return { scenarios: Object.fromEntries(Object.entries(cashForecast.scenarios).map(([key, scenario]) => [key, simulateFinancialScenario(scenario.projection, input.adjustments || [])])), assumptions: [...cashForecast.assumptions, "Ajustes de cenário são mantidos fora dos lançamentos reais."] };
}

export function clearPredictiveCache() { cache.clear(); }
