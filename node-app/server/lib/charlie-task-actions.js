import { forecastSeries, forecastStock, projectCashFlow } from "./charlie-predictive-engine.js";
import { findFinancialDuplicates } from "./charlie-audit-engine.js";
import { runBehavioralRiskAnalysis } from "./charlie-behavioral-risk-service.js";
import { listBehavioralAnalyses } from "./charlie-behavioral-risk-store.js";
import { valueDashboard } from "./charlie-value-intelligence.js";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

const REPORT_CAP = 2000;

function capLimit(value, fallback, max = REPORT_CAP) {
  return Math.max(1, Math.min(max, integer(value, fallback)));
}

export function periodLabel(params, fallback = null) {
  if (params?.periodo === "mes") return "Mês atual";
  if (params?.periodo === "ano") return "Ano atual";
  if (params?.meses) return `Últimos ${params.meses} meses`;
  if (params?.dias != null) return `Últimos ${params.dias} dias`;
  return fallback;
}

function limitNote(extra, limit) {
  return extra ? ` A consulta foi limitada a ${limit} registros.` : "";
}

function reportResult({ linhas, resumo, periodo, etapa, grupo = null, totais = null, detalhe = null, erros = [], extra = false, limit = 0 }) {
  return {
    linhas,
    detalhe,
    quantidade: linhas.length,
    quantidadeNaoProcessada: extra ? 1 : 0,
    parcial: Boolean(extra),
    resumo: `${resumo}${limitNote(extra, limit)}`.trim(),
    periodo,
    grupo,
    totalizar: true,
    totais,
    erros,
    etapas: [{ nome: etapa, situacao: extra ? "parcial" : "concluida", quantidade: linhas.length }],
  };
}

function displayName(value) {
  return String(value || "Não informado").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function titleQuery(params, kind) {
  const receive = params.dominio !== "pagar";
  const table = receive ? "CTARECEBER" : "CTAPAGAR";
  const personTable = receive ? "CLIENTE" : "FORNECEDOR";
  const personId = receive ? "CDCLIENTE" : "CDFORNECEDOR";
  const personName = receive ? "c.CLIENTE" : "c.FORNECEDOR";
  const baseValue = receive ? "COALESCE(t.VALOR,t.DIVIDA,0)" : "COALESCE(t.VALOR,t.TOTAL,0)";
  const paidValue = receive ? "COALESCE(t.TOTALPG,t.VLPGLIQ,0)" : "COALESCE(t.VLPAGTO,0)";
  const seller = receive
    ? "LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=c.CDVENDEDOR"
    : "";
  const sellerColumn = receive ? "COALESCE(v.VENDEDOR, 'Sem vendedor')" : "'Sem vendedor'";
  const emailColumn = params.incluirEmail && receive ? ", c.EMAIL" : "";
  const days = integer(params.dias, kind === "vencer" ? 7 : 1);
  const limit = integer(params.limite, 100);
  const where = ["t.STATUS=1", "t.DTVENC IS NOT NULL"];
  const queryParams = [];
  if (kind === "vencer") {
    where.push("t.DTVENC>=CURRENT_DATE", `t.DTVENC<DATEADD(${days} DAY TO CURRENT_DATE)`);
  } else {
    const operator = params.comparacao === "maior" ? ">" : ">=";
    where.push("t.DTVENC<CURRENT_DATE", `DATEDIFF(DAY, t.DTVENC, CURRENT_DATE) ${operator} ${days}`);
  }
  if (params.pessoa) {
    const columns = receive ? ["c.CLIENTE", "c.RAZAO"] : ["c.FORNECEDOR", "c.FANTASIA"];
    where.push(`(${columns.map((column) => `${column} CONTAINING ?`).join(" OR ")})`);
    queryParams.push(params.pessoa, params.pessoa);
  }
  if (receive && params.clientes?.length) {
    where.push(`t.CDCLIENTE IN (${params.clientes.map(() => "?").join(",")})`);
    queryParams.push(...params.clientes);
  }
  const sql = `SELECT FIRST ${limit}
      t.CONTROLE, t.IDEMPRESA, t.${personId} AS PESSOA_ID${emailColumn},
      ${personName} AS PESSOA, ${sellerColumn} AS VENDEDOR,
      CAST(t.DTVENC AS DATE) AS VENCIMENTO,
      CASE WHEN ${paidValue}>0 AND ${paidValue}<${baseValue} THEN ${baseValue}-${paidValue} ELSE ${baseValue} END AS SALDO,
      DATEDIFF(DAY, t.DTVENC, CURRENT_DATE) AS DIAS_ATRASO
    FROM ${table} t
    LEFT JOIN ${personTable} c ON c.${personId}=t.${personId}
    ${seller}
    WHERE ${where.join(" AND ")}
    ORDER BY SALDO DESC, t.DTVENC`;
  return { sql, queryParams, receive };
}

export async function consultarTitulos(deps, params, kind = "vencido") {
  const built = titleQuery({ ...params, incluirEmail: params.incluirContatos === "sim" }, kind);
  const rows = await deps.query(built.sql, built.queryParams);
  const linhas = rows.map((row) => ({
    CONTROLE: row.CONTROLE,
    ...(params.incluirContatos === "sim" ? { PESSOA_ID: row.PESSOA_ID, EMAIL: String(row.EMAIL || "").trim().slice(0, 120) } : {}),
    PESSOA: displayName(row.PESSOA),
    VENDEDOR: displayName(row.VENDEDOR),
    VENCIMENTO: row.VENCIMENTO,
    SALDO: roundMoney(row.SALDO),
    DIAS_ATRASO: Number(row.DIAS_ATRASO || 0),
  }));
  const grupo = params.agrupar === "vendedor"
    ? "VENDEDOR"
    : params.agrupar === "cliente" || params.agrupar === "fornecedor"
      ? "PESSOA"
      : null;
  if (grupo) {
    linhas.sort((a, b) => String(a[grupo]).localeCompare(String(b[grupo]), "pt-BR")
      || String(a.VENCIMENTO || "").localeCompare(String(b.VENCIMENTO || "")));
  }
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.SALDO, 0));
  const periodo = kind === "vencer"
    ? `Próximos ${integer(params.dias, 7)} dias`
    : `Vencidos a partir de ${integer(params.dias, 1)} dia(s)`;
  return {
    linhas,
    quantidade: linhas.length,
    periodo,
    grupo,
    totalizar: true,
    totais: { SALDO: total },
    resumo: linhas.length
      ? `Encontrei ${linhas.length} título(s), somando ${money(total)}.`
      : "Não encontrei títulos com esses filtros.",
    etapas: [{ nome: "Consulta de títulos", situacao: "concluida", quantidade: linhas.length }],
  };
}

export function buildCollectionDrafts(rows, dias) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = `${row.CDCLIENTE || row.PESSOA_ID || row.PESSOA}`;
    const current = groups.get(key) || {
      clienteId: row.CDCLIENTE || row.PESSOA_ID || null,
      nome: displayName(row.PESSOA || row.CLIENTE),
      vendedor: displayName(row.VENDEDOR),
      email: String(row.EMAIL || "").trim().slice(0, 120),
      titulos: 0,
      total: 0,
    };
    current.titulos += 1;
    current.total = roundMoney(current.total + Number(row.SALDO || 0));
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((a, b) => b.total - a.total)
    .map((client) => {
      const contato = client.email ? `contato ${client.email}` : "sem e-mail cadastrado";
      return {
        clienteId: client.clienteId,
        nome: client.nome,
        vendedor: client.vendedor,
        email: client.email || null,
        titulos: client.titulos,
        total: client.total,
        mensagem: `Olá, ${client.nome}. Identificamos ${client.titulos} título(s) vencido(s) há mais de ${dias} dia(s), no total de ${money(client.total)}. Esta mensagem é um rascunho e ainda não foi enviada. Referência: ${contato}.`,
        pendencia: client.email ? null : "Cliente sem e-mail cadastrado.",
      };
    });
}

export async function prepararCobrancas(deps, params) {
  const inherited = Array.isArray(deps.inputRows) ? deps.inputRows : null;
  const built = inherited ? null : titleQuery({ ...params, dominio: "receber", limite: 500, incluirEmail: true }, "vencido");
  const rows = inherited || await deps.query(built.sql, built.queryParams);
  const drafts = buildCollectionDrafts(rows, params.dias).slice(0, params.limite || 50);
  const missing = drafts.filter((item) => item.pendencia);
  const linhas = drafts.map((item) => ({
    CLIENTE: item.nome,
    VENDEDOR: item.vendedor,
    TITULOS: item.titulos,
    TOTAL: item.total,
    CONTATO: item.email || "Sem e-mail",
    RASCUNHO: item.mensagem,
  }));
  return {
    linhas,
    rascunhos: drafts,
    quantidade: drafts.length,
    quantidadeNaoProcessada: missing.length,
    parcial: Boolean(missing.length),
    resumo: drafts.length
      ? `Preparei ${drafts.length} rascunho(s) de cobrança, somando ${money(drafts.reduce((sum, item) => sum + item.total, 0))}. Nenhum envio foi feito.`
      : "Não encontrei clientes com títulos vencidos para cobrar.",
    erros: missing.map((item) => `${item.nome}: ${item.pendencia}`),
    etapas: [
      { nome: "Consulta de títulos", situacao: "concluida", quantidade: rows.length },
      { nome: "Agrupamento por cliente", situacao: "concluida", quantidade: drafts.length },
      { nome: "Rascunhos", situacao: missing.length ? "parcial" : "concluida", quantidade: drafts.length },
      { nome: "Envio", situacao: "bloqueado", quantidade: 0 },
    ],
  };
}

export async function clientesInativos(deps, params) {
  const dias = integer(params.dias, 60);
  const limit = integer(params.limite, 100);
  const rows = await deps.query(
    `SELECT FIRST ${limit}
       c.CDCLIENTE AS CODIGO, c.CLIENTE AS NOME, CAST(c.DTULTCOMPRA AS DATE) AS ULTIMA_COMPRA,
       COALESCE(v.VENDEDOR, 'Sem vendedor') AS VENDEDOR
     FROM CLIENTE c
     LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=c.CDVENDEDOR
     WHERE COALESCE(c.INATIVO,0)=0
       AND c.DTULTCOMPRA IS NOT NULL
       AND c.DTULTCOMPRA < DATEADD(-${dias} DAY TO CURRENT_DATE)
     ORDER BY c.DTULTCOMPRA`,
  );
  const linhas = rows.map((row) => ({
    CODIGO: row.CODIGO,
    NOME: displayName(row.NOME),
    VENDEDOR: displayName(row.VENDEDOR),
    ULTIMA_COMPRA: row.ULTIMA_COMPRA,
  }));
  return {
    linhas,
    quantidade: linhas.length,
    periodo: `Sem compra há ${dias} dias ou mais`,
    totalizar: true,
    resumo: linhas.length
      ? `Encontrei ${linhas.length} cliente(s) sem compra há mais de ${dias} dias.`
      : `Não encontrei clientes sem compra há mais de ${dias} dias.`,
    etapas: [{ nome: "Consulta de clientes", situacao: "concluida", quantidade: linhas.length }],
  };
}

function salesPeriod(params) {
  if (params.periodo === "mes")
    return "EXTRACT(YEAR FROM se.DTSAIDA)=EXTRACT(YEAR FROM CURRENT_DATE) AND EXTRACT(MONTH FROM se.DTSAIDA)=EXTRACT(MONTH FROM CURRENT_DATE)";
  if (params.periodo === "ano") return "EXTRACT(YEAR FROM se.DTSAIDA)=EXTRACT(YEAR FROM CURRENT_DATE)";
  const months = integer(params.meses, 6);
  return `se.DTSAIDA>=DATEADD(-${months} MONTH TO CURRENT_DATE)`;
}

function paidPeriod(column, params) {
  if (params.periodo === "mes")
    return `EXTRACT(YEAR FROM ${column})=EXTRACT(YEAR FROM CURRENT_DATE) AND EXTRACT(MONTH FROM ${column})=EXTRACT(MONTH FROM CURRENT_DATE)`;
  if (params.periodo === "ano") return `EXTRACT(YEAR FROM ${column})=EXTRACT(YEAR FROM CURRENT_DATE)`;
  const months = integer(params.meses, 1);
  return `${column}>=DATEADD(-${months} MONTH TO CURRENT_DATE)`;
}

export async function rankingClientes(deps, params) {
  const limit = integer(params.limite, 100);
  const rows = await deps.query(
    `SELECT FIRST ${limit}
       COALESCE(v.VENDEDOR, 'Sem vendedor') AS VENDEDOR,
       COALESCE(c.CLIENTE, se.CLIENTE) AS CLIENTE,
       COUNT(DISTINCT se.NRPEDIDO) AS PEDIDOS,
       SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL
     FROM SAIDAESTOQUE se
     JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
     LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
     LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR
     WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0 AND ${salesPeriod(params)}
     GROUP BY 1, 2
     ORDER BY 1, 4 DESC`,
  );
  const linhas = rows.map((row) => ({
    VENDEDOR: displayName(row.VENDEDOR),
    CLIENTE: displayName(row.CLIENTE),
    PEDIDOS: Number(row.PEDIDOS || 0),
    TOTAL: roundMoney(row.TOTAL),
  }));
  return {
    linhas,
    quantidade: linhas.length,
    resumo: linhas.length
      ? `Organizei ${linhas.length} cliente(s) por vendedor. Cancelamentos e itens cancelados ficaram de fora.`
      : "Não encontrei vendas válidas nesse período.",
    etapas: [{ nome: "Consulta de vendas", situacao: "concluida", quantidade: linhas.length }],
  };
}

export async function faturamentoVendedor(deps, params) {
  const limit = capLimit(params.limite, 100);
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1} COALESCE(v.VENDEDOR, 'Sem vendedor') AS VENDEDOR,
            COUNT(DISTINCT se.NRPEDIDO) AS PEDIDOS,
            SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL
     FROM SAIDAESTOQUE se
     JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
     LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR
     WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
       AND ${salesPeriod(params)}
     GROUP BY 1
     ORDER BY 3 DESC`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    VENDEDOR: displayName(row.VENDEDOR),
    PEDIDOS: Number(row.PEDIDOS || 0),
    TOTAL: roundMoney(row.TOTAL),
  }));
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.TOTAL, 0));
  const periodo = periodLabel(params, `Últimos ${integer(params.meses, 6)} meses`);
  return reportResult({
    linhas,
    extra,
    limit,
    periodo,
    totais: { TOTAL: total, PEDIDOS: linhas.reduce((sum, row) => sum + row.PEDIDOS, 0) },
    etapa: "Consulta de faturamento",
    resumo: linhas.length
      ? `Faturamento de ${periodo.toLowerCase()}: ${money(total)} em ${linhas.length} vendedor(es).`
      : `Não encontrei faturamento em ${periodo.toLowerCase()}.`,
  });
}

export async function faturamentoMensal(deps, params) {
  const rows = await deps.query(
    `SELECT EXTRACT(YEAR FROM se.DTSAIDA) AS ANO, EXTRACT(MONTH FROM se.DTSAIDA) AS MES,
            SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL,
            COUNT(DISTINCT se.NRPEDIDO) AS PEDIDOS
     FROM SAIDAESTOQUE se
     JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
     WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
       AND ${salesPeriod(params)}
     GROUP BY 1, 2
     ORDER BY 1, 2`,
  );
  let anterior = null;
  const linhas = rows.map((row) => {
    const total = roundMoney(row.TOTAL);
    const variacao = anterior ? roundMoney(((total - anterior) / anterior) * 100) : null;
    anterior = total;
    return {
      ANO: Number(row.ANO),
      MES: Number(row.MES),
      PEDIDOS: Number(row.PEDIDOS || 0),
      TOTAL: total,
      VARIACAO: variacao,
    };
  });
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.TOTAL, 0));
  return reportResult({
    linhas,
    periodo: periodLabel(params, `Últimos ${integer(params.meses, 6)} meses`),
    totais: { TOTAL: total },
    etapa: "Comparação mensal",
    resumo: linhas.length
      ? `Comparei ${linhas.length} mês(es) de faturamento, somando ${money(total)}.`
      : "Não encontrei faturamento no período.",
  });
}

export async function produtosSemVenda(deps, params) {
  const dias = integer(params.dias, 90);
  const limit = integer(params.limite, 200);
  const rows = await deps.query(
    `SELECT FIRST ${limit} p.CDPRODUTO AS CODIGO, p.PRODUTO AS DESCRICAO
     FROM PRODUTO p
     WHERE COALESCE(p.INATIVO,0)=0
       AND NOT EXISTS (
         SELECT 1 FROM SAIDAPRODUTO sp
         JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
         WHERE sp.CDPRODUTO=p.CDPRODUTO
           AND se.DTCANCELAMENTO IS NULL
           AND COALESCE(sp.STATUSSE,0)=0
           AND se.DTSAIDA>=DATEADD(-${dias} DAY TO CURRENT_DATE)
       )
     ORDER BY p.PRODUTO`,
  );
  const linhas = rows.map((row) => ({ CODIGO: row.CODIGO, DESCRICAO: displayName(row.DESCRICAO) }));
  return {
    linhas,
    quantidade: linhas.length,
    periodo: `Últimos ${dias} dias`,
    totalizar: true,
    resumo: linhas.length
      ? `Encontrei ${linhas.length} produto(s) sem venda válida nos últimos ${dias} dias.`
      : `Não encontrei produtos sem venda nos últimos ${dias} dias.`,
    etapas: [{ nome: "Consulta de produtos sem venda", situacao: "concluida", quantidade: linhas.length }],
  };
}

async function readPriceTable(deps, params) {
  const tableId = integer(params.tabela, 0);
  const tables = await deps.query(
    "SELECT FIRST 1 IDPRECO, DESCRICAO, COALESCE(INATIVO,0) AS INATIVO FROM TABELAPRECO WHERE IDPRECO=?",
    [tableId],
  );
  if (!tables.length) {
    const error = new Error(`Não encontrei a tabela de preços ${tableId}.`);
    error.status = 404;
    throw error;
  }
  if (Number(tables[0].INATIVO)) {
    const error = new Error(`A tabela de preços ${tableId} está inativa.`);
    error.status = 409;
    throw error;
  }
  const limit = integer(params.limite, 500);
  const margin = params.margem == null ? null : Number(params.margem);
  const where = ["pp.IDPRECO=?", "COALESCE(p.INATIVO,0)=0"];
  const queryParams = [tableId];
  if (margin != null) {
    where.push("pp.PRECO>0", "((pp.PRECO-COALESCE(pp.VLCUSTO,0))/pp.PRECO)*100 < ?");
    queryParams.push(margin);
  }
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       pp.CDPRODUTO, pp.IDPRECO, pp.CDUNIDADE, pp.PRECO, COALESCE(pp.VLCUSTO,0) AS CUSTO, p.PRODUTO
     FROM PRODUTOPRECO pp
     JOIN PRODUTO p ON p.CDPRODUTO=pp.CDPRODUTO
     WHERE ${where.join(" AND ")}
     ORDER BY pp.CDPRODUTO, pp.CDUNIDADE`,
    queryParams,
  );
  return { table: tables[0], rows, limit };
}

const DEFAULT_PRICE_JOIN = "pp.CDPRODUTO=p.CDPRODUTO AND pp.IDPRECO=COALESCE(p.IDPRECO,1) AND pp.CDUNIDADE=COALESCE(NULLIF(TRIM(p.CDUNIDVENDA),''), NULLIF(TRIM(p.CDUNIDADE),''), 'UN')";

async function margemPadrao(deps, params) {
  const limit = capLimit(params.limite, 200);
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       p.CDPRODUTO, pp.IDPRECO, pp.PRECO, COALESCE(pp.VLCUSTO,0) AS CUSTO, p.PRODUTO
     FROM PRODUTO p
     JOIN PRODUTOPRECO pp ON ${DEFAULT_PRICE_JOIN}
     WHERE COALESCE(p.INATIVO,0)=0 AND pp.PRECO>0
       AND ((pp.PRECO-COALESCE(pp.VLCUSTO,0))/pp.PRECO)*100 < ?
     ORDER BY p.PRODUTO`,
    [Number(params.margem)],
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => marginRow(row));
  return reportResult({
    linhas,
    extra,
    limit,
    periodo: "Tabela padrão de cada produto",
    etapa: "Consulta de margens",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} produto(s) com margem inferior a ${params.margem}% na tabela padrão.`
      : `Não encontrei produtos com margem inferior a ${params.margem}% na tabela padrão.`,
  });
}

function marginRow(row) {
  const preco = Number(row.PRECO || 0);
  const custo = Number(row.CUSTO || 0);
  return {
    CODIGO: row.CDPRODUTO,
    PRODUTO: displayName(row.PRODUTO),
    PRECO: roundMoney(preco),
    CUSTO: roundMoney(custo),
    MARGEM: preco > 0 ? roundMoney(((preco - custo) / preco) * 100) : 0,
  };
}

export async function margemInsuficiente(deps, params) {
  if (!integer(params.tabela, 0)) return margemPadrao(deps, params);
  const { rows } = await readPriceTable(deps, params);
  const linhas = rows.map((row) => marginRow(row));
  return reportResult({
    linhas,
    periodo: `Tabela ${params.tabela}`,
    etapa: "Consulta de margens",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} produto(s) da tabela ${params.tabela} com margem inferior a ${params.margem}%.`
      : `Não encontrei produtos da tabela ${params.tabela} com margem inferior a ${params.margem}%.`,
  });
}

export async function simularReajuste(deps, params) {
  const { table, rows, limit } = await readPriceTable(deps, { ...params, margem: null });
  if (rows.length > limit) {
    const error = new Error(`A tabela ${params.tabela} tem mais de ${limit} preços. O Charlie aplica no máximo ${limit} por vez.`);
    error.status = 409;
    error.code = "limite";
    throw error;
  }
  const factor = 1 + Number(params.percentual) / 100;
  const aceitos = [];
  const recusados = [];
  for (const row of rows) {
    const anterior = roundMoney(row.PRECO);
    const novo = roundMoney(anterior * factor);
    const item = {
      produto: String(row.CDPRODUTO),
      unidade: String(row.CDUNIDADE),
      tabela: Number(row.IDPRECO),
      descricao: displayName(row.PRODUTO),
      anterior,
      novo,
      custo: roundMoney(row.CUSTO),
    };
    if (novo <= 0 || (item.custo > 0 && novo < item.custo)) recusados.push(item);
    else aceitos.push(item);
  }
  const linhas = aceitos.map((item) => ({
    CODIGO: item.produto,
    PRODUTO: item.descricao,
    UNIDADE: item.unidade,
    PRECO_ATUAL: item.anterior,
    PRECO_NOVO: item.novo,
  }));
  return {
    linhas,
    snapshot: aceitos,
    quantidade: rows.length,
    quantidadeElegivel: aceitos.length,
    quantidadeNaoProcessada: recusados.length,
    parcial: Boolean(recusados.length && aceitos.length),
    resumo: `Simulação de ${params.percentual}% na tabela ${table.IDPRECO}${table.DESCRICAO ? ` (${displayName(table.DESCRICAO)})` : ""}: ${aceitos.length} preço(s) podem mudar e ${recusados.length} ficaram de fora.`,
    erros: recusados.slice(0, 20).map((item) => `${item.produto}: o novo preço ${money(item.novo)} ficaria abaixo do custo ou inválido.`),
    etapas: [
      { nome: "Consulta da tabela", situacao: "concluida", quantidade: rows.length },
      { nome: "Simulação", situacao: "concluida", quantidade: aceitos.length },
    ],
  };
}

export function pricesMatch(snapshot, current) {
  const index = new Map(current.map((row) => [`${row.CDPRODUTO}|${row.IDPRECO}|${row.CDUNIDADE}`, roundMoney(row.PRECO)]));
  const divergencias = [];
  for (const item of snapshot) {
    const key = `${item.produto}|${item.tabela}|${item.unidade}`;
    if (!index.has(key) || Math.abs(index.get(key) - item.anterior) > 0.001)
      divergencias.push(item.produto);
  }
  return divergencias;
}

export async function aplicarReajuste(tx, snapshot) {
  if (!snapshot?.length) {
    const error = new Error("Não há preços elegíveis para atualizar.");
    error.status = 409;
    throw error;
  }
  const current = [];
  for (const item of snapshot) {
    const rows = await tx.query(
      "SELECT CDPRODUTO, IDPRECO, CDUNIDADE, PRECO FROM PRODUTOPRECO WHERE CDPRODUTO=? AND IDPRECO=? AND CDUNIDADE=?",
      [item.produto, item.tabela, item.unidade],
    );
    if (rows[0]) current.push(rows[0]);
  }
  const divergencias = pricesMatch(snapshot, current);
  if (divergencias.length || current.length !== snapshot.length) {
    const error = new Error("Não consegui concluir a atualização porque alguns registros foram alterados durante o processamento.");
    error.status = 409;
    error.code = "concorrencia";
    error.divergencias = divergencias;
    throw error;
  }
  for (const item of snapshot) {
    await tx.execute(
      "UPDATE PRODUTOPRECO SET PRECO=?, DTREAJUSTE=CURRENT_TIMESTAMP, DTALTER=CURRENT_TIMESTAMP, SIST_ALT='CHARLIE' WHERE CDPRODUTO=? AND IDPRECO=? AND CDUNIDADE=?",
      [item.novo, item.produto, item.tabela, item.unidade],
    );
  }
  for (const item of snapshot) {
    const rows = await tx.query(
      "SELECT PRECO FROM PRODUTOPRECO WHERE CDPRODUTO=? AND IDPRECO=? AND CDUNIDADE=?",
      [item.produto, item.tabela, item.unidade],
    );
    if (Math.abs(roundMoney(rows[0]?.PRECO) - item.novo) > 0.001) {
      const error = new Error("A atualização não foi confirmada pelo serviço de preços.");
      error.status = 409;
      throw error;
    }
  }
  return { quantidadeConcluida: snapshot.length, servico: "PRODUTOPRECO" };
}

export async function estoqueBaixo(deps, params, suggest = false) {
  const limit = integer(params.limite, 100);
  const inherited = Array.isArray(deps.inputRows) ? deps.inputRows : null;
  const rows = inherited || await deps.query(
    `SELECT FIRST ${limit}
       m.CDPRODUTO AS CODIGO, p.PRODUTO AS DESCRICAO, m.QTDEATUAL AS ESTOQUE_ATUAL, m.QTDEMINIMA AS ESTOQUE_MINIMO,
       p.CDFORNECEDOR, COALESCE(f.FORNECEDOR,f.FANTASIA,'Sem fornecedor cadastrado') AS FORNECEDOR,
       (m.QTDEMINIMA-m.QTDEATUAL) AS SUGESTAO
     FROM MOVIMENTO m
     JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
     LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=p.CDFORNECEDOR
     WHERE m.QTDEATUAL<=m.QTDEMINIMA AND m.QTDEMINIMA>0 AND COALESCE(p.INATIVO,0)=0
     ORDER BY (m.QTDEATUAL-m.QTDEMINIMA)`,
  );
  const linhas = rows.map((row) => ({
    CODIGO: row.CODIGO,
    DESCRICAO: displayName(row.DESCRICAO),
    ESTOQUE_ATUAL: Number(row.ESTOQUE_ATUAL || 0),
    ESTOQUE_MINIMO: Number(row.ESTOQUE_MINIMO || 0),
    CDFORNECEDOR: row.CDFORNECEDOR ?? null,
    FORNECEDOR: displayName(row.FORNECEDOR || "Sem fornecedor cadastrado"),
    ...(suggest ? { SUGESTAO: Number(row.SUGESTAO ?? (Number(row.ESTOQUE_MINIMO || 0) - Number(row.ESTOQUE_ATUAL || 0))) } : {}),
  }));
  return {
    linhas,
    quantidade: linhas.length,
    periodo: "Posição atual do estoque",
    totalizar: true,
    resumo: linhas.length
      ? suggest
        ? `Preparei sugestão de compra para ${linhas.length} produto(s) abaixo do mínimo. Nenhuma ordem foi gerada.`
        : `Encontrei ${linhas.length} produto(s) com estoque igual ou inferior ao mínimo.`
      : "Não encontrei produtos abaixo do estoque mínimo.",
    etapas: [{ nome: suggest ? "Sugestão de compra" : "Consulta de estoque", situacao: "concluida", quantidade: linhas.length }],
  };
}

export async function rascunhoCliente(_deps, params) {
  const linhas = [{
    NOME: params.nome,
    DOCUMENTO: params.documento || "",
    EMAIL: params.email || "",
    TELEFONE: params.telefone || "",
    CIDADE: params.cidade || "",
    SITUACAO: "Rascunho",
  }];
  return {
    linhas,
    quantidade: 1,
    resumo: `Organizei o rascunho do cliente ${params.nome}. O cadastro não foi gravado no ERP.`,
    etapas: [
      { nome: "Coleta dos dados", situacao: "concluida", quantidade: 1 },
      { nome: "Gravação do cadastro", situacao: "bloqueado", quantidade: 0 },
    ],
  };
}

function digits(value) { return String(value || "").replace(/\D/g, ""); }
function validDocument(value) {
  const number = digits(value);
  if (!number) return true;
  if (![11, 14].includes(number.length) || /^(\d)\1+$/.test(number)) return false;
  const check = (base, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  if (number.length === 11) {
    const d1 = check(number, [10,9,8,7,6,5,4,3,2]);
    const d2 = check(number, [11,10,9,8,7,6,5,4,3,2]);
    return d1 === Number(number[9]) && d2 === Number(number[10]);
  }
  const d1 = check(number, [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = check(number, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return d1 === Number(number[12]) && d2 === Number(number[13]);
}

export async function prepararCliente(deps, params) {
  if (!validDocument(params.documento)) throw Object.assign(new Error("O CPF/CNPJ informado é inválido."), { status: 400 });
  const duplicate = params.documento ? await deps.query("SELECT FIRST 1 CDCLIENTE, CLIENTE, CGC FROM CLIENTE WHERE REPLACE(REPLACE(REPLACE(CGC,'.',''),'-',''),'/','')=?", [digits(params.documento)]) : [];
  if (duplicate.length) throw Object.assign(new Error(`Já existe o cliente ${duplicate[0].CLIENTE} com esse documento.`), { status: 409 });
  const snapshot = [{ tipo: "criar_cliente", ...params, documento: digits(params.documento) || "" }];
  return { linhas: [{ CLIENTE: params.nome, DOCUMENTO: params.documento || "", TELEFONE: params.telefone || "", EMAIL: params.email || "", ENDERECO: params.endereco || "", SITUACAO: "Prévia" }], snapshot, quantidade: 1, quantidadeElegivel: 1, resumo: "Cadastro validado e pronto para confirmação.", etapas: [{ nome: "Validação cadastral", situacao: "concluida", quantidade: 1 }] };
}

const CLIENT_FIELDS = { telefone: "TELEFONE", email: "EMAIL", endereco: "ENDERECO", observacao: "OBS" };
export async function prepararAtualizacaoCliente(deps, params) {
  const id = Number(params.cliente);
  const rows = await deps.query(`SELECT FIRST 2 CDCLIENTE, CLIENTE, TELEFONE, EMAIL, ENDERECO, OBS, DTALTER FROM CLIENTE WHERE ${Number.isInteger(id) ? "CDCLIENTE=?" : "CLIENTE CONTAINING ?"}`, [Number.isInteger(id) ? id : params.cliente]);
  if (!rows.length) throw Object.assign(new Error("Cliente não encontrado."), { status: 404 });
  if (rows.length > 1) throw Object.assign(new Error("Encontrei mais de um cliente. Informe o código para continuar."), { status: 409 });
  const row = rows[0], column = CLIENT_FIELDS[params.campo];
  const snapshot = [{ tipo: "atualizar_cliente", cliente: Number(row.CDCLIENTE), nome: row.CLIENTE, campo: params.campo, coluna: column, anterior: String(row[column] ?? ""), novo: params.valor, versao: row.DTALTER ? new Date(row.DTALTER).toISOString() : null }];
  return { linhas: [{ CLIENTE: row.CLIENTE, CAMPO: params.campo, VALOR_ATUAL: snapshot[0].anterior, NOVO_VALOR: params.valor }], snapshot, quantidade: 1, quantidadeElegivel: 1, resumo: "Alteração cadastral pronta para confirmação.", etapas: [{ nome: "Validação cadastral", situacao: "concluida", quantidade: 1 }] };
}

export async function prepararPedidoRascunho(deps, params) {
  const service = deps.writeServices?.pedidos;
  if (!service?.preparar) throw Object.assign(new Error("O serviço oficial de pedidos não está disponível nesta instalação."), { status: 503 });
  return service.preparar(params, deps);
}

export async function rascunhoPedido(_deps, params) {
  const linhas = [{ CLIENTE: params.cliente, ITENS: params.itens, SITUACAO: "Rascunho" }];
  return {
    linhas,
    quantidade: 1,
    resumo: `Preparei um rascunho de pedido para ${params.cliente}. Nenhum pedido foi gravado.`,
    etapas: [
      { nome: "Rascunho do pedido", situacao: "concluida", quantidade: 1 },
      { nome: "Gravação do pedido", situacao: "bloqueado", quantidade: 0 },
    ],
  };
}

export async function faturamentoPeriodo(deps, params) {
  const periodo = periodLabel(params, `Últimos ${integer(params.meses, 6)} meses`);
  const daily = params.periodo === "mes";
  const rows = await deps.query(
    daily
      ? `SELECT CAST(se.DTSAIDA AS DATE) AS DATA,
                COUNT(DISTINCT se.NRPEDIDO) AS PEDIDOS,
                SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL
         FROM SAIDAESTOQUE se
         JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
         WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
           AND ${salesPeriod(params)}
         GROUP BY 1
         ORDER BY 1`
      : `SELECT EXTRACT(YEAR FROM se.DTSAIDA) AS ANO, EXTRACT(MONTH FROM se.DTSAIDA) AS MES,
                COUNT(DISTINCT se.NRPEDIDO) AS PEDIDOS,
                SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL
         FROM SAIDAESTOQUE se
         JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
         WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
           AND ${salesPeriod(params)}
         GROUP BY 1, 2
         ORDER BY 1, 2`,
  );
  const linhas = rows.map((row) => daily
    ? { DATA: row.DATA, PEDIDOS: Number(row.PEDIDOS || 0), TOTAL: roundMoney(row.TOTAL) }
    : { ANO: Number(row.ANO), MES: Number(row.MES), PEDIDOS: Number(row.PEDIDOS || 0), TOTAL: roundMoney(row.TOTAL) });
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.TOTAL, 0));
  return reportResult({
    linhas,
    periodo,
    totais: { TOTAL: total, PEDIDOS: linhas.reduce((sum, row) => sum + row.PEDIDOS, 0) },
    etapa: "Faturamento do período",
    resumo: linhas.length
      ? `Faturamento de ${periodo.toLowerCase()}: ${money(total)}.`
      : `Não encontrei faturamento em ${periodo.toLowerCase()}.`,
  });
}

export async function faturamentoCliente(deps, params) {
  const limit = capLimit(params.limite, 100);
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       COALESCE(c.CLIENTE, se.CLIENTE) AS CLIENTE,
       COUNT(DISTINCT se.NRPEDIDO) AS PEDIDOS,
       SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL
     FROM SAIDAESTOQUE se
     JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
     LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
     WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0 AND ${salesPeriod(params)}
     GROUP BY 1
     ORDER BY 3 DESC`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    CLIENTE: displayName(row.CLIENTE),
    PEDIDOS: Number(row.PEDIDOS || 0),
    TOTAL: roundMoney(row.TOTAL),
  }));
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.TOTAL, 0));
  const periodo = periodLabel(params);
  return reportResult({
    linhas,
    extra,
    limit,
    periodo,
    totais: { TOTAL: total, PEDIDOS: linhas.reduce((sum, row) => sum + row.PEDIDOS, 0) },
    etapa: "Faturamento por cliente",
    resumo: linhas.length
      ? `Faturamento de ${String(periodo).toLowerCase()} em ${linhas.length} cliente(s): ${money(total)}.`
      : "Não encontrei vendas válidas nesse período.",
  });
}

export async function produtosVendidos(deps, params) {
  const limit = capLimit(params.limite, 20);
  const direction = params.ordem === "menos" ? "ASC" : "DESC";
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       sp.CDPRODUTO AS CODIGO,
       COALESCE(p.PRODUTO, sp.CDPRODUTO) AS DESCRICAO,
       SUM(COALESCE(sp.QTDPRODUTO,0)) AS QUANTIDADE,
       SUM(COALESCE(sp.SUBTOTAL, sp.TOTAL, sp.QTDPRODUTO * sp.VLUNIT, 0)) AS TOTAL
     FROM SAIDAPRODUTO sp
     JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
     LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
     WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0 AND ${salesPeriod(params)}
     GROUP BY 1, 2
     ORDER BY 3 ${direction}, 4 ${direction}`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    CODIGO: row.CODIGO,
    DESCRICAO: displayName(row.DESCRICAO),
    QUANTIDADE: Number(row.QUANTIDADE || 0),
    TOTAL: roundMoney(row.TOTAL),
  }));
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.TOTAL, 0));
  const titulo = params.ordem === "menos" ? "menos vendidos" : "mais vendidos";
  return reportResult({
    linhas,
    extra,
    limit,
    periodo: periodLabel(params),
    totais: { TOTAL: total, QUANTIDADE: linhas.reduce((sum, row) => sum + row.QUANTIDADE, 0) },
    etapa: "Ranking de produtos",
    resumo: linhas.length
      ? `Listei ${linhas.length} produto(s) ${titulo}, somando ${money(total)}.`
      : "Não encontrei vendas válidas nesse período.",
  });
}

export async function inadimplencia(deps, params) {
  if (params.agrupar === "vendedor" && params.dominio === "pagar") {
    const error = new Error("Contas a pagar não têm vendedor vinculado no cadastro validado. Posso separar por fornecedor.");
    error.status = 422;
    throw error;
  }
  const group = params.agrupar === "vendedor" ? "VENDEDOR" : "PESSOA";
  const built = titleQuery({ ...params, limite: REPORT_CAP }, "vencido");
  const rows = await deps.query(built.sql, built.queryParams);
  const groups = new Map();
  for (const row of rows) {
    const nome = displayName(row[group]);
    const current = groups.get(nome) || { [group]: nome, TITULOS: 0, SALDO: 0, DIAS_ATRASO: 0 };
    current.TITULOS += 1;
    current.SALDO = roundMoney(current.SALDO + Number(row.SALDO || 0));
    current.DIAS_ATRASO = Math.max(current.DIAS_ATRASO, Number(row.DIAS_ATRASO || 0));
    groups.set(nome, current);
  }
  const limit = capLimit(params.limite, 200);
  const ordered = [...groups.values()].sort((a, b) => b.SALDO - a.SALDO);
  const linhas = ordered.slice(0, limit);
  const detalhe = rows.slice(0, REPORT_CAP).map((row) => ({
    CONTROLE: row.CONTROLE,
    PESSOA: displayName(row.PESSOA),
    VENDEDOR: displayName(row.VENDEDOR),
    VENCIMENTO: row.VENCIMENTO,
    SALDO: roundMoney(row.SALDO),
    DIAS_ATRASO: Number(row.DIAS_ATRASO || 0),
  })).sort((a, b) => String(a.PESSOA).localeCompare(String(b.PESSOA), "pt-BR")
    || String(a.VENCIMENTO || "").localeCompare(String(b.VENCIMENTO || "")));
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.SALDO, 0));
  return reportResult({
    linhas,
    detalhe,
    extra: ordered.length > limit,
    limit,
    grupo: null,
    periodo: `Vencidos a partir de ${integer(params.dias, 1)} dia(s)`,
    totais: { SALDO: total, TITULOS: linhas.reduce((sum, row) => sum + row.TITULOS, 0) },
    etapa: "Inadimplência",
    resumo: linhas.length
      ? `Inadimplência de ${linhas.length} ${group === "VENDEDOR" ? "vendedor(es)" : "pessoa(s)"}: ${money(total)}.`
      : "Não encontrei títulos vencidos com esses filtros.",
  });
}

async function quitados(deps, params, receive) {
  const limit = capLimit(params.limite, 500);
  const table = receive ? "CTARECEBER" : "CTAPAGAR";
  const personTable = receive ? "CLIENTE" : "FORNECEDOR";
  const personId = receive ? "CDCLIENTE" : "CDFORNECEDOR";
  const personName = receive ? "c.CLIENTE" : "c.FORNECEDOR";
  const paid = receive ? "COALESCE(t.VLPGLIQ, t.TOTALPG, 0)" : "COALESCE(t.VLPAGTO, 0)";
  const paidAt = receive ? "t.DTCOB" : "t.DTPAGTO";
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       t.CONTROLE, ${personName} AS PESSOA, CAST(${paidAt} AS DATE) AS DATA_BAIXA, ${paid} AS TOTAL
     FROM ${table} t
     LEFT JOIN ${personTable} c ON c.${personId}=t.${personId}
     WHERE t.STATUS=2 AND ${paidAt} IS NOT NULL AND ${paidAt}>CAST('1899-12-30' AS DATE)
       AND ${paidPeriod(paidAt, params)}
     ORDER BY ${paidAt} DESC`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    CONTROLE: row.CONTROLE,
    PESSOA: displayName(row.PESSOA),
    DATA_BAIXA: row.DATA_BAIXA,
    TOTAL: roundMoney(row.TOTAL),
  }));
  const total = roundMoney(linhas.reduce((sum, row) => sum + row.TOTAL, 0));
  const periodo = periodLabel(params, "Mês atual");
  const nome = receive ? "recebimento(s)" : "pagamento(s)";
  return reportResult({
    linhas,
    extra,
    limit,
    periodo,
    totais: { TOTAL: total },
    etapa: receive ? "Recebimentos" : "Pagamentos",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} ${nome} em ${periodo.toLowerCase()}, somando ${money(total)}.`
      : `Não encontrei ${nome} em ${periodo.toLowerCase()}.`,
  });
}

export function recebimentosPeriodo(deps, params) {
  return quitados(deps, params, true);
}

export function pagamentosPeriodo(deps, params) {
  return quitados(deps, params, false);
}

export async function estoqueNegativo(deps, params) {
  const limit = capLimit(params.limite, 200);
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       m.CDPRODUTO AS CODIGO, p.PRODUTO AS DESCRICAO, SUM(m.QTDEATUAL) AS ESTOQUE
     FROM MOVIMENTO m
     JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
     WHERE COALESCE(p.INATIVO,0)=0
     GROUP BY m.CDPRODUTO, p.PRODUTO
     HAVING SUM(COALESCE(m.QTDEATUAL,0))<0
     ORDER BY 3`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    CODIGO: row.CODIGO,
    DESCRICAO: displayName(row.DESCRICAO),
    ESTOQUE: Number(row.ESTOQUE || 0),
  }));
  return reportResult({
    linhas,
    extra,
    limit,
    periodo: "Posição atual do estoque",
    totais: { ESTOQUE: linhas.reduce((sum, row) => sum + row.ESTOQUE, 0) },
    etapa: "Estoque negativo",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} produto(s) com estoque negativo.`
      : "Não encontrei estoque negativo.",
  });
}

export async function semMovimentacao(deps, params) {
  const dias = integer(params.dias, 90);
  const limit = capLimit(params.limite, 200);
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       m.CDPRODUTO AS CODIGO, COALESCE(p.PRODUTO, m.CDPRODUTO) AS DESCRICAO,
       SUM(m.QTDEATUAL) AS ESTOQUE,
       SUM(COALESCE(m.QTDEATUAL,0)*COALESCE(p.VLCUSTOMEDIO,0)) AS CUSTO
     FROM MOVIMENTO m
     JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
     WHERE COALESCE(p.INATIVO,0)=0 AND COALESCE(m.QTDEATUAL,0)>0
       AND NOT EXISTS (
         SELECT 1 FROM SAIDAPRODUTO sp
         JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
         WHERE sp.CDPRODUTO=m.CDPRODUTO AND se.DTCANCELAMENTO IS NULL
           AND se.DTSAIDA>=DATEADD(-${dias} DAY TO CURRENT_DATE)
       )
     GROUP BY m.CDPRODUTO, p.PRODUTO
     ORDER BY 4 DESC`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    CODIGO: row.CODIGO,
    DESCRICAO: displayName(row.DESCRICAO),
    ESTOQUE: Number(row.ESTOQUE || 0),
    CUSTO: roundMoney(row.CUSTO),
  }));
  return reportResult({
    linhas,
    extra,
    limit,
    periodo: `Sem venda há ${dias} dias ou mais`,
    totais: { ESTOQUE: linhas.reduce((sum, row) => sum + row.ESTOQUE, 0), CUSTO: roundMoney(linhas.reduce((sum, row) => sum + row.CUSTO, 0)) },
    etapa: "Produtos sem movimentação",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} produto(s) com saldo e sem venda válida nos últimos ${dias} dias.`
      : `Não encontrei produtos parados nos últimos ${dias} dias.`,
  });
}

export async function comparativoPrecos(deps, params) {
  const limit = capLimit(params.limite, 200);
  const primeira = integer(params.tabela, 0);
  const segunda = integer(params.tabelaComparar, 0);
  if (primeira && segunda) {
    const rows = await deps.query(
      `SELECT FIRST ${limit + 1}
         p.CDPRODUTO AS CODIGO, p.PRODUTO AS DESCRICAO, a.PRECO AS PRECO_A, b.PRECO AS PRECO_B
       FROM PRODUTO p
       JOIN PRODUTOPRECO a ON a.CDPRODUTO=p.CDPRODUTO AND a.IDPRECO=?
       JOIN PRODUTOPRECO b ON b.CDPRODUTO=p.CDPRODUTO AND b.IDPRECO=? AND b.CDUNIDADE=a.CDUNIDADE
       WHERE COALESCE(p.INATIVO,0)=0
       ORDER BY p.PRODUTO`,
      [primeira, segunda],
    );
    const extra = rows.length > limit;
    const linhas = rows.slice(0, limit).map((row) => ({
      CODIGO: row.CODIGO,
      DESCRICAO: displayName(row.DESCRICAO),
      PRECO_A: roundMoney(row.PRECO_A),
      PRECO_B: roundMoney(row.PRECO_B),
      DIFERENCA: roundMoney(Number(row.PRECO_B || 0) - Number(row.PRECO_A || 0)),
    }));
    return reportResult({
      linhas,
      extra,
      limit,
      periodo: `Tabelas ${primeira} e ${segunda}`,
      totais: { DIFERENCA: roundMoney(linhas.reduce((sum, row) => sum + row.DIFERENCA, 0)) },
      etapa: "Comparativo de preços",
      resumo: linhas.length
        ? `Comparei ${linhas.length} preço(s) entre as tabelas ${primeira} e ${segunda}.`
        : "Não encontrei preços nas duas tabelas.",
    });
  }
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       p.CDPRODUTO AS CODIGO, p.PRODUTO AS DESCRICAO, pp.IDPRECO AS TABELA,
       pp.PRECO, COALESCE(pp.VLCUSTO,0) AS CUSTO
     FROM PRODUTO p
     JOIN PRODUTOPRECO pp ON ${DEFAULT_PRICE_JOIN}
     WHERE COALESCE(p.INATIVO,0)=0 AND COALESCE(pp.PRECO,0)>0
     ORDER BY p.PRODUTO`,
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => {
    const preco = roundMoney(row.PRECO);
    const custo = roundMoney(row.CUSTO);
    return {
      CODIGO: row.CODIGO,
      DESCRICAO: displayName(row.DESCRICAO),
      TABELA: row.TABELA,
      PRECO: preco,
      CUSTO: custo,
      DIFERENCA: roundMoney(preco - custo),
      MARGEM: preco > 0 ? roundMoney(((preco - custo) / preco) * 100) : 0,
    };
  });
  return reportResult({
    linhas,
    extra,
    limit,
    periodo: "Tabela padrão de cada produto",
    etapa: "Comparativo de preços",
    resumo: linhas.length
      ? `Comparei preço e custo de ${linhas.length} produto(s).`
      : "Não encontrei preços para comparar.",
  });
}

export async function alteracaoCusto(deps, params) {
  const percentual = Number(params.percentual ?? 10);
  const dias = integer(params.dias, 30);
  const limit = capLimit(params.limite, 200);
  const rows = await deps.query(
    `SELECT FIRST ${limit + 1}
       ep.CDPRODUTO AS CODIGO,
       COALESCE(p.PRODUTO, ep.DESCRICAO) AS DESCRICAO,
       MAX(ep.CUSTOMED_ANTERIOR) AS CUSTO_ANTERIOR,
       MAX(COALESCE(ep.VLCUSTO, ep.VLUNIT, 0)) AS CUSTO_ATUAL,
       MAX(CASE WHEN COALESCE(ep.CUSTOMED_ANTERIOR,0)>0
         THEN (COALESCE(ep.VLCUSTO, ep.VLUNIT, 0) - ep.CUSTOMED_ANTERIOR) / ep.CUSTOMED_ANTERIOR * 100 END) AS VARIACAO
     FROM ENTRPRODUTO ep
     JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA
     LEFT JOIN PRODUTO p ON p.CDPRODUTO=ep.CDPRODUTO
     WHERE ee.DTCANCELAMENTO IS NULL
       AND ee.DTENTRADA>=DATEADD(-${dias} DAY TO CURRENT_DATE)
     GROUP BY ep.CDPRODUTO, p.PRODUTO, ep.DESCRICAO
     HAVING MAX(CASE WHEN COALESCE(ep.CUSTOMED_ANTERIOR,0)>0
       THEN (COALESCE(ep.VLCUSTO, ep.VLUNIT, 0) - ep.CUSTOMED_ANTERIOR) / ep.CUSTOMED_ANTERIOR * 100 END) >= ?
     ORDER BY 5 DESC`,
    [percentual],
  );
  const extra = rows.length > limit;
  const linhas = rows.slice(0, limit).map((row) => ({
    CODIGO: row.CODIGO,
    DESCRICAO: displayName(row.DESCRICAO),
    CUSTO_ANTERIOR: roundMoney(row.CUSTO_ANTERIOR),
    CUSTO_ATUAL: roundMoney(row.CUSTO_ATUAL),
    VARIACAO: roundMoney(row.VARIACAO),
  }));
  return reportResult({
    linhas,
    extra,
    limit,
    periodo: `Entradas dos últimos ${dias} dias`,
    etapa: "Alteração de custo",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} produto(s) com custo pelo menos ${percentual}% acima da entrada anterior.`
      : `Não encontrei alteração de custo igual ou acima de ${percentual}% nos últimos ${dias} dias.`,
  });
}

export async function reducaoCompras(deps, params) {
  const meses = integer(params.meses, 3);
  const limite = capLimit(params.limite, 200);
  const percentual = Number(params.percentual ?? 10);
  const rows = await deps.query(
    `SELECT FIRST ${limite + 1}
       c.CDCLIENTE AS CODIGO, c.CLIENTE AS CLIENTE,
       COALESCE(v.VENDEDOR, 'Sem vendedor') AS VENDEDOR,
       SUM(CASE WHEN se.DTSAIDA>=DATEADD(-${meses} MONTH TO CURRENT_DATE)
                THEN COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0) ELSE 0 END) AS PERIODO_ATUAL,
       SUM(CASE WHEN se.DTSAIDA<DATEADD(-${meses} MONTH TO CURRENT_DATE)
                 AND se.DTSAIDA>=DATEADD(-${meses * 2} MONTH TO CURRENT_DATE)
                THEN COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0) ELSE 0 END) AS PERIODO_ANTERIOR
     FROM CLIENTE c
     JOIN SAIDAESTOQUE se ON se.CDCLIENTE=c.CDCLIENTE
     JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
     LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=c.CDVENDEDOR
     WHERE se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
       AND se.DTSAIDA>=DATEADD(-${meses * 2} MONTH TO CURRENT_DATE)
     GROUP BY c.CDCLIENTE,c.CLIENTE,v.VENDEDOR
     HAVING SUM(CASE WHEN se.DTSAIDA<DATEADD(-${meses} MONTH TO CURRENT_DATE)
                      THEN COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0) ELSE 0 END)>0
        AND SUM(CASE WHEN se.DTSAIDA>=DATEADD(-${meses} MONTH TO CURRENT_DATE)
                      THEN COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0) ELSE 0 END)
            <= SUM(CASE WHEN se.DTSAIDA<DATEADD(-${meses} MONTH TO CURRENT_DATE)
                         THEN COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0) ELSE 0 END) * ?
     ORDER BY 3, 5 DESC`,
    [1 - percentual / 100],
  );
  const extra = rows.length > limite;
  const linhas = rows.slice(0, limite).map((row) => {
    const anterior = roundMoney(row.PERIODO_ANTERIOR);
    const atual = roundMoney(row.PERIODO_ATUAL);
    return {
      CODIGO: row.CODIGO,
      CLIENTE: displayName(row.CLIENTE),
      VENDEDOR: displayName(row.VENDEDOR),
      PERIODO_ANTERIOR: anterior,
      PERIODO_ATUAL: atual,
      REDUCAO_PERCENTUAL: anterior ? roundMoney(((anterior - atual) / anterior) * 100) : 0,
    };
  });
  return reportResult({
    linhas, extra, limit: limite,
    periodo: `Dois períodos equivalentes de ${meses} mês(es)`,
    etapa: "Comparação de compras por cliente",
    resumo: linhas.length
      ? `Encontrei ${linhas.length} cliente(s) com redução de compras de pelo menos ${percentual}%.`
      : `Não encontrei clientes com redução de pelo menos ${percentual}% nos períodos comparados.`,
  });
}

export async function calcularPrecoMargem(deps, params) {
  const margemAlvo = Number(params.margemAlvo);
  const rows = Array.isArray(deps.inputRows) ? deps.inputRows : [];
  const linhas = rows.map((row) => {
    const custo = Number(row.CUSTO || 0);
    const necessario = margemAlvo < 100 ? roundMoney(custo / (1 - margemAlvo / 100)) : 0;
    return { ...row, PRECO_NECESSARIO: necessario, MARGEM_ALVO: margemAlvo };
  });
  return {
    linhas,
    quantidade: linhas.length,
    resumo: `Calculei o preço necessário para margem de ${margemAlvo}% em ${linhas.length} produto(s). Nenhum preço foi alterado.`,
    etapas: [{ nome: "Simulação de preço", situacao: "concluida", quantidade: linhas.length }],
  };
}

export async function relatorioEstruturado(deps, params) {
  const linhas = Array.isArray(deps.inputRows) ? deps.inputRows : [];
  return {
    linhas,
    rascunhos: Array.isArray(deps.inputDrafts) ? deps.inputDrafts : [],
    quantidade: linhas.length,
    periodo: deps.inputPeriod || null,
    totalizar: true,
    resumo: `Relatório ${String(params.formato || "excel").toUpperCase()} preparado com ${linhas.length} registro(s).`,
    etapas: [{ nome: "Preparação do relatório", situacao: "concluida", quantidade: linhas.length }],
  };
}

export async function resultadosCharlie(deps, params) {
  const end = new Date(), start = new Date(end); start.setMonth(start.getMonth() - Math.max(1, Number(params.meses) || 1));
  const dashboard = valueDashboard(deps.actor || {}, { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
  const linhas = Object.entries(dashboard.totals).map(([category, total]) => ({ CATEGORIA: category, VALOR: total.value, MINUTOS: total.minutes, QUANTIDADE: total.quantity, REGISTROS: total.count, VALIDADOS: total.validated }));
  linhas.push({ CATEGORIA: "custos_operacionais", VALOR: dashboard.costs.total, MINUTOS: 0, QUANTIDADE: 0, REGISTROS: dashboard.costs.count, VALIDADOS: dashboard.costs.count });
  return { linhas, quantidade: linhas.length, periodo: `${start.toISOString().slice(0,10)} a ${end.toISOString().slice(0,10)}`, totalizar: false, resumo: dashboard.roi.available ? `Relatório de resultados preparado. ROI calculável: ${dashboard.roi.percentage}%.` : `Relatório de resultados preparado. ROI não apresentado: ${dashboard.roi.reason}`, etapas: [{ nome: "Consolidação auditável dos resultados", situacao: "concluida", quantidade: linhas.length }] };
}

export async function preverFaturamento(deps, params) {
  const rows = await deps.query(`SELECT CAST(se.DTSAIDA AS DATE) DATA,
    COALESCE(SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)),0) VALOR
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    WHERE se.DTSAIDA>=DATEADD(-365 DAY TO CURRENT_DATE) AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(sp.STATUSSE,0)=0 AND COALESCE(se.STATUS,0) IN (1,3)
    GROUP BY CAST(se.DTSAIDA AS DATE) ORDER BY 1`, []);
  const result = forecastSeries(rows, { dateField: "DATA", valueField: "VALOR", horizon: params.dias, minimumRecords: 28 });
  return { linhas: result.forecasts || [], quantidade: result.forecasts?.length || 0, resumo: result.ok ? `Previsão de faturamento: ${money(result.total)} nos próximos ${params.dias} dias; modelo ${result.model}, qualidade ${result.quality.status}. É uma projeção, não uma garantia.` : result.message, etapas: [{ nome: "Backtesting e previsão", situacao: result.ok ? "concluida" : "concluida_parcial", quantidade: result.validation?.samples || 0 }] };
}

export async function preverFluxoCaixa(deps, params) {
  const [balance] = await deps.query("SELECT COALESCE(SUM(COALESCE(VALOR,0)),0) TOTAL FROM MOV_BANCARIO", []);
  const receiving = await deps.query("SELECT CAST(DTVENC AS DATE) DATA,COALESCE(SUM(COALESCE(VALOR,0)-COALESCE(VLPAGO,0)-COALESCE(VLDESCONTO,0)),0) VALOR FROM CTARECEBER WHERE STATUS=1 AND DTVENC BETWEEN CURRENT_DATE AND DATEADD(? DAY TO CURRENT_DATE) GROUP BY CAST(DTVENC AS DATE)", [params.dias]);
  const paying = await deps.query("SELECT CAST(DTVENC AS DATE) DATA,COALESCE(SUM(COALESCE(VALOR,0)-COALESCE(VLPAGO,0)-COALESCE(VLDESCONTO,0)),0) VALOR FROM CTAPAGAR WHERE STATUS=1 AND DTVENC BETWEEN CURRENT_DATE AND DATEADD(? DAY TO CURRENT_DATE) GROUP BY CAST(DTVENC AS DATE)", [params.dias]);
  const mapped = (rows) => rows.map((row) => ({ date: row.DATA, value: row.VALOR }));
  const result = projectCashFlow({ openingBalance: balance?.TOTAL, receivables: mapped(receiving), payables: mapped(paying), horizon: params.dias, receiptRate: 0.95 });
  return { linhas: result.projection, quantidade: result.projection.length, resumo: `Fluxo projetado por ${params.dias} dias: saldo final ${money(result.closingBalance)}.${result.firstNegativeDate ? ` Primeiro saldo negativo em ${result.firstNegativeDate}.` : " Sem saldo negativo no cenário base."}`, etapas: [{ nome: "Projeção de caixa", situacao: "concluida", quantidade: result.projection.length }] };
}

export async function preverRupturaEstoque(deps, params) {
  const rows = await deps.query(`SELECT FIRST 500 sp.CDPRODUTO,COALESCE(p.PRODUTO,sp.DESCRICAO) PRODUTO,
    COALESCE((SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO=sp.CDPRODUTO),0) ESTOQUE,
    COALESCE(SUM(sp.QTDPRODUTO),0)/CAST(? AS NUMERIC(18,4)) DEMANDA_DIA
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE) AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0
    GROUP BY sp.CDPRODUTO,p.PRODUTO,sp.DESCRICAO ORDER BY 4 DESC`, [params.dias, -params.dias]);
  const result = forecastStock(rows.map((row) => ({ productId: row.CDPRODUTO, product: row.PRODUTO, onHand: row.ESTOQUE, dailyDemand: row.DEMANDA_DIA, leadTimeDays: 15 })), { safetyDays: 7 });
  const high = result.filter((item) => item.risk === "alto");
  return { linhas: result, quantidade: result.length, resumo: `${high.length} produto(s) com risco alto de ruptura. A compra sugerida é apenas uma recomendação e não foi efetivada.`, etapas: [{ nome: "Cobertura e risco de estoque", situacao: "concluida", quantidade: result.length }] };
}

export async function auditarDuplicidadesFinanceiras(deps, params) {
  const limit = Math.max(1, Math.min(1000, Number(params.limite) || 500));
  const receiving = await deps.query(`SELECT FIRST ${limit} 'receber' DOMINIO,CONTROLE ID,CDCLIENTE PESSOA,TRIM(NRDOC) DOCUMENTO,PARCELA,VALOR,CAST(DTVENC AS DATE) VENCIMENTO FROM CTARECEBER WHERE STATUS=1 AND DTVENC>=DATEADD(? DAY TO CURRENT_DATE)`, [-Number(params.dias)]);
  const paying = await deps.query(`SELECT FIRST ${limit} 'pagar' DOMINIO,CONTROLE ID,CDFORNECEDOR PESSOA,TRIM(NOTAFISCAL) DOCUMENTO,PARCELA,VALOR,CAST(DTVENC AS DATE) VENCIMENTO FROM CTAPAGAR WHERE STATUS=1 AND DTVENC>=DATEADD(? DAY TO CURRENT_DATE)`, [-Number(params.dias)]);
  const groups = findFinancialDuplicates([...receiving, ...paying].map((row) => ({ domain: row.DOMINIO, id: row.ID, partyId: row.PESSOA, document: row.DOCUMENTO, installment: row.PARCELA, amount: row.VALOR, dueDate: row.VENCIMENTO })));
  const linhas = groups.flatMap((group, index) => group.records.map((row) => ({ GRUPO: index + 1, DOMINIO: row.domain, ID: row.id, PESSOA: row.partyId, DOCUMENTO: row.document, PARCELA: row.installment, VALOR: row.amount, VENCIMENTO: row.dueDate, CLASSIFICACAO: "Possível duplicidade" })));
  return { linhas, quantidade: linhas.length, resumo: groups.length ? `Encontrei ${groups.length} grupo(s) de possíveis duplicidades. A coincidência não confirma lançamento duplicado.` : "Não encontrei possíveis duplicidades pelos critérios configurados.", etapas: [{ nome: "Auditoria de duplicidades", situacao: "concluida", quantidade: groups.length }] };
}

export async function analisarRiscosComportamentais(_deps, params) {
  runBehavioralRiskAnalysis();
  const rank = { baixo: 0, moderado: 1, elevado: 2 }, minimum = params.risco === "elevado" ? 2 : params.risco === "moderado" ? 1 : 0;
  const analyses = listBehavioralAnalyses({}, { limit: params.limite }).filter((item) => rank[item.risk?.level] >= minimum);
  const linhas = analyses.map((item) => ({ ANALISE: item.id, TITULO: item.title, CATEGORIA: item.category, RISCO: item.risk?.level, SINAIS: item.risk?.signals, EVENTOS: item.eventIds?.length || 0, PERIODO_INICIO: item.period?.from, PERIODO_FIM: item.period?.to, MODELO: `${item.model} ${item.modelVersion}`, CONCLUSAO: item.lastFeedback?.classification || "Pendente" }));
  return { linhas, quantidade: linhas.length, resumo: linhas.length ? `${linhas.length} análise(s) de risco requerem revisão humana. A classificação representa prioridade, não probabilidade de fraude.` : "Nenhuma anomalia com os filtros informados.", etapas: [{ nome: "Análise comportamental incremental", situacao: "concluida", quantidade: linhas.length }] };
}

export async function resumoExecutivo(deps, params) {
  if (!deps.actor?.gerencial) {
    return { linhas: [], quantidade: 0, resumo: "Resumo executivo exige permissão gerencial. Nada foi consolidado.", etapas: [{ nome: "Permissão", situacao: "bloqueado", quantidade: 0 }] };
  }
  const { buildExecutiveBriefing } = await import("./charlie-executive-service.js");
  const briefing = await buildExecutiveBriefing(deps.actor, { scope: "empresa", live: false, limit: params.limite, changesOnly: true });
  const linhas = (briefing.priorities || []).slice(0, params.limite).map((item, index) => ({
    PRIORIDADE: index + 1,
    AREA: item.area,
    SITUACAO: item.title,
    PONTUACAO: item.score,
    FONTE: item.source?.service || "",
    ATUALIZADO_EM: item.source?.updatedAt || "",
  }));
  return {
    linhas,
    quantidade: linhas.length,
    periodo: briefing.period,
    totalizar: false,
    resumo: briefing.text,
    etapas: [{ nome: "Consolidação executiva das fontes já disponíveis", situacao: "concluida", quantidade: linhas.length }],
  };
}

export const ACTION_RUNNERS = {
  "financeiro.titulos_vencidos": (deps, params) => consultarTitulos(deps, params, "vencido"),
  "financeiro.titulos_a_vencer": (deps, params) => consultarTitulos(deps, params, "vencer"),
  "financeiro.inadimplencia": inadimplencia,
  "financeiro.recebimentos_periodo": recebimentosPeriodo,
  "financeiro.pagamentos_periodo": pagamentosPeriodo,
  "financeiro.preparar_cobrancas": prepararCobrancas,
  "comercial.clientes_inativos": clientesInativos,
  "comercial.ranking_clientes": rankingClientes,
  "comercial.reducao_compras": reducaoCompras,
  "comercial.rascunho_pedido": rascunhoPedido,
  "produtos.margem_insuficiente": margemInsuficiente,
  "produtos.simular_reajuste": simularReajuste,
  "produtos.reajuste_precos": simularReajuste,
  "produtos.calcular_preco_margem": calcularPrecoMargem,
  "estoque.abaixo_minimo": (deps, params) => estoqueBaixo(deps, params, false),
  "estoque.sugestao_compra": (deps, params) => estoqueBaixo(deps, params, true),
  "estoque.negativo": estoqueNegativo,
  "estoque.sem_movimentacao": semMovimentacao,
  "produtos.comparativo_precos": comparativoPrecos,
  "produtos.alteracao_custo": alteracaoCusto,
  "relatorios.faturamento_vendedor": faturamentoVendedor,
  "relatorios.faturamento_cliente": faturamentoCliente,
  "relatorios.faturamento_periodo": faturamentoPeriodo,
  "relatorios.faturamento_mensal": faturamentoMensal,
  "relatorios.produtos_vendidos": produtosVendidos,
  "relatorios.produtos_sem_venda": produtosSemVenda,
  "relatorios.dados_estruturados": relatorioEstruturado,
  "relatorios.resultados_charlie": resultadosCharlie,
  "executivo.resumo": resumoExecutivo,
  "preditivo.faturamento": preverFaturamento,
  "preditivo.fluxo_caixa": preverFluxoCaixa,
  "preditivo.ruptura_estoque": preverRupturaEstoque,
  "auditoria.duplicidades_financeiras": auditarDuplicidadesFinanceiras,
  "auditoria.anomalias_comportamentais": analisarRiscosComportamentais,
  "cadastro.rascunho_cliente": rascunhoCliente,
  "cadastro.criar_cliente": prepararCliente,
  "cadastro.atualizar_cliente": prepararAtualizacaoCliente,
  "comercial.criar_pedido_rascunho": prepararPedidoRascunho,
};
