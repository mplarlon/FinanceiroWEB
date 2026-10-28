import test from "node:test";
import assert from "node:assert/strict";
import { montarMissoes } from "../server/lib/charlie-sales-mission.js";
import { painelMissoes } from "../server/lib/charlie-sales-mission-service.js";

test("missão sem meta não nasce e realizado ausente não vira zero", () => {
  const painel = montarMissoes({
    metas: [
      { id: "vazia", tipo: "Mensal", meta: null, realizado: 10 },
      { id: "zero", tipo: "Mensal", meta: 0, realizado: 10 },
      { id: "aberta", tipo: "Vendedor", nome: "Ana", origem: "Charlie Daily", meta: 1000, realizado: null, inicio: "2026-10-01", prazo: "2026-10-31" },
      { id: "fechada", tipo: "Loja", nome: "Centro", origem: "Relatórios gerenciais", meta: 500, realizado: 800, inicio: "2026-10-01", prazo: "2026-10-31" },
      { id: "parcial", tipo: "Diária", nome: "Meta diária", origem: "Charlie Daily", meta: 100, realizado: 40, inicio: "2026-10-26", prazo: "2026-10-26" },
    ],
  });
  assert.equal(painel.itens.some((item) => item.id === "vazia" || item.id === "zero"), false);
  const aberta = painel.itens.find((item) => item.id === "aberta");
  assert.equal(aberta.realizado, null);
  assert.equal(aberta.atingimento, null);
  assert.equal(aberta.falta, null);
  assert.equal(aberta.situacao, "Realizado não consultado");
  const fechada = painel.itens.find((item) => item.id === "fechada");
  assert.equal(fechada.falta, -300);
  assert.equal(fechada.atingimento, 160);
  assert.equal(fechada.situacao, "Meta alcançada no período");
  const parcial = painel.itens.find((item) => item.id === "parcial");
  assert.equal(parcial.falta, 60);
  assert.equal(parcial.atingimento, 40);
  assert.match(parcial.plano, /Nenhum plano novo foi criado/);
  assert.equal(JSON.stringify(painel).toLowerCase().includes("ligar"), false);
  assert.equal(JSON.stringify(painel).toLowerCase().includes("whatsapp"), false);
});

test("a consulta não grava missão", async () => {
  const sql = [];
  const painel = await painelMissoes({
    query: async (texto) => {
      sql.push(texto);
      if (/\b(insert|update|delete)\b/i.test(texto)) throw new Error("gravação");
      if (texto.includes("CDVENDEDOR") && texto.includes("FROM SAIDAESTOQUE")) return [{ ID: 4, RECEITA: 20, SEM: 1, ITENS: 2 }];
      if (texto.includes("FROM VENDEDOR")) return [{ ID: 4, NOME: "Ana" }];
      if (texto.includes("FROM SAIDAESTOQUE")) return [{ RECEITA: 15, SEM: 0, ITENS: 1 }];
      return [];
    },
  }, {
    hoje: new Date("2026-10-26T15:00:00-03:00"),
    diario: { mensal: 100, diaria: null, semanal: null, vendedores: { 4: 50 }, filiais: {}, equipes: {} },
    legado: { goals: {}, seller_goals: {}, category_goals: {} },
  });
  assert.equal(sql.some((item) => /\b(insert|update|delete)\b/i.test(item)), false);
  const mensal = painel.itens.find((item) => item.id === "mensal");
  assert.equal(mensal.realizado, 15);
  assert.equal(mensal.falta, 85);
  const vendedor = painel.itens.find((item) => item.id === "vendedor-daily:4");
  assert.equal(vendedor.nome, "Ana");
  assert.equal(vendedor.realizado, null);
  assert.equal(vendedor.meta, 50);
  assert.equal(painel.itens.some((item) => item.tipo === "Diária"), false);
});
