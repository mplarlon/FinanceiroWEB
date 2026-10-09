import test from "node:test";
import assert from "node:assert/strict";
import { parseCardCsv } from "../server/routes/reconciliation-card.js";
test("interpreta CSV de conciliacao de cartao",()=>{const rows=parseCardCsv("Status;Data da venda;Valor bruto;Valor da taxa;Valor liquido;Bandeira;NSU\nAprovada;05/10/2026;100,00;3,00;97,00;Visa;123");assert.equal(rows.length,1);assert.equal(rows[0].valor_bruto,100);assert.equal(rows[0].valor_liquido,97);assert.equal(rows[0].data,"2026-10-05");});
