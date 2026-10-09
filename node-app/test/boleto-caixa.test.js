import assert from "node:assert/strict";
import test from "node:test";
import { alphaSuffix, barcodeData, cnab240, linhaDigitavel, numeroDocumento } from "../server/routes/boleto-caixa.js";

test("sufixos e documentos CAIXA preservam regra legada",()=>{assert.equal(alphaSuffix(1),"AC");assert.equal(alphaSuffix(26),"ZC");assert.equal(alphaSuffix(27),"AAC");assert.equal(numeroDocumento("660698",1,1),"660698AC")});
test("codigo de barras CAIXA tem 44 digitos e linha digitavel",()=>{const title={valor:123.45,vencimento:"2026-10-05"},cfg={codigo_beneficiario:"1234567"},barcode=barcodeData(title,cfg,"14123456789012345");assert.match(barcode,/^\d{44}$/);assert.match(linhaDigitavel(barcode),/^\d{5}\.\d{5}/)});
test("CNAB CAIXA produz somente registros de 240 caracteres",()=>{const titles=[{nosso_numero:"14123456789012345",numero_documento:"660698AC",vencimento:"2026-10-05",valor:100,documento_pagador:"12345678000190",pagador:"CLIENTE",endereco:"RUA A",numero:"1",bairro:"CENTRO",cep:"12345678",uf:"SP"}],cfg={cnpj_beneficiario:"12345678000190",agencia:"1234",conta:"123456",codigo_beneficiario:"1234567",convenio:"CONVENIO",nome_beneficiario:"EMPRESA"};const lines=cnab240(titles,cfg,1,new Date("2026-09-10T12:00:00")).split("\r\n").filter(Boolean);assert.equal(lines.length,6);assert.ok(lines.every(line=>line.length===240))});
