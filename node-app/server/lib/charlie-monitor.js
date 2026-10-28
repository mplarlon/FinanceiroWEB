import { query } from "../db.js";
import { saleItemCost } from "./sale-cost.js";
import { getCatalog } from "./charlie-metadata.js";
import { getOllamaStatus, ollamaChat } from "./ollama.js";
import { validAiSummary } from "./charlie-ai.js";
import {
  buildFindings,
  silentCustomers,
} from "./charlie-monitor-rules.js";
import {
  applyMonitorRun,
  pendingNarratives,
  readMonitorSettings,
  readMonitorSnapshot,
  updateAlertNarrative,
} from "./charlie-monitor-store.js";
import { ITEM_SEM_SQL, ITEM_VALOR_SQL, valorJanela, valorLido } from "./charlie-sale-value.js";

const RECEBER_SALDO = `CASE WHEN t.STATUS=1 AND COALESCE(t.TOTALPG,t.VLPGLIQ,0)>0 AND COALESCE(t.TOTALPG,t.VLPGLIQ,0)<COALESCE(t.VALOR,t.DIVIDA,0) THEN COALESCE(t.VALOR,t.DIVIDA,0)-COALESCE(t.TOTALPG,t.VLPGLIQ,0) ELSE COALESCE(t.VALOR,t.DIVIDA,0) END`;
const PAGAR_SALDO = `CASE WHEN t.STATUS=1 AND COALESCE(t.VLPAGTO,0)>0 AND COALESCE(t.VLPAGTO,0)<COALESCE(t.VALOR,t.TOTAL,0) THEN COALESCE(t.VALOR,t.TOTAL,0)-COALESCE(t.VLPAGTO,0) ELSE COALESCE(t.VALOR,t.TOTAL,0) END`;
export const PAYABLE_EXCLUDES_VALE = "COALESCE(t.STATUSVALE,0) NOT IN (1,2)";
const VENDA_VALOR = ITEM_VALOR_SQL;
const VENDA_OK = "se.DTCANCELAMENTO IS NULL AND COALESCE(se.STATUS,0) IN (1,3) AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0) AND COALESCE(sp.STATUSSE,0)=0";

const FORBIDDEN = /\b(insert|update|delete|merge|alter|drop|create|execute|grant|revoke)\b/i;

export function assertMonitorSql(sql) {
  const text = String(sql || "").trim();
  if (!/^\s*select\b/i.test(text) || FORBIDDEN.test(text))
    throw new Error("O monitoramento só executa consultas de leitura.");
  return text;
}

function hasColumns(catalog, table, columns) {
  const meta = catalog.get(String(table).toUpperCase());
  if (!meta) return false;
  const names = new Set(meta.columns.map((column) => column.name));
  return columns.every((column) => names.has(column));
}

function gap(id, texto) {
  return { id, texto, em: new Date().toISOString() };
}

function days(value, fallback) {
  const parsed = Math.round(Number(value) || fallback);
  return Math.min(730, Math.max(1, parsed));
}

function periods(totalDays) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - totalDays);
  const previousEnd = new Date(start);
  const previousStart = new Date(start);
  previousStart.setDate(previousStart.getDate() - totalDays);
  return { start, end, previousStart, previousEnd };
}

async function read(db, sql, params = []) {
  return query(db, assertMonitorSql(sql), params, { timeoutMs: 20000 });
}

async function safe(errors, name, action) {
  try {
    return await action();
  } catch (error) {
    errors.push({ etapa: name, erro: String(error.message || error).slice(0, 300) });
    return null;
  }
}

async function collectReceber(db, settings, previous) {
  const lim = settings.limites;
  const [summary] = await read(db, `
    SELECT COUNT(*) TITULOS, COUNT(DISTINCT t.CDCLIENTE) CLIENTES, COALESCE(SUM(${RECEBER_SALDO}),0) TOTAL
    FROM CTARECEBER t WHERE t.STATUS=1 AND t.DTVENC<CURRENT_DATE`);
  const top = await read(db, `
    SELECT FIRST 8 t.CDCLIENTE CODIGO, COALESCE(c.CLIENTE,'Cliente') NOME,
      COUNT(*) QTD, COALESCE(SUM(${RECEBER_SALDO}),0) VALOR
    FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE
    WHERE t.STATUS=1 AND t.DTVENC<CURRENT_DATE
    GROUP BY t.CDCLIENTE, c.CLIENTE ORDER BY 4 DESC`);
  const recorrentes = await read(db, `
    SELECT FIRST 15 t.CDCLIENTE CODIGO, COALESCE(c.CLIENTE,'Cliente') NOME, COUNT(*) QTD,
      COALESCE(SUM(${RECEBER_SALDO}),0) VALOR
    FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE
    WHERE t.STATUS=1 AND t.DTVENC<CURRENT_DATE
    GROUP BY t.CDCLIENTE, c.CLIENTE
    HAVING COUNT(*)>=${days(lim.atrasoRecorrenteTitulos, 3)}
    ORDER BY 3 DESC`);
  const duplicidades = await read(db, `
    SELECT FIRST 15 t.CDCLIENTE CODIGO, COALESCE(c.CLIENTE,'Cliente') NOME,
      TRIM(t.NRDOC) DOCUMENTO, t.PARCELA, CAST(t.VALOR AS NUMERIC(18,2)) VALOR, COUNT(*) QTD
    FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE
    WHERE t.STATUS=1 AND t.NRDOC IS NOT NULL AND TRIM(t.NRDOC)<>''
    GROUP BY t.CDCLIENTE, c.CLIENTE, TRIM(t.NRDOC), t.PARCELA, CAST(t.VALOR AS NUMERIC(18,2))
    HAVING COUNT(*)>1 ORDER BY 6 DESC`);
  const top3 = top.slice(0, 3).reduce((sum, row) => sum + Number(row.VALOR || 0), 0);
  return {
    facts: {
      total: Number(summary?.TOTAL || 0),
      titulos: Number(summary?.TITULOS || 0),
      clientes: Number(summary?.CLIENTES || 0),
      top,
      top3,
      recorrentes: recorrentes.length,
      recorrentesLista: recorrentes,
      duplicidades,
      anterior: previous?.receber ?? null,
    },
    snapshot: Number(summary?.TOTAL || 0),
  };
}

async function collectPagar(db, settings) {
  const futuro = days(settings.limites.pagarFuturoDias, 7);
  const [vencido] = await read(db, `
    SELECT COUNT(*) TITULOS, COUNT(DISTINCT t.CDFORNECEDOR) FORNECEDORES, COALESCE(SUM(${PAGAR_SALDO}),0) TOTAL
    FROM CTAPAGAR t WHERE t.STATUS=1 AND t.DTVENC<CURRENT_DATE AND ${PAYABLE_EXCLUDES_VALE}`);
  const topVencidos = await read(db, `
    SELECT FIRST 8 t.CDFORNECEDOR CODIGO, COALESCE(f.FORNECEDOR,'Fornecedor') NOME,
      COUNT(*) QTD, COALESCE(SUM(${PAGAR_SALDO}),0) VALOR
    FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR
    WHERE t.STATUS=1 AND t.DTVENC<CURRENT_DATE AND ${PAYABLE_EXCLUDES_VALE}
    GROUP BY t.CDFORNECEDOR, f.FORNECEDOR ORDER BY 4 DESC`);
  const [hoje] = await read(db, `
    SELECT COUNT(*) TITULOS, COALESCE(SUM(${PAGAR_SALDO}),0) TOTAL
    FROM CTAPAGAR t WHERE t.STATUS=1 AND CAST(t.DTVENC AS DATE)=CURRENT_DATE AND ${PAYABLE_EXCLUDES_VALE}`);
  const topHoje = await read(db, `
    SELECT FIRST 8 t.CDFORNECEDOR CODIGO, COALESCE(f.FORNECEDOR,'Fornecedor') NOME,
      COUNT(*) QTD, COALESCE(SUM(${PAGAR_SALDO}),0) VALOR
    FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR
    WHERE t.STATUS=1 AND CAST(t.DTVENC AS DATE)=CURRENT_DATE AND ${PAYABLE_EXCLUDES_VALE}
    GROUP BY t.CDFORNECEDOR, f.FORNECEDOR ORDER BY 4 DESC`);
  const [futuros] = await read(db, `
    SELECT COALESCE(SUM(${PAGAR_SALDO}),0) TOTAL FROM CTAPAGAR t
    WHERE t.STATUS=1 AND t.DTVENC>CURRENT_DATE AND t.DTVENC<=DATEADD(${futuro} DAY TO CURRENT_DATE) AND ${PAYABLE_EXCLUDES_VALE}`);
  const topFuturos = await read(db, `
    SELECT FIRST 8 t.CDFORNECEDOR CODIGO, COALESCE(f.FORNECEDOR,'Fornecedor') NOME,
      COUNT(*) QTD, COALESCE(SUM(${PAGAR_SALDO}),0) VALOR
    FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR
    WHERE t.STATUS=1 AND t.DTVENC>CURRENT_DATE AND t.DTVENC<=DATEADD(${futuro} DAY TO CURRENT_DATE) AND ${PAYABLE_EXCLUDES_VALE}
    GROUP BY t.CDFORNECEDOR, f.FORNECEDOR ORDER BY 4 DESC`);
  const duplicidades = await read(db, `
    SELECT FIRST 15 t.CDFORNECEDOR CODIGO, COALESCE(f.FORNECEDOR,'Fornecedor') NOME,
      TRIM(t.NOTAFISCAL) DOCUMENTO, t.PARCELA, CAST(t.VALOR AS NUMERIC(18,2)) VALOR, COUNT(*) QTD
    FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR
    WHERE t.STATUS=1 AND t.NOTAFISCAL IS NOT NULL AND TRIM(t.NOTAFISCAL)<>'' AND ${PAYABLE_EXCLUDES_VALE}
    GROUP BY t.CDFORNECEDOR, f.FORNECEDOR, TRIM(t.NOTAFISCAL), t.PARCELA, CAST(t.VALOR AS NUMERIC(18,2))
    HAVING COUNT(*)>1 ORDER BY 6 DESC`);
  return {
    vencido: Number(vencido?.TOTAL || 0),
    titulosVencidos: Number(vencido?.TITULOS || 0),
    fornecedoresVencidos: Number(vencido?.FORNECEDORES || 0),
    topVencidos,
    top3: topVencidos.slice(0, 3).reduce((sum, row) => sum + Number(row.VALOR || 0), 0),
    hoje: Number(hoje?.TOTAL || 0),
    titulosHoje: Number(hoje?.TITULOS || 0),
    topHoje,
    futuro: Number(futuros?.TOTAL || 0),
    topFuturos,
    duplicidades,
  };
}

async function collectCaixa(db, settings) {
  const horizonte = days(settings.limites.caixaHorizonteDias, 30);
  const [saldo] = await read(db, "SELECT COALESCE(SUM(COALESCE(VALOR,0)),0) TOTAL FROM MOV_BANCARIO");
  const [receber] = await read(db, `
    SELECT COALESCE(SUM(${RECEBER_SALDO}),0) TOTAL FROM CTARECEBER t
    WHERE t.STATUS=1 AND t.DTVENC BETWEEN CURRENT_DATE AND DATEADD(${horizonte} DAY TO CURRENT_DATE)`);
  const [pagar] = await read(db, `
    SELECT COALESCE(SUM(${PAGAR_SALDO}),0) TOTAL FROM CTAPAGAR t
    WHERE t.STATUS=1 AND t.DTVENC BETWEEN CURRENT_DATE AND DATEADD(${horizonte} DAY TO CURRENT_DATE) AND ${PAYABLE_EXCLUDES_VALE}`);
  return { saldo: Number(saldo?.TOTAL || 0), receber: Number(receber?.TOTAL || 0), pagar: Number(pagar?.TOTAL || 0) };
}

async function collectVendas(db, settings) {
  const custoItem = await saleItemCost(db, "sp", "pr");
  const lim = settings.limites;
  const periodo = days(lim.periodoDias, 30);
  const p = periods(periodo);
  const [totals] = await read(db, `
    SELECT
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR} END) ATUAL,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${ITEM_SEM_SQL} ELSE 0 END) SEM_ATUAL,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR} END) ANTERIOR,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${ITEM_SEM_SQL} ELSE 0 END) SEM_ANTERIOR,
      COALESCE(SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN COALESCE(sp.DESCONTO,0) ELSE 0 END),0) DESCONTO,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR}+COALESCE(sp.DESCONTO,0) END) BRUTO
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${VENDA_OK}`,
  [p.start, p.end, p.start, p.end, p.previousStart, p.previousEnd, p.previousStart, p.previousEnd, p.start, p.end, p.start, p.end, p.previousStart, p.end]);
  const vendedores = await read(db, `
    SELECT FIRST 40 se.CDVENDEDOR ID, COALESCE(v.VENDEDOR,'Sem vendedor') NOME,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR} END) ATUAL,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${ITEM_SEM_SQL} ELSE 0 END) SEM_ATUAL,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR} END) ANTERIOR,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${ITEM_SEM_SQL} ELSE 0 END) SEM_ANTERIOR
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${VENDA_OK}
    GROUP BY se.CDVENDEDOR, v.VENDEDOR ORDER BY 5 DESC`,
  [p.start, p.end, p.start, p.end, p.previousStart, p.previousEnd, p.previousStart, p.previousEnd, p.previousStart, p.end]);
  const produtos = await read(db, `
    SELECT FIRST 80 sp.CDPRODUTO ID, COALESCE(pr.PRODUTO,sp.DESCRICAO) NOME,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR} END) ATUAL,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${ITEM_SEM_SQL} ELSE 0 END) SEM_ATUAL,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${VENDA_VALOR} END) ANTERIOR,
      SUM(CASE WHEN se.DTSAIDA>=? AND se.DTSAIDA<? THEN ${ITEM_SEM_SQL} ELSE 0 END) SEM_ANTERIOR
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${VENDA_OK}
    GROUP BY sp.CDPRODUTO, pr.PRODUTO, sp.DESCRICAO ORDER BY 5 DESC`,
  [p.start, p.end, p.start, p.end, p.previousStart, p.previousEnd, p.previousStart, p.previousEnd, p.previousStart, p.end]);
  const descontosProdutos = await read(db, `
    SELECT FIRST 8 sp.CDPRODUTO CODIGO, COALESCE(pr.PRODUTO,sp.DESCRICAO) NOME,
      COALESCE(SUM(sp.DESCONTO),0) VALOR
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${VENDA_OK}
    GROUP BY sp.CDPRODUTO, pr.PRODUTO, sp.DESCRICAO ORDER BY 3 DESC`, [p.start, p.end]);
  const margem = await read(db, `
    SELECT FIRST 80 sp.CDPRODUTO ID, COALESCE(pr.PRODUTO,sp.DESCRICAO) NOME,
      SUM(${VENDA_VALOR}) FATURAMENTO,
      SUM(${ITEM_SEM_SQL}) SEM,
      COALESCE(SUM(COALESCE(sp.QTDPRODUTO,0)*${custoItem}),0) CUSTO
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<? AND ${VENDA_OK}
    GROUP BY sp.CDPRODUTO, pr.PRODUTO, sp.DESCRICAO ORDER BY 3 DESC`, [p.start, p.end]);
  const clientes = await read(db, `
    SELECT FIRST 200 se.CDCLIENTE ID, COALESCE(c.CLIENTE,c.RAZAO,'Cliente') NOME,
      COUNT(DISTINCT se.NRPEDIDO) PEDIDOS,
      DATEDIFF(DAY, MIN(CAST(se.DTSAIDA AS DATE)), MAX(CAST(se.DTSAIDA AS DATE))) SPAN,
      DATEDIFF(DAY, MAX(CAST(se.DTSAIDA AS DATE)), CURRENT_DATE) DIAS_SEM
    FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
    WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0) AND se.CDCLIENTE>0
      AND se.DTSAIDA>=DATEADD(-365 DAY TO CURRENT_DATE)
    GROUP BY se.CDCLIENTE, c.CLIENTE, c.RAZAO
    HAVING COUNT(DISTINCT se.NRPEDIDO)>=3
    ORDER BY 5 DESC`);
  const comparar = (rows) => (rows || []).map((row) => ({
    ...row,
    ATUAL: valorJanela(row.ATUAL, row.SEM_ATUAL),
    ANTERIOR: valorJanela(row.ANTERIOR, row.SEM_ANTERIOR),
  }));
  const margemBaixa = margem.map((row) => {
    const faturamento = valorLido(row.FATURAMENTO, row.SEM);
    return {
      ...row,
      FATURAMENTO: faturamento,
      MARGEM: faturamento > 0 ? ((faturamento - Number(row.CUSTO)) / faturamento) * 100 : 0,
    };
  }).filter((row) => row.FATURAMENTO > 0 && row.MARGEM < Number(lim.margemMinima));
  return {
    atual: valorJanela(totals?.ATUAL, totals?.SEM_ATUAL),
    anterior: valorJanela(totals?.ANTERIOR, totals?.SEM_ANTERIOR),
    desconto: Number(totals?.DESCONTO || 0),
    bruto: valorJanela(totals?.BRUTO, totals?.SEM_ATUAL),
    vendedores: comparar(vendedores),
    produtos: comparar(produtos),
    descontosProdutos,
    margemBaixa,
    clientesSumidos: silentCustomers(clientes, settings),
  };
}

async function collectEstoque(db, settings) {
  const parado = days(settings.limites.semMovimentoDias, 90);
  const cobertura = days(settings.limites.coberturaRiscoDias, 7);
  const [negativos] = await read(db, `
    SELECT COUNT(DISTINCT m.CDPRODUTO) QTD FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(m.QTDEATUAL,0)<0 AND COALESCE(p.INATIVO,0)=0`);
  const negativosLista = await read(db, `
    SELECT FIRST 15 m.CDPRODUTO CODIGO, COALESCE(p.PRODUTO,m.CDPRODUTO) NOME, SUM(m.QTDEATUAL) VALOR
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(p.INATIVO,0)=0 GROUP BY m.CDPRODUTO, p.PRODUTO
    HAVING SUM(COALESCE(m.QTDEATUAL,0))<0 ORDER BY 3`);
  const [abaixo] = await read(db, `
    SELECT COUNT(*) QTD FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(m.QTDEATUAL,0)<=COALESCE(m.QTDEMINIMA,0) AND COALESCE(m.QTDEMINIMA,0)>0 AND COALESCE(p.INATIVO,0)=0`);
  const abaixoLista = await read(db, `
    SELECT FIRST 15 m.CDPRODUTO CODIGO, COALESCE(p.PRODUTO,m.CDPRODUTO) NOME,
      m.QTDEATUAL VALOR, m.QTDEMINIMA QTD
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(m.QTDEATUAL,0)<=COALESCE(m.QTDEMINIMA,0) AND COALESCE(m.QTDEMINIMA,0)>0 AND COALESCE(p.INATIVO,0)=0
    ORDER BY (COALESCE(m.QTDEMINIMA,0)-COALESCE(m.QTDEATUAL,0)) DESC`);
  const [parados] = await read(db, `
    SELECT COUNT(DISTINCT m.CDPRODUTO) QTD
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(p.INATIVO,0)=0 AND COALESCE(m.QTDEATUAL,0)>0
      AND NOT EXISTS (
        SELECT 1 FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
        WHERE sp.CDPRODUTO=m.CDPRODUTO AND se.DTCANCELAMENTO IS NULL AND se.DTSAIDA>=DATEADD(-${parado} DAY TO CURRENT_DATE)
      )`);
  const paradosLista = await read(db, `
    SELECT FIRST 15 m.CDPRODUTO CODIGO, COALESCE(p.PRODUTO,m.CDPRODUTO) NOME, SUM(m.QTDEATUAL) QTD,
      SUM(COALESCE(m.QTDEATUAL,0)*COALESCE(p.VLCUSTOMEDIO,0)) VALOR
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(p.INATIVO,0)=0 AND COALESCE(m.QTDEATUAL,0)>0
      AND NOT EXISTS (
        SELECT 1 FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
        WHERE sp.CDPRODUTO=m.CDPRODUTO AND se.DTCANCELAMENTO IS NULL AND se.DTSAIDA>=DATEADD(-${parado} DAY TO CURRENT_DATE)
      )
    GROUP BY m.CDPRODUTO, p.PRODUTO ORDER BY 4 DESC`);
  const estoque = await read(db, `
    SELECT m.CDPRODUTO ID, COALESCE(p.PRODUTO,m.CDPRODUTO) NOME, SUM(COALESCE(m.QTDEATUAL,0)) ESTOQUE
    FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
    WHERE COALESCE(p.INATIVO,0)=0 GROUP BY m.CDPRODUTO, p.PRODUTO`);
  const vendas = await read(db, `
    SELECT sp.CDPRODUTO ID, COALESCE(SUM(sp.QTDPRODUTO),0) VENDA90
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0 AND se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE)
    GROUP BY sp.CDPRODUTO`);
  const vendaMap = new Map(vendas.map((row) => [String(row.ID), Number(row.VENDA90 || 0)]));
  const ruptura = estoque.map((row) => {
    const venda90 = vendaMap.get(String(row.ID)) || 0;
    const media = venda90 / 90;
    const coberturaDias = media > 0 ? Number(row.ESTOQUE) / media : null;
    return { ...row, VENDA90: venda90, COBERTURA: coberturaDias };
  }).filter((row) => row.VENDA90 > 0 && row.COBERTURA !== null && row.COBERTURA < cobertura)
    .sort((a, b) => a.COBERTURA - b.COBERTURA);
  return {
    negativos: Number(negativos?.QTD || 0),
    negativosLista,
    abaixoMinimo: Number(abaixo?.QTD || 0),
    abaixoLista,
    parados: Number(parados?.QTD || 0),
    paradosLista,
    ruptura,
  };
}

async function collectPrecos(db, settings, { precos = true, custos = true } = {}) {
  const margem = Number(settings.limites.margemPrecoMinima);
  const aumento = Number(settings.limites.aumentoCustoPercentual);
  const abaixoCusto = precos ? await read(db, `
    SELECT FIRST 15 p.CDPRODUTO ID, COALESCE(p.PRODUTO,p.CDPRODUTO) NOME, pp.IDPRECO TABELA,
      pp.PRECO, pp.VLCUSTO CUSTO
    FROM PRODUTO p
    JOIN PRODUTOPRECO pp ON pp.CDPRODUTO=p.CDPRODUTO
      AND pp.IDPRECO=COALESCE(p.IDPRECO,1)
      AND pp.CDUNIDADE=COALESCE(NULLIF(TRIM(p.CDUNIDVENDA),''), NULLIF(TRIM(p.CDUNIDADE),''), 'UN')
    WHERE COALESCE(p.INATIVO,0)=0 AND COALESCE(pp.PRECO,0)>0 AND COALESCE(pp.VLCUSTO,0)>0
      AND pp.PRECO<pp.VLCUSTO
    ORDER BY (pp.VLCUSTO-pp.PRECO) DESC`) : [];
  const margemBaixa = precos ? await read(db, `
    SELECT FIRST 15 p.CDPRODUTO ID, COALESCE(p.PRODUTO,p.CDPRODUTO) NOME,
      pp.PRECO, pp.VLCUSTO CUSTO,
      ((pp.PRECO-pp.VLCUSTO)/pp.PRECO)*100 MARGEM
    FROM PRODUTO p
    JOIN PRODUTOPRECO pp ON pp.CDPRODUTO=p.CDPRODUTO
      AND pp.IDPRECO=COALESCE(p.IDPRECO,1)
      AND pp.CDUNIDADE=COALESCE(NULLIF(TRIM(p.CDUNIDVENDA),''), NULLIF(TRIM(p.CDUNIDADE),''), 'UN')
    WHERE COALESCE(p.INATIVO,0)=0 AND COALESCE(pp.PRECO,0)>0 AND COALESCE(pp.VLCUSTO,0)>0
      AND pp.PRECO>=pp.VLCUSTO AND ((pp.PRECO-pp.VLCUSTO)/pp.PRECO)*100 < ?
    ORDER BY 5`, [margem]) : [];
  const custosRows = custos ? await read(db, `
    SELECT FIRST 20 ep.CDPRODUTO ID, COALESCE(p.PRODUTO,ep.DESCRICAO) NOME,
      MAX(CASE WHEN COALESCE(ep.CUSTOMED_ANTERIOR,0)>0
        THEN (COALESCE(ep.VLCUSTO,ep.VLUNIT,0)-ep.CUSTOMED_ANTERIOR)/ep.CUSTOMED_ANTERIOR*100 END) VARIACAO
    FROM ENTRPRODUTO ep
    JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=ep.CDPRODUTO
    WHERE ee.DTCANCELAMENTO IS NULL AND ee.DTENTRADA>=DATEADD(-30 DAY TO CURRENT_DATE)
    GROUP BY ep.CDPRODUTO, p.PRODUTO, ep.DESCRICAO
    HAVING MAX(CASE WHEN COALESCE(ep.CUSTOMED_ANTERIOR,0)>0
      THEN (COALESCE(ep.VLCUSTO,ep.VLUNIT,0)-ep.CUSTOMED_ANTERIOR)/ep.CUSTOMED_ANTERIOR*100 END)>=?
    ORDER BY 3 DESC`, [aumento]) : [];
  return { abaixoCusto, margemBaixa, custos: custosRows };
}

const GROUPS = {
  receber: ["receber_vencidos", "receber_concentracao", "receber_recorrentes", "receber_aumento", "receber_duplicidade"],
  pagar: ["pagar_vencidos", "pagar_hoje", "pagar_futuros", "pagar_concentracao", "pagar_duplicidade"],
  caixa: ["fluxo_caixa"],
  vendas: ["vendas_queda", "vendas_crescimento", "vendedores_queda", "clientes_sumidos", "produtos_queda", "descontos", "margem_vendas"],
  estoque: ["estoque_minimo", "estoque_negativo", "estoque_parado", "ruptura"],
  precos: ["preco_abaixo_custo", "margem_preco", "aumento_custo"],
};

function enabled(settings, ids) {
  return ids.filter((id) => settings.monitores[id]);
}

export async function collectMonitorFacts(db, settings = readMonitorSettings(), catalog = getCatalog()) {
  const errors = [];
  const lacunas = [];
  const facts = {};
  const evaluated = [];
  const anterior = {};
  const previous = readMonitorSnapshot();
  const receberOk = hasColumns(catalog, "CTARECEBER", ["STATUS", "DTVENC", "VALOR", "DIVIDA", "TOTALPG", "VLPGLIQ", "CDCLIENTE", "NRDOC", "PARCELA"])
    && hasColumns(catalog, "CLIENTE", ["CDCLIENTE", "CLIENTE"]);
  if (enabled(settings, GROUPS.receber).length && !receberOk)
    lacunas.push(gap("contas_receber", "CTARECEBER ou CLIENTE não têm todas as colunas já usadas pelo Charlie financeiro. O monitoramento de contas a receber ficou pendente de validação."));
  else if (receberOk && enabled(settings, GROUPS.receber).length) {
    const data = await safe(errors, "receber", () => collectReceber(db, settings, previous));
    if (data) {
      facts.receber = data.facts;
      anterior.receber = data.snapshot;
      evaluated.push(...enabled(settings, GROUPS.receber));
    }
  }
  const pagarOk = hasColumns(catalog, "CTAPAGAR", ["STATUS", "DTVENC", "VALOR", "TOTAL", "VLPAGTO", "CDFORNECEDOR", "NOTAFISCAL", "PARCELA"])
    && hasColumns(catalog, "FORNECEDOR", ["CDFORNECEDOR", "FORNECEDOR"]);
  if (enabled(settings, GROUPS.pagar).length && !pagarOk)
    lacunas.push(gap("contas_pagar", "CTAPAGAR ou FORNECEDOR não têm as colunas usadas pelo financeiro. O monitoramento de contas a pagar ficou pendente de validação."));
  else if (pagarOk && enabled(settings, GROUPS.pagar).length) {
    const data = await safe(errors, "pagar", () => collectPagar(db, settings));
    if (data) {
      facts.pagar = data;
      evaluated.push(...enabled(settings, GROUPS.pagar));
    }
  }
  const caixaOk = receberOk && pagarOk && hasColumns(catalog, "MOV_BANCARIO", ["VALOR"]);
  if (settings.monitores.fluxo_caixa && !caixaOk)
    lacunas.push(gap("fluxo_caixa", "Não há saldo bancário e títulos suficientes, com as colunas já validadas, para projetar o caixa."));
  else if (caixaOk && settings.monitores.fluxo_caixa) {
    const data = await safe(errors, "caixa", () => collectCaixa(db, settings));
    if (data) {
      facts.caixa = data;
      evaluated.push("fluxo_caixa");
    }
  }
  const vendasOk = hasColumns(catalog, "SAIDAESTOQUE", ["NRPEDIDO", "IDEMPRESA", "DTSAIDA", "DTCANCELAMENTO", "STATUS", "STATUS_ORC", "CDVENDEDOR", "CDCLIENTE"])
    && hasColumns(catalog, "SAIDAPRODUTO", ["NRPEDIDO", "IDEMPRESA", "CDPRODUTO", "TOTAL", "SUBTOTAL", "QTDPRODUTO", "VLUNIT", "STATUSSE", "DESCONTO", "VLCUSTO"])
    && hasColumns(catalog, "PRODUTO", ["CDPRODUTO", "PRODUTO", "VLCUSTOMEDIO"]);
  if (enabled(settings, GROUPS.vendas).length && !vendasOk)
    lacunas.push(gap("vendas", "SAIDAESTOQUE, SAIDAPRODUTO ou PRODUTO não têm as colunas usadas pelos relatórios de venda. O monitoramento comercial ficou pendente de validação."));
  else if (vendasOk && enabled(settings, GROUPS.vendas).length) {
    const data = await safe(errors, "vendas", () => collectVendas(db, settings));
    if (data) {
      facts.vendas = data;
      evaluated.push(...enabled(settings, GROUPS.vendas));
    }
  }
  const estoqueOk = hasColumns(catalog, "MOVIMENTO", ["CDPRODUTO", "QTDEATUAL", "QTDEMINIMA"]) && hasColumns(catalog, "PRODUTO", ["CDPRODUTO", "INATIVO", "PRODUTO"]);
  if (enabled(settings, GROUPS.estoque).length && !estoqueOk)
    lacunas.push(gap("estoque", "MOVIMENTO ou PRODUTO não têm as colunas de saldo e estoque mínimo já usadas pelo Charlie. O monitoramento de estoque ficou pendente."));
  else if (estoqueOk && enabled(settings, GROUPS.estoque).length) {
    const data = await safe(errors, "estoque", () => collectEstoque(db, settings));
    if (data) {
      facts.estoque = data;
      evaluated.push(...enabled(settings, GROUPS.estoque));
    }
  }
  const precoOk = hasColumns(catalog, "PRODUTOPRECO", ["CDPRODUTO", "IDPRECO", "CDUNIDADE", "PRECO", "VLCUSTO"])
    && hasColumns(catalog, "PRODUTO", ["CDPRODUTO", "IDPRECO", "CDUNIDADE", "CDUNIDVENDA", "INATIVO"]);
  const custoOk = hasColumns(catalog, "ENTRPRODUTO", ["CDPRODUTO", "IDENTRADA", "IDEMPRESA", "VLCUSTO", "VLUNIT", "CUSTOMED_ANTERIOR", "DESCRICAO"])
    && hasColumns(catalog, "ENTRESTOQUE", ["IDENTRADA", "IDEMPRESA", "DTENTRADA", "DTCANCELAMENTO"]);
  if ((settings.monitores.preco_abaixo_custo || settings.monitores.margem_preco) && !precoOk)
    lacunas.push(gap("precos", "A relação PRODUTO.IDPRECO com PRODUTOPRECO, já usada pelo PDV, não está completa no catálogo. Preço abaixo do custo e margem de tabela não foram calculados."));
  if (settings.monitores.aumento_custo && !custoOk)
    lacunas.push(gap("aumento_custo", "ENTRPRODUTO.CUSTOMED_ANTERIOR não está disponível para comparar o custo da entrada. O aumento de custo não foi calculado."));
  lacunas.push(gap("alteracao_preco_venda", "Não há histórico validado de alteração do preço de venda. Mudanças incomuns de preço não são monitoradas até essa estrutura ser confirmada."));
  if ((precoOk && (settings.monitores.preco_abaixo_custo || settings.monitores.margem_preco)) || (custoOk && settings.monitores.aumento_custo)) {
    const data = await safe(errors, "precos", () => collectPrecos(db, settings, {
      precos: precoOk && (settings.monitores.preco_abaixo_custo || settings.monitores.margem_preco),
      custos: custoOk && settings.monitores.aumento_custo,
    }));
    if (data) {
      facts.precos = data;
      if (precoOk && settings.monitores.preco_abaixo_custo) evaluated.push("preco_abaixo_custo");
      if (precoOk && settings.monitores.margem_preco) evaluated.push("margem_preco");
      if (custoOk && settings.monitores.aumento_custo) evaluated.push("aumento_custo");
    }
  }
  return { facts, evaluated, lacunas, anterior, errors };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

export async function explainFinding(finding) {
  const source = `${finding.descricao} Recomendação: ${finding.recomendacao}`;
  const status = await getOllamaStatus();
  if (!status.online) return { narrativa: null, ia: "pendente" };
  const content = await ollamaChat({
    format: { type: "object", additionalProperties: false, required: ["resumo"], properties: { resumo: { type: "string" } } },
    maxTokens: 280,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "Você é Charlie, assistente do ERP. Reescreva o alerta em português claro para um usuário leigo. Use somente números e fatos do texto. Não invente causa, valor, cliente ou ação além da recomendação recebida. Não mencione SQL. Retorne apenas o JSON.",
      },
      { role: "user", content: JSON.stringify({ alerta: source }) },
    ],
  });
  if (!content) return { narrativa: null, ia: "pendente" };
  const summary = safeJson(content)?.resumo;
  if (!validAiSummary(summary, source)) return { narrativa: null, ia: "indisponivel" };
  return { narrativa: String(summary).trim(), ia: "ok" };
}

export async function explainPendingAlerts() {
  const pending = pendingNarratives(6);
  if (!pending.length) return 0;
  const status = await getOllamaStatus();
  if (!status.online) return 0;
  for (const alert of pending) {
    const explained = await explainFinding(alert);
    updateAlertNarrative(alert.id, explained.narrativa, explained.ia);
  }
  return pending.length;
}

export async function runCharlieMonitor(db) {
  const started = Date.now();
  const settings = readMonitorSettings();
  const collected = await collectMonitorFacts(db, settings);
  const findings = buildFindings(collected.facts, settings);
  const stored = applyMonitorRun({
    findings,
    evaluated: collected.evaluated,
    lacunas: collected.lacunas,
    anterior: collected.anterior,
    erros: collected.errors,
  });
  let ia = "ok";
  try {
    await explainPendingAlerts();
  } catch (error) {
    ia = "indisponivel";
    collected.errors.push({ etapa: "ollama", erro: String(error.message || error).slice(0, 300) });
  }
  return {
    ok: true,
    duracaoMs: Date.now() - started,
    achados: findings.length,
    avaliadas: collected.evaluated,
    lacunas: collected.lacunas,
    erros: collected.errors,
    ia,
    em: stored.em,
  };
}
