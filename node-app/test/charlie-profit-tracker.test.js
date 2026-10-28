import test from "node:test";
import assert from "node:assert/strict";
import { acompanharLucro } from "../server/lib/charlie-profit-tracker.js";
import { painelLucro } from "../server/lib/charlie-profit-tracker-service.js";

test("a margem só fecha com custo, tributo, comissão e taxa", () => {
  const painel = acompanharLucro({
    linhas: [
      { produtoId: "cabo", nome: "Cabo", canal: "ERP", receita: 100, custo: 40, tributos: 10, comissao: 5, taxa: 2 },
      { produtoId: "cabo", nome: "Cabo", canal: "ERP", receita: 50, custo: 20, tributos: 0, comissao: 0, taxa: 1 },
      { produtoId: "fita", nome: "Fita", canal: "ERP", receita: 30, custo: 8, tributos: null, comissao: 1, taxa: null },
      { produtoId: "tomada", nome: "Tomada", canal: "Shopee", receita: 80, custo: null, tributos: null, comissao: null, taxa: null },
    ],
    pedidosTray: [],
  });
  const cabo = painel.itens.find((item) => item.id === "ERP:CABO");
  assert.equal(cabo.receita, 150);
  assert.equal(cabo.custo, 60);
  assert.equal(cabo.tributos, 10);
  assert.equal(cabo.comissao, 5);
  assert.equal(cabo.taxa, 3);
  assert.equal(cabo.margem, 72);
  assert.equal(cabo.conciliado, true);
  const fita = painel.itens.find((item) => item.produtoId === "FITA");
  assert.equal(fita.tributos, null);
  assert.equal(fita.margem, null);
  assert.ok(fita.faltas.includes("taxa"));
  assert.ok(fita.faltas.includes("tributos"));
  const shopee = painel.itens.find((item) => item.canal === "Shopee");
  assert.equal(shopee.margem, null);
  assert.equal(shopee.custo, null);
  assert.match(painel.aviso, /Nenhum valor foi gravado/);
  assert.equal(JSON.stringify(painel).includes("lucro líquido"), false);
});

test("a consulta não grava rentabilidade", async () => {
  const sql = [];
  const painel = await painelLucro({
    query: async (texto) => {
      sql.push(texto);
      if (/\b(insert|update|delete)\b/i.test(texto)) throw new Error("gravação");
      return [{ CDPRODUTO: "CABO", NOME: "Cabo", RECEITA: 100, SEM_RECEITA: 0, CUSTO: 40, SEM_CUSTO: 0, TRIBUTOS: 10, SEM_TRIBUTO: 0, COMISSAO: 5, SEM_COMISSAO: 0, ITENS: 1 }];
    },
    store: () => ({ orders: { 1: { status: "Pago", marketplace: "Shopee", items: [{ reference: "CB", name: "Cabo", total: 20 }] } } }),
  });
  assert.equal(sql.some((item) => /\b(insert|update|delete)\b/i.test(item)), false);
  const erp = painel.itens.find((item) => item.canal === "ERP");
  assert.equal(erp.taxa, null);
  assert.equal(erp.margem, null);
  const loja = painel.itens.find((item) => item.canal === "Shopee");
  assert.equal(loja.receita, 20);
  assert.equal(loja.margem, null);
  assert.ok(loja.faltas.includes("taxa"));
});
