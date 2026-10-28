import test from "node:test";
import assert from "node:assert/strict";
import { montarRecompra } from "../server/lib/charlie-rebuy.js";
import { criarOportunidade, criarTarefa, lerVendas, painelRecompra, usarMemoriaDeTeste } from "../server/lib/charlie-rebuy-service.js";
import { createMemoryStore } from "../server/lib/charlie-task-store.js";

const hoje = "2026-10-26";

function compra(data, extra = {}) {
  return { clienteId: 10, cliente: "Oficina Sul", produtoId: 5, produto: "Filtro", vendedorId: 3, vendedor: "Ana", quantidade: 2, valor: 80, data, ...extra };
}

test("três compras no mesmo intervalo entram na janela sem virar probabilidade", () => {
  const painel = montarRecompra([
    compra("2026-07-27"),
    compra("2026-08-26"),
    compra("2026-09-25"),
  ], { hoje, janelaDias: 7 });
  assert.equal(painel.itens.length, 1);
  const item = painel.itens[0];
  assert.equal(item.intervalo, 30);
  assert.equal(item.prevista, "2026-10-25");
  assert.equal(item.situacao, "vencida");
  assert.equal(item.quantidadeMediana, 2);
  assert.equal(item.valor, 240);
  assert.match(item.prioridade.aviso, /Não é probabilidade de compra/);
  assert.match(item.sazonalidade.motivo, /não foi ajustada/i);
});

test("duas compras e outro produto não formam ciclo", () => {
  const painel = montarRecompra([
    compra("2026-08-01"),
    compra("2026-09-01"),
    compra("2026-07-01", { produtoId: 9, produto: "Outro" }),
    compra("2026-08-01", { produtoId: 9, produto: "Outro" }),
    compra("2026-09-01", { produtoId: 9, produto: "Outro" }),
  ], { hoje: "2026-09-05", janelaDias: 7 });
  assert.equal(painel.itens.length, 0);
  assert.match(painel.lacunas[0], /menos de três datas/);
});

test("quantidade ausente continua nula e a sazonalidade não move a data", () => {
  const painel = montarRecompra([
    compra("2023-10-01", { quantidade: null }),
    compra("2024-10-01", { quantidade: null }),
    compra("2025-10-01", { quantidade: null }),
  ], { hoje: "2026-10-20", janelaDias: 30 });
  const item = painel.itens[0];
  assert.equal(item.quantidadeMediana, null);
  assert.equal(item.valor, 240);
  assert.equal(item.sazonalidade.anos, 3);
  assert.match(item.prevista, /^2026-10-/);
  assert.match(item.sazonalidade.motivo, /continua sendo a última compra/);
});

test("compra sem valor não entra como zero", () => {
  const painel = montarRecompra([
    compra("2026-07-27", { valor: null }),
    compra("2026-08-26", { valor: 80 }),
    compra("2026-09-25", { valor: 0 }),
  ], { hoje, janelaDias: 7 });
  assert.equal(painel.itens[0].valor, null);
  assert.match(painel.lacunas.join(" "), /sem valor/);
  const zerado = montarRecompra([
    compra("2026-07-27", { valor: 0 }),
    compra("2026-08-26", { valor: 0 }),
    compra("2026-09-25", { valor: 0 }),
  ], { hoje, janelaDias: 7 });
  assert.equal(zerado.itens[0].valor, 0);
});

test("a consulta não transforma receita ausente em zero", async () => {
  let sql = "";
  const linhas = await lerVendas({ query: async (text) => { sql = text; return []; } }, {}, {});
  assert.deepEqual(linhas.linhas, []);
  assert.match(sql, /QTDPRODUTO IS NOT NULL AND sp\.VLUNIT IS NOT NULL/);
  assert.doesNotMatch(sql, /VLUNIT,\s*0\)/);
});

test("oportunidade e tarefa não repetem e a consulta não grava", async () => {
  const linhas = [compra("2026-07-27"), compra("2026-08-26"), compra("2026-09-25")];
  usarMemoriaDeTeste({ oportunidades: {}, tarefas: {}, historico: [] });
  const painel = await painelRecompra({}, { linhas, hoje, janelaDias: 7 });
  assert.equal(painel.itens[0].oportunidadeId, null);
  assert.equal(painel.itens[0].tarefaId, null);
  let gravacoes = 0;
  const primeira = await criarOportunidade(painel.itens[0].id, { id: 4, gerencial: true }, {
    gravarOportunidade: () => {
      gravacoes += 1;
      return [{ id: "op-1" }];
    },
  }, { linhas, hoje, janelaDias: 7 });
  const segunda = await criarOportunidade(painel.itens[0].id, { id: 4, gerencial: true }, {
    gravarOportunidade: () => {
      gravacoes += 1;
      return [{ id: "op-2" }];
    },
  }, { linhas, hoje, janelaDias: 7 });
  assert.equal(primeira.oportunidadeId, "op-1");
  assert.equal(segunda.repetida, true);
  assert.equal(gravacoes, 1);
  const store = createMemoryStore();
  const tarefa = await criarTarefa(painel.itens[0].id, { id: 4, gerencial: true }, { store }, { linhas, hoje, janelaDias: 7 });
  const deNovo = await criarTarefa(painel.itens[0].id, { id: 4, gerencial: true }, { store }, { linhas, hoje, janelaDias: 7 });
  assert.equal(deNovo.repetida, true);
  assert.equal(store.state.tarefas.length, 1);
  assert.equal(store.state.tarefas[0].id, tarefa.tarefaId);
  assert.match(store.state.tarefas[0].operacao, /Não gera pedido/);
  await assert.rejects(() => criarTarefa(painel.itens[0].id, { id: 4, gerencial: false }, { store }, { linhas, hoje, janelaDias: 7 }), /gerencial/);
  usarMemoriaDeTeste(null);
});
