import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";
import { query, withDatabase, withWriteTransaction } from "../db.js";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { ollamaChat } from "./ollama.js";
import { criarRepositorioFirebird } from "./open-finance-firebird.js";
import { chaveDe } from "./open-finance-crypto.js";
import { criarServico } from "./open-finance-service.js";
import { enviarAvisosConciliacao } from "./reconciliation-intelligence-delivery.js";
import {
  aplicarConciliacao,
  carregarConciliacao,
  desfazerNoBanco,
  importarExtratoConfirmado,
  lerEstado,
} from "./reconciliation-intelligence-service.js";

const ARQUIVO = "open-finance.json";

function chaveMestra() {
  if (process.env.OPEN_FINANCE_MASTER_KEY && process.env.OPEN_FINANCE_MASTER_KEY.length >= 16) return process.env.OPEN_FINANCE_MASTER_KEY;
  const arquivo = path.join(dataDir, "open-finance.key");
  try {
    if (fs.existsSync(arquivo)) return fs.readFileSync(arquivo, "utf8").trim();
    fs.mkdirSync(dataDir, { recursive: true });
    const gerada = crypto.randomBytes(32).toString("base64");
    fs.writeFileSync(arquivo, gerada, { encoding: "utf8", mode: 0o600 });
    return gerada;
  } catch (error) {
    console.error(`[open-finance] chave mestra indisponível: ${error.message}`);
    return "";
  }
}

async function narrar(fatos) {
  return ollamaChat({
    temperature: 0,
    maxTokens: 180,
    messages: [
      { role: "system", content: "Responda somente JSON com causa, evidencias e narracao. Nao execute baixa, nao altere valor e nao invente documento, valor ou identificador. Causas permitidas: desconto_concedido, tarifa_financeira, retencao, pagamento_parcial, divergencia_valor, transferencia_interna, pagamento_agrupado, sem_evidencia." },
      { role: "user", content: JSON.stringify({ movimento: fatos.movimento, diferenca: fatos.diferenca, evidencias: fatos.evidencias, natureza: fatos.natureza }) },
    ],
  });
}

async function localizar(tx, numdoc, empresa) {
  const row = await tx.singleton("SELECT FIRST 1 ei.CONTROLE AS ID, ei.MOV_BANCARIO FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO WHERE TRIM(ei.NUMDOC)=TRIM(?) AND e.IDEMPRESA=? ORDER BY ei.CONTROLE DESC", [numdoc, empresa]);
  return row ? { id: Number(row.ID), movBancario: row.MOV_BANCARIO == null ? null : Number(row.MOV_BANCARIO) } : null;
}

let servico;

export function servicoOpenFinance() {
  if (servico) return servico;
  servico = criarServico({
    repositorio: criarRepositorioFirebird(),
    segredos: {
      ler: async () => readJsonConfig(ARQUIVO, {}),
      gravar: async (valor) => writeJsonConfig(ARQUIVO, valor),
    },
    chave: async () => chaveDe(chaveMestra()),
    buscar: (...args) => fetch(...args),
    carregar: (empresa) => withDatabase((db) => carregarConciliacao(db, empresa, 500, 0)),
    importar: (tx, pedido) => importarExtratoConfirmado(tx, pedido),
    aplicar: (tx, decisao, ator) => aplicarConciliacao(tx, decisao, ator),
    localizar,
    desfazer: (tx, registro) => desfazerNoBanco(tx, registro),
    transacao: (acao) => withWriteTransaction(acao),
    narrar,
    notificar: (textos) => enviarAvisosConciliacao(textos, lerEstado().configuracao?.notificacoes || {}),
    saldosErp: (empresa, contas) => withDatabase(async (db) => {
      const saida = [];
      for (const conta of (contas || []).filter((item) => item.vinculada)) {
        const rows = await query(db, "SELECT COALESCE(SUM(VALOR),0) AS SALDO FROM MOV_BANCARIO WHERE IDEMPRESA=? AND CDBANCO=? AND TRIM(NUMCONTA)=TRIM(?) AND COALESCE(STATUS,0)<>9", [empresa, conta.cdbanco, conta.numcontaErp]);
        saida.push({ cdbanco: conta.cdbanco, numconta: conta.numcontaErp, saldo: Number(rows[0]?.SALDO || 0) });
      }
      return saida;
    }),
    contasErp: () => withDatabase(async (db) => (await query(db, "SELECT cc.CDBANCO, TRIM(cc.AGENCIA) AS AGENCIA, TRIM(cc.NUMCONTA) AS NUMCONTA, TRIM(b.BANCO) AS BANCO FROM CONTACORRENTE cc LEFT JOIN BANCO b ON b.CDBANCO=cc.CDBANCO ORDER BY b.BANCO, cc.AGENCIA, cc.NUMCONTA")).map((row) => ({ cdbanco: row.CDBANCO, agencia: row.AGENCIA || "", numconta: row.NUMCONTA || "", nome: row.BANCO || "" }))),
    agendar: (trabalho) => {
      setImmediate(() => {
        Promise.resolve(trabalho()).catch((error) => console.error(`[open-finance] ${error.message}`));
      });
    },
  });
  return servico;
}

export async function empresasOpenFinance() {
  return withDatabase(async (db) => (await query(db, "SELECT ID FROM (SELECT DISTINCT IDEMPRESA AS ID FROM CTARECEBER WHERE IDEMPRESA IS NOT NULL UNION SELECT DISTINCT IDEMPRESA FROM CTAPAGAR WHERE IDEMPRESA IS NOT NULL) EMPRESAS ORDER BY ID")).map((row) => ({ id: Number(row.ID), nome: `Empresa ${row.ID}` })));
}
