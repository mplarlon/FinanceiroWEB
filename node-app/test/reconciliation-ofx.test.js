import test from "node:test";
import assert from "node:assert/strict";
import { parseOfx } from "../server/routes/reconciliation-ofx.js";

test("interpreta OFX SGML e calcula saldo inicial",()=>{const parsed=parseOfx(`<OFX><BANKACCTFROM><BANKID>237<BRANCHID>1234<ACCTID>00099-1</BANKACCTFROM><BANKTRANLIST><DTSTART>20261001000000<DTEND>20261031235959<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005120000<TRNAMT>150.25<FITID>A1<NAME>PIX<MEMO>CLIENTE</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006120000<TRNAMT>-50.00<FITID>A2<NAME>PAGAMENTO</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1100.25</LEDGERBAL></OFX>`);assert.equal(parsed.bankid,"237");assert.equal(parsed.itens.length,2);assert.equal(parsed.total_itens,100.25);assert.equal(parsed.saldo_inicial,1000);assert.equal(parsed.itens[0].descricao,"PIX CLIENTE");});
