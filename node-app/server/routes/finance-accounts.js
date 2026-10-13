import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
const asInt = (value) =>
  /^\d+$/.test(String(value ?? "")) ? Number(value) : null;
const text = (value) => String(value ?? "").trim();
export function firebirdDate(value) {
  const normalized = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
export const FINANCE_STATUS = Object.freeze({
  1: "Aberto",
  2: "Quitado",
  3: "Devolucao",
  4: "Cancelado",
  5: "Transferencia",
  6: "Acordo",
  7: "Acordo em nota fiscal",
  8: "Acordo no recebimento",
  9: "Excluido",
});
export function financeStatusLabel(
  status,
  dueDate,
  today = new Date().toISOString().slice(0, 10),
) {
  const code = Number(status);
  if (code === 1 && dueDate && String(dueDate).slice(0, 10) < today)
    return "Vencido";
  return FINANCE_STATUS[code] || `Status ${code}`;
}
export const agreementStatusSql = (type) =>
  type === "receber"
    ? "UPDATE CTARECEBER SET STATUS=6,ACORDO=?,DTCOB=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1"
    : "UPDATE CTAPAGAR SET STATUS=6,ACORDO=?,DTPAGTO=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1";
function financeInput(body = {}) {
  const type = String(body.tipo || "").toLowerCase();
  if (!["receber", "pagar"].includes(type))
    throw Object.assign(new Error("Tipo financeiro invalido."), {
      status: 400,
    });
  const refs = (body.contas || []).map((item) => [
    Number(item.controle),
    Number(item.idempresa),
  ]);
  if (!refs.length || refs.some(([control, company]) => !control || !company))
    throw Object.assign(new Error("Selecione pelo menos uma conta."), {
      status: 400,
    });
  if (new Set(refs.map((ref) => ref.join("/"))).size !== refs.length)
    throw Object.assign(new Error("Existem contas repetidas na selecao."), {
      status: 400,
    });
  return { type, refs, table: type === "receber" ? "CTARECEBER" : "CTAPAGAR" };
}

export function newAccountInput(body = {}) {
  const type = text(body.tipo).toLowerCase();
  if (!["receber", "pagar"].includes(type))
    throw Object.assign(new Error("Selecione contas a receber ou contas a pagar."), { status: 400 });
  const company = asInt(body.idempresa);
  const person = asInt(body.pessoa_id);
  const dueDate = firebirdDate(body.vencimento);
  const amount = Number(body.valor);
  const installment = asInt(body.parcela || 1);
  if (!company) throw Object.assign(new Error("Selecione a empresa."), { status: 400 });
  if (!person)
    throw Object.assign(
      new Error(`Selecione ${type === "receber" ? "o cliente" : "o fornecedor"}.`),
      { status: 400 },
    );
  if (!dueDate) throw Object.assign(new Error("Informe um vencimento valido."), { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0)
    throw Object.assign(new Error("Informe um valor maior que zero."), { status: 400 });
  if (!installment || installment > 999)
    throw Object.assign(new Error("Informe uma parcela valida."), { status: 400 });
  const document = text(body.documento).slice(0, 20);
  if (!document) throw Object.assign(new Error("Informe o documento."), { status: 400 });
  return {
    type,
    company,
    person,
    dueDate,
    amount: Math.round(amount * 100) / 100,
    installment,
    document,
    history: text(body.historico).slice(0, 255),
    payment: asInt(body.forma_pagamento),
    cash: asInt(body.caixa),
    costCenter: asInt(body.centro_custo),
    account: asInt(body.conta),
    subaccount: asInt(body.subconta),
    thirdAccount: asInt(body.subsubconta),
    fourthAccount: asInt(body.subsubsubconta),
  };
}

async function nextAccountControl(tx, table) {
  const sequence = table === "CTARECEBER" ? "GEN_CTARECEBER" : "GEN_CTAPAGAR";
  try {
    const row = await tx.singleton(`SELECT NEXT VALUE FOR ${sequence} AS ID FROM RDB$DATABASE`);
    const value = Number(row?.ID);
    if (value > 0) {
      const duplicate = await tx.singleton(`SELECT FIRST 1 1 AS OK FROM ${table} WHERE CONTROLE=?`, [value]);
      if (!duplicate) return value;
    }
  } catch {
    // Bancos Automec antigos podem nao possuir os generators padrao.
  }
  return Number((await tx.singleton(`SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM ${table}`)).ID);
}

async function accountPaymentDefaults(tx, input) {
  if (!input.payment) return {};
  const receive = input.type === "receber";
  const table = receive ? "RECEBTO" : "PAGTO";
  const key = receive ? "CDRECEBTO" : "CDPAGTO";
  const rows = await tx.query(
    `SELECT FIRST 1 ${receive ? "CDGRUPO,CCUSTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA" : "CDGRUPO"} FROM ${table} WHERE ${key}=?`,
    [input.payment],
  );
  return rows[0] || {};
}

export function completeAccountInput(input, paymentDefaults = {}) {
  const pick = (provided, fallback) => provided ?? fallback ?? null;
  return {
    ...input,
    cash: input.cash ?? 1,
    costCenter: pick(input.costCenter, paymentDefaults.CCUSTO),
    account: pick(input.account, paymentDefaults.CDCONTA),
    subaccount: pick(input.subaccount, paymentDefaults.CDSUBCONTA),
    thirdAccount: pick(input.thirdAccount, paymentDefaults.CDSUBSUBCONTA),
    fourthAccount: pick(input.fourthAccount, paymentDefaults.CDSUBSUBSUBCONTA),
    receiptGroup: receivePaymentGroup(input, paymentDefaults),
  };
}

function receivePaymentGroup(input, paymentDefaults) {
  return input.type === "receber" ? paymentDefaults.CDGRUPO ?? null : null;
}
async function ensureAgreementSchema(tx) {
  const has = async (kind, name) =>
    Boolean(
      await tx.singleton(
        `SELECT 1 AS OK FROM ${kind === "sequence" ? "RDB$GENERATORS" : "RDB$RELATIONS"} WHERE TRIM(${kind === "sequence" ? "RDB$GENERATOR_NAME" : "RDB$RELATION_NAME"})=?`,
        [name],
      ),
    );
  for (const sequence of ["GEN_DASH_FIN_ACORDO", "GEN_DASH_FIN_AUDIT"])
    if (!(await has("sequence", sequence)))
      await tx.execute(`CREATE SEQUENCE ${sequence}`);
  if (!(await has("table", "DASH_FIN_ACORDO")))
    await tx.execute(
      "CREATE TABLE DASH_FIN_ACORDO (IDACORDO BIGINT NOT NULL PRIMARY KEY,TIPO VARCHAR(10) NOT NULL,PESSOA_ID INTEGER NOT NULL,MODELO_CONTROLE INTEGER NOT NULL,MODELO_EMPRESA INTEGER NOT NULL,SALDO_ORIGINAL NUMERIC(18,2) NOT NULL,JUROS NUMERIC(18,2) DEFAULT 0,DESCONTO NUMERIC(18,2) DEFAULT 0,RETENCAO NUMERIC(18,2) DEFAULT 0,ACRESCIMO NUMERIC(18,2) DEFAULT 0,TOTAL_NOVO NUMERIC(18,2) NOT NULL,STATUS VARCHAR(12) NOT NULL,CRIADO_EM TIMESTAMP NOT NULL,CRIADO_POR INTEGER,DESFEITO_EM TIMESTAMP,DESFEITO_POR INTEGER)",
    );
  if (!(await has("table", "DASH_FIN_ACORDO_ITEM")))
    await tx.execute(
      "CREATE TABLE DASH_FIN_ACORDO_ITEM (IDACORDO BIGINT NOT NULL,PAPEL CHAR(1) NOT NULL,CONTROLE INTEGER NOT NULL,IDEMPRESA INTEGER NOT NULL,STATUS_ANTERIOR INTEGER,ACORDO_ANTERIOR BIGINT,PRIMARY KEY (IDACORDO,PAPEL,CONTROLE,IDEMPRESA))",
    );
  if (!(await has("table", "DASH_FIN_AUDIT")))
    await tx.execute(
      "CREATE TABLE DASH_FIN_AUDIT (IDAUDIT BIGINT NOT NULL PRIMARY KEY,OPERACAO VARCHAR(30) NOT NULL,TIPO VARCHAR(10) NOT NULL,CONTROLE INTEGER,IDEMPRESA INTEGER,DETALHE VARCHAR(1000),USUARIO_ID INTEGER,DATAHORA TIMESTAMP NOT NULL)",
    );
}
async function cloneAccount(tx, table, model, overrides) {
  const columns = (
    await tx.query(
      "SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME)=? ORDER BY RDB$FIELD_POSITION",
      [table],
    )
  ).map((row) => row.NAME);
  const parts = [],
    params = [];
  for (const column of columns)
    if (Object.hasOwn(overrides, column)) {
      parts.push("?");
      params.push(overrides[column]);
    } else parts.push(column);
  await tx.execute(
    `INSERT INTO ${table} (${columns.join(",")}) SELECT ${parts.join(",")} FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
    [...params, ...model],
  );
}

export function buildAccountFilters(type, input = {}) {
  const where = ["t.DTVENC IS NOT NULL"],
    params = [];
  const receive = type === "receber";
  const movement = receive ? "t.DTMOV" : "t.DTINCLUSAO";
  const paidAt = receive ? "t.DTCOB" : "t.DTPAGTO";
  const dateColumn =
    { vencimento: "t.DTVENC", movimento: movement, pagamento: paidAt }[
      text(input.tipo_data).toLowerCase()
    ] || "t.DTVENC";
  const startDate = firebirdDate(input.data_inicio);
  if (startDate) {
    where.push(`${dateColumn}>=?`);
    params.push(startDate);
  }
  const endDate = firebirdDate(input.data_fim);
  if (endDate) {
    where.push(`${dateColumn}<DATEADD(1 DAY TO CAST(? AS DATE))`);
    params.push(endDate);
  }
  const addInt = (name, column) => {
    const value = asInt(input[name]);
    if (value !== null) {
      where.push(`${column}=?`);
      params.push(value);
    }
  };
  addInt("loja", "t.IDEMPRESA");
  addInt("banco", "t.CDBANCO");
  addInt("grupo_recebto", "t.CDRECGRUPO");
  addInt("centro_custo", "t.CCUSTO");
  addInt("caixa", receive ? "t.CAIXA" : "t.CDCAIXA");
  addInt("conta", "t.CDCONTA");
  addInt("subconta", "t.CDSUBCONTA");
  addInt("subsubconta", "t.CDSUBSUBCONTA");
  addInt("subsubsubconta", "t.CDSUBSUBSUBCONTA");
  addInt(
    receive ? "cliente" : "fornecedor",
    receive ? "t.CDCLIENTE" : "t.CDFORNECEDOR",
  );
  const payment = asInt(input.forma_pagamento);
  if (payment !== null) {
    where.push("(t.CODPAGTO=? OR t.TPPAGTO=?)");
    params.push(payment, payment);
  }
  addInt("condicao_pagamento", "t.TPPAGTO");
  addInt("tipo_pagamento", "t.CODPAGTO");
  if (!receive) {
    const vale = text(input.vale).toLowerCase();
    if (vale === "somente_vales") where.push("t.STATUSVALE IS NOT NULL");
    else if (vale === "vales_gerados")
      where.push("t.STATUSVALE IS NOT NULL AND t.EHFUNCIONARIO=0");
    else if (vale === "vales_funcionarios")
      where.push("t.STATUSVALE IS NOT NULL AND t.EHFUNCIONARIO=-1");
    else if (vale === "sem_vales") where.push("t.STATUSVALE IS NULL");
  }
  if (text(input.categoria)) {
    where.push("t.CDCONTA=?");
    params.push(text(input.categoria));
  }
  const addText = (name, column, mode = "equal") => {
    const value = text(input[name]);
    if (!value) return;
    if (mode === "contains") {
      where.push(`UPPER(COALESCE(${column},'')) LIKE ?`);
      params.push(`%${value.toUpperCase()}%`);
    } else {
      where.push(`${column}=?`);
      params.push(value);
    }
  };
  addText("historico", "t.HISTORICO", "contains");
  addText("documento", "t.NRDOC");
  addText("documento_2", "t.NRDOC2");
  const competence = firebirdDate(input.competencia);
  if (competence) {
    where.push("t.COMPETENCIA=?");
    params.push(competence);
  }
  const exactValue = Number(String(input.valor || "").replace(",", "."));
  if (Number.isFinite(exactValue) && exactValue > 0) {
    where.push(`${receive ? "COALESCE(t.VALOR,t.DIVIDA,0)" : "COALESCE(t.VALOR,t.TOTAL,0)"}=?`);
    params.push(exactValue);
  }
  if (receive) {
    addInt("vendedor", "t.CDVEND");
    addInt("pedido", "t.NRPEDIDO");
    addInt("acordo_nf", "t.ACORDO_NF");
    addInt("acordo_recebimento", "t.ACORDO_REC");
    addText("nosso_numero", "t.NOSSONUMERO", "contains");
    addText("origem", "t.ORIGEM", "contains");
    addText("remessa", "t.REMESSA_BOLETO");
    const receiptType = asInt(input.tipo_recebimento);
    if (receiptType !== null) {
      where.push("EXISTS (SELECT 1 FROM RECEBTO rp WHERE rp.CDRECEBTO=t.CODPAGTO AND rp.TPRECEBTO=?)");
      params.push(receiptType);
    }
    const address = asInt(input.endereco);
    if (address !== null) {
      where.push("EXISTS (SELECT 1 FROM SAIDAESTOQUE se WHERE se.NRPEDIDO=t.NRPEDIDO AND se.IDEMPRESA=t.IDEMPRESA AND se.IDENDERECO=?)");
      params.push(address);
    }
    const orderStatus = asInt(input.status_pedido);
    if (orderStatus !== null) {
      where.push("EXISTS (SELECT 1 FROM SAIDAESTOQUE se WHERE se.NRPEDIDO=t.NRPEDIDO AND se.IDEMPRESA=t.IDEMPRESA AND se.STATUS=?)");
      params.push(orderStatus);
    }
    const cheque = text(input.cheque);
    if (cheque) {
      where.push("EXISTS (SELECT 1 FROM CHEQUES ch WHERE ch.NRPEDIDO=t.NRPEDIDO AND ch.IDEMPRESA=t.IDEMPRESA AND ch.PARCELA=t.PARCELA AND ch.STATUS<>9 AND ch.NRCHEQUE=?)");
      params.push(cheque);
    }
    const classification = asInt(input.classificacao);
    if (classification !== null) {
      where.push("p.CDCLASSIFICACAO=?");
      params.push(classification);
    }
  } else {
    addInt("tipo_documento", "t.CDDOCUMENTO");
    addText("nota_fiscal", "t.NOTAFISCAL");
    addInt("parcela", "t.PARCELA");
    addText("entrada", "t.IDENTRADA");
    const paidValue = Number(String(input.valor_pago || "").replace(",", "."));
    if (Number.isFinite(paidValue) && paidValue > 0) {
      where.push("t.VLPAGTO=?");
      params.push(paidValue);
    }
    const boleto = text(input.com_boleto).toLowerCase();
    if (boleto === "sim") where.push("t.COMBOLETO=-1");
    else if (boleto === "nao") where.push("COALESCE(t.COMBOLETO,0)=0");
    const danfe = text(input.danfe).toLowerCase();
    if (danfe === "sim") where.push("t.DUF=-1");
    else if (danfe === "nao") where.push("COALESCE(t.DUF,0)<>-1");
    if ([true, "true", "1", 1].includes(input.ocultar_provisao))
      where.push("COALESCE(t.HISTORICO,'')<>'Provisao de Ordem de compra'");
    const issueStart = firebirdDate(input.emissao_inicio);
    if (issueStart) { where.push("t.DTEMISSAO>=?"); params.push(issueStart); }
    const issueEnd = firebirdDate(input.emissao_fim);
    if (issueEnd) { where.push("t.DTEMISSAO<DATEADD(1 DAY TO CAST(? AS DATE))"); params.push(issueEnd); }
  }
  const status = text(input.status).toLowerCase();
  const map = receive
    ? {
        aberto_quitado: "t.STATUS IN (1,2)",
        0: "t.STATUS IN (1,2)",
        aberto: "t.STATUS=1",
        1: "t.STATUS=1",
        acordo: "t.STATUS=6",
        2: "t.STATUS=6",
        acordo_nf: "t.STATUS=7",
        3: "t.STATUS=7",
        acordo_recebimento: "t.STATUS=8",
        4: "t.STATUS=8",
        cancelado: "t.STATUS=4",
        5: "t.STATUS=4",
        devolucao: "t.STATUS=3",
        6: "t.STATUS=3",
        excluido: "t.STATUS=9",
        7: "t.STATUS=9",
        quitado: "t.STATUS=2",
        8: "t.STATUS=2",
        transferencia: "t.STATUS=5",
        9: "t.STATUS=5",
      }
    : {
        aberto_quitado: "t.STATUS IN (1,2)",
        0: "t.STATUS IN (1,2)",
        cancelado: "t.STATUS=4",
        1: "t.STATUS=4",
        excluido: "t.STATUS=9",
        2: "t.STATUS=9",
        quitado: "t.STATUS=2",
        3: "t.STATUS=2",
        aberto: "t.STATUS=1",
        4: "t.STATUS=1",
        acordo: "t.STATUS=6",
        5: "t.STATUS=6",
        pendente: "t.STATUS=7",
        6: "t.STATUS=7",
      };
  if (map[status]) where.push(map[status]);
  else if (status === "vencido")
    where.push("t.STATUS=1", "t.DTVENC<CURRENT_DATE");
  else if (status === "a_vencer")
    where.push("t.STATUS=1", "t.DTVENC>=CURRENT_DATE");
  const search = text(input.busca);
  if (search) {
    const like = `%${search.toUpperCase()}%`,
      person = receive
        ? "p.CLIENTE"
        : "p.FORNECEDOR",
      doc = receive
        ? "CAST(COALESCE(CAST(t.NRPEDIDO AS VARCHAR(20)),t.NRDOC,t.NRDOC2) AS VARCHAR(40))"
        : "CAST(COALESCE(t.NOTAFISCAL,t.NRDOC,t.NRDOC2) AS VARCHAR(40))";
    where.push(
      `(UPPER(${person}) LIKE ? OR UPPER(COALESCE(t.HISTORICO,'')) LIKE ? OR UPPER(${doc}) LIKE ?)`,
    );
    params.push(like, like, like);
  }
  return { where, params };
}

export async function accounts(db, type, args) {
  const receive = type === "receber",
    table = receive ? "CTARECEBER" : "CTAPAGAR",
    personJoin = receive
      ? "LEFT JOIN CLIENTE p ON p.CDCLIENTE=t.CDCLIENTE"
      : "LEFT JOIN FORNECEDOR p ON p.CDFORNECEDOR=t.CDFORNECEDOR",
    personId = receive ? "t.CDCLIENTE" : "t.CDFORNECEDOR",
    person = receive
      ? "p.CLIENTE"
      : "p.FORNECEDOR",
    doc = receive
      ? "CAST(COALESCE(CAST(t.NRPEDIDO AS VARCHAR(20)),t.NRDOC,t.NRDOC2) AS VARCHAR(40))"
      : "CAST(COALESCE(t.NOTAFISCAL,t.NRDOC,t.NRDOC2) AS VARCHAR(40))",
    value = receive
      ? "COALESCE(t.VALOR,t.DIVIDA,0)"
      : "COALESCE(t.VALOR,t.TOTAL,0)",
    paid = receive
      ? "COALESCE(t.TOTALPG,t.VLPGLIQ,0)"
      : "COALESCE(t.VLPAGTO,0)",
    shown = `CASE WHEN t.STATUS=2 THEN ${paid} ELSE ${value} END`,
    paidAt = receive ? "t.DTCOB" : "t.DTPAGTO",
    movement = receive ? "t.DTMOV" : "t.DTINCLUSAO",
    { where, params } = buildAccountFilters(type, args),
    orders = {
      vencimento_asc: "t.DTVENC ASC,t.CONTROLE DESC",
      valor_desc: `${shown} DESC,t.DTVENC DESC`,
      valor_asc: `${shown} ASC,t.DTVENC DESC`,
      pessoa: "PESSOA ASC,t.DTVENC DESC",
    },
    order = orders[text(args.ordenar).toLowerCase()] || orders.vencimento_asc;
  let dados;
  try {
    dados = await query(
      db,
      `SELECT FIRST 500 t.CONTROLE,t.IDEMPRESA,${personId} AS PESSOA_ID,${person} AS PESSOA,${doc} AS DOCUMENTO,t.PARCELA,CAST(t.DTVENC AS DATE) AS VENCIMENTO,CASE WHEN ${paidAt} IS NULL OR ${paidAt}<=CAST('1899-12-30' AS DATE) THEN NULL ELSE CAST(${paidAt} AS DATE) END AS DATA_BAIXA,${shown} AS VALOR,${paid} AS VALOR_PAGO,COALESCE(t.RETENCAO,0) AS RETENCAO,(${shown}-${paid}) AS SALDO,t.STATUS,CASE WHEN t.STATUS=1 AND t.DTVENC<CURRENT_DATE THEN 'Vencido' WHEN t.STATUS=1 THEN 'Aberto' WHEN t.STATUS=2 THEN 'Quitado' WHEN t.STATUS=3 THEN 'Devolucao' WHEN t.STATUS=4 THEN 'Cancelado' WHEN t.STATUS=5 THEN 'Transferencia' WHEN t.STATUS=6 THEN 'Acordo' WHEN t.STATUS=7 THEN 'Acordo em nota fiscal' WHEN t.STATUS=8 THEN 'Acordo no recebimento' WHEN t.STATUS=9 THEN 'Excluido' ELSE 'Status '||CAST(t.STATUS AS VARCHAR(10)) END AS STATUS_TITULO,DATEDIFF(DAY,t.DTVENC,CURRENT_DATE) AS DIAS_ATRASO,t.ACORDO FROM ${table} t ${personJoin} WHERE ${where.join(" AND ")} ORDER BY ${order}`,
      params,
    );
  } catch (error) {
    throw new Error(`Falha ao listar títulos: ${error.message}`);
  }
  let resumo;
  try {
    resumo =
      (
        await query(
          db,
          `SELECT COUNT(*) AS TITULOS,SUM(${shown}) AS TOTAL,SUM(CASE WHEN t.STATUS=1 THEN ${value} ELSE 0 END) AS TOTAL_ABERTO,SUM(CASE WHEN t.STATUS=1 AND t.DTVENC<CURRENT_DATE THEN ${value} ELSE 0 END) AS TOTAL_VENCIDO,SUM(CASE WHEN t.STATUS=1 AND t.DTVENC>=CURRENT_DATE THEN ${value} ELSE 0 END) AS TOTAL_A_VENCER,SUM(CASE WHEN t.STATUS=2 THEN ${paid} ELSE 0 END) AS TOTAL_QUITADO FROM ${table} t ${personJoin} WHERE ${where.join(" AND ")}`,
          params,
        )
      )[0] || {};
  } catch (error) {
    throw new Error(`Falha ao resumir títulos: ${error.message}`);
  }
  return { ok: true, tipo: type, dados, resumo };
}

const endpoint = (type) => async (req, res) => {
  try {
    res.json(await withDatabase((db) => accounts(db, type, req.query)));
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
};
router.get("/contas-receber", endpoint("receber"));
router.get("/contas-pagar", endpoint("pagar"));
router.get("/operacoes/detalhe", async (req, res) => {
  try {
    const tipo = text(req.query.tipo).toLowerCase(),
      controle = asInt(req.query.controle),
      empresa = asInt(req.query.empresa);
    if (!["receber", "pagar"].includes(tipo) || controle === null || empresa === null)
      return res.status(400).json({ ok: false, erro: "Título inválido." });
    const result = await withDatabase(async (db) => {
      const receber = tipo === "receber";
      const titulo = receber
        ? (
            await query(
              db,
              `SELECT FIRST 1 t.CONTROLE,t.IDEMPRESA,t.NRPEDIDO,t.NRDOC,t.NRDOC2,t.PARCELA,t.CDCLIENTE AS PESSOA_ID,COALESCE(c.CLIENTE,c.RAZAO) AS PESSOA,t.DTVENC,t.DTMOV,t.DTCOB AS DATA_BAIXA,t.VALOR,t.DIVIDA,t.TOTALPG,t.VLPGLIQ,t.JUROS,t.DESCONTO,t.RETENCAO,t.STATUS,t.ORIGEM,t.HISTORICO,t.CAIXA,t.CDBANCO,t.AGENCIA,t.NUMCONTA,COALESCE(r.RECEBTO,'Não informada') AS FORMA_PAGAMENTO FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(t.TPPAGTO,t.CODPAGTO) WHERE t.CONTROLE=? AND t.IDEMPRESA=?`,
              [controle, empresa],
            )
          )[0]
        : (
            await query(
              db,
              `SELECT FIRST 1 t.CONTROLE,t.IDEMPRESA,t.NOTAFISCAL,t.NRDOC,t.NRDOC2,t.CHAVE,t.PARCELA,t.CDFORNECEDOR AS PESSOA_ID,f.FORNECEDOR AS PESSOA,t.DTVENC,t.DTINCLUSAO AS DTMOV,t.DTPAGTO AS DATA_BAIXA,t.VALOR,t.TOTAL,t.VLPAGTO,t.JUROS,t.DESCONTO,t.RETENCAO,t.STATUS,t.ORIGEM,t.HISTORICO,t.CDCAIXA AS CAIXA,t.CDBANCO,t.AGENCIA,t.NUMCONTA,COALESCE(p.PAGTO,'Não informada') AS FORMA_PAGAMENTO FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR LEFT JOIN PAGTO p ON p.CDPAGTO=COALESCE(t.TPPAGTO,t.CODPAGTO) WHERE t.CONTROLE=? AND t.IDEMPRESA=?`,
              [controle, empresa],
            )
          )[0];
      if (!titulo) throw Object.assign(new Error("Título não encontrado."), { status: 404 });
      let pedido = null,
        entrada = null,
        itens = [];
      if (receber && Number(titulo.NRPEDIDO)) {
        pedido = (
          await query(
            db,
            "SELECT FIRST 1 se.NRPEDIDO,se.IDEMPRESA,se.DTSAIDA,se.CLIENTE,se.CDCLIENTE,se.STATUS,se.SUBTOTAL,se.DESCONTO,se.FRETE,se.VLTOTAL,se.OBS,se.OBSERVACAO FROM SAIDAESTOQUE se WHERE se.NRPEDIDO=? AND se.IDEMPRESA=?",
            [titulo.NRPEDIDO, empresa],
          )
        )[0] || null;
        itens = await query(
          db,
          "SELECT sp.POSIC,sp.CDPRODUTO,sp.DESCRICAO,sp.UNID,sp.QTDPRODUTO,sp.VLUNIT,COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0) AS TOTAL FROM SAIDAPRODUTO sp WHERE sp.NRPEDIDO=? AND sp.IDEMPRESA=? AND COALESCE(sp.STATUSSE,0)=0 ORDER BY sp.POSIC",
          [titulo.NRPEDIDO, empresa],
        );
      } else if (!receber) {
        const invoice = text(titulo.NOTAFISCAL || titulo.NRDOC).replace(/-\d+$/, ""),
          document = text(titulo.NRDOC).replace(/-\d+$/, "");
        entrada = (
          await query(
            db,
            "SELECT FIRST 1 ee.IDENTRADA,ee.IDEMPRESA,ee.CDFORNECEDOR,ee.NOTAFISCAL,ee.DTENTRADA,ee.DTNTFISCAL,ee.VLTOTAL,ee.SUBTOTAL,ee.DESCONTO,ee.VLFRETE,ee.VLTOTIPI,ee.VLTOTOUTROS,ee.STATUS,ee.CHAVE,ee.OBSERVACAO FROM ENTRESTOQUE ee WHERE ee.IDEMPRESA=? AND ee.CDFORNECEDOR=? AND ((?<>'' AND TRIM(ee.CHAVE)=?) OR TRIM(ee.NOTAFISCAL)=? OR TRIM(ee.NOTAFISCAL)=?) ORDER BY CASE WHEN ?<>'' AND TRIM(ee.CHAVE)=? THEN 0 ELSE 1 END,ABS(DATEDIFF(DAY,ee.DTENTRADA,?)),ee.IDENTRADA DESC",
            [empresa,titulo.PESSOA_ID,text(titulo.CHAVE),text(titulo.CHAVE),invoice,document,text(titulo.CHAVE),text(titulo.CHAVE),titulo.DTMOV],
          )
        )[0] || null;
        if (entrada)
          itens = await query(
            db,
            "SELECT ep.POSIC,ep.CDPRODUTO,ep.DESCRICAO,ep.UNID,ep.QTDE AS QTDPRODUTO,ep.VLUNIT,COALESCE(ep.VLTOT,ep.QTDE*ep.VLUNIT,0) AS TOTAL,COALESCE(ep.DESCONTO,0) AS DESCONTO,COALESCE(ep.VLFRETE,0) AS FRETE,COALESCE(ep.VLIPI,0) AS IPI FROM ENTRPRODUTO ep WHERE ep.IDENTRADA=? AND ep.IDEMPRESA=? ORDER BY ep.POSIC",
            [entrada.IDENTRADA, entrada.IDEMPRESA],
          );
      }
      return { ok: true, tipo, titulo, pedido, entrada, itens };
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.get("/operacoes/opcoes", async (_req, res) => {
  try {
    const result = await withDatabase(async (db) => {
      const walletRows = await query(db,"SELECT FIRST 1 CDRECEBTO,RECEBTO,CDGRUPO,CCUSTO FROM RECEBTO WHERE UPPER(TRIM(RECEBTO)) CONTAINING 'CARTEIRA' ORDER BY CASE WHEN UPPER(TRIM(RECEBTO))='CARTEIRA' THEN 0 ELSE 1 END,CDRECEBTO");
      const formas = await query(db,"SELECT CDRECEBTO,RECEBTO,COALESCE(DESCONTO,0) AS TAXA_RETENCAO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY RECEBTO");
      const formas_pagar = await query(db,"SELECT CDPAGTO,PAGTO,CDGRUPO FROM PAGTO WHERE COALESCE(INATIVO,0)=0 ORDER BY PAGTO");
      const bancos = await query(db,"SELECT CDBANCO,BANCO FROM BANCO ORDER BY BANCO");
      const contas_bancarias = await query(db,"SELECT cc.CDBANCO,b.BANCO,cc.AGENCIA,cc.NUMCONTA FROM CONTACORRENTE cc LEFT JOIN BANCO b ON b.CDBANCO=cc.CDBANCO ORDER BY b.BANCO,cc.AGENCIA,cc.NUMCONTA");
      const caixas = await query(db,"SELECT CDCAIXA,CAIXA FROM TPCAIXA WHERE COALESCE(INATIVO,0)=0 ORDER BY CAIXA,CDCAIXA");
      const taxas_juros = await query(db,"SELECT IDEMPRESA,COALESCE(TXJUROS,0) AS TXJUROS FROM CONFIGURACAO");
      const contas = await query(db,"SELECT CDCONTA,CONTA FROM CONTAS ORDER BY CONTA");
      const subcontas = await query(db,"SELECT CDCONTA,CDSUBCONTA,SUBCONTA FROM SUBCONTAS ORDER BY SUBCONTA");
      const subsubcontas = await query(db,"SELECT CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,SUBSUBCONTA FROM SUBSUBCONTAS ORDER BY SUBSUBCONTA");
      const subsubsubcontas = await query(db,"SELECT CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,SUBSUBSUBCONTA FROM SUBSUBSUBCONTAS ORDER BY SUBSUBSUBCONTA");
      const empresas = await query(db,"SELECT IDEMPRESA,NOMEEMPRESA FROM CONFIGURACAO ORDER BY NOMEEMPRESA");
      const clientes = await query(db,"SELECT CDCLIENTE,CLIENTE FROM CLIENTE WHERE COALESCE(INATIVO,0)=0 ORDER BY CLIENTE");
      const fornecedores = await query(db,"SELECT CDFORNECEDOR,FORNECEDOR FROM FORNECEDOR WHERE COALESCE(INATIVO,0)=0 ORDER BY FORNECEDOR");
      const grupos_recebimento = await query(db,"SELECT CDGRUPO,GRUPO FROM GRUPORECEBTO ORDER BY GRUPO");
      const centros_custo = await query(db,"SELECT CCUSTO,CENTROCUSTO FROM CENTROCUSTO ORDER BY CENTROCUSTO");
      const vendedores = await query(db,"SELECT CDVENDEDOR,VENDEDOR FROM VENDEDOR WHERE COALESCE(INATIVO,0)=0 ORDER BY VENDEDOR");
      const classificacoes = await query(db,"SELECT CDCLASSIFICACAO,CLASSIFICACAO FROM CLASSIFICACAO ORDER BY CLASSIFICACAO");
      const tipos_documento = await query(db,"SELECT CDDOCUMENTO,DOCUMENTO FROM TIPODOCUMENTO ORDER BY DOCUMENTO");
      return {
        ok: true,
        carteira: walletRows[0] || null,
        formas,
        formas_pagar,
        bancos,
        contas_bancarias,
        caixas,
        taxas_juros,
        empresas,
        clientes,
        fornecedores,
        grupos_recebimento,
        centros_custo,
        vendedores,
        classificacoes,
        tipos_documento,
        plano_contas: {
          ok: true,
          contas,
          subcontas,
          subsubcontas,
          subsubsubcontas,
        },
      };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

router.post("/operacoes/criar", async (req, res) => {
  try {
    let input = newAccountInput(req.body || {});
    const user = Number(req.dashboardSession?.user?.idusuario || 1);
    const result = await withWriteTransaction(async (tx) => {
      const table = input.type === "receber" ? "CTARECEBER" : "CTAPAGAR";
      const control = await nextAccountControl(tx, table);
      input = completeAccountInput(input, await accountPaymentDefaults(tx, input));
      if (input.type === "receber") {
        await tx.execute(
          "INSERT INTO CTARECEBER (CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,INTERVALO,ORIGEM,DIVIDA,TOTALPG,DTCOB,CAIXA,CODPAGTO,DTMOV,TPPAGTO,STATUS,CDUSR,DTLOG,HORALOG,CDRECGRUPO,NRDOC2,ACORDO,DTALTER,SIST_ALT,CDCAIXAORIGEM,HISTORICO,VLPGLIQ,CCUSTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,JUROS,DESCONTO,RETENCAO,AVISOS) VALUES (?,?,?,?,?,?,?,0,'LANCAMENTO MANUAL',?,0,NULL,?,?,CURRENT_TIMESTAMP,?,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,0,CURRENT_TIMESTAMP,'LOCAL',?,?,0,?,?,?,?,?,0,0,0,0)",
          [control,input.company,input.document,input.installment,input.person,input.dueDate,input.amount,input.amount,input.cash,input.payment,input.payment,user,input.receiptGroup,input.document,input.cash,input.history,input.costCenter,input.account,input.subaccount,input.thirdAccount,input.fourthAccount],
        );
      } else {
        await tx.execute(
          "INSERT INTO CTAPAGAR (CONTROLE,IDEMPRESA,NOTAFISCAL,NUMERO,CDFORNECEDOR,PARCELA,INTERVALO,STATUS,CDCAIXA,CCUSTO,CODPAGTO,TPPAGTO,NRDOC,NRDOC2,DTVENC,DTPAGTO,DTINCLUSAO,DTLOG,HORALOG,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,HISTORICO,VALOR,TOTAL,VLPAGTO,JUROS,DESCONTO,RETENCAO,ACORDO,COMBOLETO,IDUSUARIO,SIST_ALT,ORIGEM,COMPETENCIA) VALUES (?,?,?,?,?,?,0,1,?,?,?,?,?,?,?,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,0,0,0,0,0,0,?,'LOCAL','LANCAMENTO MANUAL',?)",
          [control,input.company,input.document,input.document.slice(0,10),input.person,input.installment,input.cash,input.costCenter,input.payment,input.payment,input.document,input.document,input.dueDate,input.account,input.subaccount,input.thirdAccount,input.fourthAccount,input.history,input.amount,input.amount,user,input.dueDate],
        );
      }
      return {
        controle: control,
        idempresa: input.company,
        tipo: input.type,
        vencimento: input.dueDate.toISOString().slice(0, 10),
      };
    });
    res.status(201).json({ ok: true, mensagem: `Conta a ${result.tipo} criada com sucesso.`, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.get("/operacoes/acordos", async (req, res) => {
  try {
    const tipo = text(req.query.tipo).toLowerCase();
    const result = await withDatabase(async (db) => {
      const exists = await query(
        db,
        "SELECT FIRST 1 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)='DASH_FIN_ACORDO'",
      );
      if (!exists.length) return [];
      const params = [],
        where = [];
      if (["receber", "pagar"].includes(tipo)) {
        where.push("a.TIPO=?");
        params.push(tipo);
      }
      return query(
        db,
        `SELECT FIRST 100 a.IDACORDO,a.TIPO,a.PESSOA_ID,a.SALDO_ORIGINAL,a.JUROS,a.DESCONTO,a.RETENCAO,a.ACRESCIMO,a.TOTAL_NOVO,a.STATUS,a.CRIADO_EM,a.DESFEITO_EM,(SELECT COUNT(*) FROM DASH_FIN_ACORDO_ITEM i WHERE i.IDACORDO=a.IDACORDO AND i.PAPEL='O') AS TITULOS_ORIGINAIS,(SELECT COUNT(*) FROM DASH_FIN_ACORDO_ITEM i WHERE i.IDACORDO=a.IDACORDO AND i.PAPEL='N') AS PARCELAS_NOVAS FROM DASH_FIN_ACORDO a ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.CRIADO_EM DESC`,
        params,
      );
    });
    res.json({ ok: true, acordos: result });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

router.post("/operacoes/acordo", async (req, res) => {
  try {
    const body = req.body || {},
      { type, refs, table } = financeInput(body),
      model = [Number(body.modelo_controle), Number(body.modelo_empresa)],
      count = Number(body.quantidade || 0),
      interval = Number(body.intervalo || 0),
      start = String(body.data_inicial || "").slice(0, 10),
      startDate = firebirdDate(start),
      interest = Math.round(Number(body.juros || 0) * 100) / 100,
      discount = Math.round(Number(body.desconto || 0) * 100) / 100,
      retention =
        type === "receber"
          ? Math.round(Number(body.retencao || 0) * 100) / 100
          : 0,
      addition = Math.round(Number(body.acrescimo || 0) * 100) / 100,
      values = (body.valores || []).map(
        (value) => Math.round(Number(value) * 100) / 100,
      ),
      boleto = Boolean(body.transformar_boleto),
      informedHistory = String(body.historico || "")
        .trim()
        .slice(0, 255);
    if (!refs.some((ref) => ref[0] === model[0] && ref[1] === model[1]))
      throw Object.assign(
        new Error("Escolha uma das contas selecionadas como modelo."),
        { status: 400 },
      );
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 120 ||
      interval < 0 ||
      !startDate ||
      values.length !== count ||
      values.some((value) => !Number.isFinite(value) || value <= 0)
    )
      throw Object.assign(new Error("Parcelamento invalido."), { status: 400 });
    const agreement = await withWriteTransaction(async (tx) => {
      await ensureAgreementSchema(tx);
      const person = type === "receber" ? "CDCLIENTE" : "CDFORNECEDOR",
        value =
          type === "receber"
            ? "COALESCE(VALOR,DIVIDA,0)"
            : "COALESCE(VALOR,TOTAL,0)",
        rows = [];
      for (const ref of refs) {
        const row = await tx.singleton(
          `SELECT CONTROLE,IDEMPRESA,${person} AS PESSOA,STATUS,${value} AS VALOR,ACORDO,DTVENC,COALESCE(RETENCAO,0) AS RETENCAO FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
          ref,
        );
        if (!row || Number(row.STATUS) !== 1)
          throw Object.assign(
            new Error(`A conta ${ref[0]} nao esta mais aberta.`),
            { status: 409 },
          );
        rows.push(row);
      }
      if (new Set(rows.map((row) => Number(row.PESSOA))).size !== 1)
        throw Object.assign(
          new Error(
            "Todas as contas devem pertencer ao mesmo cliente ou fornecedor.",
          ),
          { status: 400 },
        );
      let form = await tx.singleton(
        `SELECT t.CODPAGTO,COALESCE(r.CDGRUPO,t.CDRECGRUPO) AS CDGRUPO,COALESCE(r.CCUSTO,t.CCUSTO) AS CCUSTO FROM ${table} t LEFT JOIN RECEBTO r ON r.CDRECEBTO=t.CODPAGTO WHERE t.CONTROLE=? AND t.IDEMPRESA=?`,
        model,
      );
      if (!form?.CODPAGTO)
        throw Object.assign(
          new Error("A conta modelo nao possui forma prevista informada."),
          { status: 400 },
        );
      if (boleto) {
        if (type !== "receber")
          throw Object.assign(
            new Error(
              "A transformacao em boleto esta disponivel somente para contas a receber.",
            ),
            { status: 400 },
          );
        form = await tx.singleton(
          "SELECT FIRST 1 CDRECEBTO AS CODPAGTO,CDGRUPO,CCUSTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 AND UPPER(TRIM(RECEBTO)) CONTAINING 'BOLETO' ORDER BY CASE WHEN UPPER(TRIM(RECEBTO))='BOLETO' THEN 0 ELSE 1 END,CDRECEBTO",
        );
        if (!form)
          throw Object.assign(
            new Error(
              "A forma de pagamento Boleto nao foi encontrada neste banco de dados.",
            ),
            { status: 400 },
          );
      }
      const balance =
          Math.round(
            rows.reduce((sum, row) => sum + Number(row.VALOR || 0), 0) * 100,
          ) / 100,
        total = Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100,
        expected =
          Math.round(
            (balance + interest + addition - discount - retention) * 100,
          ) / 100;
      if (Math.abs(total - expected) > 0.009)
        throw Object.assign(
          new Error(
            `O total das parcelas (${total.toFixed(2)}) deve ser igual a ${expected.toFixed(2)}.`,
          ),
          { status: 400 },
        );
      const id = Number(
          (
            await tx.singleton(
              "SELECT NEXT VALUE FOR GEN_DASH_FIN_ACORDO AS ID FROM RDB$DATABASE",
            )
          ).ID,
        ),
        uid = Number(req.dashboardSession?.user?.idusuario || 1);
      await tx.execute(
        "INSERT INTO DASH_FIN_ACORDO (IDACORDO,TIPO,PESSOA_ID,MODELO_CONTROLE,MODELO_EMPRESA,SALDO_ORIGINAL,JUROS,DESCONTO,RETENCAO,ACRESCIMO,TOTAL_NOVO,STATUS,CRIADO_EM,CRIADO_POR) VALUES (?,?,?,?,?,?,?,?,?,?,?,'ATIVO',CURRENT_TIMESTAMP,?)",
        [
          id,
          type,
          rows[0].PESSOA,
          ...model,
          balance,
          interest,
          discount,
          retention,
          addition,
          total,
          uid,
        ],
      );
      for (let i = 0; i < refs.length; i++) {
        await tx.execute(agreementStatusSql(type), [id, startDate, ...refs[i]]);
        await tx.execute(
          "INSERT INTO DASH_FIN_ACORDO_ITEM (IDACORDO,PAPEL,CONTROLE,IDEMPRESA,STATUS_ANTERIOR,ACORDO_ANTERIOR) VALUES (?,'O',?,?,1,?)",
          [id, ...refs[i], rows[i].ACORDO],
        );
      }
      for (let i = 0; i < values.length; i++) {
        const control = Number(
            (
              await tx.singleton(
                `SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM ${table}`,
              )
            ).ID,
          ),
          due = new Date(`${start}T12:00:00`);
        due.setDate(due.getDate() + interval * i);
        const history =
            informedHistory ||
            `Acordo nº ${id}${boleto ? " - transformado em boleto" : ""}`,
          overrides = {
            CONTROLE: control,
            IDEMPRESA: model[1],
            STATUS: 1,
            ACORDO: id,
            PARCELA: i + 1,
            INTERVALO: interval,
            DTVENC: due,
            CODPAGTO: form.CODPAGTO,
            CDRECGRUPO: form.CDGRUPO,
            CCUSTO: form.CCUSTO,
            HISTORICO: history,
            DTALTER: new Date(),
          };
        if (type === "receber")
          Object.assign(overrides, {
            VALOR: values[i],
            DIVIDA: values[i],
            TOTALPG: 0,
            VLPGLIQ: 0,
            DTCOB: null,
            TPPAGTO: null,
            QUITACAO_RECEBTO: null,
            NOSSONUMERO: boleto ? "SIM" : null,
          });
        else
          Object.assign(overrides, {
            VALOR: values[i],
            TOTAL: values[i],
            VLPAGTO: 0,
            DTPAGTO: null,
          });
        await cloneAccount(tx, table, model, overrides);
        await tx.execute(
          "INSERT INTO DASH_FIN_ACORDO_ITEM (IDACORDO,PAPEL,CONTROLE,IDEMPRESA,STATUS_ANTERIOR) VALUES (?,'N',?,?,NULL)",
          [id, control, model[1]],
        );
      }
      return id;
    });
    res.json({
      ok: true,
      acordo: agreement,
      mensagem: `Acordo nº ${agreement} criado com ${count} parcela(s).`,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/operacoes/cancelar-baixa", async (req, res) => {
  try {
    const { type, refs, table } = financeInput(req.body),
      count = await withWriteTransaction(async (tx) => {
        const movements = new Set();
        for (const ref of refs) {
          const row = await tx.singleton(
            `SELECT STATUS,MOV_BANCARIA FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
            ref,
          );
          if (!row || Number(row.STATUS) !== 2)
            throw Object.assign(
              new Error(
                `A conta ${ref[0]} nao esta mais quitada. Nenhum cancelamento foi gravado.`,
              ),
              { status: 409 },
            );
          if (row.MOV_BANCARIA) movements.add(Number(row.MOV_BANCARIA));
        }
        for (const movement of movements) {
          const row = await tx.singleton(
            "SELECT EXTRATO_ITEM FROM MOV_BANCARIO WHERE CONTROLE=?",
            [movement],
          );
          if (row?.EXTRATO_ITEM !== null && row?.EXTRATO_ITEM !== undefined)
            throw Object.assign(
              new Error(
                `A baixa ja foi conciliada com o OFX (movimento ${movement}) e nao pode ser cancelada antes de desfazer a conciliacao.`,
              ),
              { status: 409 },
            );
        }
        const sql =
          type === "receber"
            ? "UPDATE CTARECEBER SET STATUS=1,DTCOB=NULL,TPPAGTO=NULL,CDBANCO=NULL,CAIXA=NULL,NUMCONTA=NULL,AGENCIA=NULL,TOTALPG=0,VLPGLIQ=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=2"
            : "UPDATE CTAPAGAR SET STATUS=1,DTPAGTO=NULL,TPPAGTO=NULL,CDBANCO=NULL,CDCAIXA=NULL,CONTA=NULL,AGENCIA=NULL,VLPAGTO=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=2";
        for (const ref of refs) {
          await tx.execute(sql, ref);
          if (type === "receber")
            await tx.execute(
              "UPDATE CTARECEBERCAIXA SET CANCELADO=1,DTALTER=CURRENT_TIMESTAMP WHERE LANCAMENTO=? AND IDEMPRESA=? AND COALESCE(CANCELADO,0)=0",
              ref,
            );
        }
        for (const movement of movements) {
          const receivable = await tx.singleton(
              "SELECT COALESCE(SUM(CASE WHEN STATUS=2 THEN COALESCE(VLPGLIQ,TOTALPG,0) ELSE 0 END),0) AS TOTAL FROM CTARECEBER WHERE MOV_BANCARIA=?",
              [movement],
            ),
            payable = await tx.singleton(
              "SELECT COALESCE(SUM(CASE WHEN STATUS=2 THEN COALESCE(VLPAGTO,0) ELSE 0 END),0) AS TOTAL FROM CTAPAGAR WHERE MOV_BANCARIA=?",
              [movement],
            ),
            remaining =
              Math.round(
                (Number(receivable.TOTAL) - Number(payable.TOTAL)) * 100,
              ) / 100;
          if (Math.abs(remaining) > 0.009)
            await tx.execute(
              "UPDATE MOV_BANCARIO SET VALOR=? WHERE CONTROLE=? AND EXTRATO_ITEM IS NULL",
              [remaining, movement],
            );
          else
            await tx.execute(
              "DELETE FROM MOV_BANCARIO WHERE CONTROLE=? AND EXTRATO_ITEM IS NULL AND DESCRICAO STARTING WITH 'Baixa contas a'",
              [movement],
            );
        }
        return refs.length;
      });
    res.json({
      ok: true,
      mensagem: `Baixa de ${count} conta(s) cancelada com sucesso.`,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/operacoes/baixar", async (req, res) => {
  try {
    const body = req.body || {},
      { type, refs, table } = financeInput(body),
      date = String(body.data_pagamento || "").slice(0, 10),
      paymentDate = firebirdDate(date),
      payment = Number(body.forma_pagamento || 0),
      bank = Number(body.banco || 0) || null,
      cash = Number(body.caixa || 0),
      account = String(body.conta || "").trim(),
      agency = String(body.agencia || "").trim(),
      discount = Math.round(Number(body.desconto || 0) * 100) / 100,
      gross = Math.round(Number(body.valor_pagamento || 0) * 100) / 100,
      net = Math.round(Number(body.valor_liquido || 0) * 100) / 100,
      history = String(body.historico || "")
        .trim()
        .slice(0, 255);
    if (!paymentDate || !payment || !cash)
      throw Object.assign(
        new Error("Informe data, forma de pagamento e caixa."),
        { status: 400 },
      );
    if (date > new Date().toISOString().slice(0, 10))
      throw Object.assign(
        new Error("A data da baixa nao pode ser posterior ao dia atual."),
        { status: 400 },
      );
    const result = await withWriteTransaction(async (tx) => {
      if (
        !(await tx.singleton(
          "SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0",
          [cash],
        ))
      )
        throw Object.assign(
          new Error("Selecione um caixa ativo e cadastrado."),
          { status: 400 },
        );
      const person = type === "receber" ? "CDCLIENTE" : "CDFORNECEDOR",
        value =
          type === "receber"
            ? "COALESCE(VALOR,DIVIDA,0)"
            : "COALESCE(VALOR,TOTAL,0)",
        rows = [];
      for (const ref of refs) {
        const row = await tx.singleton(
          `SELECT CONTROLE,IDEMPRESA,${person} AS PESSOA,STATUS,${value} AS VALOR,ACORDO,DTVENC,COALESCE(RETENCAO,0) AS RETENCAO FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
          ref,
        );
        if (!row || Number(row.STATUS) !== 1)
          throw Object.assign(
            new Error(`A conta ${ref[0]} nao esta mais aberta.`),
            { status: 409 },
          );
        rows.push(row);
      }
      if (new Set(rows.map((row) => Number(row.PESSOA))).size !== 1)
        throw Object.assign(
          new Error(
            "Todas as contas devem pertencer ao mesmo cliente ou fornecedor.",
          ),
          { status: 400 },
        );
      const form = await tx.singleton(
        "SELECT COALESCE(DESCONTO,0) AS TAXA,COALESCE(TPRECEBTO,CDRECEBTO) AS TIPO,CDGRUPO,CCUSTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA FROM RECEBTO WHERE CDRECEBTO=?",
        [payment],
      );
      if (!form)
        throw Object.assign(new Error("Forma de pagamento nao encontrada."), {
          status: 400,
        });
      const original =
          Math.round(
            rows.reduce((sum, row) => sum + Number(row.VALOR || 0), 0) * 100,
          ) / 100,
        titleRetention =
          Math.round(
            rows.reduce((sum, row) => sum + Number(row.RETENCAO || 0), 0) * 100,
          ) / 100,
        retention =
          type === "receber"
            ? titleRetention > 0
              ? titleRetention
              : Math.round(original * Number(form.TAXA || 0)) / 100
            : 0,
        interest = [];
      for (const row of rows) {
        const cfg = await tx.singleton(
            "SELECT COALESCE(TXJUROS,0) AS TAXA FROM CONFIGURACAO WHERE IDEMPRESA=?",
            [row.IDEMPRESA],
          ),
          days = row.DTVENC
            ? Math.max(
                0,
                Math.floor(
                  (new Date(`${date}T12:00:00`) -
                    new Date(`${String(row.DTVENC).slice(0, 10)}T12:00:00`)) /
                    86400000,
                ),
              )
            : 0;
        interest.push(
          Math.round(Number(row.VALOR) * Number(cfg?.TAXA || 0) * days) / 100,
        );
      }
      const totalInterest =
          Math.round(interest.reduce((a, b) => a + b, 0) * 100) / 100,
        expected =
          Math.round((original + totalInterest - discount) * 100) / 100,
        expectedNet = Math.round((expected - retention) * 100) / 100;
      if (Math.abs(gross - expected) > 0.009)
        throw Object.assign(
          new Error(`O valor do pagamento deve ser ${expected.toFixed(2)}.`),
          { status: 400 },
        );
      if (Math.abs(net - expectedNet) > 0.009)
        throw Object.assign(
          new Error(`O pagamento liquido deve ser ${expectedNet.toFixed(2)}.`),
          { status: 400 },
        );
      const distribute = (amount) =>
          rows.map((row, index) =>
            index === rows.length - 1
              ? Math.round(
                  (amount -
                    rows
                      .slice(0, -1)
                      .reduce(
                        (sum, item) =>
                          sum +
                          Math.round(
                            ((amount * Number(item.VALOR)) / original) * 100,
                          ) /
                            100,
                        0,
                      )) *
                    100,
                ) / 100
              : Math.round(((amount * Number(row.VALOR)) / original) * 100) /
                100,
          ),
        discounts = distribute(discount),
        retentions =
          titleRetention > 0
            ? rows.map((row) => Number(row.RETENCAO || 0))
            : distribute(retention);
      for (let i = 0; i < rows.length; i++) {
        const paid =
            Math.round(
              (Number(rows[i].VALOR) + interest[i] - discounts[i]) * 100,
            ) / 100,
          paidNet = Math.round((paid - retentions[i]) * 100) / 100,
          plan = [
            form.CDGRUPO,
            form.CCUSTO,
            body.cdconta || form.CDCONTA,
            body.cdsubconta || form.CDSUBCONTA,
            body.cdsubsubconta || form.CDSUBSUBCONTA,
            body.cdsubsubsubconta || form.CDSUBSUBSUBCONTA,
          ];
        if (type === "receber") {
          await tx.execute(
            "UPDATE CTARECEBER SET STATUS=2,DTCOB=?,TPPAGTO=?,CDBANCO=?,CAIXA=?,NUMCONTA=?,AGENCIA=?,CDRECGRUPO=COALESCE(?,CDRECGRUPO),CCUSTO=COALESCE(?,CCUSTO),CDCONTA=COALESCE(?,CDCONTA),CDSUBCONTA=COALESCE(?,CDSUBCONTA),CDSUBSUBCONTA=COALESCE(?,CDSUBSUBCONTA),CDSUBSUBSUBCONTA=COALESCE(?,CDSUBSUBSUBCONTA),JUROS=?,DESCONTO=?,RETENCAO=?,TOTALPG=?,VLPGLIQ=?,HISTORICO=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1",
            [
              paymentDate,
              payment,
              bank,
              cash,
              account,
              agency,
              ...plan,
              interest[i],
              discounts[i],
              retentions[i],
              paid,
              paidNet,
              history,
              ...refs[i],
            ],
          );
          await tx.execute(
            "INSERT INTO CTARECEBERCAIXA (IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,ORIGEM,DIVIDA,TOTALPG,DTCOB,CDBANCO,CAIXA,JUROS,CODPAGTO,DESCONTO,RETENCAO,NRPEDIDO,DTMOV,LANCAMENTO,TPPAGTO,STATUS,CDUSR,DTLOG,CDRECGRUPO,NRDOC2,ACORDO,SIST_ALT,HISTORICO,CANCELADO,CDCAIXAORIGEM,CDUSR_CAIXA) SELECT IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,COALESCE(VALOR,DIVIDA,0),COALESCE(ORIGEM,'RECBTO'),DIVIDA,?,?,?, ?,?,CODPAGTO,?,?,NRPEDIDO,DTMOV,CONTROLE,?,2,?,CURRENT_TIMESTAMP,COALESCE(?,CDRECGRUPO),NRDOC2,ACORDO,'LOCAL',?,0,?,? FROM CTARECEBER WHERE CONTROLE=? AND IDEMPRESA=?",
            [
              paid,
              paymentDate,
              bank,
              cash,
              interest[i],
              discounts[i],
              retentions[i],
              payment,
              Number(req.dashboardSession?.user?.idusuario || 1),
              form.CDGRUPO,
              history,
              cash,
              Number(req.dashboardSession?.user?.idusuario || 1),
              ...refs[i],
            ],
          );
        } else
          await tx.execute(
            "UPDATE CTAPAGAR SET STATUS=2,DTPAGTO=?,TPPAGTO=?,CDBANCO=?,CDCAIXA=?,CONTA=?,AGENCIA=?,CDRECGRUPO=COALESCE(?,CDRECGRUPO),CCUSTO=COALESCE(?,CCUSTO),CDCONTA=COALESCE(?,CDCONTA),CDSUBCONTA=COALESCE(?,CDSUBCONTA),CDSUBSUBCONTA=COALESCE(?,CDSUBSUBCONTA),CDSUBSUBSUBCONTA=COALESCE(?,CDSUBSUBSUBCONTA),JUROS=?,DESCONTO=?,RETENCAO=?,VLPAGTO=?,HISTORICO=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1",
            [
              paymentDate,
              payment,
              bank,
              cash,
              account,
              agency,
              ...plan,
              interest[i],
              discounts[i],
              retentions[i],
              paidNet,
              history,
              ...refs[i],
            ],
          );
      }
      let movement = null;
      if (bank) {
        movement = Number(
          (
            await tx.singleton(
              "SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM MOV_BANCARIO",
            )
          ).ID,
        );
        await tx.execute(
          "INSERT INTO MOV_BANCARIO (CONTROLE,CDBANCO,AGENCIA,NUMCONTA,NUMDOC,IDUSUARIO,IDEMPRESA,DESCRICAO,HISTORICO,DTLANCAMENTO,VALOR,TPLANCAMENTO,CDRECEBTO,STATUS,EXTRATO_ITEM,CONTROLE_CTA,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,'LOCAL')",
          [
            movement,
            bank,
            agency,
            account,
            String(body.numero_pagamento || `BAIXA-${movement}`).slice(0, 30),
            Number(req.dashboardSession?.user?.idusuario || 1),
            rows[0].IDEMPRESA,
            type === "receber"
              ? "Baixa contas a receber"
              : "Baixa contas a pagar",
            history,
            paymentDate,
            type === "receber" ? net : -net,
            type === "receber" ? 0 : 1,
            payment,
            refs[0][0],
          ],
        );
        for (const ref of refs)
          await tx.execute(
            `UPDATE ${table} SET MOV_BANCARIA=? WHERE CONTROLE=? AND IDEMPRESA=?`,
            [movement, ...ref],
          );
      }
      return movement;
    });
    res.json({
      ok: true,
      mov_bancario: result,
      mensagem: `${refs.length} conta(s) baixada(s) com sucesso.${result ? ` Movimento bancario ${result} aguardando OFX.` : ""}`,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

async function undoAgreement(req, res) {
  try {
    const { type, refs, table } = financeInput(req.body),
      result = await withWriteTransaction(async (tx) => {
        const links = [];
        for (const ref of refs)
          links.push(
            await tx.singleton(
              "SELECT a.IDACORDO,a.STATUS FROM DASH_FIN_ACORDO a JOIN DASH_FIN_ACORDO_ITEM i ON i.IDACORDO=a.IDACORDO AND i.PAPEL='N' WHERE a.TIPO=? AND i.CONTROLE=? AND i.IDEMPRESA=?",
              [type, ...ref],
            ),
          );
        if (links.every((item) => !item)) {
          const rows = [];
          for (const ref of refs) {
            const row = await tx.singleton(
              `SELECT ACORDO,STATUS FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
              ref,
            );
            if (
              !row ||
              row.ACORDO === null ||
              ![1, 2].includes(Number(row.STATUS))
            )
              throw Object.assign(
                new Error(
                  "Uma parcela selecionada nao pertence a um acordo legado ativo.",
                ),
                { status: 409 },
              );
            rows.push(row);
          }
          const agreements = new Set(rows.map((row) => Number(row.ACORDO)));
          if (agreements.size !== 1)
            throw Object.assign(
              new Error("Selecione parcelas de um unico acordo."),
              { status: 400 },
            );
          const agreement = [...agreements][0],
            active = await tx.query(
              `SELECT CONTROLE,IDEMPRESA FROM ${table} WHERE ACORDO=? AND STATUS IN (1,2)`,
              [agreement],
            ),
            originals = await tx.query(
              `SELECT CONTROLE,IDEMPRESA FROM ${table} WHERE ACORDO=? AND STATUS=6`,
              [agreement],
            );
          if (!originals.length)
            throw Object.assign(
              new Error(
                "Nao foram encontradas as contas originais deste acordo no sistema legado.",
              ),
              { status: 409 },
            );
          for (const row of active)
            await tx.execute(
              `UPDATE ${table} SET STATUS=9,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND ACORDO=? AND STATUS IN (1,2)`,
              [row.CONTROLE, row.IDEMPRESA, agreement],
            );
          for (const row of originals)
            await tx.execute(
              type === "receber"
                ? "UPDATE CTARECEBER SET STATUS=1,ACORDO=NULL,DTCOB=NULL,TOTALPG=0,VLPGLIQ=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND ACORDO=? AND STATUS=6"
                : "UPDATE CTAPAGAR SET STATUS=1,ACORDO=NULL,DTPAGTO=NULL,VLPAGTO=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND ACORDO=? AND STATUS=6",
              [row.CONTROLE, row.IDEMPRESA, agreement],
            );
          return { agreement, origin: "legado" };
        }
        if (
          links.some((item) => !item) ||
          links.some((item) => String(item.STATUS).trim() !== "ATIVO")
        )
          throw Object.assign(
            new Error(
              "A selecao mistura parcelas de acordos diferentes ou inativos.",
            ),
            { status: 409 },
          );
        const agreements = new Set(links.map((item) => Number(item.IDACORDO)));
        if (agreements.size !== 1)
          throw Object.assign(
            new Error("Selecione parcelas de um unico acordo."),
            { status: 400 },
          );
        const agreement = [...agreements][0],
          items = await tx.query(
            "SELECT PAPEL,CONTROLE,IDEMPRESA,ACORDO_ANTERIOR FROM DASH_FIN_ACORDO_ITEM WHERE IDACORDO=?",
            [agreement],
          ),
          newItems = items.filter((item) => String(item.PAPEL).trim() === "N"),
          originals = items.filter((item) => String(item.PAPEL).trim() === "O");
        const nested = await tx.singleton(
          `SELECT FIRST 1 t.CONTROLE FROM ${table} t WHERE t.STATUS=6 AND EXISTS (SELECT 1 FROM DASH_FIN_ACORDO_ITEM i WHERE i.IDACORDO=? AND i.PAPEL='N' AND i.CONTROLE=t.CONTROLE AND i.IDEMPRESA=t.IDEMPRESA)`,
          [agreement],
        );
        if (nested)
          throw Object.assign(
            new Error(
              "Este acordo possui parcela usada em outro acordo ativo. Desfaca primeiro o acordo mais recente.",
            ),
            { status: 409 },
          );
        for (const item of newItems)
          await tx.execute(
            `UPDATE ${table} SET STATUS=9,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS IN (1,2)`,
            [item.CONTROLE, item.IDEMPRESA],
          );
        for (const item of originals)
          await tx.execute(
            type === "receber"
              ? "UPDATE CTARECEBER SET STATUS=1,ACORDO=?,DTCOB=NULL,TOTALPG=0,VLPGLIQ=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=6"
              : "UPDATE CTAPAGAR SET STATUS=1,ACORDO=?,DTPAGTO=NULL,VLPAGTO=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=6",
            [item.ACORDO_ANTERIOR, item.CONTROLE, item.IDEMPRESA],
          );
        await tx.execute(
          "UPDATE DASH_FIN_ACORDO SET STATUS='DESFEITO',DESFEITO_EM=CURRENT_TIMESTAMP,DESFEITO_POR=? WHERE IDACORDO=? AND STATUS='ATIVO'",
          [Number(req.dashboardSession?.user?.idusuario || 1), agreement],
        );
        return { agreement, origin: "dashboard" };
      });
    res.json({
      ok: true,
      mensagem: `Acordo nº ${result.agreement} desfeito com sucesso.`,
      acordo_desfeito: true,
      origem: result.origin,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
}
router.post("/operacoes/desfazer-acordo", undoAgreement);
router.post("/operacoes/desfazer-acordo-legado", undoAgreement);
export default router;
