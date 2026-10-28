import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { loadState } from "./charlie-leads-store.js";
import { montarRecuperacao, registrarAcao, rascunhoRecuperacao } from "./charlie-recovery.js";

const FILE = "charlie_recovery.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return memoria;
  const estado = readJsonConfig(FILE, { acoes: {} });
  if (!estado.acoes || typeof estado.acoes !== "object") estado.acoes = {};
  return estado;
}

function gravar(estado) {
  if (memoria) {
    memoria.acoes = estado.acoes;
    return estado;
  }
  return writeJsonConfig(FILE, estado);
}

function numeroOuNulo(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function inteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, numero));
}

function dataTexto(valor) {
  if (!valor) return "";
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleDateString("pt-BR");
}

async function consultar(query, sql, params) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export async function lerFatos(deps = {}, opcoes = {}) {
  const diasOrcamento = inteiro(opcoes.diasOrcamento, 15, 1, 365);
  const diasCliente = inteiro(opcoes.diasCliente, 60, 1, 730);
  const diasPedido = inteiro(opcoes.diasPedido, 2, 0, 365);
  const orcamentos = await consultar(deps.query, `
    SELECT FIRST 40 o.NRORCAMENTO, o.IDEMPRESA, o.CDCLIENTE, o.CDVENDEDOR,
      COALESCE(v.VENDEDOR, 'Sem vendedor') VENDEDOR,
      COALESCE(c.CLIENTE, c.RAZAO, o.CLIENTE) CLIENTE,
      o.DTORC, o.VLTOTAL
    FROM ORCAMENTO o
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = o.CDVENDEDOR
    LEFT JOIN CLIENTE c ON c.CDCLIENTE = o.CDCLIENTE
    WHERE o.STATUS = 0 AND o.DTCANCELAMENTO IS NULL
      AND o.DTORC < DATEADD(-${diasOrcamento} DAY TO CURRENT_DATE)
    ORDER BY o.VLTOTAL DESC`, []);
  const clientes = await consultar(deps.query, `
    SELECT FIRST 40 c.CDCLIENTE, COALESCE(c.CLIENTE, c.RAZAO) NOME, c.DTULTCOMPRA,
      COALESCE(v.VENDEDOR, 'Sem vendedor') VENDEDOR, c.CDVENDEDOR,
      (SELECT COUNT(*) FROM SAIDAESTOQUE s
        WHERE s.CDCLIENTE = c.CDCLIENTE AND s.DTCANCELAMENTO IS NULL
          AND s.DTSAIDA >= DATEADD(-365 DAY TO CURRENT_DATE)) FREQUENCIA
    FROM CLIENTE c
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = c.CDVENDEDOR
    WHERE COALESCE(c.INATIVO, 0) = 0 AND c.DTULTCOMPRA IS NOT NULL
      AND c.DTULTCOMPRA < DATEADD(-${diasCliente} DAY TO CURRENT_DATE)
    ORDER BY c.DTULTCOMPRA`, []);
  const janelaAtual = "se.DTSAIDA >= DATEADD(-90 DAY TO CURRENT_DATE)";
  const janelaAnterior = "se.DTSAIDA < DATEADD(-90 DAY TO CURRENT_DATE) AND se.DTSAIDA >= DATEADD(-180 DAY TO CURRENT_DATE)";
  const valorPedido = "COALESCE(se.VLTOTAL, se.SUBTOTAL)";
  const semValor = "se.VLTOTAL IS NULL AND se.SUBTOTAL IS NULL";
  const somaAtual = `SUM(CASE WHEN ${janelaAtual} AND ${valorPedido} IS NOT NULL THEN ${valorPedido} ELSE 0 END)`;
  const somaAnterior = `SUM(CASE WHEN ${janelaAnterior} AND ${valorPedido} IS NOT NULL THEN ${valorPedido} ELSE 0 END)`;
  const semAtual = `SUM(CASE WHEN ${janelaAtual} AND ${semValor} THEN 1 ELSE 0 END)`;
  const semAnterior = `SUM(CASE WHEN ${janelaAnterior} AND ${semValor} THEN 1 ELSE 0 END)`;
  const reducoes = await consultar(deps.query, `
    SELECT FIRST 20 c.CDCLIENTE, COALESCE(c.CLIENTE, c.RAZAO) NOME, COALESCE(v.VENDEDOR, 'Sem vendedor') VENDEDOR,
      MAX(se.DTSAIDA) ULTIMA,
      ${somaAtual} ATUAL,
      ${somaAnterior} ANTERIOR,
      COUNT(DISTINCT CASE WHEN se.DTSAIDA >= DATEADD(-365 DAY TO CURRENT_DATE) THEN se.NRPEDIDO END) FREQUENCIA
    FROM SAIDAESTOQUE se
    JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = c.CDVENDEDOR
    WHERE se.DTCANCELAMENTO IS NULL AND se.DTSAIDA >= DATEADD(-180 DAY TO CURRENT_DATE)
    GROUP BY c.CDCLIENTE, c.CLIENTE, c.RAZAO, v.VENDEDOR
    HAVING ${semAtual} = 0 AND ${semAnterior} = 0 AND ${somaAnterior} > 0 AND ${somaAtual} <= ${somaAnterior} * 0.7
    ORDER BY 5 DESC`, []);
  const incompletas = await consultar(deps.query, `
    SELECT COUNT(*) TOTAL FROM (
      SELECT c.CDCLIENTE
      FROM SAIDAESTOQUE se
      JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
      WHERE se.DTCANCELAMENTO IS NULL AND se.DTSAIDA >= DATEADD(-180 DAY TO CURRENT_DATE)
      GROUP BY c.CDCLIENTE
      HAVING SUM(CASE WHEN ${semValor} THEN 1 ELSE 0 END) > 0
    ) sem_valor`, []);
  const pedidos = await consultar(deps.query, `
    SELECT FIRST 25 se.NRPEDIDO, se.IDEMPRESA, se.DTSAIDA, se.CDCLIENTE,
      COALESCE(se.CLIENTE, c.CLIENTE) CLIENTE,
      COALESCE(v.VENDEDOR, 'Sem vendedor') VENDEDOR,
      COALESCE(se.VLTOTAL, se.SUBTOTAL) TOTAL
    FROM SAIDAESTOQUE se
    LEFT JOIN CLIENTE c ON c.CDCLIENTE = se.CDCLIENTE
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = se.CDVENDEDOR
    WHERE se.DTCANCELAMENTO IS NULL AND se.STATUS_ORC = 0
      AND se.DTSAIDA < DATEADD(-${diasPedido} DAY TO CURRENT_DATE)
    ORDER BY se.DTSAIDA`, []);
  let negociacoes = [];
  try {
    negociacoes = loadState().leads
      .filter((lead) => ["NEGOCIACAO", "ORCAMENTO"].includes(lead.status))
      .map((lead) => ({
        id: lead.id,
        cliente: lead.razaoSocial || lead.nomeFantasia,
        clienteId: lead.clienteId || null,
        vendedor: lead.vendedorNome || "Sem vendedor",
        atualizadoEm: lead.atualizadoEm,
        valor: (() => {
          const localizados = (lead.orcamentos || []).filter((item) => item.localizado && Number.isFinite(Number(item.valor)));
          return localizados.length ? localizados.reduce((soma, item) => soma + Number(item.valor), 0) : null;
        })(),
      }));
  } catch {
    negociacoes = null;
  }
  return {
    orcamentos: orcamentos?.map((row) => ({ numero: row.NRORCAMENTO, empresa: row.IDEMPRESA, clienteId: row.CDCLIENTE, vendedorId: row.CDVENDEDOR, vendedor: row.VENDEDOR, cliente: row.CLIENTE, data: row.DTORC, valor: row.VLTOTAL })),
    clientes: clientes?.map((row) => ({ codigo: row.CDCLIENTE, nome: row.NOME, ultimaCompra: row.DTULTCOMPRA, vendedor: row.VENDEDOR, vendedorId: row.CDVENDEDOR, frequencia: Number(row.FREQUENCIA || 0) })),
    reducoes: reducoes?.map((row) => ({ clienteId: row.CDCLIENTE, cliente: row.NOME, vendedor: row.VENDEDOR, ultimaCompra: row.ULTIMA, atual: numeroOuNulo(row.ATUAL), anterior: numeroOuNulo(row.ANTERIOR), frequencia: Number(row.FREQUENCIA || 0), janelaDias: 90 })),
    reducoesIncompletas: incompletas == null ? null : Number(incompletas[0]?.TOTAL ?? incompletas[0]?.total ?? 0),
    pedidos: pedidos?.map((row) => ({ numero: row.NRPEDIDO, empresa: row.IDEMPRESA, clienteId: row.CDCLIENTE, cliente: row.CLIENTE, vendedor: row.VENDEDOR, data: row.DTSAIDA, valor: row.TOTAL })),
    negociacoes,
    carrinhos: null,
    diasOrcamento,
    diasCliente,
  };
}

export async function painelRecuperacao(deps = {}, opcoes = {}) {
  const fatos = await lerFatos(deps, opcoes);
  const painel = montarRecuperacao(fatos, { diasOrcamento: fatos.diasOrcamento, diasCliente: fatos.diasCliente, hoje: opcoes.hoje });
  const estado = ler();
  painel.itens = painel.itens.map((item) => {
    const salvo = estado.acoes[item.id] || {};
    const completo = { ...item, acoes: salvo.acoes || [], resultado: salvo.resultado || null };
    completo.rascunho = rascunhoRecuperacao({ ...completo, dataTexto: item.dataTexto || dataTexto(item.data) });
    return completo;
  });
  return painel;
}

export function agir(id, entrada = {}) {
  const estado = ler();
  const atual = estado.acoes[id] || { acoes: [], resultado: null };
  const registro = registrarAcao(atual, {
    ...entrada,
    id: crypto.randomUUID(),
    em: new Date().toISOString(),
    texto: entrada.tipo === "mensagem" ? (entrada.texto || "") : entrada.texto,
  });
  estado.acoes[id] = registro;
  gravar(estado);
  return registro;
}
