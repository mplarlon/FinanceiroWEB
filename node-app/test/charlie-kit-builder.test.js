import test from "node:test";
import assert from "node:assert/strict";
import { sugerirKits } from "../server/lib/charlie-kit-builder.js";
import { painelKits } from "../server/lib/charlie-kit-builder-service.js";

const fatos = {
  pares: [
    { a: "cabo", b: "disjuntor", pedidos: 4 },
    { a: "tomada", b: "espelho", pedidos: 1 },
    { a: "cabo", b: "fita", pedidos: 3 },
    { a: "cabo", b: "cabo", pedidos: 5 },
  ],
  cadastro: {
    CABO: { nome: "Cabo flexível", preco: 10, custo: 4, saldo: 8 },
    DISJUNTOR: { nome: "Disjuntor", preco: 20, custo: 9, saldo: 0 },
    FITA: { nome: "Fita isolante", preco: 5, custo: null, saldo: null },
  },
  kits: [{ kit: "K1", produtoId: "CABO" }, { kit: "K1", produtoId: "DISJUNTOR" }, { kit: "K2", produtoId: "FITA" }],
};

test("o par só entra com dois pedidos e não inventa margem nem estoque", () => {
  const painel = sugerirKits(fatos);
  assert.equal(painel.sugestoes.some((item) => item.a === "TOMADA" || item.b === "ESPELHO"), false);
  assert.equal(painel.sugestoes.some((item) => item.a === "CABO" && item.b === "CABO"), false);
  const novo = painel.sugestoes.find((item) => item.id === "CABO:FITA");
  assert.equal(novo.pedidos, 3);
  assert.equal(novo.preco, 15);
  assert.equal(novo.custo, null);
  assert.equal(novo.margem, null);
  assert.equal(novo.saldoB, null);
  assert.equal(novo.estoqueInsuficiente, null);
  const existente = painel.jaCadastrados.find((item) => item.id === "CABO:DISJUNTOR");
  assert.deepEqual(existente.kits, ["K1"]);
  assert.equal(existente.preco, 30);
  assert.equal(existente.custo, 13);
  assert.equal(existente.margem, 17);
  assert.equal(existente.estoqueInsuficiente, true);
  assert.equal(painel.sugestoes.some((item) => item.kits.length), false);
  assert.match(painel.aviso, /Nenhum kit foi gravado/);
  assert.equal(painel.lacunas.some((item) => item.includes("200 pares")), false);
  const amostra = sugerirKits({ ...fatos, amostra: true });
  assert.equal(amostra.lacunas.some((item) => item.includes("200 pares")), true);
  assert.equal(JSON.stringify(painel).includes("desconto sugerido"), false);
});

test("a consulta não grava kit", async () => {
  const sql = [];
  const painel = await painelKits({
    query: async (texto) => {
      sql.push(texto);
      if (/\b(insert|update|delete)\b/i.test(texto)) throw new Error("gravação");
      if (texto.includes("COUNT(*)")) return [{ A: "CABO", B: "FITA", PEDIDOS: 2 }];
      if (texto.includes("VLCUSTOMEDIO")) return [{ CDPRODUTO: "CABO", VLCUSTOMEDIO: 4 }, { CDPRODUTO: "FITA", VLCUSTOMEDIO: 4 }];
      if (texto.includes("FROM PRODUTO")) return [{ CDPRODUTO: "CABO", PRODUTO: "Cabo", PRECO: 10, SALDO: 3 }, { CDPRODUTO: "FITA", PRODUTO: "Fita", PRECO: 5, SALDO: 1 }];
      if (texto.includes("PRODKIT")) return [];
      return [];
    },
  });
  assert.equal(sql.some((item) => /\b(insert|update|delete)\b/i.test(item)), false);
  assert.equal(painel.sugestoes.length, 1);
  assert.equal(painel.sugestoes[0].preco, 15);
  assert.equal(painel.sugestoes[0].custo, 8);
  assert.equal(painel.sugestoes[0].margem, 7);
  assert.equal(painel.jaCadastrados.length, 0);
});
