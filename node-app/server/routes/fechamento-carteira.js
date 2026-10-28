// Fechamento de carteira: gera NOTAFISCAL/NOTAFIS_PRODUTO a partir de titulos
// CTARECEBER pagos em carteira. Porta de fechamento_carteira.py.
//
// A transmissao para a SEFAZ NAO acontece aqui — "gerar" so cria as notas.
// O frontend mostra uma tela de revisao com o valor de cada nota e so
// transmite (nota a nota, via POST /api/fiscal/nfe/<idnf>/emitir) quando o
// usuario clica em "Transmitir todas".

import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";
import { HttpError, sendError } from "../lib/http-error.js";

const router = express.Router();

function strOrNone(value) {
  const s = String(value ?? "").trim();
  return s || null;
}
function intOrNone(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function floatOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function toTimestamp(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function periodo(req) {
  let dataIni = String(req.query?.data_inicio || "").trim().slice(0, 10);
  let dataFim = String(req.query?.data_fim || "").trim().slice(0, 10);
  if (req.method === "POST") {
    const body = req.body || {};
    dataIni = String(body.data_inicio || dataIni || "").trim().slice(0, 10);
    dataFim = String(body.data_fim || dataFim || "").trim().slice(0, 10);
  }
  if (!dataIni || !dataFim) throw new HttpError("Informe o periodo inicial e final.", 400);
  if (Number.isNaN(new Date(`${dataIni}T00:00:00`).getTime()) || Number.isNaN(new Date(`${dataFim}T00:00:00`).getTime())) {
    throw new HttpError("Data invalida.", 400);
  }
  if (dataIni > dataFim) throw new HttpError("Data inicial nao pode ser maior que a data final.", 400);
  return { dataIni, dataFim };
}

async function tableColumns(tx, table) {
  const rows = await tx.query(
    "SELECT TRIM(rdb$field_name) AS COL FROM rdb$relation_fields WHERE TRIM(rdb$relation_name) = ?",
    [table.toUpperCase()]
  );
  return new Set(rows.map(r => String(r.COL).trim().toUpperCase()));
}
async function nextNumericId(tx, table, column) {
  const row = await tx.singleton(`SELECT COALESCE(MAX(${column}), 0) + 1 AS NEXT FROM ${table}`);
  return Number(row?.NEXT || 1);
}
async function nextGeneratorValue(tx, generatorName) {
  const gen = String(generatorName || "").trim().toUpperCase();
  if (!gen || [...gen].some(ch => !"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$".includes(ch))) {
    throw new Error("Generator Firebird invalido: " + generatorName);
  }
  const exists = await tx.singleton(
    "SELECT FIRST 1 TRIM(rdb$generator_name) AS NAME FROM rdb$generators WHERE TRIM(rdb$generator_name) = ?", [gen]
  );
  if (!exists) throw new Error("Generator Firebird nao encontrado: " + gen);
  const row = await tx.singleton(`SELECT GEN_ID(${gen}, 1) AS PROXIMO FROM RDB$DATABASE`);
  const value = Number(row?.PROXIMO);
  if (!Number.isFinite(value)) throw new Error("Nao foi possivel obter o proximo valor de " + gen);
  return value;
}
async function nextNfNumber(tx, idempresa) {
  const generatorName = "GEN_NOTAFISCAL1_" + Number(idempresa);
  return String(await nextGeneratorValue(tx, generatorName)).slice(0, 15);
}

// Colunas opcionais de CTARECEBER que podem nao existir no banco (varia por
// instalacao/versao do ERP). Cache por processo: true = existe, false = nao.
const colunasOkCache = {};
const COLS_OPCIONAIS = ["CDVENDEDOR", "CDVEND", "CCUSTO", "CDCONTA", "CDSUBCONTA", "ACORDO_NF", "PARCELA", "TOTALPG", "VLPAGTO", "VLPGLIQ", "DTPAGTO", "DTCOB"];

// O Automec grava o vendedor em CDVEND e a data da baixa em DTCOB.
// CDVENDEDOR, DTPAGTO e VLPAGTO aparecem em outras versoes ou em CTAPAGAR.
export function expressaoColuna(existentes, nomes) {
  const set = existentes instanceof Set ? existentes : new Set(existentes);
  const nome = nomes.find((coluna) => set.has(coluna));
  return nome ? `cr.${nome}` : "NULL";
}

async function testarColuna(tx, coluna) {
  if (coluna in colunasOkCache) return colunasOkCache[coluna];
  const rows = await tx.query(
    "SELECT FIRST 1 TRIM(rf.RDB$FIELD_NAME) AS COL FROM RDB$RELATION_FIELDS rf" +
    " WHERE TRIM(rf.RDB$RELATION_NAME) = 'CTARECEBER' AND TRIM(rf.RDB$FIELD_NAME) = ?",
    [coluna]
  );
  colunasOkCache[coluna] = rows.length > 0;
  return colunasOkCache[coluna];
}
async function col(tx, coluna) {
  return (await testarColuna(tx, coluna)) ? coluna : "NULL";
}
async function expr(tx, nomes) {
  const existentes = new Set();
  for (const nome of nomes) {
    if (await testarColuna(tx, nome)) existentes.add(nome);
  }
  return expressaoColuna(existentes, nomes);
}
async function exprTabela(tx, tabela, nomes) {
  for (const nome of nomes) {
    const rows = await tx.query(
      "SELECT FIRST 1 TRIM(rf.RDB$FIELD_NAME) AS COL FROM RDB$RELATION_FIELDS rf" +
      " WHERE TRIM(rf.RDB$RELATION_NAME) = ? AND TRIM(rf.RDB$FIELD_NAME) = ?",
      [tabela, nome]
    );
    if (rows.length) return nome;
  }
  return null;
}

async function titulosSql(tx, excluidos, clienteBusca, idempresa) {
  excluidos = (excluidos || []).map(Number).filter(x => Number.isFinite(x));
  const params = [];
  let filtroCliente = "";
  clienteBusca = String(clienteBusca || "").trim();
  if (clienteBusca) {
    filtroCliente = " AND (CAST(cr.CDCLIENTE AS VARCHAR(20)) CONTAINING ?" +
      " OR cli.CLIENTE CONTAINING ?" +
      " OR cli.RAZAO CONTAINING ?)";
    params.push(clienteBusca, clienteBusca, clienteBusca);
  }
  let filtroEmpresa = "";
  if (idempresa) {
    filtroEmpresa = " AND cr.IDEMPRESA = ?";
    params.push(idempresa);
  }
  let filtro = "";
  if (excluidos.length) {
    filtro = ` AND cr.CDCLIENTE NOT IN (${excluidos.map(() => "?").join(",")})`;
    params.push(...excluidos);
  }
  const cdvendedor = await expr(tx, ["CDVENDEDOR", "CDVEND"]);
  const ccusto = await col(tx, "CCUSTO");
  const cdconta = await col(tx, "CDCONTA");
  const cdsubconta = await col(tx, "CDSUBCONTA");
  const parcela = await col(tx, "PARCELA");
  const totalpg = await col(tx, "TOTALPG");
  const vlpagto = await col(tx, "VLPAGTO");
  const vlpgliq = await col(tx, "VLPGLIQ");
  const dtpagto = await expr(tx, ["DTPAGTO", "DTCOB"]);
  const valorTitulo = "COALESCE(cr.VALOR, cr.DIVIDA, 0)";
  const valorPago = `COALESCE(NULLIF(${totalpg}, 0), NULLIF(${vlpagto}, 0), NULLIF(${vlpgliq}, 0), 0)`;
  // DTCOB no Automec fica 30/12/1899 enquanto o titulo nao foi baixado.
  // So DTPAGTO, quando existe, significa baixa. Sem ele, o saldo decide.
  const dataPagamento = dtpagto === "NULL"
    ? "NULL"
    : `CASE WHEN ${dtpagto} IS NULL OR ${dtpagto} < DATE '1900-01-01' THEN NULL ELSE CAST(${dtpagto} AS DATE) END`;
  const filtroQuitado = (await testarColuna(tx, "DTPAGTO"))
    ? "   AND cr.DTPAGTO IS NULL"
    : `   AND ABS(${valorTitulo}) > ABS(${valorPago}) + 0.009`;
  const filtroNf = (await testarColuna(tx, "ACORDO_NF")) ? "   AND COALESCE(cr.ACORDO_NF, 0) = 0" : "";
  const sql =
    "SELECT cr.CONTROLE, cr.IDEMPRESA, TRIM(cfg.NOMEEMPRESA) AS EMPRESA, cr.CDCLIENTE," +
    " cli.CLIENTE AS CLIENTE," +
    " cr.NRPEDIDO," +
    " CAST(cr.DTMOV AS DATE) AS DTMOV," +
    " CAST(cr.DTVENC AS DATE) AS DTVENC," +
    ` ${dataPagamento} AS DTPAGTO,` +
    ` ${valorTitulo} AS VALOR,` +
    ` ${valorPago} AS VALOR_PAGO,` +
    ` ${parcela} AS PARCELA,` +
    " cr.NRDOC AS NRDOC," +
    " cr.NRDOC2 AS NRDOC2," +
    " cr.CODPAGTO, cr.CDRECGRUPO," +
    ` ${cdvendedor} AS CDVENDEDOR,` +
    ` ${ccusto} AS CCUSTO,` +
    ` ${cdconta} AS CDCONTA,` +
    ` ${cdsubconta} AS CDSUBCONTA,` +
    " cr.HISTORICO," +
    " rec.RECEBTO AS FORMA_PAGAMENTO," +
    " CASE WHEN UPPER(rec.RECEBTO) LIKE '%DEV%'" +
    "        OR UPPER(cr.ORIGEM) LIKE '%DEV%'" +
    "        OR UPPER(cr.HISTORICO) LIKE '%DEV%'" +
    "      THEN 1 ELSE 0 END AS IS_DESCONTO" +
    " FROM CTARECEBER cr" +
    " LEFT JOIN CLIENTE cli ON cli.CDCLIENTE = cr.CDCLIENTE" +
    " LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA = cr.IDEMPRESA" +
    " JOIN RECEBTO rec ON rec.CDRECEBTO = cr.CODPAGTO" +
    " WHERE cr.STATUS = 1" +
    "   AND cr.NRPEDIDO IS NOT NULL" +
    filtroQuitado +
    "   AND cr.DTMOV >= ?" +
    "   AND cr.DTMOV < DATEADD(1 DAY TO CAST(? AS DATE))" +
    "   AND (UPPER(rec.RECEBTO) LIKE '%CARTEIRA%' OR UPPER(rec.RECEBTO) LIKE '%DEV%CART%' OR UPPER(rec.RECEBTO) LIKE '%DEV/CART%')" +
    filtroNf + filtroCliente + filtroEmpresa + filtro +
    " ORDER BY CLIENTE, cr.CDCLIENTE, cr.NRPEDIDO, cr.CONTROLE";
  return { sql, params };
}

function empresaInformada(req) {
  const raw = req.method === "POST" ? (req.body?.idempresa ?? req.query?.idempresa) : req.query?.idempresa;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError("Empresa invalida.", 400);
  return Math.trunc(n);
}

export async function carregarPreview(tx, dataIni, dataFim, excluidos, clienteBusca, idempresa = null) {
  const inicio = toTimestamp(dataIni);
  const fim = toTimestamp(dataFim);
  if (!inicio || !fim) throw new HttpError("Data invalida.", 400);
  let rows = null;
  for (let tentativa = 0; tentativa < COLS_OPCIONAIS.length + 2; tentativa++) {
    try {
      const { sql, params } = await titulosSql(tx, excluidos, clienteBusca, idempresa);
      rows = await tx.query(sql, [inicio, fim, ...params]);
      break;
    } catch (error) {
      const err = String(error?.message || error).toUpperCase();
      const colFalhou = COLS_OPCIONAIS.find(c => err.includes(c));
      if (colFalhou) { colunasOkCache[colFalhou] = false; continue; }
      throw error;
    }
  }
  if (!rows) rows = [];

  const grupos = new Map();
  for (const row of rows) {
    const key = `${row.IDEMPRESA}|${row.CDCLIENTE}`;
    let grupo = grupos.get(key);
    if (!grupo) {
      grupo = {
        IDEMPRESA: row.IDEMPRESA, EMPRESA: String(row.EMPRESA || "").trim(), CDCLIENTE: row.CDCLIENTE, CLIENTE: row.CLIENTE || "-",
        TOTAL: 0, DESCONTO: 0, QTDE_TITULOS: 0, PEDIDOS: [], TITULOS: [],
      };
      grupos.set(key, grupo);
    }
    const pedido = row.NRPEDIDO;
    if (!grupo.PEDIDOS.includes(pedido)) grupo.PEDIDOS.push(pedido);
    grupo.QTDE_TITULOS += 1;
    let valor = floatOrZero(row.VALOR);
    if (row.IS_DESCONTO) {
      valor = -Math.abs(valor);
      row.VALOR = valor;
      grupo.DESCONTO += Math.abs(valor);
      grupo.TOTAL += valor;
    } else {
      grupo.TOTAL += valor;
    }
    grupo.TITULOS.push(row);
  }
  const clientes = [...grupos.values()].sort((a, b) => {
    const cmp = String(a.CLIENTE).localeCompare(String(b.CLIENTE));
    return cmp !== 0 ? cmp : (a.CDCLIENTE || 0) - (b.CDCLIENTE || 0);
  });
  const totais = {
    CLIENTES: clientes.length,
    PEDIDOS: clientes.reduce((s, c) => s + c.PEDIDOS.length, 0),
    TITULOS: clientes.reduce((s, c) => s + c.QTDE_TITULOS, 0),
    TOTAL: clientes.reduce((s, c) => s + floatOrZero(c.TOTAL), 0),
  };
  return { clientes, totais };
}

router.get("/fechamento-carteira/preview", async (req, res) => {
  try {
    const { dataIni, dataFim } = periodo(req);
    const excluidos = [].concat(req.query.excluir_cliente || []);
    const clienteBusca = String(req.query.cliente || "").trim();
    const idempresa = empresaInformada(req);
    const { clientes, totais } = await withWriteTransaction(tx => carregarPreview(tx, dataIni, dataFim, excluidos, clienteBusca, idempresa));
    res.json({ ok: true, periodo: { data_inicio: dataIni, data_fim: dataFim }, idempresa, clientes, totais });
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 400);
  }
});

router.get("/fechamento-carteira/empresas", async (_req, res) => {
  try {
    const empresas = await withDatabase(db => query(
      db,
      "SELECT IDEMPRESA, TRIM(NOMEEMPRESA) AS NOMEEMPRESA FROM CONFIGURACAO ORDER BY IDEMPRESA"
    ));
    res.json({ ok: true, empresas });
  } catch (error) {
    sendError(res, error, 500);
  }
});

router.get("/formas-pagamento", async (_req, res) => {
  try {
    const formas = await withDatabase(db => query(db, "SELECT CDRECEBTO, RECEBTO FROM RECEBTO ORDER BY RECEBTO"));
    res.json({ ok: true, formas });
  } catch (error) {
    sendError(res, error, 500);
  }
});

router.post("/fechamento-carteira/gerar", async (req, res) => {
  try {
    const body = req.body || {};
    const { dataIni, dataFim } = periodo(req);
    const excluidos = body.excluir_clientes || [];
    const clienteBusca = strOrNone(body.cliente);
    const idempresa = empresaInformada(req);
    const idusuario = intOrNone(body.idusuario) || 1;
    const cdrecebto = intOrNone(body.cdrecebto);
    const meioPagto = strOrNone(body.meio_pagto) || "01";
    const dtvenc = toTimestamp(body.dtvenc);
    const bandeira = strOrNone(body.bandeira);

    const result = await withWriteTransaction(async tx => {
      const { clientes } = await carregarPreview(tx, dataIni, dataFim, excluidos, clienteBusca, idempresa);
      if (!clientes.length) throw new HttpError("Nenhum cliente encontrado para gerar nota fiscal.", 400);

      const nfCols = await tableColumns(tx, "NOTAFISCAL");
      const nfpCols = await tableColumns(tx, "NOTAFIS_PRODUTO");
      const spCols = await tableColumns(tx, "SAIDAPRODUTO");
      const ctaCols = await tableColumns(tx, "CTA_NF");
      const geradas = [];

      let nextIdnf = await nextNumericId(tx, "NOTAFISCAL", "IDNF");
      let nextNfpId = await nextNumericId(tx, "NOTAFIS_PRODUTO", "ID");
      let idtranspPadrao = null;
      try {
        let row = (await tx.query(
          "SELECT FIRST 1 IDTRANSP FROM TRANSPORTADORA WHERE COALESCE(PADRAO, 0) <> 0 ORDER BY IDTRANSP"
        ))[0];
        if (!row) row = (await tx.query("SELECT FIRST 1 IDTRANSP FROM TRANSPORTADORA ORDER BY IDTRANSP"))[0];
        idtranspPadrao = row ? intOrNone(row.IDTRANSP) : null;
      } catch { idtranspPadrao = null; }

      for (const cliente of clientes) {
        const idempresa = Number(cliente.IDEMPRESA || 1);
        const cdcliente = Number(cliente.CDCLIENTE || 0);
        const pedidos = cliente.PEDIDOS.filter(p => p !== null && p !== undefined).map(Number);
        if (!cdcliente || !pedidos.length) continue;

        // O sufixo do generator corresponde a IDEMPRESA: GEN_NOTAFISCAL1_1, etc.
        const nrdoc = (await nextNfNumber(tx, idempresa)).padStart(9, "0").slice(0, 15);
        const idnf = nextIdnf; nextIdnf += 1;
        let totalNf = floatOrZero(cliente.TOTAL);
        const descontoNf = floatOrZero(cliente.DESCONTO);
        const pedidoRef = pedidos[0];
        const tituloRef = cliente.TITULOS[0] || {};
        const obs = `Fechamento Carteira ${dataIni} a ${dataFim}. Pedidos: ${pedidos.join(", ")}`;

        // CDVENDEDOR: busca no cabecalho da saida.
        let cdvendedorNf = intOrNone(tituloRef.CDVENDEDOR);
        const phPedidos = pedidos.map(() => "?").join(",");
        for (const tabela of ["SAIDAESTOQUE", "SAIDAPRODUTO"]) {
          const colunaVend = await exprTabela(tx, tabela, ["CDVENDEDOR", "CDVEND"]);
          if (!colunaVend) continue;
          try {
            const vrow = (await tx.query(
              `SELECT FIRST 1 se.${colunaVend} AS CDVENDEDOR FROM ${tabela} se` +
              ` WHERE se.IDEMPRESA = ? AND se.NRPEDIDO IN (${phPedidos}) AND se.${colunaVend} IS NOT NULL`,
              [idempresa, ...pedidos]
            ))[0];
            if (vrow && vrow.CDVENDEDOR !== null && vrow.CDVENDEDOR !== undefined) {
              cdvendedorNf = intOrNone(vrow.CDVENDEDOR);
              break;
            }
          } catch { /* tabela/coluna nao existe, tenta a proxima */ }
        }

        const nfData = {
          NRDOC: nrdoc, IDEMPRESA: idempresa, NRPEDIDO: pedidoRef, CDCLIENTE: cdcliente,
          DTEMISS: toTimestamp(dataFim), DATASAIDA: toTimestamp(dataFim),
          VALOR: totalNf, VLTOTAL: totalNf, IDTRANSP: idtranspPadrao, DESCONTO: descontoNf, FRETE: 0,
          // Campos estruturais preenchidos pelo ERP ao criar uma NF-e. Deixa-los
          // nulos impede que algumas telas do sistema legado carreguem a nota.
          TIPOFRETE: 0, VOLUMES: "0", PESO: "0,00", PESOBRUTO: 0,
          SERIE_NFE: 1, SERIE_NFCE: 0, END_NF: 0, EXPORTACAO: 0, INDINTERMED: 0,
          FRETE_ABATER: 0, OUTROS: 0, VLIPI: 0, VLSEG: 0, IDNF: idnf, CDNATOP: "0000",
          CDVENDEDOR: cdvendedorNf, STATUS: 0, NFE_EMITIDA: 0, NFE_CANCELADA: 0, CANCELAR_NFE: 0,
          IMPRESSO: 0, ESTOQUE_ATUALIZADO: 0, ACORDO_NF: 0, NFCE: 0, EXPORTA: 0,
          INDFINAL: -1, INDPRES: 1, SIST_ALT: "LOCAL", DTALTER: new Date(), OBSERVACAO: obs,
        };
        const nfColumns = Object.keys(nfData).filter(c => nfCols.has(c));
        await tx.execute(
          `INSERT INTO NOTAFISCAL (${nfColumns.join(", ")}) VALUES (${nfColumns.map(() => "?").join(", ")})`,
          nfColumns.map(c => nfData[c])
        );

        let itemRows = [];
        let itemSource = "SAIDAPRODUTO";
        const phPedidos2 = pedidos.map(() => "?").join(",");
        try {
          const rows = await tx.query(
            "SELECT sp.*, p.PRODUTO AS PRODUTO_CADASTRO," +
            " p.CLASSFISCAL AS PRODUTO_NCM, p.ORIGEM AS PRODUTO_ORIGEM," +
            " COALESCE(i.CST, p.SITTRIBUT) AS IMPOSTO_CST," +
            " i.CSOSN AS IMPOSTO_CSOSN, i.CFOP_EST, i.CFOP_INT," +
            " i.ALIQPIS, i.ALIQCOFI" +
            " FROM SAIDAPRODUTO sp" +
            " LEFT JOIN PRODUTO p ON p.CDPRODUTO = sp.CDPRODUTO" +
            " LEFT JOIN IMPOSTO i ON i.IDIMPOSTO = p.IDIMPOSTO_VENDA" +
            " WHERE sp.IDEMPRESA = ?" +
            ` AND sp.NRPEDIDO IN (${phPedidos2})` +
            " AND COALESCE(sp.STATUSSE, 0) <> 9",
            [idempresa, ...pedidos]
          );
          if (rows.length) {
            itemRows = rows;
            itemRows.sort((a, b) => (a.NRPEDIDO || 0) - (b.NRPEDIDO || 0) || (a.POSIC || 0) - (b.POSIC || 0));
          }
        } catch { itemRows = []; }
        const itensDebug = itemRows.length;
        if (!itemRows.length) {
          let cdprodFallback = "SERVICO";
          try {
            const pr = (await tx.query(
              "SELECT FIRST 1 TRIM(CDPRODUTO) AS CDPRODUTO FROM SAIDAPRODUTO" +
              " WHERE CDPRODUTO IS NOT NULL AND TRIM(CDPRODUTO) <> ''" +
              " AND COALESCE(STATUSSE, 0) <> 9"
            ))[0];
            if (pr?.CDPRODUTO) cdprodFallback = String(pr.CDPRODUTO).trim();
          } catch { /* ignore */ }
          itemRows = [{
            NRPEDIDO: pedidoRef, POSIC: 1, CDPRODUTO: cdprodFallback, CDDEPOSITO: 1,
            DESCRICAO: "Fechamento de carteira", QTDPRODUTO: 1, VLUNIT: totalNf, TOTAL: totalNf, UNID: "UN",
          }];
          itemSource = "fallback";
        }

        let posic = 1;
        let totalItensNf = 0;
        for (const item of itemRows) {
          if (intOrNone(item.STATUSSE) === 9) continue;
          const qtd = floatOrZero(item.QTDPRODUTO || item.QTDELIB || 1) || 1;
          let vlunit = floatOrZero(item.VLUNIT);
          let total = floatOrZero(item.TOTAL || item.SUBTOTAL || (vlunit ? vlunit * qtd : 0));
          if (!vlunit && total) vlunit = qtd ? total / qtd : total;
          if (!total && vlunit) total = vlunit * qtd;
          totalItensNf += total;
          const itemId = nextNfpId; nextNfpId += 1;
          const nfpData = {
            ID: itemId, IDNF: idnf, IDEMPRESA: idempresa, POSIC: posic,
            CDPRODUTO: String(item.CDPRODUTO || "SERVICO").slice(0, 10),
            CDDEPOSITO: intOrNone(item.CDDEPOSITO) || 1,
            NRPEDIDO: intOrNone(item.NRPEDIDO) || pedidoRef,
            DESCRICAO: strOrNone(item.PRODUTO_CADASTRO) || strOrNone(item.DESCRICAO) || "Fechamento de carteira",
            TOTAL: total, VLUNIT: vlunit, QTDPRODUTO: qtd, DESCONTO: floatOrZero(item.DESCONTO),
            STATUSSE: intOrNone(item.STATUSSE), UNID: strOrNone(item.UNID) || "UN",
            NCM: strOrNone(item.NCM || item.PRODUTO_NCM),
            // CFOP interno/interestadual e definido na emissao, comparando a UF
            // do emitente com a do destinatario.
            CFOP: strOrNone(item.CFOP),
            SITTRIBUT: strOrNone(item.SITTRIBUT || item.IMPOSTO_CST),
            ORIG: intOrNone(item.ORIG !== undefined && item.ORIG !== null ? item.ORIG : item.PRODUTO_ORIGEM),
            CST_PIS: strOrNone(item.CST_PIS) || "01", PPIS: floatOrZero(item.PPIS || item.ALIQPIS),
            CST_COFINS: strOrNone(item.CST_COFINS) || "01", PCOFINS: floatOrZero(item.PCOFINS || item.ALIQCOFI),
            TEMICMS: 0, ICMS: floatOrZero(item.PERC_ICMS), VLICMS: floatOrZero(item.VLICMS),
            QTDEPECA: intOrNone(item.QTDEPECA), DTALTER: new Date(), SIST_ALT: "LOCAL",
          };
          for (const [sourceCol, targetCol] of [
            ["VLBCICMS", "VBC"], ["PERC_ICMS", "PICMS"], ["VLICMS", "VICMS"],
            ["VLBCST", "VBCST"], ["PERC_ST", "PICMSST"], ["VLST", "VICMSST"],
          ]) {
            if (spCols.has(sourceCol) && nfpCols.has(targetCol)) nfpData[targetCol] = item[sourceCol] || 0;
          }
          const nfpColumns = Object.keys(nfpData).filter(c => nfpCols.has(c));
          await tx.execute(
            `INSERT INTO NOTAFIS_PRODUTO (${nfpColumns.join(", ")}) VALUES (${nfpColumns.map(() => "?").join(", ")})`,
            nfpColumns.map(c => nfpData[c])
          );
          posic += 1;
        }

        if (totalItensNf > 0) {
          totalNf = Math.round(totalItensNf * 100) / 100;
          const setCols = ["VALOR", "VLTOTAL"].filter(c => nfCols.has(c));
          if (setCols.length) {
            await tx.execute(
              `UPDATE NOTAFISCAL SET ${setCols.map(c => c + " = ?").join(", ")} WHERE IDNF = ? AND IDEMPRESA = ?`,
              [...setCols.map(() => totalNf), idnf, idempresa]
            );
          }
        }

        // Atualizar SAIDAPRODUTO.NRDOC para todos os pedidos do fechamento (o
        // ERP desktop filtra "NF nao emitida" por SAIDAPRODUTO.NRDOC preenchido).
        await tx.execute(
          `UPDATE SAIDAPRODUTO SET NRDOC = ?, DTALTER = CURRENT_TIMESTAMP, SIST_ALT = 'LOCAL'` +
          ` WHERE NRPEDIDO IN (${pedidos.map(() => "?").join(",")}) AND IDEMPRESA = ? AND COALESCE(STATUSSE, 0) <> 9`,
          [nrdoc, ...pedidos, idempresa]
        );

        const controles = cliente.TITULOS.map(t => t.CONTROLE).filter(c => c !== null && c !== undefined).map(Number);
        for (const controle of controles) {
          await tx.execute(
            "UPDATE CTARECEBER SET NRDOC = ?, ACORDO_NF = ?, VALOR_ACORDO_NF = COALESCE(VALOR, DIVIDA, 0)," +
            " CDUSR = ?, DTALTER = CURRENT_TIMESTAMP, SIST_ALT = 'LOCAL'" +
            " WHERE CONTROLE = ? AND IDEMPRESA = ? AND STATUS = 1" +
            "   AND COALESCE(TRIM(NRDOC), '') = CAST(NRPEDIDO AS VARCHAR(20))",
            [nrdoc, 1, idusuario, controle, idempresa]
          );
        }

        geradas.push({
          NRDOC: nrdoc, IDNF: idnf, IDEMPRESA: idempresa, CDCLIENTE: cdcliente, CLIENTE: cliente.CLIENTE,
          TOTAL: totalNf, PEDIDOS: pedidos, itens_fonte: itemSource, itens_qtde: itensDebug,
        });

        // Inserir na CTA_NF se a tabela existir e os dados foram informados
        if (ctaCols.size && dtvenc) {
          const ctaData = {
            IDNF: idnf, IDEMPRESA: idempresa, DTVENC: dtvenc, VALOR: totalNf,
            CDRECEBTO: cdrecebto, MEIO_PAGTO: meioPagto, BANDEIRA: bandeira, NFCE: 0, EXPORTA: 0,
          };
          if (ctaCols.has("CONTROLE")) ctaData.CONTROLE = await nextGeneratorValue(tx, "GEN_CTA_NF_ID");
          const ctaColumns = Object.keys(ctaData).filter(c => ctaCols.has(c) && ctaData[c] !== null && ctaData[c] !== undefined);
          await tx.execute(
            `INSERT INTO CTA_NF (${ctaColumns.join(", ")}) VALUES (${ctaColumns.map(() => "?").join(", ")})`,
            ctaColumns.map(c => ctaData[c])
          );
          if (ctaCols.has("NFCE")) {
            await tx.execute("UPDATE CTA_NF SET NFCE = 0 WHERE IDNF = ? AND IDEMPRESA = ? AND NFCE IS NULL", [idnf, idempresa]);
          }
        }
      }

      return { ok: true, geradas, total: geradas.length };
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, error instanceof HttpError ? error.status : 500);
  }
});

export default router;
