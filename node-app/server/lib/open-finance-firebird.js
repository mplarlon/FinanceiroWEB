import { query, withDatabase, withWriteTransaction } from "../db.js";
import { dia, VERSAO_ESQUEMA } from "./open-finance-engine.js";

const SEQUENCIAS = [
  "GEN_DASH_OF_CONEXAO",
  "GEN_DASH_OF_CONTA",
  "GEN_DASH_OF_MOV",
  "GEN_DASH_OF_SYNC",
  "GEN_DASH_OF_REGRA",
  "GEN_DASH_OF_DIVERG",
  "GEN_DASH_OF_AUDIT",
  "GEN_DASH_OF_EVENTO",
];

const TABELAS = {
  DASH_OF_VERSAO: "CREATE TABLE DASH_OF_VERSAO (VERSAO INTEGER NOT NULL PRIMARY KEY, APLICADO_EM TIMESTAMP NOT NULL)",
  DASH_OF_POLITICA: "CREATE TABLE DASH_OF_POLITICA (IDEMPRESA INTEGER NOT NULL PRIMARY KEY, MODO VARCHAR(12) NOT NULL, INTERVALO_MIN INTEGER NOT NULL, RETENCAO_DIAS INTEGER NOT NULL, ULTIMO_RELATORIO DATE, ATUALIZADO_EM TIMESTAMP)",
  DASH_OF_CONEXAO: "CREATE TABLE DASH_OF_CONEXAO (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER NOT NULL, PROVEDOR VARCHAR(20) NOT NULL, ITEM_EXTERNO VARCHAR(80) NOT NULL, INSTITUICAO VARCHAR(120), CONECTOR VARCHAR(40), STATUS VARCHAR(30) NOT NULL, CONSENTIMENTO_ID VARCHAR(80), CONSENTIMENTO_EXPIRA TIMESTAMP, CONSENTIMENTO_REVOGADO TIMESTAMP, PRODUTOS VARCHAR(500), CRIADO_EM TIMESTAMP, ATUALIZADO_EM TIMESTAMP, ULTIMA_SYNC TIMESTAMP, ULTIMO_ERRO VARCHAR(300), TENTATIVAS INTEGER DEFAULT 0, PROXIMA_TENTATIVA TIMESTAMP)",
  DASH_OF_CONTA: "CREATE TABLE DASH_OF_CONTA (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER NOT NULL, IDCONEXAO BIGINT NOT NULL, ID_EXTERNO VARCHAR(80) NOT NULL, NOME VARCHAR(120), TIPO VARCHAR(30), BANCO VARCHAR(10), AGENCIA VARCHAR(20), NUMERO VARCHAR(30), MOEDA CHAR(3), SALDO NUMERIC(18,2), SALDO_EM TIMESTAMP, CDBANCO VARCHAR(10), AGENCIA_ERP VARCHAR(20), NUMCONTA_ERP VARCHAR(30), VINCULADA SMALLINT DEFAULT 0)",
  DASH_OF_MOVIMENTO: "CREATE TABLE DASH_OF_MOVIMENTO (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER NOT NULL, IDCONEXAO BIGINT, IDCONTA BIGINT, ID_EXTERNO VARCHAR(80) NOT NULL, DATA_MOV DATE, DATA_CONTABIL DATE, DESCRICAO VARCHAR(255), VALOR NUMERIC(18,2), MOEDA CHAR(3), NATUREZA VARCHAR(20), DIRECAO VARCHAR(10), E2E VARCHAR(40), DOCUMENTO VARCHAR(20), PAGADOR VARCHAR(160), STATUS VARCHAR(20) NOT NULL, CLASSE VARCHAR(20), MOTIVO VARCHAR(40), ACAO VARCHAR(30), CONFIANCA INTEGER, CHARLIE VARCHAR(500), TITULOS VARCHAR(1000), EXTRATO_ITEM INTEGER, MOV_BANCARIO INTEGER, ESPELHO_ID BIGINT, ORIGEM_BAIXA VARCHAR(30), BANCO VARCHAR(10), AGENCIA VARCHAR(20), NUMERO VARCHAR(30), IMPORTADO_EM TIMESTAMP, ATUALIZADO_EM TIMESTAMP, ERRO VARCHAR(300), RESERVADO_EM TIMESTAMP, VERSAO INTEGER DEFAULT 0)",
  DASH_OF_SYNC: "CREATE TABLE DASH_OF_SYNC (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER NOT NULL, IDCONEXAO BIGINT, INICIO TIMESTAMP, FIM TIMESTAMP, STATUS VARCHAR(20), RECEBIDOS INTEGER, NOVOS INTEGER, DUPLICADOS INTEGER, ERRO VARCHAR(300), TENTATIVA INTEGER)",
  DASH_OF_REGRA: "CREATE TABLE DASH_OF_REGRA (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER NOT NULL, PADRAO VARCHAR(160) NOT NULL, CATEGORIA VARCHAR(30), CRIAR_LANCAMENTO SMALLINT DEFAULT 0, CDFORNECEDOR INTEGER, CDCONTA INTEGER, ATIVA SMALLINT DEFAULT 1, ORIGEM VARCHAR(40), CRIADO_POR INTEGER, CRIADO_EM TIMESTAMP)",
  DASH_OF_DIVERGENCIA: "CREATE TABLE DASH_OF_DIVERGENCIA (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER NOT NULL, IDMOVIMENTO BIGINT, TIPO VARCHAR(40) NOT NULL, VALOR NUMERIC(18,2), CAUSA VARCHAR(255), SUGESTAO VARCHAR(500), DOCUMENTOS VARCHAR(80), STATUS VARCHAR(20), RESPONSAVEL INTEGER, CRIADO_EM TIMESTAMP)",
  DASH_OF_AUDITORIA: "CREATE TABLE DASH_OF_AUDITORIA (ID BIGINT NOT NULL PRIMARY KEY, IDEMPRESA INTEGER, OPERACAO VARCHAR(40) NOT NULL, DETALHE VARCHAR(1000), USUARIO_ID INTEGER, DATAHORA TIMESTAMP NOT NULL)",
  DASH_OF_EVENTO: "CREATE TABLE DASH_OF_EVENTO (ID BIGINT NOT NULL PRIMARY KEY, EVENTO_ID VARCHAR(80) NOT NULL, IDEMPRESA INTEGER, RECEBIDO_EM TIMESTAMP NOT NULL)",
};

let esquemaPronto = false;
let preparando = null;

function texto(valor, limite) {
  if (valor == null || valor === "") return null;
  return String(valor).slice(0, limite);
}

function inteiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function jsonTitulos(valor) {
  try {
    return JSON.stringify(valor || []).slice(0, 1000);
  } catch {
    return "[]";
  }
}

function lerTitulos(valor) {
  try {
    const lista = JSON.parse(String(valor || "[]"));
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function quando(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  return String(valor);
}

// O driver do Firebird chama getFullYear no parâmetro. Data em texto derruba o processo.
function dataFirebird(valor) {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  const texto = String(valor).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) {
    if (texto.length > 10) {
      const instante = new Date(texto);
      if (!Number.isNaN(instante.getTime())) return instante;
    }
    const data = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(data.getTime()) ? null : data;
  }
  const instante = new Date(texto);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

async function ddlPendente(tx) {
  for (const nome of SEQUENCIAS) {
    const existe = await tx.singleton("SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME)=?", [nome]);
    if (!existe) await tx.execute(`CREATE SEQUENCE ${nome}`);
  }
  for (const [nome, sql] of Object.entries(TABELAS)) {
    const existe = await tx.singleton("SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)=?", [nome]);
    if (!existe) await tx.execute(sql);
  }
}

async function complementoPendente(tx) {
  const indice = await tx.singleton("SELECT 1 AS OK FROM RDB$INDICES WHERE TRIM(RDB$INDEX_NAME)='UX_DASH_OF_MOV_EXT'");
  if (!indice) await tx.execute("CREATE UNIQUE INDEX UX_DASH_OF_MOV_EXT ON DASH_OF_MOVIMENTO (IDEMPRESA, ID_EXTERNO)");
  const versao = await tx.singleton("SELECT VERSAO FROM DASH_OF_VERSAO WHERE VERSAO=?", [VERSAO_ESQUEMA]);
  if (!versao) await tx.execute("INSERT INTO DASH_OF_VERSAO (VERSAO, APLICADO_EM) VALUES (?, CURRENT_TIMESTAMP)", [VERSAO_ESQUEMA]);
}

export function prepararEsquema(escrever = withWriteTransaction) {
  if (esquemaPronto) return Promise.resolve();
  if (!preparando) {
    preparando = escrever(ddlPendente)
      .then(() => escrever(complementoPendente))
      .then(() => {
        esquemaPronto = true;
      })
      .catch((error) => {
        preparando = null;
        throw error;
      });
  }
  return preparando;
}

export async function garantirEsquema() {
  await prepararEsquema();
}

async function novoId(tx, sequence) {
  if (!SEQUENCIAS.includes(sequence)) throw new Error("Sequência não permitida.");
  return Number((await tx.singleton(`SELECT GEN_ID(${sequence}, 1) AS ID FROM RDB$DATABASE`)).ID);
}

function mapearPolitica(row) {
  if (!row) return null;
  return { empresa: Number(row.IDEMPRESA), modo: row.MODO, intervaloMinutos: Number(row.INTERVALO_MIN), retencaoDias: Number(row.RETENCAO_DIAS), ultimoRelatorio: dia(row.ULTIMO_RELATORIO) };
}

function mapearConexao(row) {
  return {
    id: Number(row.ID),
    empresa: Number(row.IDEMPRESA),
    provedor: row.PROVEDOR,
    itemExterno: row.ITEM_EXTERNO,
    instituicao: row.INSTITUICAO || "",
    conector: row.CONECTOR || "",
    status: row.STATUS,
    consentimentoId: row.CONSENTIMENTO_ID || "",
    consentimentoExpira: quando(row.CONSENTIMENTO_EXPIRA),
    consentimentoRevogado: quando(row.CONSENTIMENTO_REVOGADO),
    produtos: row.PRODUTOS || "",
    criadoEm: quando(row.CRIADO_EM),
    atualizadoEm: quando(row.ATUALIZADO_EM),
    ultimaSync: quando(row.ULTIMA_SYNC),
    ultimoErro: row.ULTIMO_ERRO || "",
    tentativas: Number(row.TENTATIVAS || 0),
    proximaTentativa: quando(row.PROXIMA_TENTATIVA),
  };
}

function mapearConta(row) {
  return {
    id: Number(row.ID),
    empresa: Number(row.IDEMPRESA),
    conexaoId: Number(row.IDCONEXAO),
    idExterno: row.ID_EXTERNO,
    nome: row.NOME || "",
    tipo: row.TIPO || "",
    banco: row.BANCO || "",
    agencia: row.AGENCIA || "",
    numero: row.NUMERO || "",
    moeda: row.MOEDA || "BRL",
    saldo: row.SALDO == null ? null : Number(row.SALDO),
    cdbanco: row.CDBANCO || "",
    agenciaErp: row.AGENCIA_ERP || "",
    numcontaErp: row.NUMCONTA_ERP || "",
    vinculada: Number(row.VINCULADA) === 1,
  };
}

function mapearMovimento(row) {
  return {
    id: Number(row.ID),
    empresa: Number(row.IDEMPRESA),
    conexaoId: Number(row.IDCONEXAO) || null,
    contaId: Number(row.IDCONTA) || null,
    idExterno: row.ID_EXTERNO,
    data: dia(row.DATA_MOV),
    dataContabil: dia(row.DATA_CONTABIL),
    descricao: row.DESCRICAO || "",
    valor: Number(row.VALOR) || 0,
    moeda: row.MOEDA || "BRL",
    natureza: row.NATUREZA || "",
    direcao: row.DIRECAO || "",
    e2e: row.E2E || "",
    documento: row.DOCUMENTO || "",
    pagador: row.PAGADOR || "",
    status: row.STATUS,
    classe: row.CLASSE || "",
    motivo: row.MOTIVO || "",
    acao: row.ACAO || "",
    confianca: Number(row.CONFIANCA || 0),
    charlie: row.CHARLIE || "",
    titulos: lerTitulos(row.TITULOS),
    extratoItem: row.EXTRATO_ITEM == null ? null : Number(row.EXTRATO_ITEM),
    movBancario: row.MOV_BANCARIO == null ? null : Number(row.MOV_BANCARIO),
    espelhoId: row.ESPELHO_ID == null ? null : Number(row.ESPELHO_ID),
    origemBaixa: row.ORIGEM_BAIXA || "",
    banco: row.BANCO || "",
    agencia: row.AGENCIA || "",
    numero: row.NUMERO || "",
    importadoEm: quando(row.IMPORTADO_EM),
    erro: row.ERRO || "",
    reservadoEm: quando(row.RESERVADO_EM),
    versao: Number(row.VERSAO || 0),
    podeBaixar: false,
  };
}

function mapearRegra(row) {
  return {
    id: Number(row.ID),
    empresa: Number(row.IDEMPRESA),
    padrao: row.PADRAO,
    categoria: row.CATEGORIA,
    criarLancamento: Number(row.CRIAR_LANCAMENTO) === 1,
    cdfornecedor: row.CDFORNECEDOR == null ? null : Number(row.CDFORNECEDOR),
    cdconta: row.CDCONTA == null ? null : Number(row.CDCONTA),
    ativa: Number(row.ATIVA) === 1,
    origem: row.ORIGEM || "",
    criadoPor: row.CRIADO_POR == null ? null : Number(row.CRIADO_POR),
    criadoEm: quando(row.CRIADO_EM),
  };
}

export function criarRepositorioFirebird(io = {}) {
  const escrever = io.escrever || withWriteTransaction;
  const lerBase = io.ler || ((acao) => withDatabase(acao));
  const consultar = io.consultar || query;
  async function ler(acao) {
    try {
      return await lerBase(acao);
    } catch (error) {
      if (!/table unknown|not found/i.test(String(error?.message || error)) || !/DASH_OF_/i.test(String(error?.message || error))) throw error;
      await prepararEsquema(escrever);
      return lerBase(acao);
    }
  }

  async function escreverComEsquema(acao) {
    await prepararEsquema(escrever);
    return escrever(acao);
  }

  async function usar(tx, acao) {
    await prepararEsquema(escrever);
    if (tx) return acao(tx);
    return escrever(acao);
  }

  return {
    async politica(empresa) {
      const rows = await ler((db) => consultar(db, "SELECT * FROM DASH_OF_POLITICA WHERE IDEMPRESA=?", [empresa]));
      return mapearPolitica(rows[0]);
    },
    async salvarPolitica(politica) {
      return escreverComEsquema(async (tx) => {
        await tx.execute("UPDATE OR INSERT INTO DASH_OF_POLITICA (IDEMPRESA, MODO, INTERVALO_MIN, RETENCAO_DIAS, ULTIMO_RELATORIO, ATUALIZADO_EM) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) MATCHING (IDEMPRESA)", [
          politica.empresa, politica.modo, politica.intervaloMinutos, politica.retencaoDias, dataFirebird(politica.ultimoRelatorio),
        ]);
        return politica;
      });
    },
    async listarConexoes(empresa) {
      const rows = await ler((db) => consultar(db, `SELECT * FROM DASH_OF_CONEXAO ${empresa ? "WHERE IDEMPRESA=?" : ""} ORDER BY ID`, empresa ? [empresa] : []));
      return rows.map(mapearConexao);
    },
    async salvarConexao(conexao) {
      return escreverComEsquema(async (tx) => {
        const id = conexao.id || await novoId(tx, "GEN_DASH_OF_CONEXAO");
        await tx.execute(`UPDATE OR INSERT INTO DASH_OF_CONEXAO (ID, IDEMPRESA, PROVEDOR, ITEM_EXTERNO, INSTITUICAO, CONECTOR, STATUS, CONSENTIMENTO_ID, CONSENTIMENTO_EXPIRA, CONSENTIMENTO_REVOGADO, PRODUTOS, CRIADO_EM, ATUALIZADO_EM, ULTIMA_SYNC, ULTIMO_ERRO, TENTATIVAS, PROXIMA_TENTATIVA) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?) MATCHING (ID)`, [
          id, conexao.empresa, texto(conexao.provedor, 20), texto(conexao.itemExterno, 80), texto(conexao.instituicao, 120), texto(conexao.conector, 40), texto(conexao.status, 30), texto(conexao.consentimentoId, 80), dataFirebird(conexao.consentimentoExpira), dataFirebird(conexao.consentimentoRevogado), texto(conexao.produtos, 500), dataFirebird(conexao.criadoEm) || new Date(), dataFirebird(conexao.ultimaSync), texto(conexao.ultimoErro, 300), Number(conexao.tentativas || 0), dataFirebird(conexao.proximaTentativa),
        ]);
        return { ...conexao, id };
      });
    },
    async obterConexao(id, empresa) {
      const rows = await ler((db) => consultar(db, "SELECT * FROM DASH_OF_CONEXAO WHERE ID=? AND IDEMPRESA=?", [id, empresa]));
      return rows[0] ? mapearConexao(rows[0]) : null;
    },
    async obterConexaoPorItem(itemExterno) {
      const rows = await ler((db) => consultar(db, "SELECT FIRST 1 * FROM DASH_OF_CONEXAO WHERE ITEM_EXTERNO=? AND STATUS<>'desconectada' ORDER BY ID DESC", [itemExterno]));
      return rows[0] ? mapearConexao(rows[0]) : null;
    },
    async listarContas(empresa, idConexao) {
      const rows = await ler((db) => consultar(db, `SELECT * FROM DASH_OF_CONTA WHERE IDEMPRESA=? ${idConexao ? "AND IDCONEXAO=?" : ""} ORDER BY ID`, idConexao ? [empresa, idConexao] : [empresa]));
      return rows.map(mapearConta);
    },
    async salvarConta(conta) {
      return escreverComEsquema(async (tx) => {
        const atual = await tx.singleton("SELECT ID, VINCULADA, CDBANCO, AGENCIA_ERP, NUMCONTA_ERP FROM DASH_OF_CONTA WHERE IDEMPRESA=? AND ID_EXTERNO=?", [conta.empresa, conta.idExterno]);
        const id = atual?.ID ? Number(atual.ID) : (conta.id || await novoId(tx, "GEN_DASH_OF_CONTA"));
        const vinculada = conta.vinculada == null ? Number(atual?.VINCULADA) === 1 : Boolean(conta.vinculada);
        await tx.execute(`UPDATE OR INSERT INTO DASH_OF_CONTA (ID, IDEMPRESA, IDCONEXAO, ID_EXTERNO, NOME, TIPO, BANCO, AGENCIA, NUMERO, MOEDA, SALDO, SALDO_EM, CDBANCO, AGENCIA_ERP, NUMCONTA_ERP, VINCULADA) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?) MATCHING (ID)`, [
          id, conta.empresa, conta.conexaoId, texto(conta.idExterno, 80), texto(conta.nome, 120), texto(conta.tipo, 30), texto(conta.banco, 10), texto(conta.agencia, 20), texto(conta.numero, 30), texto(conta.moeda || "BRL", 3), conta.saldo, texto(conta.cdbanco || atual?.CDBANCO, 10), texto(conta.agenciaErp || atual?.AGENCIA_ERP, 20), texto(conta.numcontaErp || atual?.NUMCONTA_ERP, 30), vinculada ? 1 : 0,
        ]);
        return { ...conta, id, vinculada, cdbanco: conta.cdbanco || atual?.CDBANCO || "", agenciaErp: conta.agenciaErp || atual?.AGENCIA_ERP || "", numcontaErp: conta.numcontaErp || atual?.NUMCONTA_ERP || "" };
      });
    },
    async obterConta(id, empresa) {
      const rows = await ler((db) => consultar(db, "SELECT * FROM DASH_OF_CONTA WHERE ID=? AND IDEMPRESA=?", [id, empresa]));
      return rows[0] ? mapearConta(rows[0]) : null;
    },
    async movimentoPorExterno(empresa, idExterno) {
      const rows = await ler((db) => consultar(db, "SELECT FIRST 1 * FROM DASH_OF_MOVIMENTO WHERE IDEMPRESA=? AND ID_EXTERNO=?", [empresa, idExterno]));
      return rows[0] ? mapearMovimento(rows[0]) : null;
    },
    async salvarMovimento(movimento) {
      return escreverComEsquema((tx) => gravarMovimento(tx, movimento));
    },
    async listarMovimentos(empresa) {
      const rows = await ler((db) => consultar(db, "SELECT FIRST 2000 * FROM DASH_OF_MOVIMENTO WHERE IDEMPRESA=? ORDER BY DATA_MOV DESC, ID DESC", [empresa]));
      return rows.map(mapearMovimento);
    },
    async obterMovimento(id, empresa) {
      const rows = await ler((db) => consultar(db, "SELECT * FROM DASH_OF_MOVIMENTO WHERE ID=? AND IDEMPRESA=?", [id, empresa]));
      return rows[0] ? mapearMovimento(rows[0]) : null;
    },
    async reservarMovimento(id, empresa) {
      return escreverComEsquema(async (tx) => {
        const atual = await tx.singleton("SELECT STATUS, VERSAO FROM DASH_OF_MOVIMENTO WHERE ID=? AND IDEMPRESA=?", [id, empresa]);
        if (!atual || !["sugerido", "divergente", "importado", "classificado"].includes(String(atual.STATUS || "").trim())) return null;
        const versao = Number(atual.VERSAO || 0);
        await tx.execute("UPDATE DASH_OF_MOVIMENTO SET STATUS='processando', RESERVADO_EM=CURRENT_TIMESTAMP, VERSAO=? WHERE ID=? AND IDEMPRESA=? AND VERSAO=?", [versao + 1, id, empresa, versao]);
        const depois = await tx.singleton("SELECT * FROM DASH_OF_MOVIMENTO WHERE ID=? AND IDEMPRESA=?", [id, empresa]);
        if (Number(depois?.VERSAO) !== versao + 1) return null;
        return mapearMovimento(depois);
      });
    },
    async concluirMovimento(id, patch, tx) {
      return usar(tx, async (transacao) => {
        const atual = await transacao.singleton("SELECT * FROM DASH_OF_MOVIMENTO WHERE ID=?", [id]);
        if (!atual) return null;
        const movimento = { ...mapearMovimento(atual), ...patch, id };
        return gravarMovimento(transacao, movimento);
      });
    },
    async liberarMovimento(id, erro) {
      return escreverComEsquema(async (tx) => {
        await tx.execute("UPDATE DASH_OF_MOVIMENTO SET STATUS='sugerido', ERRO=?, ATUALIZADO_EM=CURRENT_TIMESTAMP WHERE ID=? AND STATUS<>'conciliado'", [texto(erro, 300), id]);
        const row = await tx.singleton("SELECT * FROM DASH_OF_MOVIMENTO WHERE ID=?", [id]);
        return row ? mapearMovimento(row) : null;
      });
    },
    async liberarTravados(antes) {
      return escreverComEsquema(async (tx) => {
        await tx.execute("UPDATE DASH_OF_MOVIMENTO SET STATUS='sugerido', ERRO='tempo_excedido' WHERE STATUS='processando' AND (RESERVADO_EM IS NULL OR RESERVADO_EM < ?)", [dataFirebird(antes)]);
        return true;
      });
    },
    async salvarSync(registro) {
      return escreverComEsquema(async (tx) => {
        const id = await novoId(tx, "GEN_DASH_OF_SYNC");
        await tx.execute("INSERT INTO DASH_OF_SYNC (ID, IDEMPRESA, IDCONEXAO, INICIO, FIM, STATUS, RECEBIDOS, NOVOS, DUPLICADOS, ERRO, TENTATIVA) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          id, registro.empresa, registro.conexaoId, registro.inicio, registro.fim, texto(registro.status, 20), Number(registro.recebidos || 0), Number(registro.novos || 0), Number(registro.duplicados || 0), texto(registro.erro, 300), Number(registro.tentativa || 0),
        ]);
        return { ...registro, id };
      });
    },
    async listarSync(empresa) {
      const rows = await ler((db) => consultar(db, "SELECT FIRST 50 * FROM DASH_OF_SYNC WHERE IDEMPRESA=? ORDER BY ID DESC", [empresa]));
      return rows.map((row) => ({ id: Number(row.ID), empresa: Number(row.IDEMPRESA), conexaoId: Number(row.IDCONEXAO), inicio: quando(row.INICIO), fim: quando(row.FIM), status: row.STATUS, recebidos: Number(row.RECEBIDOS || 0), novos: Number(row.NOVOS || 0), duplicados: Number(row.DUPLICADOS || 0), erro: row.ERRO || "", tentativa: Number(row.TENTATIVA || 0) }));
    },
    async listarRegras(empresa) {
      const rows = await ler((db) => consultar(db, "SELECT * FROM DASH_OF_REGRA WHERE IDEMPRESA=? ORDER BY ID", [empresa]));
      return rows.map(mapearRegra);
    },
    async salvarRegra(regra) {
      return escreverComEsquema(async (tx) => {
        const id = regra.id || await novoId(tx, "GEN_DASH_OF_REGRA");
        await tx.execute("UPDATE OR INSERT INTO DASH_OF_REGRA (ID, IDEMPRESA, PADRAO, CATEGORIA, CRIAR_LANCAMENTO, CDFORNECEDOR, CDCONTA, ATIVA, ORIGEM, CRIADO_POR, CRIADO_EM) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) MATCHING (ID)", [
          id, regra.empresa, texto(regra.padrao, 160), texto(regra.categoria, 30), regra.criarLancamento ? 1 : 0, inteiro(regra.cdfornecedor), inteiro(regra.cdconta), regra.ativa === false ? 0 : 1, texto(regra.origem, 40), inteiro(regra.criadoPor), regra.criadoEm || new Date(),
        ]);
        return { ...regra, id, ativa: regra.ativa !== false };
      });
    },
    async salvarDivergencia(item) {
      return escreverComEsquema(async (tx) => {
        const existente = await tx.singleton("SELECT ID FROM DASH_OF_DIVERGENCIA WHERE IDEMPRESA=? AND IDMOVIMENTO=? AND TIPO=? AND STATUS='aberta'", [item.empresa, item.movimentoId, item.tipo]);
        if (existente) return { ...item, id: Number(existente.ID) };
        const id = await novoId(tx, "GEN_DASH_OF_DIVERG");
        await tx.execute("INSERT INTO DASH_OF_DIVERGENCIA (ID, IDEMPRESA, IDMOVIMENTO, TIPO, VALOR, CAUSA, SUGESTAO, DOCUMENTOS, STATUS, RESPONSAVEL, CRIADO_EM) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, CURRENT_TIMESTAMP)", [
          id, item.empresa, item.movimentoId, texto(item.tipo, 40), item.valor, texto(item.causa, 255), texto(item.sugestao, 500), texto(item.documentos, 80), inteiro(item.responsavel),
        ]);
        return { ...item, id, status: "aberta" };
      });
    },
    async listarDivergencias(empresa) {
      const rows = await ler((db) => consultar(db, "SELECT * FROM DASH_OF_DIVERGENCIA WHERE IDEMPRESA=? ORDER BY ID DESC", [empresa]));
      return rows.map((row) => ({ id: Number(row.ID), empresa: Number(row.IDEMPRESA), movimentoId: Number(row.IDMOVIMENTO), tipo: row.TIPO, valor: Number(row.VALOR || 0), causa: row.CAUSA || "", sugestao: row.SUGESTAO || "", documentos: row.DOCUMENTOS || "", status: row.STATUS, responsavel: row.RESPONSAVEL == null ? null : Number(row.RESPONSAVEL) }));
    },
    async auditar(evento) {
      return escreverComEsquema(async (tx) => {
        const id = await novoId(tx, "GEN_DASH_OF_AUDIT");
        await tx.execute("INSERT INTO DASH_OF_AUDITORIA (ID, IDEMPRESA, OPERACAO, DETALHE, USUARIO_ID, DATAHORA) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)", [
          id, inteiro(evento.empresa), texto(evento.operacao, 40), texto(evento.detalhe, 1000), inteiro(evento.usuarioId),
        ]);
        return { ...evento, id };
      });
    },
    async listarAuditoria(empresa) {
      const rows = await ler((db) => consultar(db, "SELECT FIRST 100 * FROM DASH_OF_AUDITORIA WHERE IDEMPRESA=? ORDER BY ID DESC", [empresa]));
      return rows.map((row) => ({ id: Number(row.ID), empresa: Number(row.IDEMPRESA), operacao: row.OPERACAO, detalhe: row.DETALHE || "", usuarioId: row.USUARIO_ID == null ? null : Number(row.USUARIO_ID), em: quando(row.DATAHORA) }));
    },
    async eventoVisto(eventoId) {
      const rows = await ler((db) => consultar(db, "SELECT FIRST 1 ID FROM DASH_OF_EVENTO WHERE EVENTO_ID=?", [eventoId]));
      return rows.length > 0;
    },
    async registrarEvento(eventoId, empresa) {
      return escreverComEsquema(async (tx) => {
        const id = await novoId(tx, "GEN_DASH_OF_EVENTO");
        await tx.execute("INSERT INTO DASH_OF_EVENTO (ID, EVENTO_ID, IDEMPRESA, RECEBIDO_EM) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", [id, texto(eventoId, 80), inteiro(empresa)]);
        return true;
      });
    },
    async redactarAntigos(empresa, antes) {
      return escreverComEsquema(async (tx) => {
        await tx.execute("UPDATE DASH_OF_MOVIMENTO SET PAGADOR=NULL, DOCUMENTO=NULL WHERE IDEMPRESA=? AND STATUS IN ('conciliado', 'ignorado') AND DATA_MOV < ? AND (PAGADOR IS NOT NULL OR DOCUMENTO IS NOT NULL)", [empresa, dataFirebird(antes)]);
        return true;
      });
    },
  };
}

async function gravarMovimento(tx, movimento) {
  const existente = movimento.id
    ? await tx.singleton("SELECT ID FROM DASH_OF_MOVIMENTO WHERE ID=?", [movimento.id])
    : await tx.singleton("SELECT ID FROM DASH_OF_MOVIMENTO WHERE IDEMPRESA=? AND ID_EXTERNO=?", [movimento.empresa, movimento.idExterno]);
  const id = existente?.ID ? Number(existente.ID) : await novoId(tx, "GEN_DASH_OF_MOV");
  await tx.execute(`UPDATE OR INSERT INTO DASH_OF_MOVIMENTO (ID, IDEMPRESA, IDCONEXAO, IDCONTA, ID_EXTERNO, DATA_MOV, DATA_CONTABIL, DESCRICAO, VALOR, MOEDA, NATUREZA, DIRECAO, E2E, DOCUMENTO, PAGADOR, STATUS, CLASSE, MOTIVO, ACAO, CONFIANCA, CHARLIE, TITULOS, EXTRATO_ITEM, MOV_BANCARIO, ESPELHO_ID, ORIGEM_BAIXA, BANCO, AGENCIA, NUMERO, IMPORTADO_EM, ATUALIZADO_EM, ERRO, RESERVADO_EM, VERSAO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, ?, ?, COALESCE(?, 0)) MATCHING (ID)`, [
    id, movimento.empresa, movimento.conexaoId || null, movimento.contaId || null, texto(movimento.idExterno, 80), dataFirebird(movimento.data), dataFirebird(movimento.dataContabil || movimento.data), texto(movimento.descricao, 255), movimento.valor, texto(movimento.moeda || "BRL", 3), texto(movimento.natureza, 20), texto(movimento.direcao, 10), texto(movimento.e2e, 40), texto(movimento.documento, 20), texto(movimento.pagador, 160), texto(movimento.status || "importado", 20), texto(movimento.classe, 20), texto(movimento.motivo, 40), texto(movimento.acao, 30), Number(movimento.confianca || 0), texto(movimento.charlie, 500), jsonTitulos(movimento.titulos), movimento.extratoItem || null, movimento.movBancario || null, movimento.espelhoId || null, texto(movimento.origemBaixa, 30), texto(movimento.banco, 10), texto(movimento.agencia, 20), texto(movimento.numero, 30), dataFirebird(movimento.importadoEm), texto(movimento.erro, 300), dataFirebird(movimento.reservadoEm), Number(movimento.versao || 0),
  ]);
  const row = await tx.singleton("SELECT * FROM DASH_OF_MOVIMENTO WHERE ID=?", [id]);
  return mapearMovimento(row);
}

export const TABELAS_OPEN_FINANCE = TABELAS;
