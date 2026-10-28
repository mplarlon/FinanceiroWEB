import { query } from "../db.js";
import { saleItemCost } from "./sale-cost.js";
import { ITEM_VALOR_SQL } from "./charlie-sale-value.js";

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value) => Math.round((n(value) + Number.EPSILON) * 100) / 100;

export const IMPACT_TYPES = Object.freeze({
  VERIFIED_LOSS: "perda_verificada",
  INSUFFICIENT_MARGIN: "margem_insuficiente",
  FINANCIAL_RISK: "risco_financeiro",
  TIED_CAPITAL: "capital_imobilizado",
  SAVING_OPPORTUNITY: "oportunidade_economia",
});

export function allocateAmount(total, items, basis = "revenue") {
  const amount = n(total);
  const weights = (items || []).map((item) => Math.max(0, n(item?.[basis])));
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  if (!amount || !items?.length) return (items || []).map(() => 0);
  if (!denominator) return items.map(() => round(amount / items.length));
  let allocated = 0;
  return items.map((_, index) => {
    if (index === items.length - 1) return round(amount - allocated);
    const value = round(amount * weights[index] / denominator);
    allocated = round(allocated + value);
    return value;
  });
}

export function calculateProfitability(input = {}, policy = {}) {
  const quantity = n(input.quantity);
  const grossRevenue = round(input.grossRevenue ?? n(input.unitPrice) * quantity);
  const discount = round(input.discount);
  const returns = round(input.returns);
  const taxes = round(input.taxes);
  const freightPaid = round(input.freightPaid);
  const freightCharged = round(input.freightCharged);
  const commission = round(input.commission);
  const otherVariableCosts = round(input.otherVariableCosts);
  const netRevenue = round(grossRevenue - discount - returns);
  const unitCost = input.historicalUnitCost == null ? n(input.currentUnitCost) : n(input.historicalUnitCost);
  const cogs = round(input.cogs ?? unitCost * quantity);
  const grossMargin = round(netRevenue - cogs);
  const variableExpenses = round(taxes + commission + Math.max(0, freightPaid - freightCharged) + otherVariableCosts);
  const contributionMargin = round(grossMargin - variableExpenses);
  const marginPercent = netRevenue ? round(contributionMargin / netRevenue * 100) : null;
  const missing = [];
  if (input.historicalUnitCost == null) missing.push("custo_historico");
  for (const [field, label] of [["taxesAvailable", "tributos"], ["commissionAvailable", "comissao"], ["freightAvailable", "frete"]]) {
    if (input[field] === false) missing.push(label);
  }
  const minimumMargin = n(policy.minimumMarginPercent ?? 0);
  const classification = contributionMargin < 0
    ? IMPACT_TYPES.VERIFIED_LOSS
    : marginPercent != null && marginPercent < minimumMargin
      ? IMPACT_TYPES.INSUFFICIENT_MARGIN
      : null;
  return {
    grossRevenue, discount, returns, netRevenue, cogs, grossMargin,
    taxes, commission, freightPaid, freightCharged, otherVariableCosts,
    variableExpenses, contributionMargin, marginPercent, classification,
    costSource: input.historicalUnitCost == null ? "custo_atual_estimado" : "custo_historico_item",
    complete: missing.length === 0,
    missing,
    disclaimer: "Margem de contribuição não equivale ao lucro líquido da empresa.",
  };
}

export function robustAnomaly(values, current, threshold = 3) {
  const clean = (values || []).map(n).filter((value) => Number.isFinite(value));
  if (clean.length < 4) return { anomalous: false, score: null, reason: "historico_insuficiente" };
  const sorted = [...clean].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  if (!mad) return { anomalous: n(current) !== median, score: n(current) === median ? 0 : null, reason: "historico_sem_variacao", median };
  const score = round(0.6745 * (n(current) - median) / mad);
  return { anomalous: Math.abs(score) >= n(threshold), score, median, method: "z_score_modificado_mad" };
}

function scope(actor = {}) {
  const company = Number(actor.company);
  return Number.isInteger(company) && company > 0 ? company : null;
}

export function idleProducts(candidates, soldIds) {
  const sold = soldIds instanceof Set ? soldIds : new Set((soldIds || []).map((id) => String(id)));
  return (candidates || [])
    .filter((row) => !sold.has(String(row.CDPRODUTO)))
    .map((row) => ({ ...row, ULTIMA_VENDA: null }));
}

export async function profitabilityDashboard(db, actor = {}, options = {}) {
  const days = Math.min(365, Math.max(1, Number(options.days) || 30));
  const idleDays = Math.min(730, Math.max(7, Number(options.idleDays) || 90));
  const minimumMargin = Math.min(100, Math.max(-100, Number(options.minimumMargin) || 15));
  const company = scope(actor);
  const companySql = company ? " AND se.IDEMPRESA=?" : "";
  const params = company ? [-days, company] : [-days];
  const custoItem = await saleItemCost(db, "sp", null);
  const rows = await query(db, `
    SELECT se.NRPEDIDO VENDA, se.IDEMPRESA, se.DTSAIDA DATA, se.CDCLIENTE,
      COALESCE(c.CLIENTE,c.RAZAO,'Cliente') CLIENTE, se.CDVENDEDOR,
      COALESCE(v.VENDEDOR,'Sem vendedor') VENDEDOR, sp.CDPRODUTO,
      COALESCE(p.PRODUTO,sp.DESCRICAO,'Produto') PRODUTO, sp.QTDPRODUTO QUANTIDADE,
      ${ITEM_VALOR_SQL} RECEITA,
      COALESCE(sp.DESCONTO,0) DESCONTO,
      COALESCE(sp.QTDPRODUTO,0)*${custoItem} CUSTO,
      CASE WHEN ${custoItem}>0 THEN 1 ELSE 0 END CUSTO_HISTORICO,
      COALESCE(sp.VLICMS,0)+COALESCE(sp.VLST,0) TRIBUTOS,
      COALESCE(sp.VLCOMISSAO,0) COMISSAO,
      COALESCE(se.FRETE,0) FRETE_COBRADO,
      COALESCE(se.FRETE_CT,0) FRETE_PAGO
    FROM SAIDAESTOQUE se
    JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR
    WHERE se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE)${companySql}
      AND se.DTCANCELAMENTO IS NULL AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0) AND COALESCE(sp.STATUSSE,0)=0
    ORDER BY se.DTSAIDA DESC`, params, { timeoutMs: 60000 });

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.IDEMPRESA}:${row.VENDA}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const occurrences = [];
  let receitaIncompleta = 0;
  for (const saleRows of grouped.values()) {
    if (saleRows.some((row) => row.RECEITA == null)) {
      receitaIncompleta += 1;
      continue;
    }
    const freightPaid = allocateAmount(saleRows[0].FRETE_PAGO, saleRows.map((row) => ({ revenue: row.RECEITA })));
    const freightCharged = allocateAmount(saleRows[0].FRETE_COBRADO, saleRows.map((row) => ({ revenue: row.RECEITA })));
    saleRows.forEach((row, index) => {
      const calc = calculateProfitability({
        quantity: row.QUANTIDADE, grossRevenue: n(row.RECEITA) + n(row.DESCONTO), discount: row.DESCONTO,
        cogs: row.CUSTO, historicalUnitCost: row.CUSTO_HISTORICO ? n(row.CUSTO) / Math.max(1, n(row.QUANTIDADE)) : null,
        taxes: row.TRIBUTOS, commission: row.COMISSAO,
        freightPaid: freightPaid[index], freightCharged: freightCharged[index],
        taxesAvailable: true, commissionAvailable: true, freightAvailable: true,
      }, { minimumMarginPercent: minimumMargin });
      if (!calc.classification) return;
      occurrences.push({
        id: `${row.IDEMPRESA}-${row.VENDA}-${row.CDPRODUTO}`, type: calc.classification,
        severity: calc.contributionMargin < 0 ? "critico" : "atencao",
        sale: row.VENDA, company: row.IDEMPRESA, date: row.DATA, customerId: row.CDCLIENTE,
        customer: row.CLIENTE, sellerId: row.CDVENDEDOR, seller: row.VENDEDOR,
        productId: row.CDPRODUTO, product: row.PRODUTO, quantity: n(row.QUANTIDADE),
        ...calc,
        evidence: ["SAIDAESTOQUE", "SAIDAPRODUTO", "PRODUTO", "CLIENTE", "VENDEDOR"],
      });
    });
  }

  const idleCompany = company ? " AND m.CDDEPOSITO IN (SELECT d.CDDEPOSITO FROM DEPOSITO d WHERE d.IDEMPRESA=?)" : "";
  let idleStock = [];
  try {
    const candidates = await query(db, `
      SELECT m.CDPRODUTO, p.PRODUTO, SUM(m.QTDEATUAL) QUANTIDADE,
        COALESCE(p.VLCUSTOMEDIO,0) CUSTO_AVALIACAO,
        SUM(m.QTDEATUAL)*COALESCE(p.VLCUSTOMEDIO,0) CAPITAL_IMOBILIZADO
      FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
      WHERE COALESCE(p.INATIVO,0)=0${idleCompany}
      GROUP BY m.CDPRODUTO,p.PRODUTO,p.VLCUSTOMEDIO
      HAVING SUM(m.QTDEATUAL)>0
      ORDER BY 5 DESC`, company ? [company] : [], { timeoutMs: 45000 });
    const saleScope = company ? " AND se.IDEMPRESA=?" : "";
    const sold = candidates.length ? await query(db, `SELECT DISTINCT sp.CDPRODUTO
      FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se
        ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
      WHERE se.DTCANCELAMENTO IS NULL
        AND se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE)${saleScope}`,
      company ? [-idleDays, company] : [-idleDays], { timeoutMs: 45000 }) : [];
    idleStock = idleProducts(candidates, sold.map((row) => row.CDPRODUTO));
  } catch { idleStock = []; }

  const negative = occurrences.filter((item) => item.type === IMPACT_TYPES.VERIFIED_LOSS);
  const insufficient = occurrences.filter((item) => item.type === IMPACT_TYPES.INSUFFICIENT_MARGIN);
  const tiedCapital = round(idleStock.reduce((sum, row) => sum + n(row.CAPITAL_IMOBILIZADO), 0));
  const aggregate = (key) => [...occurrences.reduce((map, item) => {
    const label = String(item[key] ?? "Não informado");
    const current = map.get(label) || { label, occurrences: 0, negativeResult: 0, netRevenue: 0, contribution: 0 };
    current.occurrences += 1;
    current.negativeResult = round(current.negativeResult + Math.abs(Math.min(0, item.contributionMargin)));
    current.netRevenue = round(current.netRevenue + item.netRevenue);
    current.contribution = round(current.contribution + item.contributionMargin);
    map.set(label, current);
    return map;
  }, new Map()).values()].sort((a, b) => b.negativeResult - a.negativeResult);
  const monthly = occurrences.reduce((map, occurrence) => {
    const parsedDate = new Date(occurrence.date);
    const month = Number.isNaN(parsedDate.getTime()) ? "Sem data" : parsedDate.toISOString().slice(0, 7);
    const current = map.get(month) || { label: month, occurrences: 0, negativeResult: 0, contribution: 0 };
    current.occurrences += 1;
    current.negativeResult = round(current.negativeResult + Math.abs(Math.min(0, occurrence.contributionMargin)));
    current.contribution = round(current.contribution + occurrence.contributionMargin);
    map.set(month, current);
    return map;
  }, new Map());
  return {
    generatedAt: new Date().toISOString(), period: { days, idleDays }, criteria: { minimumMarginPercent: minimumMargin },
    indicators: {
      verifiedNegativeResult: round(negative.reduce((sum, item) => sum + Math.abs(Math.min(0, item.contributionMargin)), 0)),
      negativeSales: negative.length, insufficientMarginSales: insufficient.length,
      tiedCapital, idleProducts: idleStock.length, criticalOccurrences: negative.length,
    },
    occurrences, idleStock,
    analytics: {
      monthly: [...monthly.values()].sort((a, b) => a.label.localeCompare(b.label)),
      products: aggregate("product").slice(0, 20),
      customers: aggregate("customer").slice(0, 20),
      sellers: aggregate("seller").slice(0, 20),
      types: aggregate("type"),
    },
    limitations: [
      "O resultado é margem de contribuição estimada, não lucro líquido.",
      "Capital imobilizado não é prejuízo realizado.",
      "Custos ausentes no item não são substituídos silenciosamente pelo custo atual.",
      "Campanhas e autorizações comerciais dependem de cadastro estruturado para validação automática.",
      "No estoque parado, ausência de última venda significa que não houve venda no período analisado; a data histórica anterior não é inferida.",
      ...(receitaIncompleta ? ["Há item sem valor. Essa venda não entrou na margem."] : []),
    ],
  };
}

export function investigateOccurrence(occurrence) {
  if (!occurrence) return null;
  return {
    title: occurrence.type === IMPACT_TYPES.VERIFIED_LOSS
      ? "🔴 Venda com contribuição negativa identificada."
      : "🟠 Venda com margem abaixo do limite.",
    composition: {
      receitaLiquida: occurrence.netRevenue, custoMercadoria: occurrence.cogs,
      margemBruta: occurrence.grossMargin, tributos: occurrence.taxes,
      comissao: occurrence.commission, freteLiquido: round(occurrence.freightPaid - occurrence.freightCharged),
      margemContribuicao: occurrence.contributionMargin, percentual: occurrence.marginPercent,
    },
    evidence: occurrence.evidence,
    missing: occurrence.missing,
    explanation: `A receita líquida de ${occurrence.netRevenue} menos o custo de ${occurrence.cogs} e despesas variáveis de ${occurrence.variableExpenses} resulta em contribuição de ${occurrence.contributionMargin}.`,
    disclaimer: occurrence.disclaimer,
  };
}
