import { query } from "../db.js";

export const PURCHASE_DEMAND_SOURCE = "SAIDAESTOQUE/SAIDAPRODUTO";
export const PURCHASE_MOVEMENT_SOURCE = "MOV_PRODUTO";
export const PURCHASE_ENTRY_SOURCES = ["ENTRESTOQUE", "ENTRPRODUTO"];

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const limitFrom = (text, fallback = 15) => {
  const value = Number(normalize(text).match(/\b(?:top|primeiros?|listar?)\s+(\d{1,2})\b/)?.[1] || fallback);
  return Math.max(1, Math.min(50, value));
};

export function detectPurchaseIntent(question) {
  const text = normalize(question);
  const limit = limitFrom(text);
  const days = Math.max(1, Math.min(180, Number(text.match(/\b(\d{1,3})\s+dias\b/)?.[1] || 15)));

  if (/ordens? de compra|\bocs?\b/.test(text) && /pendent|abert|atrasad|fornecedor/.test(text))
    return { type: "compras_oc_pendente", limit };
  if (/curva\s*(?:abc|[abcd])|classificacao abc|classe\s*[abcd]/.test(text))
    return { type: "compras_curva_abc", limit };
  if (/sugestao de compras?|o que (?:eu )?(?:preciso )?comprar|o que repor|lista de compras|repor estoque|comprar hoje|necessidade de compra/.test(text))
    return { type: "compras_sugestao", limit, coverageDays: days };
  const ruptureHorizon = /\brupturas?\b/.test(text) && /\b\d{1,3}\s+dias\b/.test(text);
  if (/risco de ruptura|vai faltar|cobertura de estoque|baixo estoque.*curva|curva.*baixo estoque/.test(text) || ruptureHorizon)
    return { type: "compras_cobertura", limit, coverageDays: days };
  return null;
}

const number = (value) => Number(value || 0);
const amount = (value, digits = 1) => number(value).toLocaleString("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: digits,
});

async function purchaseSuggestions(db, intent) {
  const targetDays = intent.coverageDays || 15;
  const stockRows = await query(db, `
    SELECT
      p.CDPRODUTO AS CODIGO,
      p.PRODUTO,
      p.FORNECEDOR AS FORNECEDOR,
      p.GRUPO AS GRUPO,
      SUM(COALESCE(m.QTDEATUAL, 0)) AS ESTOQUE_ATUAL,
      SUM(COALESCE(m.QTDEMINIMA, 0)) AS ESTOQUE_MINIMO,
      SUM(COALESCE(m.QTDEMAXIMA, 0)) AS ESTOQUE_MAXIMO,
      COALESCE(p.VLCUSTOMEDIO, 0) AS CUSTO_CADASTRO
    FROM PRODUTO p
    JOIN MOVIMENTO m ON m.CDPRODUTO = p.CDPRODUTO
    JOIN DEPOSITO d ON d.CDDEPOSITO = m.CDDEPOSITO
      AND COALESCE(d.INATIVO, 0) = 0
    WHERE COALESCE(p.INATIVO, 0) = 0 AND COALESCE(p.INATIVOCOMPRA, 0) = 0
    GROUP BY p.CDPRODUTO, p.PRODUTO, p.FORNECEDOR, p.GRUPO,
      p.VLCUSTOMEDIO
  `);
  const salesDemandRows = await query(db, `
      SELECT sp.CDPRODUTO AS CODIGO, SUM(COALESCE(sp.QTDPRODUTO, 0)) AS QTD_90
      FROM SAIDAPRODUTO sp
      JOIN SAIDAESTOQUE se ON se.NRPEDIDO = sp.NRPEDIDO AND se.IDEMPRESA = sp.IDEMPRESA
      WHERE se.DTSAIDA >= DATEADD(-90 DAY TO CURRENT_DATE)
        AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE, 0) = 0
      GROUP BY sp.CDPRODUTO
    `);
  const movementDemandRows = await query(db, `
      SELECT mp.CDPRODUTO AS CODIGO, SUM(COALESCE(mp.QTSAIDA, 0)) AS QTD_90
      FROM ${PURCHASE_MOVEMENT_SOURCE} mp
      JOIN DEPOSITO md ON md.CDDEPOSITO = mp.CDDEPOSITO
        AND md.IDEMPRESA = mp.IDEMPRESA AND COALESCE(md.INATIVO, 0) = 0
      WHERE mp.DTMOVIMENTO >= DATEADD(-90 DAY TO CURRENT_DATE)
        AND COALESCE(mp.QTSAIDA, 0) > 0
      GROUP BY mp.CDPRODUTO
    `);
  const pendingRows = await query(db, `
      SELECT op.CDPRODUTO AS CODIGO,
        SUM(CASE
          WHEN COALESCE(op.QTDE, 0) - COALESCE(rec.QTD_RECEBIDA, 0) > 0
          THEN COALESCE(op.QTDE, 0) - COALESCE(rec.QTD_RECEBIDA, 0)
          ELSE 0
        END) AS QTD_PENDENTE
      FROM ORDEMCOMPRAPROD op
      JOIN ORDEMCOMPRA o ON o.CDORDEM = op.CDORDEM AND o.IDEMPRESA = op.IDEMPRESA
      LEFT JOIN (
        SELECT ee.CDORDEM, ep.IDEMPRESA, ep.CDPRODUTO,
          SUM(COALESCE(ep.QTDE, 0)) AS QTD_RECEBIDA
        FROM ENTRESTOQUE ee
        JOIN ENTRPRODUTO ep ON ep.IDENTRADA = ee.IDENTRADA AND ep.IDEMPRESA = ee.IDEMPRESA
        WHERE ee.CDORDEM IS NOT NULL AND ee.DTCANCELAMENTO IS NULL
        GROUP BY ee.CDORDEM, ep.IDEMPRESA, ep.CDPRODUTO
      ) rec ON rec.CDORDEM = op.CDORDEM AND rec.IDEMPRESA = op.IDEMPRESA
        AND rec.CDPRODUTO = op.CDPRODUTO
      WHERE o.STATUS = 1
      GROUP BY op.CDPRODUTO
    `);
  const entryRows = await query(db, `
      SELECT ep.CDPRODUTO AS CODIGO,
        SUM(COALESCE(ep.QTDE, 0)) AS QTD_COMPRADA_180,
        MAX(ee.DTENTRADA) AS ULTIMA_ENTRADA,
        SUM(COALESCE(NULLIF(ep.VLCUSTO, 0), ep.VLUNIT, 0) * COALESCE(ep.QTDE, 0))
          / NULLIF(SUM(COALESCE(ep.QTDE, 0)), 0) AS CUSTO_MEDIO_ENTRADA
      FROM ENTRESTOQUE ee
      JOIN ENTRPRODUTO ep ON ep.IDENTRADA = ee.IDENTRADA AND ep.IDEMPRESA = ee.IDEMPRESA
      WHERE ee.DTENTRADA >= DATEADD(-180 DAY TO CURRENT_DATE)
        AND ee.DTCANCELAMENTO IS NULL
      GROUP BY ep.CDPRODUTO
    `);
  const packageRows = await query(db, `
      SELECT CDPRODUTO AS CODIGO, MAX(COALESCE(QTDE_EMBALAGEM, 1)) AS QTD_EMBALAGEM
      FROM PRODUTO_CODFORN GROUP BY CDPRODUTO
    `);

  const byCode = (rows) => new Map(rows.map((row) => [String(row.CODIGO), row]));
  const salesDemand = byCode(salesDemandRows);
  const movementDemand = byCode(movementDemandRows);
  const pending = byCode(pendingRows);
  const entries = byCode(entryRows);
  const packages = byCode(packageRows);
  const rows = stockRows.map((row) => {
    const code = String(row.CODIGO);
    const entry = entries.get(code) || {};
    return {
      ...row,
      FORNECEDOR: String(row.FORNECEDOR || "").trim() || "SEM FORNECEDOR",
      GRUPO: String(row.GRUPO || "").trim() || "SEM GRUPO",
      SAIDAS_90_DIAS: number(salesDemand.get(code)?.QTD_90) || number(movementDemand.get(code)?.QTD_90),
      FONTE_DEMANDA: number(salesDemand.get(code)?.QTD_90) > 0 ? PURCHASE_DEMAND_SOURCE : PURCHASE_MOVEMENT_SOURCE,
      QTD_JA_PEDIDA: number(pending.get(code)?.QTD_PENDENTE),
      QTD_COMPRADA_180_DIAS: number(entry.QTD_COMPRADA_180),
      ULTIMA_ENTRADA: entry.ULTIMA_ENTRADA || null,
      QTD_EMBALAGEM: Math.max(1, number(packages.get(code)?.QTD_EMBALAGEM)),
      CUSTO_MEDIO: number(entry.CUSTO_MEDIO_ENTRADA) || number(row.CUSTO_CADASTRO),
    };
  });

  const calculated = rows.map((row) => {
    const daily = number(row.SAIDAS_90_DIAS) / 90;
    const stock = number(row.ESTOQUE_ATUAL);
    const pending = number(row.QTD_JA_PEDIDA);
    const target = Math.max(number(row.ESTOQUE_MAXIMO), number(row.ESTOQUE_MINIMO), daily * targetDays);
    const pack = Math.max(1, number(row.QTD_EMBALAGEM));
    const buy = Math.max(0, Math.ceil(Math.max(0, target - stock - pending) / pack) * pack);
    return {
      ...row,
      COBERTURA_DIAS: daily > 0 ? Math.round((Math.max(0, stock) / daily) * 10) / 10 : null,
      ESTOQUE_ALVO: Math.round(target * 10) / 10,
      QTDE_COMPRAR: buy,
      CUSTO_ESTIMADO: Math.round(buy * number(row.CUSTO_MEDIO) * 100) / 100,
      PRIORIDADE: stock <= 0 || (daily > 0 && stock / daily < 5) ? "ALTA" : "MEDIA",
    };
  });
  const atRiskOnly = intent.type === "compras_cobertura";
  const ranked = calculated.filter((row) => {
    if (!atRiskOnly) return row.QTDE_COMPRAR > 0;
    if (number(row.ESTOQUE_ATUAL) <= 0) return true;
    return row.COBERTURA_DIAS != null && row.COBERTURA_DIAS <= targetDays;
  }).sort((a, b) => {
    if (atRiskOnly) {
      const rank = (row) => row.COBERTURA_DIAS == null ? 100000 : row.COBERTURA_DIAS;
      return rank(a) - rank(b) || number(a.ESTOQUE_ATUAL) - number(b.ESTOQUE_ATUAL);
    }
    if (a.PRIORIDADE !== b.PRIORIDADE) return a.PRIORIDADE === "ALTA" ? -1 : 1;
    const coverageA = a.COBERTURA_DIAS == null ? 999999 : a.COBERTURA_DIAS;
    const coverageB = b.COBERTURA_DIAS == null ? 999999 : b.COBERTURA_DIAS;
    return coverageA - coverageB || b.QTDE_COMPRAR - a.QTDE_COMPRAR;
  });
  return { rows: ranked.slice(0, intent.limit), total: ranked.length };
}

export async function answerPurchaseQuestion(db, intent) {
  if (intent.negativeTimeline && intent.productCodes?.length) {
    const codes = intent.productCodes.slice(0, 50);
    const placeholders = codes.map(() => "?").join(",");
    const days = Math.max(1, Math.min(180, Number(intent.coverageDays) || 15));
    const products = await query(db, `SELECT p.CDPRODUTO AS CODIGO,p.PRODUTO,
      SUM(COALESCE(m.QTDEATUAL,0)) AS SALDO_ATUAL
      FROM PRODUTO p JOIN MOVIMENTO m ON m.CDPRODUTO=p.CDPRODUTO
      JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0
      WHERE p.CDPRODUTO IN (${placeholders})
      GROUP BY p.CDPRODUTO,p.PRODUTO`, codes);
    const outputs = await query(db, `SELECT sp.CDPRODUTO AS CODIGO,CAST(se.DTSAIDA AS DATE) AS DATA,
      SUM(COALESCE(sp.QTDPRODUTO,0)) AS QUANTIDADE
      FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
      WHERE sp.CDPRODUTO IN (${placeholders}) AND se.DTSAIDA>=DATEADD(-${days} DAY TO CURRENT_DATE)
        AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
      GROUP BY sp.CDPRODUTO,CAST(se.DTSAIDA AS DATE)`, codes);
    const inputs = await query(db, `SELECT ep.CDPRODUTO AS CODIGO,CAST(ee.DTENTRADA AS DATE) AS DATA,
      SUM(COALESCE(ep.QTDE,0)) AS QUANTIDADE
      FROM ENTRPRODUTO ep JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA
      WHERE ep.CDPRODUTO IN (${placeholders}) AND ee.DTENTRADA>=DATEADD(-${days} DAY TO CURRENT_DATE)
        AND ee.DTCANCELAMENTO IS NULL
      GROUP BY ep.CDPRODUTO,CAST(ee.DTENTRADA AS DATE)`, codes);
    const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
    const movementMap = new Map();
    for (const row of inputs) movementMap.set(`${row.CODIGO}|${dateKey(row.DATA)}`, number(row.QUANTIDADE));
    for (const row of outputs) {
      const key = `${row.CODIGO}|${dateKey(row.DATA)}`;
      movementMap.set(key, number(movementMap.get(key)) - number(row.QUANTIDADE));
    }
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const data = products.map((product) => {
      let closing = number(product.SALDO_ATUAL);
      let transition = null;
      let oldestOpening = closing;
      for (let offset = 0; offset < days; offset += 1) {
        const date = new Date(end); date.setDate(end.getDate() - offset);
        const key = date.toISOString().slice(0, 10);
        const opening = closing - number(movementMap.get(`${product.CODIGO}|${key}`));
        if (opening >= 0 && closing < 0)
          transition = { date: key, before: opening, after: closing };
        closing = opening;
        oldestOpening = opening;
      }
      return {
        CODIGO: product.CODIGO,
        PRODUTO: product.PRODUTO,
        DATA_NEGATIVOU: transition?.date || null,
        SALDO_ANTES: transition?.before ?? oldestOpening,
        SALDO_APOS: transition?.after ?? number(product.SALDO_ATUAL),
        SITUACAO: transition ? "FICOU NEGATIVO NO PERIODO" : oldestOpening < 0 ? "JA ESTAVA NEGATIVO NO INICIO" : number(product.SALDO_ATUAL) < 0 ? "NEGATIVOU SEM MOVIMENTO IDENTIFICADO" : "NAO FICOU NEGATIVO",
      };
    });
    const transitions = data.filter((row) => row.SITUACAO === "FICOU NEGATIVO NO PERIODO");
    const alreadyNegative = data.filter((row) => row.SITUACAO === "JA ESTAVA NEGATIVO NO INICIO").length;
    const transitionSummary = transitions.length
      ? ` ${transitions.map((row) => `O produto ${row.CODIGO} ficou negativo em ${row.DATA_NEGATIVOU}, passando de ${amount(row.SALDO_ANTES)} para ${amount(row.SALDO_APOS)}.`).join(" ")}`
      : " Nenhum produto cruzou de saldo positivo para negativo dentro do período.";
    return {
      resposta: `Reconstruí o saldo diário dos ${data.length} produtos exibidos usando as saídas e entradas dos últimos ${days} dias. ${alreadyNegative} já estavam negativos no início do período e ${transitions.length} ficou negativo durante o período.${transitionSummary}`,
      intencao: { ...intent, negativeTimeline: false }, dados: data,
      sugestoes: ["risco de ruptura em 30 dias", "o que preciso comprar hoje?", "ordens de compra pendentes"],
    };
  }
  if (intent.explainCalculation) {
    const days = intent.coverageDays || 15;
    return {
      resposta: `Para calcular ruptura em ${days} dias no MIAUTOMEC, o Charlie soma as vendas válidas de SAIDAESTOQUE/SAIDAPRODUTO nos últimos 90 dias e divide por 90 para obter a demanda média diária. MOV_PRODUTO é usado apenas como fonte complementar quando não houver venda registrada para o produto. Depois calcula a cobertura: estoque atual ÷ demanda média diária. A necessidade de compra é o maior valor entre estoque máximo, estoque mínimo e demanda para ${days} dias, menos o estoque atual e menos o saldo ainda não recebido das ordens abertas. O resultado é arredondado para o múltiplo de embalagem do fornecedor. Vendas e entradas canceladas não entram no cálculo. Prioridade alta significa estoque zerado ou cobertura inferior a 5 dias.`,
      intencao: { ...intent, explainCalculation: false },
      dados: [],
      sugestoes: ["risco de ruptura em 30 dias", "o que preciso comprar hoje?", "ordens de compra pendentes"],
    };
  }
  if (intent.type === "compras_curva_abc") {
    const data = await query(db, `SELECT FIRST ${intent.limit} CURVA,CDPRODUTO AS CODIGO,PRODUTO,
      SUM(COALESCE(QTDEATUAL,0)) ESTOQUE_ATUAL,SUM(COALESCE(VALORTOTAL,0)) VALOR_ESTOQUE,
      MAX(COALESCE(PERCENTUAL,0)) PARTICIPACAO_PERCENTUAL
      FROM T_CURVA_ABC GROUP BY CURVA,CDPRODUTO,PRODUTO
      ORDER BY CURVA,VALOR_ESTOQUE DESC`);
    return { resposta: `Curva ABC: encontrei ${data.length} item(ns) prioritários, ordenados por curva e valor em estoque.`, intencao: intent, dados: data,
      sugestoes: ["sugestão de compras", "risco de ruptura em 15 dias", "ordens de compra pendentes"] };
  }

  if (intent.type === "compras_oc_pendente") {
    const data = await query(db, `SELECT FIRST ${intent.limit} o.CDORDEM AS ORDEM_COMPRA,o.DATA,
      COALESCE(f.FORNECEDOR,f.FANTASIA,'SEM FORNECEDOR') FORNECEDOR,
      COUNT(*) ITENS,SUM(COALESCE(op.QTDE,0)) QUANTIDADE,SUM(COALESCE(op.VLTOT,op.QTDE*op.VLUNIT,0)) TOTAL,
      DATEADD(COALESCE(o.PRAZO,0) DAY TO o.DATA) PREVISAO
      FROM ORDEMCOMPRA o JOIN ORDEMCOMPRAPROD op ON op.CDORDEM=o.CDORDEM AND op.IDEMPRESA=o.IDEMPRESA
      LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=o.CDFORNECEDOR
      WHERE o.STATUS=1 GROUP BY o.CDORDEM,o.DATA,f.FORNECEDOR,f.FANTASIA,o.PRAZO
      ORDER BY PREVISAO,o.DATA`);
    return { resposta: `Há ${data.length} ordem(ns) de compra aberta(s) na relação exibida.`, intencao: intent, dados: data,
      sugestoes: ["sugestão de compras", "curva ABC", "risco de ruptura em 15 dias"] };
  }

  const suggestion = await purchaseSuggestions(db, intent);
  const data = suggestion.rows;
  const days = amount(intent.coverageDays || 15, 0);
  const critical = data.filter((row) => row.PRIORIDADE === "ALTA").length;
  const totalCost = data.reduce((sum, row) => sum + number(row.CUSTO_ESTIMADO), 0);
  const money = totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const coverageAnswer = data.length
    ? `Há ${suggestion.total} item(ns) com estoque zerado ou cobertura de até ${days} dias.${suggestion.total > data.length ? ` Mostro os ${data.length} mais urgentes.` : ""} ${critical} estão com prioridade alta. Custo estimado da lista: ${money}.`
    : `Não encontrei item com estoque zerado ou cobertura de até ${days} dias.`;
  const replenishmentAnswer = data.length
    ? `Recomendo repor ${data.length} item(ns); ${critical} com prioridade alta. Custo estimado: ${money}. O cálculo considera as vendas de SAIDAESTOQUE/SAIDAPRODUTO, MOV_PRODUTO como complemento, as entradas de ENTRESTOQUE/ENTRPRODUTO, estoque atual, embalagem e o saldo ainda não recebido das ordens abertas.`
    : `Não encontrei necessidade de reposição para a cobertura de ${days} dias após considerar o estoque e as ordens abertas.`;
  return {
    resposta: intent.type === "compras_cobertura" ? coverageAnswer : replenishmentAnswer,
    intencao: intent,
    dados: data,
    alertas: critical ? [{ tipo: "critico", texto: `${critical} item(ns) com estoque zerado ou menos de 5 dias de cobertura.` }] : [],
    sugestoes: ["ordens de compra pendentes", "curva ABC", "risco de ruptura em 30 dias"],
  };
}
