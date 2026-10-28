import { query } from "../db.js";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { ollamaChat } from "./ollama.js";
import {
  CONFIGURACAO_PADRAO,
  aceitarResumo,
  analisarLote,
  chaveIdempotencia,
  descreverFontes,
  desfazerPermitido,
  extrairIdentificadores,
  investigar,
  loteSeguro,
  montarFatos,
  montarPreFechamento,
  notificacoesDoCiclo,
  parseCnabExtrato,
  parseCsvExtrato,
  podeAprovarEscolha,
  podeExecutarAutomaticamente,
  podeFecharDefinitivo,
  proximaFila,
  registrarAprendizado,
  separarJaImportados,
} from "./reconciliation-intelligence.js";

const ARQUIVO = "conciliacao-inteligente.json";
const TABELAS = new Set(["CTARECEBER", "CTAPAGAR", "MOV_BANCARIO", "CTAPAGAR"]);

function estadoInicial() {
  return {
    configuracao: CONFIGURACAO_PADRAO,
    cursores: {},
    padroes: [],
    auditoria: [],
    excecoes: [],
    execucoes: [],
    notificacoes: [],
    fechamentos: [],
    idempotencia: {},
    lock: null,
    ultimoErro: null,
  };
}

const lerPadrao = (nome, fallback) => readJsonConfig(nome, fallback);
const gravarPadrao = (nome, valor) => writeJsonConfig(nome, valor);

export function lerEstado(deps = {}) {
  const lido = (deps.ler || lerPadrao)(ARQUIVO, estadoInicial());
  return {
    ...estadoInicial(),
    ...lido,
    configuracao: {
      ...CONFIGURACAO_PADRAO,
      ...(lido.configuracao || {}),
      autorizacoes: { ...CONFIGURACAO_PADRAO.autorizacoes, ...(lido.configuracao?.autorizacoes || {}) },
      notificacoes: { ...CONFIGURACAO_PADRAO.notificacoes, ...(lido.configuracao?.notificacoes || {}) },
    },
  };
}

function gravarEstado(estado, deps = {}) {
  estado.auditoria = (estado.auditoria || []).slice(-500);
  estado.execucoes = (estado.execucoes || []).slice(-120);
  estado.notificacoes = (estado.notificacoes || []).slice(-100);
  estado.padroes = (estado.padroes || []).slice(-1000);
  estado.excecoes = (estado.excecoes || []).slice(-300);
  return (deps.gravar || gravarPadrao)(ARQUIVO, estado);
}

export function adquirirLock(estado, agora = Date.now()) {
  if (estado.lock && agora - Date.parse(estado.lock.desde || 0) < 10 * 60 * 1000) return null;
  const owner = `${process.pid}-${agora}`;
  estado.lock = { owner, desde: new Date(agora).toISOString() };
  return owner;
}

export function liberarLock(estado, owner) {
  if (estado.lock?.owner === owner) estado.lock = null;
}

export function cicloDevido(estado, agora = Date.now()) {
  if (estado.configuracao?.ativo === false) return false;
  const falha = estado.ultimoErro;
  if (falha?.em) {
    const espera = Math.min(Number(falha.tentativas || 1), 5) * 60 * 1000;
    if (agora - Date.parse(falha.em) < espera) return false;
  }
  const ultimaExecucao = estado.execucoes?.at?.(-1)?.em || estado.execucoes?.[estado.execucoes.length - 1]?.em;
  if (!ultimaExecucao) return true;
  const ultima = Date.parse(ultimaExecucao);
  const intervalo = Math.max(5, Number(estado.configuracao?.intervaloMinutos) || 15) * 60 * 1000;
  return !Number.isFinite(ultima) || agora - ultima >= intervalo;
}

function dia(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
  const texto = String(valor || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

function mapearMovimento(row) {
  return {
    id: Number(row.ID),
    data: row.DATA,
    valor: Number(row.VALOR) || 0,
    historico: row.HISTORICO ? String(row.HISTORICO).trim() : "",
    numdoc: row.NUMDOC ? String(row.NUMDOC).trim() : "",
    fitid: row.NUMDOC && (/[A-Za-z]/.test(String(row.NUMDOC)) || String(row.NUMDOC).trim().length >= 15) ? String(row.NUMDOC).trim() : "",
    conciliado: row.MOV_BANCARIO != null,
    empresa: Number(row.EMPRESA) || null,
    conta: { banco: row.CDBANCO, agencia: row.AGENCIA || "", conta: row.NUMCONTA || "" },
  };
}

function nomesDaPessoa(row) {
  return [row.RAZAO, row.CLIENTE, row.FANTASIA, row.PESSOA]
    .map((nome) => (nome ? String(nome).trim() : ""))
    .filter((nome, indice, lista) => nome && lista.indexOf(nome) === indice);
}

function mapearTitulo(row, tipo) {
  const nomes = nomesDaPessoa(row);
  return {
    tipo,
    controle: Number(row.CONTROLE),
    idempresa: Number(row.IDEMPRESA),
    empresa: Number(row.IDEMPRESA),
    valor: Number(row.VALOR) || 0,
    dtvenc: row.DTVENC,
    nrdoc: row.NRDOC ? String(row.NRDOC).trim() : "",
    nrdoc2: row.NRDOC2 ? String(row.NRDOC2).trim() : "",
    nossoNumero: row.NOSSONUMERO ? String(row.NOSSONUMERO).trim() : "",
    pedido: row.NRPEDIDO ? String(row.NRPEDIDO).trim() : "",
    retencao: row.RETENCAO == null ? null : Number(row.RETENCAO),
    pessoa: nomes[0] || "",
    nomes,
    cgc: row.CGC ? String(row.CGC).replace(/\D/g, "") : "",
    conciliado: false,
    bruto: row.BRUTO == null ? null : Number(row.BRUTO),
    taxa: row.TAXA == null ? null : Number(row.TAXA),
    liquido: row.LIQUIDO == null ? null : Number(row.LIQUIDO),
  };
}

function centavosUnicos(movimentos) {
  return [...new Set((movimentos || []).map((movimento) => Math.round(Math.abs(Number(movimento.valor) || 0) * 100)).filter((valor) => valor > 0))].slice(0, 800);
}

function documentosDosMovimentos(movimentos) {
  const ids = new Set();
  for (const movimento of movimentos || []) {
    const extra = extrairIdentificadores(`${movimento.historico || ""} ${movimento.numdoc || ""} ${movimento.fitid || ""}`);
    for (const valor of Object.values(extra)) {
      if (valor && /^[A-Z0-9-]{5,40}$/i.test(String(valor))) ids.add(String(valor).replace(/'/g, "").toUpperCase());
    }
  }
  return [...ids].slice(0, 80);
}

async function titulosAbertos(db, empresa, movimentos, tipo) {
  const centavos = centavosUnicos(movimentos);
  const documentos = documentosDosMovimentos(movimentos);
  if (!centavos.length && !documentos.length) return [];
  const valorSql = tipo === "receber"
    ? "COALESCE(NULLIF(t.VLPGLIQ,0), NULLIF(t.TOTALPG,0), t.VALOR)"
    : "COALESCE(NULLIF(t.VLPAGTO,0), NULLIF(t.TOTAL,0), t.VALOR)";
  const partes = [];
  if (centavos.length) partes.push(`CAST(ABS(${valorSql}) * 100 AS INTEGER) IN (${centavos.join(",")})`);
  if (documentos.length) {
    const lista = documentos.map((id) => `'${id}'`).join(",");
    partes.push(tipo === "receber"
      ? `UPPER(TRIM(t.NRDOC)) IN (${lista}) OR UPPER(TRIM(t.NRDOC2)) IN (${lista}) OR UPPER(TRIM(t.NOSSONUMERO)) IN (${lista})`
      : `UPPER(TRIM(t.NRDOC)) IN (${lista})`);
  }
  const pessoa = tipo === "receber"
    ? "TRIM(c.RAZAO) AS RAZAO, TRIM(c.CLIENTE) AS CLIENTE, CAST(NULL AS VARCHAR(1)) AS FANTASIA, TRIM(c.CGC) AS CGC"
    : "TRIM(f.FORNECEDOR) AS RAZAO, CAST(NULL AS VARCHAR(1)) AS CLIENTE, TRIM(f.FANTASIA) AS FANTASIA, TRIM(f.CGC) AS CGC";
  const extras = tipo === "receber"
    ? "TRIM(t.NRDOC2) AS NRDOC2, TRIM(t.NOSSONUMERO) AS NOSSONUMERO, t.NRPEDIDO, t.RETENCAO"
    : "CAST(NULL AS VARCHAR(20)) AS NRDOC2, CAST(NULL AS VARCHAR(30)) AS NOSSONUMERO, CAST(NULL AS VARCHAR(20)) AS NRPEDIDO, CAST(NULL AS NUMERIC(15,2)) AS RETENCAO";
  const join = tipo === "receber" ? "LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE" : "LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR";
  const tabela = tipo === "receber" ? "CTARECEBER" : "CTAPAGAR";
  const filtroEmpresa = empresa ? " AND t.IDEMPRESA=?" : "";
  const sql = `SELECT FIRST 4000 t.CONTROLE, t.IDEMPRESA, ${valorSql} AS VALOR, CAST(t.DTVENC AS DATE) AS DTVENC, TRIM(t.NRDOC) AS NRDOC, ${extras}, ${pessoa} FROM ${tabela} t ${join} WHERE t.MOV_BANCARIA IS NULL AND t.STATUS=1${filtroEmpresa} AND (${partes.join(" OR ")})`;
  return (await consultar(db, sql, empresa ? [empresa] : [])).map((row) => mapearTitulo(row, tipo));
}

async function consultar(db, sql, params = []) {
  return query(db, sql, params);
}

export async function carregarConciliacao(db, empresa, limite = 500, cursor = 0) {
  const filtro = empresa ? " AND COALESCE(e.IDEMPRESA, c.IDEMPRESA)=?" : "";
  const params = empresa ? [empresa] : [];
  const teto = Math.max(1, Math.min(1000, Number(limite) || 500));
  const metade = Math.max(1, Math.floor(teto / 2));
  const idsPendentes = (await consultar(db, `SELECT ei.CONTROLE AS ID FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO WHERE ei.MOV_BANCARIO IS NULL${filtro}`, params)).map((row) => Number(row.ID));
  const fila = proximaFila(idsPendentes, cursor, metade);
  const recentes = (await consultar(db, `SELECT FIRST ${metade} ei.CONTROLE AS ID FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO WHERE ei.MOV_BANCARIO IS NULL${filtro} ORDER BY ei.DTLANCAMENTO DESC, ei.CONTROLE DESC`, params)).map((row) => Number(row.ID));
  const ids = [...new Set([...fila.ids, ...recentes])].filter((id) => id > 0).slice(0, teto);
  const movimentos = ids.length
    ? (await consultar(db, `SELECT ei.CONTROLE AS ID, ei.DTLANCAMENTO AS DATA, ei.VALOR, ei.DESCRICAO AS HISTORICO, ei.NUMDOC, ei.MOV_BANCARIO, COALESCE(e.IDEMPRESA, c.IDEMPRESA) AS EMPRESA, c.CDBANCO, c.AGENCIA, COALESCE(c.NUMCONTA, e.NUMCONTA) AS NUMCONTA FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO WHERE ei.CONTROLE IN (${ids.join(",")})`)).map(mapearMovimento)
    : [];
  const receber = await titulosAbertos(db, empresa, movimentos, "receber");
  try {
    const existe = await consultar(db, "SELECT COUNT(*) AS TOTAL FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)='CONCILIACAOCARTAO'");
    if (Number(existe[0]?.TOTAL) > 0) {
      const cartoes = await consultar(db, `SELECT cc.CONTROLE_CTA, cc.IDEMPRESA, cc.VALOR_BRUTO, cc.VALOR_TAXA, cc.VALOR_LIQUIDO FROM CONCILIACAOCARTAO cc JOIN CTARECEBER t ON t.CONTROLE=cc.CONTROLE_CTA AND t.IDEMPRESA=cc.IDEMPRESA WHERE t.MOV_BANCARIA IS NULL AND t.STATUS=1${empresa ? " AND t.IDEMPRESA=?" : ""}`, params);
      const porTitulo = new Map(cartoes.map((cartao) => [`${cartao.IDEMPRESA}:${cartao.CONTROLE_CTA}`, cartao]));
      for (const titulo of receber) {
        const cartao = porTitulo.get(`${titulo.idempresa}:${titulo.controle}`);
        if (!cartao) continue;
        titulo.bruto = Number(cartao.VALOR_BRUTO);
        titulo.taxa = Number(cartao.VALOR_TAXA);
        titulo.liquido = Number(cartao.VALOR_LIQUIDO);
      }
    }
  } catch {
    /* a tabela de cartão é opcional */
  }
  const pagar = await titulosAbertos(db, empresa, movimentos, "pagar");
  const baixadosReceber = (await consultar(db, `SELECT FIRST 30 t.CONTROLE, t.IDEMPRESA, COALESCE(NULLIF(t.VLPGLIQ,0), NULLIF(t.TOTALPG,0), t.VALOR) AS VALOR, CAST(t.DTVENC AS DATE) AS DTVENC, TRIM(t.NRDOC) AS NRDOC, TRIM(c.RAZAO) AS RAZAO, TRIM(c.CLIENTE) AS CLIENTE, CAST(NULL AS VARCHAR(1)) AS FANTASIA, TRIM(c.CGC) AS CGC FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE WHERE t.STATUS=2 AND t.MOV_BANCARIA IS NULL AND t.DTCOB IS NOT NULL AND CAST(t.DTCOB AS DATE) >= DATEADD(-15 DAY TO CURRENT_DATE)${empresa ? " AND t.IDEMPRESA=?" : ""}`, params)).map((row) => mapearTitulo(row, "receber"));
  const baixadosPagar = (await consultar(db, `SELECT FIRST 30 t.CONTROLE, t.IDEMPRESA, COALESCE(NULLIF(t.VLPAGTO,0), NULLIF(t.TOTAL,0), t.VALOR) AS VALOR, CAST(t.DTVENC AS DATE) AS DTVENC, TRIM(t.NRDOC) AS NRDOC, TRIM(f.FORNECEDOR) AS RAZAO, CAST(NULL AS VARCHAR(1)) AS CLIENTE, TRIM(f.FANTASIA) AS FANTASIA, TRIM(f.CGC) AS CGC FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR WHERE t.STATUS=2 AND t.MOV_BANCARIA IS NULL AND t.DTPAGTO IS NOT NULL AND CAST(t.DTPAGTO AS DATE) >= DATEADD(-15 DAY TO CURRENT_DATE)${empresa ? " AND t.IDEMPRESA=?" : ""}`, params)).map((row) => mapearTitulo(row, "pagar"));
  const contas = (await consultar(db, "SELECT DISTINCT CDBANCO, AGENCIA, NUMCONTA FROM (SELECT CDBANCO, AGENCIA, NUMCONTA FROM CONTACORRENTE UNION SELECT CDBANCO, AGENCIA, NUMCONTA FROM BANCO) contas WHERE CDBANCO IS NOT NULL AND NUMCONTA IS NOT NULL")).map((row) => ({ banco: row.CDBANCO, agencia: row.AGENCIA || "", conta: row.NUMCONTA }));
  let tarifas = [];
  try {
    tarifas = (await consultar(db, "SELECT FIRST 30 ABS(ei.VALOR) AS VALOR FROM EXTRATO_ITEM ei WHERE ei.MOV_BANCARIO IS NOT NULL AND UPPER(ei.DESCRICAO) CONTAINING 'TARIFA' ORDER BY ei.DTLANCAMENTO DESC")).map((row) => Number(row.VALOR) || 0);
  } catch {
    tarifas = [];
  }
  return { movimentos, titulos: [...receber, ...pagar], baixadosSemBanco: [...baixadosReceber, ...baixadosPagar], contasProprias: contas, tarifasHistoricas: tarifas, proximoCursor: fila.proximo, contagens: { baixadosSemBanco: baixadosReceber.length + baixadosPagar.length } };
}

function gravavel(decisao) {
  if (podeExecutarAutomaticamente(decisao)) return true;
  if (!decisao?.aprovadaPorHumano || decisao.alteraValor || decisao.ambigua || !decisao.titulos?.length) return false;
  const empresas = new Set(decisao.titulos.map((titulo) => Number(titulo.idempresa)));
  if (empresas.size !== 1 || ![...empresas][0] || [...empresas][0] !== Number(decisao.empresa)) return false;
  const soma = Math.round(decisao.titulos.reduce((total, titulo) => total + Math.abs(Number(titulo.valor) || 0), 0) * 100) / 100;
  return Math.abs(soma - Math.abs(Number(decisao.valor) || 0)) <= 0.01;
}

async function lerItem(tx, id) {
  return tx.singleton("SELECT FIRST 1 ei.CONTROLE, ei.DTLANCAMENTO AS DATA, ei.VALOR, ei.DESCRICAO, ei.MOV_BANCARIO, e.IDEMPRESA, c.CDBANCO, c.AGENCIA, COALESCE(c.NUMCONTA, e.NUMCONTA) AS NUMCONTA FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO WHERE ei.CONTROLE=?", [id]);
}

async function proximo(tx, tabela) {
  if (!["MOV_BANCARIO", "CTAPAGAR"].includes(tabela)) throw new Error("Tabela não permitida.");
  return Number((await tx.singleton(`SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM ${tabela}`)).ID);
}

async function vincularTitulo(tx, statement, titulo, ator) {
  const tabela = titulo.tipo === "receber" ? "CTARECEBER" : "CTAPAGAR";
  if (!TABELAS.has(tabela)) throw new Error("Tipo de título inválido.");
  const linha = await tx.singleton(`SELECT CONTROLE, IDEMPRESA, CODPAGTO, TPPAGTO, MOV_BANCARIA FROM ${tabela} WHERE CONTROLE=? AND IDEMPRESA=?`, [titulo.controle, titulo.idempresa]);
  if (!linha) throw Object.assign(new Error(`Título ${titulo.controle} não encontrado.`), { status: 404 });
  if (linha.MOV_BANCARIA) throw Object.assign(new Error(`Título ${titulo.controle} já está conciliado.`), { status: 409 });
  if (Number(statement.IDEMPRESA) && Number(linha.IDEMPRESA) !== Number(statement.IDEMPRESA)) {
    throw Object.assign(new Error("Título de outra empresa."), { status: 409 });
  }
  const forma = /pix/i.test(String(statement.DESCRICAO || "")) ? 29 : Number(linha.CODPAGTO || linha.TPPAGTO || 1);
  const valor = Math.abs(Number(titulo.valor));
  const controle = await proximo(tx, "MOV_BANCARIO");
  await tx.execute("INSERT INTO MOV_BANCARIO (CONTROLE,CDBANCO,AGENCIA,NUMCONTA,IDUSUARIO,IDEMPRESA,DESCRICAO,HISTORICO,DTLANCAMENTO,VALOR,TPLANCAMENTO,CDRECEBTO,STATUS,EXTRATO_ITEM,CONTROLE_CTA,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?, 'LOCAL')", [
    controle, statement.CDBANCO, statement.AGENCIA, statement.NUMCONTA, Number(ator.idusuario || 1), Number(linha.IDEMPRESA),
    "Conciliacao automatica", String(statement.DESCRICAO || "").slice(0, 255), statement.DATA,
    titulo.tipo === "receber" ? valor : -valor, titulo.tipo === "receber" ? 0 : 1, forma, statement.CONTROLE, Number(linha.CONTROLE),
  ]);
  if (titulo.tipo === "receber") {
    await tx.execute("UPDATE CTARECEBER SET MOV_BANCARIA=?,STATUS=2,CODPAGTO=COALESCE(CODPAGTO,?),TPPAGTO=?,DTCOB=COALESCE(DTCOB,?),TOTALPG=CASE WHEN COALESCE(TOTALPG,0)=0 THEN ? ELSE TOTALPG END,VLPGLIQ=CASE WHEN COALESCE(VLPGLIQ,0)=0 THEN ? ELSE VLPGLIQ END WHERE CONTROLE=? AND IDEMPRESA=? AND MOV_BANCARIA IS NULL", [controle, forma, forma, statement.DATA, valor, valor, linha.CONTROLE, linha.IDEMPRESA]);
  } else {
    await tx.execute("UPDATE CTAPAGAR SET MOV_BANCARIA=?,STATUS=2,CODPAGTO=COALESCE(CODPAGTO,?),TPPAGTO=?,DTPAGTO=COALESCE(DTPAGTO,?),VLPAGTO=CASE WHEN COALESCE(VLPAGTO,0)=0 THEN ? ELSE VLPAGTO END WHERE CONTROLE=? AND IDEMPRESA=? AND MOV_BANCARIA IS NULL", [controle, forma, forma, statement.DATA, valor, linha.CONTROLE, linha.IDEMPRESA]);
  }
  const conferido = await tx.singleton(`SELECT MOV_BANCARIA FROM ${tabela} WHERE CONTROLE=? AND IDEMPRESA=?`, [linha.CONTROLE, linha.IDEMPRESA]);
  if (Number(conferido?.MOV_BANCARIA) !== controle) throw Object.assign(new Error("A baixa não foi confirmada."), { status: 409 });
  return controle;
}

async function aplicarTransferencia(tx, statement, espelho, ator) {
  if (!espelho || espelho.MOV_BANCARIO || statement.MOV_BANCARIO) throw Object.assign(new Error("A transferência já foi conciliada."), { status: 409 });
  if (Math.abs(Number(espelho.VALOR) + Number(statement.VALOR)) > 0.009) throw Object.assign(new Error("O espelho não fecha o valor."), { status: 409 });
  const origemConta = Number(statement.VALOR) < 0 ? statement : espelho;
  const destinoConta = Number(statement.VALOR) < 0 ? espelho : statement;
  const valor = Math.abs(Number(statement.VALOR));
  const descricao = `Transferencia entre contas ${origemConta.CDBANCO}/${origemConta.NUMCONTA} -> ${destinoConta.CDBANCO}/${destinoConta.NUMCONTA}`.slice(0, 255);
  const inserir = async (item, sinal) => {
    const controle = await proximo(tx, "MOV_BANCARIO");
    await tx.execute("INSERT INTO MOV_BANCARIO (CONTROLE,CDBANCO,AGENCIA,NUMCONTA,CDBANCOORIGEM,AGENCIAORIGEM,NUMCONTAORIGEM,CDBANCODESTINO,AGENCIADESTINO,NUMCONTADESTINO,NUMDOC,IDUSUARIO,IDEMPRESA,DESCRICAO,HISTORICO,DTLANCAMENTO,VALOR,TPLANCAMENTO,CDRECEBTO,STATUS,EXTRATO_ITEM,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'LOCAL')", [
      controle, item.CDBANCO, item.AGENCIA, item.NUMCONTA, origemConta.CDBANCO, origemConta.AGENCIA, origemConta.NUMCONTA,
      destinoConta.CDBANCO, destinoConta.AGENCIA, destinoConta.NUMCONTA, `TRANSF-${statement.CONTROLE}`.slice(0, 30),
      Number(ator.idusuario || 1), statement.IDEMPRESA, descricao, String(statement.DESCRICAO || "").slice(0, 255),
      statement.DATA, sinal * valor, sinal < 0 ? 1 : 0, 1, 0, item.CONTROLE,
    ]);
    await tx.execute("UPDATE EXTRATO_ITEM SET MOV_BANCARIO=? WHERE CONTROLE=? AND MOV_BANCARIO IS NULL", [controle, item.CONTROLE]);
    return controle;
  };
  const saida = await inserir(origemConta, -1);
  const entrada = await inserir(destinoConta, 1);
  return [saida, entrada];
}

async function aplicarTarifa(tx, statement, decisao, ator) {
  const valor = Math.abs(Number(statement.VALOR));
  const controle = await proximo(tx, "CTAPAGAR");
  const empresa = Number(statement.IDEMPRESA || decisao.empresa);
  const documento = `TAR-${statement.CONTROLE}`.slice(0, 20);
  await tx.execute("INSERT INTO CTAPAGAR (CONTROLE,IDEMPRESA,NOTAFISCAL,NUMERO,CDFORNECEDOR,PARCELA,STATUS,CDCAIXA,CCUSTO,CODPAGTO,NRDOC,DTVENC,DTINCLUSAO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,HISTORICO,VALOR,TOTAL,VLPAGTO,IDUSUARIO,SIST_ALT,ORIGEM,COMPETENCIA) VALUES (?,?,?,?,?,1,1,?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?,?, ?,0,?,'LOCAL','CONCILIACAO_AUTOMATICA',?)", [
    controle, empresa, documento, documento.slice(0, 10), Number(decisao.fornecedor), null, null, 1, documento,
    dia(statement.DATA), decisao.cdconta, null, null, null, String(statement.DESCRICAO || "Tarifa bancária").slice(0, 255),
    valor, valor, Number(ator.idusuario || 1), dia(statement.DATA),
  ]);
  return vincularTitulo(tx, statement, { tipo: "pagar", controle, idempresa: empresa, valor }, ator);
}

export async function aplicarConciliacao(tx, decisao, ator = {}) {
  if (!gravavel(decisao)) throw Object.assign(new Error("A decisão não passou nas regras de gravação."), { status: 409 });
  const statement = await lerItem(tx, decisao.movimentoId);
  if (!statement) throw Object.assign(new Error("Lançamento de extrato não encontrado."), { status: 404 });
  if (statement.MOV_BANCARIO) throw Object.assign(new Error("Lançamento já conciliado."), { status: 409 });
  if (Number(statement.IDEMPRESA) && Number(decisao.empresa) && Number(statement.IDEMPRESA) !== Number(decisao.empresa)) {
    throw Object.assign(new Error("Lançamento de outra empresa."), { status: 409 });
  }
  if (decisao.acao === "transferencia") {
    const espelho = await lerItem(tx, decisao.espelhoId);
    const movimentos = await aplicarTransferencia(tx, statement, espelho, ator);
    return { movimentos, titulos: [] };
  }
  if (decisao.acao === "tarifa") {
    const movimento = await aplicarTarifa(tx, statement, decisao, ator);
    await tx.execute("UPDATE EXTRATO_ITEM SET MOV_BANCARIO=? WHERE CONTROLE=? AND MOV_BANCARIO IS NULL", [movimento, statement.CONTROLE]);
    return { movimentos: [movimento], titulos: [] };
  }
  if (decisao.acao === "cartao") {
    const titulo = decisao.titulos[0];
    const taxa = Math.abs(Number(decisao.taxa));
    const liquido = Math.abs(Number(statement.VALOR));
    if (Math.abs(Math.abs(titulo.valor) - taxa - liquido) > 0.009) {
      throw Object.assign(new Error("A taxa autorizada não fecha o líquido do extrato."), { status: 409 });
    }
    await tx.execute("UPDATE CTARECEBER SET RETENCAO=? WHERE CONTROLE=? AND IDEMPRESA=? AND MOV_BANCARIA IS NULL", [taxa, titulo.controle, titulo.idempresa]);
    const movimento = await vincularTitulo(tx, statement, { ...titulo, valor: liquido }, ator);
    await tx.execute("UPDATE EXTRATO_ITEM SET MOV_BANCARIO=? WHERE CONTROLE=? AND MOV_BANCARIO IS NULL", [movimento, statement.CONTROLE]);
    return { movimentos: [movimento], titulos: [titulo] };
  }
  const soma = Math.round(decisao.titulos.reduce((total, titulo) => total + Math.abs(titulo.valor), 0) * 100) / 100;
  if (Math.abs(soma - Math.abs(Number(statement.VALOR))) > 0.009) throw Object.assign(new Error("A soma dos títulos mudou antes da gravação."), { status: 409 });
  const movimentos = [];
  for (const titulo of decisao.titulos) movimentos.push(await vincularTitulo(tx, statement, titulo, ator));
  await tx.execute("UPDATE EXTRATO_ITEM SET MOV_BANCARIO=? WHERE CONTROLE=? AND MOV_BANCARIO IS NULL", [movimentos[0], statement.CONTROLE]);
  const vinculado = await tx.singleton("SELECT MOV_BANCARIO FROM EXTRATO_ITEM WHERE CONTROLE=?", [statement.CONTROLE]);
  if (Number(vinculado?.MOV_BANCARIO) !== Number(movimentos[0])) throw Object.assign(new Error("O extrato não ficou vinculado."), { status: 409 });
  return { movimentos, titulos: decisao.titulos };
}

export async function desfazerNoBanco(tx, registro) {
  const item = await lerItem(tx, registro.movimentoId);
  if (!item || Number(item.MOV_BANCARIO) !== Number(registro.movimentos[0])) {
    throw Object.assign(new Error("O vínculo atual não é o que esta conciliação gravou."), { status: 409 });
  }
  await tx.execute("UPDATE EXTRATO_ITEM SET MOV_BANCARIO=NULL WHERE CONTROLE=? AND MOV_BANCARIO=?", [registro.movimentoId, registro.movimentos[0]]);
  for (const titulo of registro.titulos || []) {
    const tabela = titulo.tipo === "receber" ? "CTARECEBER" : "CTAPAGAR";
    await tx.execute(`UPDATE ${tabela} SET MOV_BANCARIA=NULL, STATUS=1 WHERE CONTROLE=? AND IDEMPRESA=? AND MOV_BANCARIA=?`, [titulo.controle, titulo.idempresa, registro.movimentos[0]]);
  }
  for (const movimento of registro.movimentos || []) {
    await tx.execute("UPDATE MOV_BANCARIO SET STATUS=9, EXTRATO_ITEM=NULL WHERE CONTROLE=?", [movimento]);
  }
  if (registro.acao === "cartao") {
    for (const titulo of registro.titulos || []) {
      if (titulo.tipo === "receber") {
        await tx.execute("UPDATE CTARECEBER SET RETENCAO=0, VLPGLIQ=NULL, TOTALPG=NULL WHERE CONTROLE=? AND IDEMPRESA=? AND MOV_BANCARIA IS NULL", [titulo.controle, titulo.idempresa]);
      }
    }
  }
  if (registro.espelhoId) await tx.execute("UPDATE EXTRATO_ITEM SET MOV_BANCARIO=NULL WHERE CONTROLE=?", [registro.espelhoId]);
}

function trilha(decisao, resultado, ator, origem) {
  return {
    id: `${Date.now()}-${decisao.movimentoId}-${origem}`,
    em: new Date().toISOString(),
    origem,
    idusuario: ator.idusuario || null,
    nome: String(ator.nome || origem).slice(0, 100),
    empresa: decisao.empresa,
    movimentoId: decisao.movimentoId,
    dataMovimento: decisao.data || null,
    espelhoId: decisao.espelhoId || null,
    acao: decisao.acao,
    motivo: decisao.motivo,
    nivel: decisao.nivel,
    valorAntes: decisao.valor,
    valorDepois: decisao.valor,
    titulos: decisao.titulos || [],
    movimentos: resultado?.movimentos || [],
    hipotese: decisao.hipotese ? { causa: decisao.hipotese.causa, origem: decisao.hipotese.origem || "regras" } : null,
    taxa: decisao.taxa ?? null,
    desfeito: false,
  };
}

async function narrarOllama(fatos) {
  return ollamaChat({
    temperature: 0,
    maxTokens: 350,
    messages: [
      { role: "system", content: "Responda somente JSON com causa, evidencias e narracao. Nao invente documento, valor ou causa. Nao execute nada. Causas: desconto_concedido, tarifa_financeira, retencao, pagamento_parcial, divergencia_valor, transferencia_interna, pagamento_agrupado, sem_evidencia." },
      { role: "user", content: JSON.stringify(fatos) },
    ],
  });
}

function horarioPermite(configuracao, agora, ultimoEnvio) {
  const horario = String(configuracao.notificacoes?.horario || "08:00");
  const [hora, minuto] = horario.split(":").map((parte) => Number(parte));
  if (!Number.isInteger(hora) || !Number.isInteger(minuto)) return false;
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  if (minutos < hora * 60 + minuto) return false;
  return !ultimoEnvio || dia(ultimoEnvio) !== dia(agora);
}

export async function executarCiclo(deps = {}) {
  const estado = lerEstado(deps);
  if (deps.manual !== true && !cicloDevido(estado, deps.agora || Date.now())) return { adiado: true, motivo: "aguardando_intervalo" };
  const owner = adquirirLock(estado, deps.agora || Date.now());
  if (!owner) return { adiado: true, motivo: "em_processamento" };
  gravarEstado(estado, deps);
  try {
    const empresa = Number(deps.empresa || 0) || null;
    const carga = deps.movimentos ? {
      movimentos: deps.movimentos,
      titulos: deps.titulos || [],
      contasProprias: deps.contasProprias || [],
      baixadosSemBanco: deps.baixadosSemBanco || [],
      tarifasHistoricas: deps.tarifasHistoricas || [],
      contagens: deps.contagens || null,
    } : await carregarConciliacao(deps.db, empresa, estado.configuracao.maxMovimentos);
    const analise = analisarLote({ ...carga, padroes: estado.padroes, configuracao: estado.configuracao });
    const aplicadas = [];
    const falhas = [];
    for (const decisao of analise.decisoes) {
      if (decisao.acao === "transferencia" && Number(decisao.movimentoId) > Number(decisao.espelhoId)) continue;
      if (!podeExecutarAutomaticamente(decisao)) continue;
      const chave = chaveIdempotencia(decisao);
      const anterior = estado.idempotencia[chave];
      if (anterior?.status === "aplicado" || Number(anterior?.tentativas || 0) >= 5) continue;
      try {
        const resultado = await deps.aplicar(decisao, { origem: "servico-conciliacao", idusuario: estado.configuracao.usuarioServico || 1, nome: "servico-conciliacao" });
        estado.idempotencia[chave] = { status: "aplicado", em: new Date().toISOString(), movimentos: resultado?.movimentos || [] };
        estado.auditoria.push(trilha(decisao, resultado, { idusuario: estado.configuracao.usuarioServico || 1, nome: "servico-conciliacao" }, "servico-conciliacao"));
        aplicadas.push({ movimentoId: decisao.movimentoId, movimentos: resultado?.movimentos || [] });
      } catch (error) {
        estado.idempotencia[chave] = { status: "falha", em: new Date().toISOString(), tentativas: Number(anterior?.tentativas || 0) + 1, erro: String(error.message || error).slice(0, 180) };
        falhas.push({ movimentoId: decisao.movimentoId, erro: String(error.message || error).slice(0, 180) });
      }
    }
    if (carga.proximoCursor != null) estado.fila = carga.proximoCursor;
    const narrar = deps.narrar === undefined ? narrarOllama : deps.narrar;
    const excecoes = [];
    let charlie = 0;
    for (const decisao of analise.decisoes.filter((item) => item.acao === "excecao")) {
      const copia = { ...decisao, id: decisao.movimentoId ? `mov-${decisao.movimentoId}` : `titulo-${decisao.titulos?.[0]?.tipo || "x"}-${decisao.titulos?.[0]?.controle || excecoes.length}` };
      if (narrar && copia.nivel === 3 && charlie < Number(estado.configuracao.maxCharlie || 8)) {
        const movimento = carga.movimentos.find((item) => item.id === decisao.movimentoId);
        const relacionados = carga.titulos.filter((titulo) => (decisao.titulos || []).some((item) => item.controle === titulo.controle && item.tipo === titulo.tipo));
        if (movimento) {
          copia.hipotese = await investigar(montarFatos(movimento, relacionados), narrar);
          copia.hipotese.automatica = false;
          charlie += 1;
        }
      }
      excecoes.push(copia);
    }
    const comDecisao = excecoes.filter((item) => item.motivo !== "sem_origem" && item.motivo !== "baixado_sem_banco");
    const baixados = excecoes.filter((item) => item.motivo === "baixado_sem_banco");
    const semOrigem = excecoes.filter((item) => item.motivo === "sem_origem");
    estado.excecoes = [...comDecisao, ...baixados.slice(0, 30), ...semOrigem.slice(0, 40)].slice(0, 300);
    estado.resumoExcecoes = {
      semOrigem: semOrigem.length,
      valorSemOrigem: Math.round(semOrigem.reduce((total, item) => total + Math.abs(Number(item.valor) || 0), 0) * 100) / 100,
      baixadosSemBanco: Number(carga.contagens?.baixadosSemBanco ?? baixados.length),
    };
    for (const movimento of carga.movimentos) {
      const chave = `${movimento.empresa}|${movimento.conta?.banco}|${movimento.conta?.conta}`;
      const atual = Number(estado.cursores[chave]?.ultimoId || 0);
      if (Number(movimento.id) > atual) estado.cursores[chave] = { ultimoId: Number(movimento.id), em: new Date().toISOString() };
    }
    const mensagens = notificacoesDoCiclo(analise.metricas, analise.decisoes, estado.configuracao);
    const ultimoAviso = estado.notificacoes.filter((item) => item.canais?.includes("email")).at?.(-1)?.em;
    const enviar = estado.configuracao.notificacoes?.envioReal && horarioPermite(estado.configuracao, deps.agoraData || new Date(), ultimoAviso);
    const registros = mensagens.map((mensagem) => ({ ...mensagem, em: new Date().toISOString(), canais: estado.configuracao.notificacoes?.interno === false ? [] : ["interno"] }));
    if (enviar && deps.enviarAvisos) {
      try {
        const entrega = await deps.enviarAvisos(registros, estado.configuracao.notificacoes || {});
        for (const registro of registros) {
          registro.canais.push(...(entrega?.canais || []));
          if (entrega?.motivos?.length) registro.motivos = entrega.motivos;
        }
      } catch (error) {
        for (const registro of registros) registro.erroEnvio = String(error.message || error).replace(/bearer\s+\S+/gi, "bearer").slice(0, 160);
      }
    } else if (enviar && deps.enviarEmail && estado.configuracao.notificacoes?.email) {
      try {
        await deps.enviarEmail(registros, estado.configuracao.notificacoes.destinatarios || []);
        for (const registro of registros) registro.canais.push("email");
      } catch (error) {
        for (const registro of registros) registro.erroEmail = String(error.message || error).slice(0, 160);
      }
    }
    estado.notificacoes.push(...registros);
    estado.execucoes.push({ em: new Date().toISOString(), ...analise.metricas, aplicadas: aplicadas.length, falhas: falhas.length, charlie });
    estado.ultimoErro = null;
    estado.fechamentos = estado.fechamentos || [];
    liberarLock(estado, owner);
    gravarEstado(estado, deps);
    return { ok: true, metricas: analise.metricas, aplicadas, falhas, excecoes: excecoes.length, proativas: analise.proativas, charlie };
  } catch (error) {
    estado.ultimoErro = { em: new Date().toISOString(), tentativas: Number(estado.ultimoErro?.tentativas || 0) + 1, erro: String(error.message || error).slice(0, 300) };
    liberarLock(estado, owner);
    gravarEstado(estado, deps);
    throw error;
  }
}

export async function aprovarExcecao(deps, id, escolha, ator) {
  const estado = lerEstado(deps);
  const excecao = (estado.excecoes || []).find((item) => item.id === id);
  if (!excecao) return { ok: false, motivo: "excecao_nao_encontrada" };
  const permissao = podeAprovarEscolha(excecao, { ...escolha, perfis: estado.configuracao.perfisAprovacao }, ator);
  if (!permissao.ok) return permissao;
  const decisao = { ...excecao, acao: "conciliar", automatica: false, ambigua: false, alteraValor: false, aprovadaPorHumano: true, titulos: [permissao.titulo] };
  const resultado = await deps.aplicar(decisao, { ...ator, origem: "aprovacao-humana" });
  estado.padroes = registrarAprendizado(estado.padroes, { empresa: excecao.empresa, historico: excecao.historico, pessoa: permissao.titulo.pessoa, tipo: permissao.titulo.tipo });
  estado.excecoes = estado.excecoes.filter((item) => item.id !== id);
  estado.auditoria.push(trilha(decisao, resultado, ator, "aprovacao-humana"));
  estado.idempotencia[chaveIdempotencia(decisao)] = { status: "aplicado", em: new Date().toISOString(), movimentos: resultado?.movimentos || [] };
  gravarEstado(estado, deps);
  return { ok: true, movimentos: resultado?.movimentos || [] };
}

export async function aprovarLote(deps, ids, ator) {
  const estado = lerEstado(deps);
  const escolhidas = (estado.excecoes || []).filter((item) => ids.includes(item.id));
  if (!loteSeguro(escolhidas)) return { ok: false, motivo: "lote_inseguro" };
  const feitas = [];
  for (const item of escolhidas) {
    const resultado = await aprovarExcecao(deps, item.id, { confirmado: true, controle: item.titulos[0].controle, tipo: item.titulos[0].tipo }, ator);
    if (!resultado.ok) return resultado;
    feitas.push(resultado);
  }
  return { ok: true, aprovadas: feitas.length };
}

export function rejeitarExcecao(deps, id, ator) {
  const estado = lerEstado(deps);
  if (!ator?.idusuario) return { ok: false, motivo: "usuario_ausente" };
  const excecao = (estado.excecoes || []).find((item) => item.id === id);
  if (!excecao) return { ok: false, motivo: "excecao_nao_encontrada" };
  const titulo = excecao.titulos?.[0];
  if (titulo?.pessoa) {
    estado.padroes = registrarAprendizado(estado.padroes, { empresa: excecao.empresa, historico: excecao.historico, pessoa: titulo.pessoa, tipo: titulo.tipo, erro: true });
  }
  estado.excecoes = estado.excecoes.filter((item) => item.id !== id);
  estado.auditoria.push({ id: `rejeicao-${id}`, em: new Date().toISOString(), origem: "aprovacao-humana", idusuario: ator.idusuario, nome: ator.nome || "", empresa: excecao.empresa, movimentoId: excecao.movimentoId, acao: "rejeitar", motivo: excecao.motivo, movimentos: [], titulos: [], desfeito: false });
  gravarEstado(estado, deps);
  return { ok: true };
}

export async function desfazerConciliacao(deps, id, pedido) {
  const estado = lerEstado(deps);
  const registro = (estado.auditoria || []).find((item) => item.id === id);
  const permissao = desfazerPermitido(registro, pedido);
  if (!permissao.ok) return permissao;
  await deps.desfazer(registro);
  registro.desfeito = true;
  registro.desfeitoEm = new Date().toISOString();
  registro.desfeitoPor = pedido.idusuario;
  estado.auditoria.push({ ...registro, id: `${registro.id}-desfeito`, acao: "desfazer", movimentos: registro.movimentos, desfeito: true });
  gravarEstado(estado, deps);
  return { ok: true };
}

function tempoMedioHoras(auditoria) {
  const horas = [];
  for (const item of auditoria || []) {
    if (!item.em || !item.dataMovimento || item.acao === "desfazer") continue;
    const diff = (Date.parse(item.em) - Date.parse(`${item.dataMovimento}T00:00:00`)) / 36e5;
    if (Number.isFinite(diff) && diff >= 0 && diff < 24 * 90) horas.push(diff);
  }
  if (!horas.length) return null;
  return Math.round((horas.reduce((total, hora) => total + hora, 0) / horas.length) * 10) / 10;
}

export function montarPainel(estado = lerEstado(), contas = []) {
  const execucoes = estado.execucoes || [];
  const ultima = execucoes[execucoes.length - 1] || null;
  const incorretas = (estado.auditoria || []).filter((item) => item.desfeito && item.acao !== "desfazer").length;
  return {
    indicadores: ultima ? { ...ultima, incorretas, pendentesPorIdade: (estado.excecoes || []).length, tempoMedioHoras: tempoMedioHoras(estado.auditoria) } : null,
    resumoExcecoes: estado.resumoExcecoes || null,
    excecoes: estado.excecoes || [],
    divergencias: (estado.excecoes || []).filter((item) => item.cor === "divergencia").length,
    aguardando: (estado.excecoes || []).filter((item) => item.cor === "analise").length,
    charlie: (estado.excecoes || []).filter((item) => item.hipotese?.origem === "charlie").length,
    ultimaSincronizacao: Object.values(estado.cursores || {}).sort((a, b) => String(b.em).localeCompare(String(a.em)))[0]?.em || ultima?.em || null,
    processando: Boolean(estado.lock),
    serie: execucoes.slice(-30).map((item) => ({ em: item.em, percentual: item.percentualElegiveis })),
    porConta: ultima?.porConta || [],
    fontes: descreverFontes(contas),
    notificacoes: (estado.notificacoes || []).slice(-20),
    meta: 95,
    configuracao: {
      ativo: estado.configuracao.ativo,
      intervaloMinutos: estado.configuracao.intervaloMinutos,
      janelaDias: estado.configuracao.janelaDias,
      notificacoes: { ...estado.configuracao.notificacoes, destinatarios: estado.configuracao.notificacoes?.destinatarios || [] },
    },
  };
}

export async function gerarPreFechamento(deps, data) {
  const carga = deps.movimentos ? deps : await carregarConciliacao(deps.db, Number(deps.empresa || 0) || null, 1000);
  const doDia = (carga.movimentos || []).filter((item) => !data || dia(item.data) === data);
  const analise = analisarLote({ ...carga, movimentos: doDia, padroes: [], configuracao: deps.configuracao || CONFIGURACAO_PADRAO });
  const fechamento = montarPreFechamento({ data, movimentos: doDia, analise, saldos: deps.saldos || [], diasEsperados: deps.diasEsperados || [] });
  let resumo = fechamento.resumo;
  if (deps.narrar) {
    const texto = await deps.narrar(fechamento);
    const aceito = aceitarResumo(texto, { valores: [fechamento.divergencias, analise.metricas?.automaticas || 0, analise.metricas?.valorPendente || 0] });
    if (aceito) resumo = aceito;
  }
  return { ...fechamento, resumo, fechamentoDefinitivo: false };
}

export async function fecharDefinitivo(deps, data, ator) {
  const previa = await gerarPreFechamento(deps, data);
  const estado = lerEstado(deps);
  const permissao = podeFecharDefinitivo(previa, ator, estado.configuracao.perfisAprovacao);
  if (!permissao.ok) return { ...permissao, fechamento: previa };
  const registro = { data, em: new Date().toISOString(), idusuario: ator.idusuario, nome: ator.nome || "", definitivo: true, divergencias: previa.divergencias };
  estado.fechamentos = [...(estado.fechamentos || []), registro].slice(-60);
  estado.auditoria.push({ id: `fechamento-${data}-${Date.now()}`, em: registro.em, origem: "aprovacao-humana", idusuario: ator.idusuario, nome: ator.nome || "", empresa: Number(deps.empresa || 0) || null, movimentoId: null, acao: "fechamento", motivo: "fechamento_definitivo", movimentos: [], titulos: [], desfeito: false });
  gravarEstado(estado, deps);
  return { ok: true, fechamento: { ...previa, fechamentoDefinitivo: true, fechadoPor: ator.idusuario, fechadoEm: registro.em } };
}

export async function importarExtratoConfirmado(tx, pedido) {
  if (pedido?.confirmado !== true) throw Object.assign(new Error("Confirme a importação."), { status: 409 });
  const banco = String(pedido.cdbanco || "").trim();
  const conta = String(pedido.numconta || "").trim();
  const empresa = Number(pedido.empresa);
  const usuario = Number(pedido.usuario);
  if (!banco || !conta || !empresa || !usuario) throw Object.assign(new Error("Informe banco, conta, empresa e usuário."), { status: 400 });
  const conhecidos = (await tx.query("SELECT TRIM(i.NUMDOC) AS NUMDOC FROM EXTRATO_ITEM i JOIN EXTRATO e ON e.CONTROLE=i.EXTRATO JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO WHERE c.CDBANCO=? AND TRIM(COALESCE(c.NUMCONTA, e.NUMCONTA))=TRIM(?) AND i.NUMDOC IS NOT NULL", [banco, conta])).map((row) => row.NUMDOC);
  const preparado = Array.isArray(pedido.itens)
    ? { ...separarJaImportados(pedido.itens, conhecidos), formato: "API", erros: [] }
    : prepararImportacao(pedido.conteudo, pedido.formato, conhecidos);
  if (!preparado.novos.length) return { inseridos: 0, duplicados: preparado.duplicados.length, erros: preparado.erros || [] };
  const datas = preparado.novos.map((item) => item.data).sort();
  const conc = Number((await tx.singleton("SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM CONCILIACAO")).ID);
  await tx.execute("INSERT INTO CONCILIACAO (CONTROLE,CDBANCO,AGENCIA,NUMCONTA,IDEMPRESA,IDUSUARIO,DESCRICAO,DTINICIAL,DTFINAL,SALDOINICIAL,SALDOFINAL,STATUS,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'LOCAL')", [
    conc, banco, String(pedido.agencia || ""), conta, empresa, usuario, `Importacao ${preparado.formato || "arquivo"}`.slice(0, 255), datas[0], datas[datas.length - 1], 0, 0,
  ]);
  const ext = Number((await tx.singleton("SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM EXTRATO")).ID);
  await tx.execute("INSERT INTO EXTRATO (CONTROLE,CONCILIACAO,IDUSUARIO,IDEMPRESA,NUMCONTA,DESCRICAO,DTINICIAL,DTFINAL,SALDOINICIAL,SALDOFINAL,STATUS,NUMARQUIVO,NOMEARQUIVO,TPDADOS,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,0,1,?,0,'LOCAL')", [
    ext, conc, usuario, empresa, conta, `${banco} - ${conta}`.slice(0, 255), datas[0], datas[datas.length - 1], 0, 0, String(pedido.nomeArquivo || preparado.formato || "extrato").slice(0, 255),
  ]);
  let nextItem = Number((await tx.singleton("SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM EXTRATO_ITEM")).ID);
  for (const item of preparado.novos) {
    await tx.execute("INSERT INTO EXTRATO_ITEM (CONTROLE,EXTRATO,DTLANCAMENTO,VALOR,DESCRICAO,TPLANCAMENTO,NUMDOC,STATUS,STATUS_EXT,SIST_ALT) VALUES (?,?,?,?,?,?,?,0,1,'LOCAL')", [
      nextItem++, ext, item.data, item.valor, String(item.historico || "Lancamento").slice(0, 255), item.valor < 0 ? 1 : 0, String(item.numdoc || item.fitid || "").slice(0, 40),
    ]);
  }
  return { inseridos: preparado.novos.length, duplicados: preparado.duplicados.length, erros: preparado.erros || [] };
}

export function registrarFalhaCiclo(erro, deps = {}) {
  const estado = lerEstado(deps);
  estado.ultimoErro = { em: new Date().toISOString(), tentativas: Number(estado.ultimoErro?.tentativas || 0) + 1, erro: String(erro?.message || erro).slice(0, 300) };
  gravarEstado(estado, deps);
  return estado.ultimoErro;
}

export function prepararImportacao(texto, formato, chavesExistentes = []) {
  const lido = String(formato || "").toLowerCase() === "cnab" ? parseCnabExtrato(texto) : parseCsvExtrato(texto);
  const separado = separarJaImportados(lido.itens, chavesExistentes);
  return { ...lido, ...separado };
}

export function salvarConfiguracao(deps, entrada) {
  const estado = lerEstado(deps);
  const atual = estado.configuracao;
  const notificacoes = entrada?.notificacoes || {};
  estado.configuracao = {
    ...atual,
    ativo: entrada?.ativo == null ? atual.ativo : Boolean(entrada.ativo),
    intervaloMinutos: Number(entrada?.intervaloMinutos || atual.intervaloMinutos),
    janelaDias: Number(entrada?.janelaDias ?? atual.janelaDias),
    notificacoes: {
      ...atual.notificacoes,
      interno: notificacoes.interno == null ? atual.notificacoes.interno : Boolean(notificacoes.interno),
      email: notificacoes.email == null ? atual.notificacoes.email : Boolean(notificacoes.email),
      whatsapp: notificacoes.whatsapp == null ? atual.notificacoes.whatsapp : Boolean(notificacoes.whatsapp),
      envioReal: notificacoes.envioReal == null ? atual.notificacoes.envioReal : Boolean(notificacoes.envioReal),
      horario: /^\d{2}:\d{2}$/.test(String(notificacoes.horario || "")) ? notificacoes.horario : atual.notificacoes.horario,
      destinatarios: Array.isArray(notificacoes.destinatarios) ? notificacoes.destinatarios.map((item) => String(item).slice(0, 120)).slice(0, 20) : atual.notificacoes.destinatarios,
      telefones: notificacoes.telefones == null ? atual.notificacoes.telefones || "" : String(notificacoes.telefones).slice(0, 200),
      templateWhatsapp: notificacoes.templateWhatsapp == null ? atual.notificacoes.templateWhatsapp || "" : String(notificacoes.templateWhatsapp).slice(0, 80),
      prioridades: Array.isArray(notificacoes.prioridades) ? notificacoes.prioridades.filter((item) => ["alta", "normal", "baixa"].includes(item)) : atual.notificacoes.prioridades,
    },
  };
  gravarEstado(estado, deps);
  return montarPainel(estado).configuracao;
}
