import test from "node:test";
import assert from "node:assert/strict";
import { divergenciasDoExtrato, parseOfx } from "../server/routes/reconciliation-ofx.js";

const selecionada = { cdbanco: "237", agencia: "2143-1", numconta: "000009-4", data_ini: "2026-09-01", data_fim: "2026-09-30" };

test("interpreta OFX SGML e calcula saldo inicial",()=>{const parsed=parseOfx(`<OFX><BANKACCTFROM><BANKID>237<BRANCHID>1234<ACCTID>00099-1</BANKACCTFROM><BANKTRANLIST><DTSTART>20261001000000<DTEND>20261031235959<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000<TRNAMT>150.25<FITID>A1<NAME>PIX<MEMO>CLIENTE</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006120000<TRNAMT>-50.00<FITID>A2<NAME>PAGAMENTO</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1100.25</LEDGERBAL></OFX>`);assert.equal(parsed.bankid,"237");assert.equal(parsed.itens.length,2);assert.equal(parsed.total_itens,100.25);assert.equal(parsed.saldo_inicial,1000);assert.equal(parsed.itens[0].descricao,"PIX CLIENTE");});

test("aceita a mesma conta com dígito e o mesmo período do arquivo", () => {
  const messages = divergenciasDoExtrato({
    bankid: "0237", agencia: "21431", conta: "0000094",
    dt_inicial: "2026-09-01", dt_final: "2026-09-30",
    itens: [{ data: "2026-09-02" }, { data: "2026-09-30" }],
  }, selecionada);
  assert.deepEqual(messages, []);
});

test("recusa extrato de outra conta e de outro período", () => {
  const messages = divergenciasDoExtrato({
    bankid: "237", agencia: "0991", conta: "18516-7",
    dt_inicial: "2026-10-01", dt_final: "2026-10-27",
    itens: [{ data: "2026-10-05" }, { data: "2026-10-27" }],
  }, selecionada);
  assert.match(messages.join(" "), /0991\/18516-7/);
  assert.match(messages.join(" "), /2143-1\/000009-4/);
  assert.match(messages.join(" "), /01\/10\/2026 a 27\/10\/2026/);
  assert.match(messages.join(" "), /01\/09\/2026 a 30\/09\/2026/);
});

test("recusa lançamento fora do período mesmo com cabeçalho igual", () => {
  const messages = divergenciasDoExtrato({
    bankid: "237", agencia: "2143-1", conta: "000009-4",
    dt_inicial: "2026-09-01", dt_final: "2026-09-30",
    itens: [{ data: "2026-09-02" }, { data: "2026-10-01" }],
  }, selecionada);
  assert.match(messages.join(" "), /fora do período informado/);
});

test("aceita OFX do Bradesco sem agência quando a conta é a mesma", () => {
  const parsed = parseOfx("<OFX><BANKACCTFROM><BANKID>0237<ACCTID>9<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20261027120000<DTEND>20261027120000<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901120000<TRNAMT>10,00<FITID>1<MEMO>PIX</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261027120000<TRNAMT>5,00<FITID>2<MEMO>PIX</STMTTRN></BANKTRANLIST></OFX>");
  assert.equal(parsed.agencia, null);
  assert.equal(parsed.conta, "9");
  const messages = divergenciasDoExtrato(parsed, {
    cdbanco: "237", agencia: "2143-1", numconta: "000009-4",
    data_ini: "2026-09-01", data_fim: "2026-10-27",
  });
  assert.deepEqual(messages, []);
});

test("recusa OFX do Bradesco sem agência quando a conta é outra", () => {
  const messages = divergenciasDoExtrato({
    bankid: "0237", agencia: null, conta: "9",
    dt_inicial: "2026-10-27", dt_final: "2026-10-27",
    itens: [{ data: "2026-09-01" }, { data: "2026-10-27" }],
  }, {
    cdbanco: "237", agencia: "0991", numconta: "18516-7",
    data_ini: "2026-09-01", data_fim: "2026-10-27",
  });
  assert.match(messages.join(" "), /sem agência\/9/);
  assert.match(messages.join(" "), /0991\/18516-7/);
});

test("usa o período dos lançamentos quando o cabeçalho é só a data do download", () => {
  const messages = divergenciasDoExtrato({
    bankid: "237", agencia: "2143-1", conta: "000009-4",
    dt_inicial: "2026-10-27", dt_final: "2026-10-27",
    itens: [{ data: "2026-09-01" }, { data: "2026-10-27" }],
  }, selecionada);
  assert.match(messages.join(" "), /01\/09\/2026 a 27\/10\/2026/);
  assert.doesNotMatch(messages.join(" "), /27\/10\/2026 a 27\/10\/2026/);
});
