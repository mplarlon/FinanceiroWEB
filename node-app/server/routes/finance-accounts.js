import fs from "node:fs";
import path from "node:path";
import express from "express";
import { dataDir } from "../config.js";
import { query, withDatabase, withWriteTransaction } from "../db.js";
import { buildInstallments } from "../lib/account-parcels.js";

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

export function settlementInput(body = {}) {
  const date = String(body.data_pagamento || "").slice(0, 10);
  const paymentDate = firebirdDate(date);
  const payment = asInt(body.forma_pagamento);
  if (!paymentDate)
    throw Object.assign(new Error("Informe a data da quitacao."), { status: 400 });
  if (!payment)
    throw Object.assign(
      new Error("E necessario informar a forma de pagamento."),
      { status: 400 },
    );
  if (date > new Date().toISOString().slice(0, 10))
    throw Object.assign(
      new Error("A data da baixa nao pode ser posterior ao dia atual."),
      { status: 400 },
    );
  return {
    date,
    paymentDate,
    payment,
    cash: asInt(body.caixa),
    bank: asInt(body.banco),
    account: text(body.conta),
    agency: text(body.agencia),
    discount: Math.round(Number(body.desconto || 0) * 100) / 100,
    gross: Math.round(Number(body.valor_pagamento || 0) * 100) / 100,
    net: Math.round(Number(body.valor_liquido || 0) * 100) / 100,
    history: text(body.historico).slice(0, 255),
  };
}

export function agreementInput(body = {}) {
  const start = String(body.data_inicial || "").slice(0, 10);
  const startDate = firebirdDate(start);
  const payment = asInt(body.forma_pagamento);
  const cash = asInt(body.caixa);
  if (!startDate)
    throw Object.assign(new Error("Informe o primeiro vencimento."), { status: 400 });
  if (!payment)
    throw Object.assign(
      new Error("Forma de pagamento/recebimento deve ser preenchida."),
      { status: 400 },
    );
  if (!cash)
    throw Object.assign(new Error("Caixa deve ser preenchido."), { status: 400 });
  return { start, startDate, payment, cash };
}

export function paymentFormAllowed(form, type, operation) {
  if (!form)
    throw Object.assign(new Error("Forma de pagamento nao encontrada."), { status: 400 });
  const exitFlag = Number(type === "receber" ? form.SAIR_RECEBTO : form.SAIR_PAGTO);
  if (exitFlag !== -1)
    throw Object.assign(
      new Error(
        type === "receber"
          ? "Esta forma de pagamento nao esta liberada para contas a receber."
          : "Esta forma de pagamento nao esta liberada para contas a pagar.",
      ),
      { status: 400 },
    );
  const status = Number(type === "receber" ? form.STATUS : form.STATUS_PAGTO);
  if (operation === "quitar" && status === 3)
    throw Object.assign(new Error("Forma de pagamento e uma devolucao."), { status: 400 });
  return form;
}
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

export function readMachineCode() {
  const fromEnv = text(process.env.DASHBOARD_MAQUINA).replace(/\s/g, "");
  if (fromEnv) return fromEnv;
  const files = [
    path.join(dataDir, "Start.ini"),
    "C:\\Administracao\\Start.ini",
    "D:\\Pontual\\Automec\\Start.ini",
  ];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(/^\s*Maquina\s*=\s*(.*)$/im);
    if (match?.[1].trim()) return match[1].trim().replace(/\s/g, "");
  }
  return "";
}

export function automaticDocumentNumber({
  type,
  count = 0,
  machine = "",
  date = new Date(),
}) {
  const when = date instanceof Date ? date : firebirdDate(date);
  if (!when) throw new Error("Data invalida para o documento.");
  const stamp = [
    String(when.getDate()).padStart(2, "0"),
    String(when.getMonth() + 1).padStart(2, "0"),
    String(when.getFullYear()),
  ].join("");
  const sequence = String(Math.max(0, Number(count) || 0) + 1);
  const limit = type === "receber" ? 15 : 20;
  const prefix = String(machine || "").replace(/\s/g, "");
  const room = Math.max(sequence.length, limit - stamp.length);
  return `${prefix.slice(0, Math.max(0, room - sequence.length))}${sequence}${stamp}`.slice(0, limit);
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
  const document = text(body.documento).slice(0, type === "receber" ? 15 : 20);
  if (!document) throw Object.assign(new Error("Informe o documento."), { status: 400 });
  const roundedAmount = Math.round(amount * 100) / 100;
  const dueIso = text(body.vencimento).slice(0, 10);
  const posted = Array.isArray(body.parcelas) ? body.parcelas : [];
  const quantity = asInt(body.quantidade) || posted.length || 1;
  const equal = !["false", "0", false, 0].includes(body.iguais);
  const spacing = asInt(body.intervalo) ?? 0;
  const fixedDay = [true, "true", 1, "1"].includes(body.dia_fixo);
  let parcels;
  try {
    if (posted.length > 1 || quantity > 1) {
      parcels = buildInstallments({
        total: roundedAmount,
        count: equal ? quantity : posted.length || quantity,
        firstDue: dueIso,
        interval: fixedDay ? 30 : spacing,
        fixedDay,
        custom: equal ? null : posted,
      });
    } else if (posted.length === 1) {
      parcels = buildInstallments({
        total: roundedAmount,
        count: 1,
        firstDue: posted[0].vencimento || dueIso,
        custom: posted,
      });
      parcels[0].parcela = installment;
    } else {
      parcels = [
        {
          parcela: installment,
          vencimento: dueIso,
          valor: roundedAmount,
          intervalo: 0,
        },
      ];
    }
  } catch (error) {
    throw Object.assign(new Error(error.message), { status: 400 });
  }
  const credit = [true, "true", 1, "1"].includes(body.gerar_credito);
  const signedAmount = accountLaunchValue(roundedAmount, type, credit);
  const signedParcels = parcels.map((parcel) => ({
    ...parcel,
    valor: accountLaunchValue(parcel.valor, type, credit),
  }));
  return {
    type,
    company,
    person,
    dueDate,
    amount: signedAmount,
    installment: signedParcels[0].parcela,
    parcels: signedParcels,
    document,
    history: creditHistory(text(body.historico), credit),
    paymentNumber: credit ? null : accountPaymentNumber(body.numero_pagamento),
    payment: credit ? null : asInt(body.forma_pagamento),
    credit,
    cash: credit ? null : asInt(body.caixa),
    costCenter: asInt(body.centro_custo),
    account: asInt(body.conta),
    subaccount: asInt(body.subconta),
    thirdAccount: asInt(body.subsubconta),
    fourthAccount: asInt(body.subsubsubconta),
  };
}

export function calendarDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const key = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

export function overdueDays(due, paidOn) {
  const dueKey = calendarDate(due);
  const paidKey = calendarDate(paidOn);
  if (!dueKey || !paidKey) return 0;
  const dueDate = new Date(`${dueKey}T12:00:00`);
  const paidDate = new Date(`${paidKey}T12:00:00`);
  return Math.max(0, Math.floor((paidDate - dueDate) / 86400000));
}

export function paymentFormSettlesPayable(form) {
  if (!form) return false;
  return Number(form.STATUS) === 2 || Number(form.STATUS_PAGTO) === 2;
}

export function creditHistory(history, credit) {
  const textValue = text(history).slice(0, 255);
  if (!credit || /^cr[eé]dito\b/i.test(textValue)) return textValue;
  return `Crédito ${textValue}`.trim().slice(0, 255);
}

export function accountLaunchValue(amount, type, credit) {
  const value = Math.round(Number(amount) * 100) / 100;
  if (type === "pagar" && credit) return -Math.abs(value);
  return value;
}

export function manualReceivablePlan(form = {}, credit = false) {
  if (credit) return { status: 3, settled: false, credit: true };
  const settled = Number(form.STATUS) === 2;
  return { status: settled ? 2 : 1, settled, credit: false };
}

export function accountPaymentNumber(value) {
  const number = text(value).slice(0, 20);
  return number || null;
}

function editDateKey(value) {
  return calendarDate(value);
}

function editValuesEqual(column, current, next) {
  if (column === "DTVENC") return editDateKey(current) === next;
  if (column === "VALOR")
    return Math.round(Number(current || 0) * 100) === Math.round(Number(next || 0) * 100);
  if (["PARCELA", "CODPAGTO", "TPPAGTO", "CAIXA", "CDCAIXA", "CCUSTO", "CDFORNECEDOR"].includes(column))
    return (asInt(current) ?? null) === (asInt(next) ?? null);
  return text(current) === text(next);
}

export function accountEditPlan(type, current = {}, body = {}) {
  if (!["receber", "pagar"].includes(type))
    throw Object.assign(new Error("Selecione contas a receber ou contas a pagar."), { status: 400 });
  if (Number(current.STATUS) !== 1)
    throw Object.assign(new Error("Somente conta em aberto pode ser alterada."), { status: 409 });
  const receive = type === "receber";
  const accountCode = (value, limit) => {
    const code = text(value).slice(0, limit);
    return code || null;
  };
  const next = {
    NRDOC: text(body.documento).slice(0, receive ? 15 : 20),
    PARCELA: asInt(body.parcela),
    DTVENC: text(body.vencimento).slice(0, 10),
    VALOR: Math.round(Number(body.valor) * 100) / 100,
    HISTORICO: text(body.historico).slice(0, 255),
    CODPAGTO: asInt(body.forma_pagamento),
    [receive ? "CAIXA" : "CDCAIXA"]: asInt(body.caixa),
    CCUSTO: asInt(body.centro_custo),
    CDCONTA: accountCode(body.conta, 3),
    CDSUBCONTA: accountCode(body.subconta, receive ? 3 : 5),
    CDSUBSUBCONTA: accountCode(body.subsubconta, receive ? 3 : 5),
    CDSUBSUBSUBCONTA: accountCode(body.subsubsubconta, receive ? 3 : 7),
  };
  if (!receive) {
    next.NOTAFISCAL = text(body.nota).slice(0, 20);
    next.CDFORNECEDOR = asInt(body.pessoa_id);
  }
  if (!next.NRDOC) throw Object.assign(new Error("Informe o documento."), { status: 400 });
  if (!next.PARCELA || next.PARCELA > 999)
    throw Object.assign(new Error("Informe uma parcela valida."), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.DTVENC))
    throw Object.assign(new Error("Informe um vencimento valido."), { status: 400 });
  if (!Number.isFinite(next.VALOR) || next.VALOR <= 0)
    throw Object.assign(new Error("Informe um valor maior que zero."), { status: 400 });
  if (!receive && !next.CDFORNECEDOR)
    throw Object.assign(new Error("Selecione o fornecedor."), { status: 400 });
  const values = {};
  const changes = [];
  for (const [column, value] of Object.entries(next)) {
    if (editValuesEqual(column, current[column], value)) continue;
    changes.push(column);
    values[column] = column === "DTVENC" ? firebirdDate(value) : value;
  }
  if (changes.includes("CODPAGTO") && !editValuesEqual("TPPAGTO", current.TPPAGTO, next.CODPAGTO)) {
    changes.push("TPPAGTO");
    values.TPPAGTO = next.CODPAGTO;
  }
  return {
    changes,
    values,
    message: changes.length ? `${changes.join(";")};`.slice(0, 80) : "",
  };
}

async function historyMenuItem(tx, type) {
  const names = type === "receber"
    ? ["TCadCtaReceberCGASPARList", "TCadCtaReceberList"]
    : ["TCadContasPagarList"];
  const row = await tx.singleton(
    `SELECT FIRST 1 IDMENUITEM FROM SIS_MAINMENU WHERE CLASSNAME IN (${names.map(() => "?").join(",")})`,
    names,
  );
  return Number(row?.IDMENUITEM || 0);
}

function historyClock(date = new Date()) {
  const day = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  return { day, time };
}

export function cashMovementSubject(name, action, document) {
  const suffix = ` ${action} ${text(document)}`.slice(0, 70);
  const room = Math.max(0, 100 - suffix.length);
  return `${text(name).slice(0, room)}${suffix}`.trim().slice(0, 100);
}

export function agreementRealizationHistory(id, day) {
  return `Acordo nº ${id} realizado em: ${day}`.slice(0, 80);
}

export function agreementUndoHistory(day) {
  return `Acordo desfeito em: ${day}`.slice(0, 80);
}

async function recordAccountHistory(tx, type, control, company, kind, message, userId) {
  const contexto = `CONTROLE=${control};IDEMPRESA=${company};`.slice(0, 50);
  await tx.execute(
    "INSERT INTO SIS_APPHISTORY (IDMENUITEM,TIPO,CONTEXTO,MENSAGEM,IDUSUARIO,DATA_HORA,SIST_ALT) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
    [await historyMenuItem(tx, type), kind, contexto, text(message).slice(0, 80), userId || null],
  );
}

async function nextCashControl(tx) {
  try {
    const row = await tx.singleton(
      "SELECT NEXT VALUE FOR GEN_CTARECEBERCAIXA AS ID FROM RDB$DATABASE",
    );
    const value = Number(row?.ID);
    if (value > 0) {
      const duplicate = await tx.singleton(
        "SELECT FIRST 1 1 AS OK FROM CTARECEBERCAIXA WHERE CONTROLE=?",
        [value],
      );
      if (!duplicate) return value;
    }
  } catch {
    // Alguns bancos nao possuem o generator do caixa.
  }
  return Number(
    (await tx.singleton("SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM CTARECEBERCAIXA")).ID,
  );
}

async function existingBank(tx, bank) {
  const id = asInt(bank);
  if (!id) return null;
  const row = await tx.singleton("SELECT FIRST 1 1 AS OK FROM BANCO WHERE CDBANCO=?", [id]);
  return row ? id : null;
}

async function postReceivableCash(tx, entry) {
  if (!entry.cash) return;
  const paid = Math.round(Number(entry.paid) * 100) / 100;
  const amount = Math.round(Number(entry.amount) * 100) / 100;
  if (!Number.isFinite(paid) || !Number.isFinite(amount))
    throw Object.assign(new Error("Valor do caixa invalido."), { status: 400 });
  const control = await nextCashControl(tx);
  const bank = await existingBank(tx, entry.bank);
  await tx.execute(
    "INSERT INTO CTARECEBERCAIXA (CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,ORIGEM,DIVIDA,TOTALPG,DTCOB,CDBANCO,CAIXA,JUROS,CODPAGTO,DESCONTO,RETENCAO,NRPEDIDO,DTMOV,LANCAMENTO,TPPAGTO,STATUS,CDUSR,DTLOG,HORALOG,CDRECGRUPO,NRDOC2,ACORDO,SIST_ALT,HISTORICO,CANCELADO,CDCAIXAORIGEM,CDUSR_CAIXA,CDVEND) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,2,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,?,'LOCAL',?,?,?,?,?)",
    [
      control,
      entry.company,
      entry.document,
      entry.installment,
      entry.person,
      entry.due,
      amount,
      text(entry.origin || "RECBTO").slice(0, 20),
      entry.debt ?? amount,
      paid,
      entry.when,
      bank,
      entry.cash,
      Number(entry.interest || 0),
      entry.payment,
      Number(entry.discount || 0),
      Number(entry.retention || 0),
      entry.order || null,
      entry.when,
      entry.launch || null,
      entry.payment,
      entry.user,
      entry.group || null,
      entry.document2 || null,
      entry.agreement || 0,
      text(entry.history).slice(0, 255),
      entry.cancelled ? -1 : 0,
      entry.cash,
      entry.user,
      entry.seller || null,
    ],
  );
}

async function cancelReceivableCash(tx, launch, company, userId) {
  const rows = await tx.query(
    "SELECT CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,DIVIDA,TOTALPG,DTCOB,CDBANCO,CAIXA,JUROS,CODPAGTO,DESCONTO,RETENCAO,NRPEDIDO,DTMOV,TPPAGTO,CDRECGRUPO,NRDOC2,ACORDO,CDVEND,HISTORICO,CDUSR FROM CTARECEBERCAIXA WHERE LANCAMENTO=? AND IDEMPRESA=? AND COALESCE(CANCELADO,0)=0",
    [launch, company],
  );
  for (const row of rows) {
    await tx.execute(
      "UPDATE CTARECEBERCAIXA SET CANCELADO=-1,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=?",
      [row.CONTROLE, row.IDEMPRESA],
    );
    const paid = Math.round(Number(row.TOTALPG || 0) * 100) / 100;
    await postReceivableCash(tx, {
      company: row.IDEMPRESA,
      document: row.NRDOC,
      installment: row.PARCELA,
      person: row.CDCLIENTE,
      due: row.DTVENC,
      amount: -Math.round(Number(row.VALOR || paid) * 100) / 100,
      debt: row.DIVIDA,
      paid: -paid,
      when: row.DTCOB || row.DTMOV,
      bank: row.CDBANCO,
      cash: row.CAIXA,
      interest: row.JUROS,
      payment: row.TPPAGTO || row.CODPAGTO,
      discount: row.DESCONTO,
      retention: row.RETENCAO,
      order: row.NRPEDIDO,
      launch,
      user: userId || row.CDUSR || 1,
      group: row.CDRECGRUPO,
      document2: row.NRDOC2,
      agreement: row.ACORDO,
      history: "Cancelamento de recebimento",
      seller: row.CDVEND,
      origin: "RECBTO Cancelado",
      cancelled: true,
    });
  }
}

async function postPayableCash(tx, { company, cash, subject, amount, when, payment }) {
  if (!cash) return;
  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value))
    throw Object.assign(new Error("Valor do caixa invalido."), { status: 400 });
  await tx.execute(
    "INSERT INTO MOV_PAGTO (IDEMPRESA,CDCAIXA,ASSUNTO,VALOR,DT_MOV,SIST_ALT,CDRECEBTO,HORALOG) VALUES (?,?,?,?,?,'LOCAL',?,CURRENT_TIMESTAMP)",
    [company, cash, text(subject).slice(0, 100), value, when, payment],
  );
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
  const rows = await tx.query(
    "SELECT FIRST 1 CDGRUPO,CCUSTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,COALESCE(STATUS,0) AS STATUS,COALESCE(STATUS_PAGTO,0) AS STATUS_PAGTO FROM RECEBTO WHERE CDRECEBTO=?",
    [input.payment],
  );
  return rows[0] || {};
}

export function completeAccountInput(input, paymentDefaults = {}) {
  const pick = (provided, fallback) => provided ?? fallback ?? null;
  return {
    ...input,
    cash: input.credit ? null : input.cash ?? 1,
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
    if (vale === "somente_vales") where.push("t.STATUSVALE IN (1,2)");
    else if (vale === "vale_emitido") where.push("t.STATUSVALE=1");
    else if (vale === "vale_confirmado") where.push("t.STATUSVALE=2");
    else if (vale === "vales_gerados")
      where.push("t.STATUSVALE IN (1,2) AND t.EHFUNCIONARIO=0");
    else if (vale === "vales_funcionarios")
      where.push("t.STATUSVALE IN (1,2) AND t.EHFUNCIONARIO=-1");
    else if (vale !== "todos")
      where.push("COALESCE(t.STATUSVALE,0) NOT IN (1,2)");
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
      `SELECT FIRST 500 t.CONTROLE,t.IDEMPRESA,${personId} AS PESSOA_ID,${person} AS PESSOA,${doc} AS DOCUMENTO,t.PARCELA,CAST(t.DTVENC AS DATE) AS VENCIMENTO,CASE WHEN ${paidAt} IS NULL OR ${paidAt}<=CAST('1899-12-30' AS DATE) THEN NULL ELSE CAST(${paidAt} AS DATE) END AS DATA_BAIXA,${shown} AS VALOR,${paid} AS VALOR_PAGO,COALESCE(t.RETENCAO,0) AS RETENCAO,(${shown}-${paid}) AS SALDO,${receive ? "t.CAIXA" : "t.CDCAIXA"} AS CAIXA,t.STATUS,CASE WHEN t.STATUS=1 AND t.DTVENC<CURRENT_DATE THEN 'Vencido' WHEN t.STATUS=1 THEN 'Aberto' WHEN t.STATUS=2 THEN 'Quitado' WHEN t.STATUS=3 THEN 'Devolucao' WHEN t.STATUS=4 THEN 'Cancelado' WHEN t.STATUS=5 THEN 'Transferencia' WHEN t.STATUS=6 THEN 'Acordo' WHEN t.STATUS=7 THEN 'Acordo em nota fiscal' WHEN t.STATUS=8 THEN 'Acordo no recebimento' WHEN t.STATUS=9 THEN 'Excluido' ELSE 'Status '||CAST(t.STATUS AS VARCHAR(10)) END AS STATUS_TITULO,DATEDIFF(DAY,t.DTVENC,CURRENT_DATE) AS DIAS_ATRASO,t.ACORDO FROM ${table} t ${personJoin} WHERE ${where.join(" AND ")} ORDER BY ${order}`,
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

let receivableNanRepairTried = false;
async function repairReceivableNanAmounts() {
  if (receivableNanRepairTried) return;
  receivableNanRepairTried = true;
  try {
    await withWriteTransaction((tx) =>
      tx.execute(
        "UPDATE CTARECEBER SET TOTALPG=COALESCE(VALOR,0)+COALESCE(JUROS,0)-COALESCE(DESCONTO,0),VLPGLIQ=COALESCE(VALOR,0)+COALESCE(JUROS,0)-COALESCE(DESCONTO,0)-COALESCE(RETENCAO,0) WHERE STATUS=2 AND (TOTALPG<>TOTALPG OR VLPGLIQ<>VLPGLIQ)",
      ),
    );
  } catch {
    // A correção dos valores já gravados como NaN volta na próxima subida do serviço.
  }
}

let payableNanRepairTried = false;
async function repairPayableNanAmounts() {
  if (payableNanRepairTried) return;
  payableNanRepairTried = true;
  try {
    await withWriteTransaction((tx) =>
      tx.execute(
        "UPDATE CTAPAGAR SET VLPAGTO=COALESCE(VALOR,0)+COALESCE(JUROS,0)-COALESCE(DESCONTO,0) WHERE STATUS=2 AND VLPAGTO<>VLPAGTO",
      ),
    );
  } catch {
    // A correção dos valores já gravados como NaN volta na próxima subida do serviço.
  }
}

const endpoint = (type) => async (req, res) => {
  try {
    if (type === "receber") await repairReceivableNanAmounts();
    if (type === "pagar") await repairPayableNanAmounts();
    res.json(await withDatabase((db) => accounts(db, type, req.query)));
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
};
router.get("/contas-receber", endpoint("receber"));
router.get("/contas-pagar", endpoint("pagar"));

export function includeAccountProducts(tipo, query = {}) {
  if (String(tipo || "").toLowerCase() !== "receber") return true;
  return ["1", "true", "sim"].includes(String(query.produtos ?? "").trim().toLowerCase());
}

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
              `SELECT FIRST 1 t.CONTROLE,t.IDEMPRESA,t.NRPEDIDO,t.NRDOC,t.NRDOC2,t.PARCELA,t.CDCLIENTE AS PESSOA_ID,COALESCE(c.CLIENTE,c.RAZAO) AS PESSOA,t.DTVENC,t.DTMOV,t.DTCOB AS DATA_BAIXA,t.VALOR,t.DIVIDA,t.TOTALPG,t.VLPGLIQ,t.JUROS,t.DESCONTO,t.RETENCAO,t.STATUS,t.ORIGEM,t.HISTORICO,t.CAIXA,t.CODPAGTO,t.TPPAGTO,t.CCUSTO,t.CDCONTA,t.CDSUBCONTA,t.CDSUBSUBCONTA,t.CDSUBSUBSUBCONTA,t.CDBANCO,t.AGENCIA,t.NUMCONTA,COALESCE(rq.RECEBTO,'') AS FORMA_QUITACAO,COALESCE(rp.RECEBTO,'') AS FORMA_PREVISTA,COALESCE(rq.RECEBTO,rp.RECEBTO,'Não informada') AS FORMA_PAGAMENTO FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE LEFT JOIN RECEBTO rq ON rq.CDRECEBTO=NULLIF(t.TPPAGTO,0) LEFT JOIN RECEBTO rp ON rp.CDRECEBTO=NULLIF(t.CODPAGTO,0) WHERE t.CONTROLE=? AND t.IDEMPRESA=?`,
              [controle, empresa],
            )
          )[0]
        : (
            await query(
              db,
              `SELECT FIRST 1 t.CONTROLE,t.IDEMPRESA,t.NOTAFISCAL,t.NRDOC,t.NRDOC2,t.CHAVE,t.PARCELA,t.CDFORNECEDOR AS PESSOA_ID,f.FORNECEDOR AS PESSOA,t.DTVENC,t.DTINCLUSAO AS DTMOV,t.DTPAGTO AS DATA_BAIXA,t.VALOR,t.TOTAL,t.VLPAGTO,t.JUROS,t.DESCONTO,t.RETENCAO,t.STATUS,t.ORIGEM,t.HISTORICO,t.CDCAIXA AS CAIXA,t.CODPAGTO,t.TPPAGTO,t.CCUSTO,t.CDCONTA,t.CDSUBCONTA,t.CDSUBSUBCONTA,t.CDSUBSUBSUBCONTA,t.CDBANCO,t.AGENCIA,t.NUMCONTA,COALESCE(r.RECEBTO,'Não informada') AS FORMA_PAGAMENTO FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(t.TPPAGTO,t.CODPAGTO) WHERE t.CONTROLE=? AND t.IDEMPRESA=?`,
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
        if (includeAccountProducts(tipo, req.query))
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
      const historico = await query(
        db,
        "SELECT FIRST 40 sa.DATA_HORA,sa.TIPO,sa.MENSAGEM,COALESCE(u.NOMECOMPLETO,u.LOGIN) AS USUARIO FROM SIS_APPHISTORY sa LEFT JOIN USUARIOS u ON u.IDUSUARIO=sa.IDUSUARIO WHERE sa.CONTEXTO CONTAINING ? AND sa.CONTEXTO CONTAINING ? ORDER BY sa.DATA_HORA DESC",
        [`CONTROLE=${controle};`, `IDEMPRESA=${empresa};`],
      );
      return { ok: true, tipo, titulo, pedido, entrada, itens, historico };
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
// Comparar o parâmetro com '' faz o Firebird fixar o tamanho em zero e
// recusar qualquer nome. UPPER/COALESCE com literal também mistura o charset
// da conexão com o cadastro legado e aborta a busca com "Malformed string".
export function personSearch(type, rawTerm) {
  const kind = text(type).toLowerCase();
  const term = text(rawTerm).slice(0, 60).toUpperCase();
  if (kind === "receber")
    return {
      sql: `SELECT FIRST 40 CDCLIENTE AS ID, COALESCE(CLIENTE,RAZAO) AS NOME
        FROM CLIENTE
        WHERE COALESCE(INATIVO,0)=0
          AND (CLIENTE CONTAINING ? OR RAZAO CONTAINING ? OR CAST(CDCLIENTE AS VARCHAR(20)) CONTAINING ?)
        ORDER BY CASE WHEN CLIENTE STARTING WITH ? OR RAZAO STARTING WITH ? THEN 0 ELSE 1 END, CLIENTE`,
      params: [term, term, term, term, term],
    };
  if (kind === "pagar")
    return {
      sql: `SELECT FIRST 40 CDFORNECEDOR AS ID, COALESCE(FORNECEDOR,FANTASIA) AS NOME
        FROM FORNECEDOR
        WHERE COALESCE(INATIVO,0)=0
          AND (FORNECEDOR CONTAINING ? OR FANTASIA CONTAINING ? OR CAST(CDFORNECEDOR AS VARCHAR(20)) CONTAINING ?)
        ORDER BY CASE WHEN FORNECEDOR STARTING WITH ? OR FANTASIA STARTING WITH ? THEN 0 ELSE 1 END, FORNECEDOR`,
      params: [term, term, term, term, term],
    };
  throw Object.assign(new Error("Tipo financeiro invalido."), { status: 400 });
}

router.get("/operacoes/pessoas", async (req, res) => {
  try {
    const search = personSearch(req.query.tipo, req.query.q);
    const pessoas = await withDatabase((db) => query(db, search.sql, search.params));
    res.json({ ok: true, pessoas });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.get("/operacoes/opcoes", async (_req, res) => {
  try {
    const result = await withDatabase(async (db) => {
      const walletRows = await query(db,"SELECT FIRST 1 CDRECEBTO,RECEBTO,CDGRUPO,CCUSTO FROM RECEBTO WHERE UPPER(TRIM(RECEBTO)) CONTAINING 'CARTEIRA' ORDER BY CASE WHEN UPPER(TRIM(RECEBTO))='CARTEIRA' THEN 0 ELSE 1 END,CDRECEBTO");
      const formas = await query(db,"SELECT CDRECEBTO,RECEBTO,COALESCE(DESCONTO,0) AS TAXA_RETENCAO,COALESCE(STATUS,0) AS STATUS,COALESCE(STATUS_PAGTO,0) AS STATUS_PAGTO,COALESCE(SAIR_RECEBTO,0) AS SAIR_RECEBTO,COALESCE(SAIR_PAGTO,0) AS SAIR_PAGTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY RECEBTO");
      const formas_pagar = await query(db,"SELECT CDPAGTO,PAGTO,CDGRUPO FROM PAGTO WHERE COALESCE(INATIVO,0)=0 ORDER BY PAGTO");
      const bancos = await query(db,"SELECT CDBANCO,BANCO FROM BANCO ORDER BY BANCO");
      const contas_bancarias = await query(db,"SELECT cc.CDBANCO,b.BANCO,cc.AGENCIA,cc.NUMCONTA FROM CONTACORRENTE cc JOIN BANCO b ON b.CDBANCO=cc.CDBANCO ORDER BY b.BANCO,cc.AGENCIA,cc.NUMCONTA");
      const caixas = await query(db,"SELECT CDCAIXA,CAIXA FROM TPCAIXA WHERE COALESCE(INATIVO,0)=0 ORDER BY CAIXA,CDCAIXA");
      const taxas_juros = await query(db,"SELECT IDEMPRESA,COALESCE(TXJUROS,0) AS TXJUROS FROM CONFIGURACAO");
      const contas = await query(db,"SELECT CDCONTA,CONTA FROM CONTAS ORDER BY CONTA");
      const subcontas = await query(db,"SELECT CDCONTA,CDSUBCONTA,SUBCONTA FROM SUBCONTAS ORDER BY SUBCONTA");
      const subsubcontas = await query(db,"SELECT CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,SUBSUBCONTA FROM SUBSUBCONTAS ORDER BY SUBSUBCONTA");
      const subsubsubcontas = await query(db,"SELECT CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,SUBSUBSUBCONTA FROM SUBSUBSUBCONTAS ORDER BY SUBSUBSUBCONTA");
      const empresas = await query(db,"SELECT IDEMPRESA,NOMEEMPRESA FROM CONFIGURACAO ORDER BY NOMEEMPRESA");
      const clientes = [];
      const fornecedores = [];
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

router.get("/operacoes/proximo-documento", async (req, res) => {
  try {
    const type = text(req.query.tipo).toLowerCase();
    if (!["receber", "pagar"].includes(type))
      throw Object.assign(new Error("Selecione contas a receber ou contas a pagar."), { status: 400 });
    const documento = await withDatabase(async (db) => {
      const table = type === "receber" ? "CTARECEBER" : "CTAPAGAR";
      const column = type === "receber" ? "DTMOV" : "DTINCLUSAO";
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const rows = await query(
        db,
        `SELECT COUNT(*) AS TOTAL FROM ${table} WHERE ${column}>=? AND ${column}<?`,
        [start, end],
      );
      return automaticDocumentNumber({
        type,
        count: Number(rows[0]?.TOTAL ?? rows[0]?.total ?? 0),
        machine: readMachineCode(),
        date: start,
      });
    });
    res.json({ ok: true, documento });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/operacoes/alterar", async (req, res) => {
  try {
    const type = text(req.body?.tipo).toLowerCase();
    const controle = asInt(req.body?.controle);
    const empresa = asInt(req.body?.idempresa);
    if (!["receber", "pagar"].includes(type) || controle === null || empresa === null)
      throw Object.assign(new Error("Título inválido."), { status: 400 });
    const user = Number(req.dashboardSession?.user?.idusuario || 0) || null;
    const result = await withWriteTransaction(async (tx) => {
      const table = type === "receber" ? "CTARECEBER" : "CTAPAGAR";
      const cash = type === "receber" ? "t.CAIXA" : "t.CDCAIXA";
      const current = await tx.singleton(
        `SELECT FIRST 1 t.STATUS,t.NRDOC,t.PARCELA,t.DTVENC,t.VALOR,t.HISTORICO,t.CODPAGTO,t.TPPAGTO,${cash},t.CCUSTO,t.CDCONTA,t.CDSUBCONTA,t.CDSUBSUBCONTA,t.CDSUBSUBSUBCONTA${type === "pagar" ? ",t.NOTAFISCAL,t.CDFORNECEDOR" : ""} FROM ${table} t WHERE t.CONTROLE=? AND t.IDEMPRESA=?`,
        [controle, empresa],
      );
      if (!current) throw Object.assign(new Error("Título não encontrado."), { status: 404 });
      const plan = accountEditPlan(type, current, req.body || {});
      if (!plan.changes.length)
        return { ok: true, alterado: false, mensagem: "Nenhum dado foi alterado." };
      const assignments = Object.keys(plan.values).map((column) => `${column}=?`);
      assignments.push("SIST_ALT='LOCAL'");
      await tx.execute(
        `UPDATE ${table} SET ${assignments.join(",")} WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1`,
        [...Object.values(plan.values), controle, empresa],
      );
      const contexto = `CONTROLE=${controle};IDEMPRESA=${empresa};`.slice(0, 50);
      await tx.execute(
        "INSERT INTO SIS_APPHISTORY (IDMENUITEM,TIPO,CONTEXTO,MENSAGEM,IDUSUARIO,DATA_HORA,SIST_ALT) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
        [await historyMenuItem(tx, type), 2, contexto, plan.message, user],
      );
      return {
        ok: true,
        alterado: true,
        mensagem: "Conta alterada. O histórico da alteração foi gravado.",
        campos: plan.changes,
      };
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

export const manualReceivableInsert =
  "INSERT INTO CTARECEBER (CONTROLE,IDEMPRESA,NRDOC,PARCELA,CDCLIENTE,DTVENC,VALOR,INTERVALO,ORIGEM,DIVIDA,TOTALPG,DTCOB,CAIXA,CODPAGTO,DTMOV,TPPAGTO,STATUS,CDUSR,DTLOG,HORALOG,CDRECGRUPO,NRDOC2,ACORDO,DTALTER,SIST_ALT,CDCAIXAORIGEM,HISTORICO,VLPGLIQ,CCUSTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,JUROS,DESCONTO,RETENCAO,AVISOS) VALUES (?,?,?,?,?,?,?,?,'LANCAMENTO MANUAL',?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,0,CURRENT_TIMESTAMP,'LOCAL',?,?,?,?,?,?,?,?,0,0,0,0)";
export const manualPayableInsert =
  "INSERT INTO CTAPAGAR (CONTROLE,IDEMPRESA,NOTAFISCAL,NUMERO,CDFORNECEDOR,PARCELA,INTERVALO,STATUS,CDCAIXA,CCUSTO,CODPAGTO,TPPAGTO,NRDOC,NRDOC2,DTVENC,DTPAGTO,DTINCLUSAO,DTLOG,HORALOG,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,HISTORICO,VALOR,TOTAL,VLPAGTO,JUROS,DESCONTO,RETENCAO,ACORDO,COMBOLETO,IDUSUARIO,SIST_ALT,ORIGEM,COMPETENCIA) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?,?,?,?,?,?,?,?,0,0,0,0,0,?,'LOCAL','LANCAMENTO MANUAL',?)";

router.post("/operacoes/criar", async (req, res) => {
  try {
    let input = newAccountInput(req.body || {});
    const user = Number(req.dashboardSession?.user?.idusuario || 1);
    const result = await withWriteTransaction(async (tx) => {
      const table = input.type === "receber" ? "CTARECEBER" : "CTAPAGAR";
      const defaults = await accountPaymentDefaults(tx, input);
      input = completeAccountInput(input, defaults);
      const receivePlan = manualReceivablePlan(defaults, input.credit);
      const settled = input.credit
        ? false
        : input.type === "pagar"
          ? paymentFormSettlesPayable(defaults)
          : receivePlan.settled;
      if (settled && !input.cash)
        throw Object.assign(new Error("Forma de pagamento quitada exige um caixa."), { status: 400 });
      const paidOn = new Date();
      paidOn.setHours(12, 0, 0, 0);
      const personName = input.type === "pagar"
        ? text((await tx.singleton("SELECT FORNECEDOR AS NOME FROM FORNECEDOR WHERE CDFORNECEDOR=?", [input.person]))?.NOME)
        : "";
      const controls = [];
      const clock = historyClock();
      for (const parcel of input.parcels) {
        const control = await nextAccountControl(tx, table);
        const due = firebirdDate(parcel.vencimento);
        controls.push(control);
        if (input.type === "receber") {
          const status = receivePlan.status;
          const paid = settled ? parcel.valor : 0;
          const paidAt = settled ? paidOn : null;
          const quitPayment = settled ? input.payment : null;
          await tx.execute(
            manualReceivableInsert,
            [control,input.company,input.document,parcel.parcela,input.person,due,parcel.valor,parcel.intervalo,input.amount,paid,paidAt,input.cash,input.payment,quitPayment,status,user,input.receiptGroup,input.document,input.cash,input.history,paid,input.costCenter,input.account,input.subaccount,input.thirdAccount,input.fourthAccount],
          );
          if (settled)
            await postReceivableCash(tx, {
              company: input.company,
              document: input.document,
              installment: parcel.parcela,
              person: input.person,
              due,
              amount: paid,
              debt: input.amount,
              paid,
              when: paidOn,
              cash: input.cash,
              payment: input.payment,
              launch: control,
              user,
              group: input.receiptGroup,
              document2: input.document,
              history: input.history || `Recebimento ${input.document}`,
            });
          await recordAccountHistory(
            tx,
            "receber",
            control,
            input.company,
            settled ? 6 : 1,
            input.credit
              ? `Crédito gerado em: ${clock.day}`
              : settled
                ? `Baixa Realizada em: ${clock.day};hora=${clock.time}`
                : `Inclusão em: ${clock.day}`,
            user,
          );
        } else {
          const status = settled ? 2 : 1;
          const paidAt = settled ? due : null;
          const paidValue = settled ? parcel.valor : 0;
          await tx.execute(
            manualPayableInsert,
            [control,input.company,input.document,input.document.slice(0,10),input.person,parcel.parcela,parcel.intervalo,status,input.cash,input.costCenter,input.payment,input.payment,input.document,input.paymentNumber,due,paidAt,input.account,input.subaccount,input.thirdAccount,input.fourthAccount,input.history,parcel.valor,input.amount,paidValue,user,due],
          );
          if (settled) {
            await postPayableCash(tx, {
              company: input.company,
              cash: input.cash,
              subject: cashMovementSubject(personName, "BAIXA DA CONTA Nº", input.document),
              amount: -paidValue,
              when: due,
              payment: input.payment,
            });
            await recordAccountHistory(
              tx,
              "pagar",
              control,
              input.company,
              6,
              `Baixa Realizada em: ${clock.day};hora=${clock.time}`,
              user,
            );
          } else if (input.credit) {
            await recordAccountHistory(
              tx,
              "pagar",
              control,
              input.company,
              1,
              `Crédito gerado em: ${clock.day}`,
              user,
            );
          }
        }
      }
      return {
        controle: controls[0],
        controles: controls,
        parcelas: input.parcels.length,
        idempresa: input.company,
        tipo: input.type,
        vencimento: input.parcels[0].vencimento,
        vencimento_final: input.parcels.at(-1).vencimento,
      };
    });
    const created =
      result.parcelas > 1
        ? `Conta a ${result.tipo} criada com ${result.parcelas} parcelas.`
        : `Conta a ${result.tipo} criada com sucesso.`;
    res.status(201).json({ ok: true, mensagem: created, ...result });
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
      { start, startDate, payment, cash } = agreementInput(body),
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
      let form = paymentFormAllowed(
        await tx.singleton(
          "SELECT CDRECEBTO AS CODPAGTO,CDGRUPO,CCUSTO,COALESCE(STATUS,0) AS STATUS,COALESCE(STATUS_PAGTO,0) AS STATUS_PAGTO,COALESCE(SAIR_RECEBTO,0) AS SAIR_RECEBTO,COALESCE(SAIR_PAGTO,0) AS SAIR_PAGTO FROM RECEBTO WHERE CDRECEBTO=? AND COALESCE(INATIVO,0)=0",
          [payment],
        ),
        type,
        "acordo",
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
      const clock = historyClock();
      const realization = agreementRealizationHistory(id, clock.day);
      for (let i = 0; i < refs.length; i++) {
        await tx.execute(agreementStatusSql(type), [id, startDate, ...refs[i]]);
        await tx.execute(
          "INSERT INTO DASH_FIN_ACORDO_ITEM (IDACORDO,PAPEL,CONTROLE,IDEMPRESA,STATUS_ANTERIOR,ACORDO_ANTERIOR) VALUES (?,'O',?,?,1,?)",
          [id, ...refs[i], rows[i].ACORDO],
        );
        await recordAccountHistory(tx, type, refs[i][0], refs[i][1], 2, realization, uid);
      }
      let firstDueDate = null;
      let lastDueDate = null;
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
        const dueDate = due.toISOString().slice(0, 10);
        firstDueDate ||= dueDate;
        lastDueDate = dueDate;
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
            ...(type === "receber" ? { CAIXA: cash } : { CDCAIXA: cash }),
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
        await recordAccountHistory(tx, type, control, model[1], 1, history, uid);
      }
      return {
        id,
        firstDueDate,
        lastDueDate,
      };
    });
    res.json({
      ok: true,
      acordo: agreement.id,
      vencimento_inicial: agreement.firstDueDate,
      vencimento_final: agreement.lastDueDate,
      mensagem: `Acordo nº ${agreement.id} criado com ${count} parcela(s).`,
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
        const payableCash = [];
        const userId = Number(req.dashboardSession?.user?.idusuario || 0) || null;
        const clock = historyClock();
        for (const ref of refs) {
          const row = await tx.singleton(
            type === "pagar"
              ? `SELECT t.STATUS,t.MOV_BANCARIA,COALESCE(t.NRDOC,t.NOTAFISCAL,'') AS NRDOC,(SELECT COALESCE(f.FORNECEDOR,'') FROM FORNECEDOR f WHERE f.CDFORNECEDOR=t.CDFORNECEDOR) AS PESSOA_NOME FROM ${table} t WHERE t.CONTROLE=? AND t.IDEMPRESA=?`
              : `SELECT STATUS,MOV_BANCARIA FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
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
          if (type === "pagar")
            payableCash.push({
              controle: ref[0],
              empresa: ref[1],
              assunto: cashMovementSubject(row.PESSOA_NOME, "BAIXA DA CONTA Nº", row.NRDOC),
              nome: row.PESSOA_NOME,
              nrdoc: row.NRDOC,
            });
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
            await cancelReceivableCash(tx, ref[0], ref[1], userId);
          await recordAccountHistory(
            tx,
            type,
            ref[0],
            ref[1],
            7,
            `Baixa cancelada em: ${clock.day}`,
            userId,
          );
        }
        for (const item of payableCash) {
          const found = await tx.singleton(
            "SELECT FIRST 1 IDEMPRESA,CDCAIXA,CDRECEBTO,VALOR,DT_MOV FROM MOV_PAGTO WHERE ASSUNTO=? ORDER BY IDMOVCAIXA DESC",
            [item.assunto],
          );
          if (!found) continue;
          await postPayableCash(tx, {
            company: found.IDEMPRESA,
            cash: found.CDCAIXA,
            subject: cashMovementSubject(item.nome, "CANCELAMENTO - BAIXA DA CONTA Nº", item.nrdoc),
            amount: Math.round(Number(found.VALOR) * -100) / 100,
            when: found.DT_MOV,
            payment: found.CDRECEBTO,
          });
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
      {
        date,
        paymentDate,
        payment,
        cash,
        bank,
        account,
        agency,
        discount,
        gross,
        net,
        history,
      } = settlementInput(body);
    const result = await withWriteTransaction(async (tx) => {
      if (
        cash &&
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
        document =
          type === "receber"
            ? "COALESCE(NRDOC,'')"
            : "COALESCE(NRDOC,NOTAFISCAL,'')",
        personName =
          type === "receber"
            ? "(SELECT COALESCE(CLIENTE,RAZAO,'') FROM CLIENTE p WHERE p.CDCLIENTE=CTARECEBER.CDCLIENTE)"
            : "(SELECT COALESCE(FORNECEDOR,'') FROM FORNECEDOR p WHERE p.CDFORNECEDOR=CTAPAGAR.CDFORNECEDOR)",
        rows = [];
      for (const ref of refs) {
        const row = await tx.singleton(
          `SELECT CONTROLE,IDEMPRESA,${person} AS PESSOA,STATUS,${value} AS VALOR,ACORDO,DTVENC,COALESCE(RETENCAO,0) AS RETENCAO,${document} AS NRDOC,${personName} AS PESSOA_NOME,${type === "receber" ? "CAIXA" : "CDCAIXA"} AS CAIXA_TITULO FROM ${table} WHERE CONTROLE=? AND IDEMPRESA=?`,
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
      const form = paymentFormAllowed(
        await tx.singleton(
          "SELECT COALESCE(DESCONTO,0) AS TAXA,COALESCE(TPRECEBTO,CDRECEBTO) AS TIPO,CDGRUPO,CCUSTO,CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,COALESCE(STATUS,0) AS STATUS,COALESCE(STATUS_PAGTO,0) AS STATUS_PAGTO,COALESCE(SAIR_RECEBTO,0) AS SAIR_RECEBTO,COALESCE(SAIR_PAGTO,0) AS SAIR_PAGTO FROM RECEBTO WHERE CDRECEBTO=? AND COALESCE(INATIVO,0)=0",
          [payment],
        ),
        type,
        "quitar",
      );
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
      if (!(original > 0))
        throw Object.assign(
          new Error("O valor das contas selecionadas deve ser maior que zero."),
          { status: 400 },
        );
      for (const row of rows) {
        const cfg = await tx.singleton(
          "SELECT COALESCE(TXJUROS,0) AS TAXA FROM CONFIGURACAO WHERE IDEMPRESA=?",
          [row.IDEMPRESA],
        );
        const days = overdueDays(row.DTVENC, date);
        const parcelInterest =
          Math.round(Number(row.VALOR) * Number(cfg?.TAXA || 0) * days) / 100;
        if (!Number.isFinite(parcelInterest))
          throw Object.assign(
            new Error("Nao foi possivel calcular os juros da conta."),
            { status: 400 },
          );
        interest.push(parcelInterest);
      }
      const totalInterest =
          Math.round(interest.reduce((a, b) => a + b, 0) * 100) / 100,
        expected =
          Math.round((original + totalInterest - discount) * 100) / 100,
        expectedNet = Math.round((expected - retention) * 100) / 100;
      if (!Number.isFinite(expected) || !Number.isFinite(expectedNet))
        throw Object.assign(
          new Error("Nao foi possivel calcular o valor do pagamento."),
          { status: 400 },
        );
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
      const userId = Number(req.dashboardSession?.user?.idusuario || 0) || null;
      const clock = historyClock();
      const bankId = await existingBank(tx, bank);
      for (let i = 0; i < rows.length; i++) {
        const paid =
            Math.round(
              (Number(rows[i].VALOR) + interest[i] - discounts[i]) * 100,
            ) / 100,
          paidNet = Math.round((paid - retentions[i]) * 100) / 100;
        if (!Number.isFinite(paid) || !Number.isFinite(paidNet))
          throw Object.assign(
            new Error("Nao foi possivel calcular o valor pago."),
            { status: 400 },
          );
        const cashBox = cash || asInt(rows[i].CAIXA_TITULO);
        if (type === "receber" && !cashBox)
          throw Object.assign(
            new Error("Selecione um caixa para lancar o recebimento."),
            { status: 400 },
          );
        const plan = [
            form.CDGRUPO,
            form.CCUSTO,
            body.cdconta || form.CDCONTA,
            body.cdsubconta || form.CDSUBCONTA,
            body.cdsubsubconta || form.CDSUBSUBCONTA,
            body.cdsubsubsubconta || form.CDSUBSUBSUBCONTA,
          ];
        if (type === "receber") {
          await tx.execute(
            "UPDATE CTARECEBER SET STATUS=2,DTCOB=?,TPPAGTO=?,CDBANCO=?,CAIXA=?,NUMCONTA=?,AGENCIA=?,CDRECGRUPO=COALESCE(?,CDRECGRUPO),CCUSTO=COALESCE(?,CCUSTO),CDCONTA=COALESCE(?,CDCONTA),CDSUBCONTA=COALESCE(?,CDSUBCONTA),CDSUBSUBCONTA=COALESCE(?,CDSUBSUBCONTA),CDSUBSUBSUBCONTA=COALESCE(?,CDSUBSUBSUBCONTA),JUROS=?,DESCONTO=?,RETENCAO=?,TOTALPG=?,VLPGLIQ=?,HISTORICO=COALESCE(NULLIF(?,''),HISTORICO),DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1",
            [
              paymentDate,
              payment,
              bankId,
              cashBox,
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
          const title = await tx.singleton(
            "SELECT PARCELA,NRPEDIDO,COALESCE(DIVIDA,VALOR,0) AS DIVIDA,NRDOC2,CDVEND FROM CTARECEBER WHERE CONTROLE=? AND IDEMPRESA=?",
            refs[i],
          );
          await postReceivableCash(tx, {
            company: refs[i][1],
            document: rows[i].NRDOC,
            installment: title?.PARCELA,
            person: rows[i].PESSOA,
            due: rows[i].DTVENC,
            amount: paid,
            debt: title?.DIVIDA,
            paid,
            when: paymentDate,
            bank: bankId,
            cash: cashBox,
            interest: interest[i],
            payment,
            discount: discounts[i],
            retention: retentions[i],
            order: title?.NRPEDIDO,
            launch: refs[i][0],
            user: userId || 1,
            group: form.CDGRUPO,
            document2: title?.NRDOC2,
            agreement: rows[i].ACORDO,
            history: history || `Recebimento ${rows[i].NRDOC || refs[i][0]}`,
            seller: title?.CDVEND,
          });
        } else
          await tx.execute(
            "UPDATE CTAPAGAR SET STATUS=2,DTPAGTO=?,TPPAGTO=?,CDBANCO=?,CDCAIXA=?,CONTA=?,AGENCIA=?,CDRECGRUPO=COALESCE(?,CDRECGRUPO),CCUSTO=COALESCE(?,CCUSTO),CDCONTA=COALESCE(?,CDCONTA),CDSUBCONTA=COALESCE(?,CDSUBCONTA),CDSUBSUBCONTA=COALESCE(?,CDSUBSUBCONTA),CDSUBSUBSUBCONTA=COALESCE(?,CDSUBSUBSUBCONTA),JUROS=?,DESCONTO=?,RETENCAO=?,VLPAGTO=?,HISTORICO=COALESCE(NULLIF(?,''),HISTORICO),DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=1",
            [
              paymentDate,
              payment,
              bankId,
              cashBox,
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
        if (type === "pagar" && cashBox)
          await postPayableCash(tx, {
            company: rows[i].IDEMPRESA,
            cash: cashBox,
            subject: cashMovementSubject(rows[i].PESSOA_NOME, "BAIXA DA CONTA Nº", rows[i].NRDOC),
            amount: -paidNet,
            when: paymentDate,
            payment,
          });
        await recordAccountHistory(
          tx,
          type,
          refs[i][0],
          refs[i][1],
          6,
          `Baixa Realizada em: ${clock.day};hora=${clock.time}`,
          userId,
        );
      }
      let movement = null;
      if (bankId) {
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
            bankId,
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
        const userId = Number(req.dashboardSession?.user?.idusuario || 0) || null;
        const undone = agreementUndoHistory(historyClock().day);
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
          for (const row of active) {
            await tx.execute(
              `UPDATE ${table} SET STATUS=9,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND ACORDO=? AND STATUS IN (1,2)`,
              [row.CONTROLE, row.IDEMPRESA, agreement],
            );
            await recordAccountHistory(tx, type, row.CONTROLE, row.IDEMPRESA, 3, undone, userId);
          }
          for (const row of originals) {
            await tx.execute(
              type === "receber"
                ? "UPDATE CTARECEBER SET STATUS=1,ACORDO=NULL,DTCOB=NULL,TOTALPG=0,VLPGLIQ=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND ACORDO=? AND STATUS=6"
                : "UPDATE CTAPAGAR SET STATUS=1,ACORDO=NULL,DTPAGTO=NULL,VLPAGTO=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND ACORDO=? AND STATUS=6",
              [row.CONTROLE, row.IDEMPRESA, agreement],
            );
            await recordAccountHistory(tx, type, row.CONTROLE, row.IDEMPRESA, 2, undone, userId);
          }
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
        for (const item of newItems) {
          await tx.execute(
            `UPDATE ${table} SET STATUS=9,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS IN (1,2)`,
            [item.CONTROLE, item.IDEMPRESA],
          );
          await recordAccountHistory(tx, type, item.CONTROLE, item.IDEMPRESA, 3, undone, userId);
        }
        for (const item of originals) {
          await tx.execute(
            type === "receber"
              ? "UPDATE CTARECEBER SET STATUS=1,ACORDO=?,DTCOB=NULL,TOTALPG=0,VLPGLIQ=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=6"
              : "UPDATE CTAPAGAR SET STATUS=1,ACORDO=?,DTPAGTO=NULL,VLPAGTO=0,MOV_BANCARIA=NULL,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND STATUS=6",
            [item.ACORDO_ANTERIOR, item.CONTROLE, item.IDEMPRESA],
          );
          await recordAccountHistory(tx, type, item.CONTROLE, item.IDEMPRESA, 2, undone, userId);
        }
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
