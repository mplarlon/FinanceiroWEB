import assert from "node:assert/strict";
import test from "node:test";
import { digits, publicConfig, validateTitle } from "../server/routes/boleto-bradesco.js";

test("validacao Bradesco aceita titulo completo", () => {
  const title = { documento_pagador:"12.345.678/0001-90",pagador:"Cliente",
    endereco:"Rua A",cep:"12345-678",uf:"SP",valor:100,status_titulo:1,forma_venda:"Boleto" };
  assert.deepEqual(validateTitle(title), []);
  assert.equal(digits(title.documento_pagador), "12345678000190");
});

test("configuracao Bradesco nao expoe credenciais", () => {
  const result = publicConfig({ token_url:"a",issue_url:"b",client_id:"c",client_secret:"d",
    agencia:"1",conta:"2",carteira:"3",homologado:true });
  assert.equal(result.configurado, true);
  assert.equal("client_secret" in result, false);
});
