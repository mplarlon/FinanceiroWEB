import test from "node:test";
import assert from "node:assert/strict";
import { montarCoach } from "../server/lib/charlie-sales-coach.js";
import { painelCoach } from "../server/lib/charlie-sales-coach-service.js";

const fatos = {
  hoje: "2026-10-26",
  inativoDias: 60,
  metas: { mensal: 50000, diaria: 2000, vendedores: { 4: 1000 } },
  vendedores: [{ id: 4, nome: "Ana" }, { id: 9, nome: "Bruno" }],
  orcamentos: [
    { vendedorId: 4, status: 0, valor: 80, contato: "", cliente: "Oficina Sul", numero: 1 },
    { vendedorId: 4, status: 0, valor: 40, contato: "Maria", cliente: "Oficina Norte", numero: 2 },
    { vendedorId: 4, status: 1, valor: 100, contato: "João", cliente: "Metalúrgica", numero: 3 },
    { vendedorId: 4, status: 2, valor: 999, contato: "", cliente: "Cancelado", numero: 4 },
    { vendedorId: 9, status: 0, valor: 70, contato: "", cliente: "Carteira do Bruno", numero: 5 },
  ],
  vendasMes: [{ vendedorId: 4, valor: 250 }, { vendedorId: 9, valor: 900 }],
  vendasDia: [{ vendedorId: 4, valor: null }],
  inativos: [
    { vendedorId: 4, clienteId: 1, cliente: "Parado", ultimaCompra: "2026-07-01" },
    { vendedorId: 4, clienteId: 2, cliente: "Recente", ultimaCompra: "2026-10-01" },
    { vendedorId: 4, clienteId: 3, cliente: "Sem data", ultimaCompra: null },
    { vendedorId: 9, clienteId: 8, cliente: "Cliente do Bruno", ultimaCompra: "2026-01-01" },
  ],
  complementos: [
    { vendedorId: 4, produto: "Luva", suporte: 2 },
    { vendedorId: 4, produto: "Cabo", suporte: 3 },
  ],
};

test("conversão, meta e contato usam só o que foi lido", () => {
  const painel = montarCoach(fatos, { gerencial: true, vendedorId: null });
  const ana = painel.vendedores.find((item) => item.id === 4);
  assert.equal(ana.orcamentos, 3);
  assert.equal(ana.convertidos, 1);
  assert.equal(ana.taxaConversao, 33.3);
  assert.equal(ana.tempoResposta, null);
  assert.equal(ana.vendasDia, null);
  assert.equal(ana.metaMensal.atingimento, 25);
  assert.equal(ana.metaMensal.valor, 1000);
  assert.equal(ana.metaDiaria, null);
  assert.equal(ana.semContato.length, 1);
  assert.equal(ana.semContato[0].cliente, "Oficina Sul");
  assert.equal(ana.inativos.length, 1);
  assert.equal(ana.inativos[0].cliente, "Parado");
  assert.equal(ana.complementos.length, 1);
  assert.equal(ana.complementos[0].produto, "Cabo");
  assert.equal(ana.complementos[0].junto, null);
  const semPar = montarCoach({ ...fatos, complementos: null }, { gerencial: true, vendedorId: null });
  assert.equal(semPar.vendedores[0].complementos, null);
  assert.match(semPar.lacunas.join(" "), /não foram consultados/);
  assert.equal(ana.tarefas.every((item) => item.gravada === false && item.enviada === false), true);
  assert.match(painel.aviso, /Não é probabilidade de fechar/);
  assert.equal(painel.loja.metaMensal, 50000);
  const semMeta = montarCoach({ ...fatos, metas: { mensal: null, diaria: null, vendedores: {} }, orcamentos: [] }, { gerencial: true });
  assert.equal(semMeta.vendedores[0].taxaConversao, null);
  assert.equal(semMeta.vendedores[0].metaMensal.valor, null);
});

test("vendedor vê a própria carteira e a consulta não grava", async () => {
  const painel = montarCoach(fatos, { gerencial: false, vendedorId: 4 });
  assert.equal(painel.escopo, "carteira");
  assert.deepEqual(painel.vendedores.map((item) => item.id), [4]);
  assert.equal(JSON.stringify(painel).includes("Bruno"), false);
  assert.equal(JSON.stringify(painel).includes("Carteira do Bruno"), false);
  const chamadas = [];
  const deps = {
    query: async (sql) => {
      chamadas.push(sql);
      if (sql.includes("FROM USUARIOS")) return [{ CDVENDEDOR: 4 }];
      if (sql.includes("FROM VENDEDOR")) return [{ CDVENDEDOR: 4, VENDEDOR: "Ana" }];
      if (sql.includes("SAIDAPRODUTO a")) return [{ CDVENDEDOR: 4, A: "1", NOME_A: "Cabo", B: "2", NOME_B: "Luva", PEDIDOS: 4 }];
      if (sql.includes("SUM(") && sql.includes("SAIDAPRODUTO sp")) return [{ CDVENDEDOR: 4, VALOR: 10, SEM: 1 }];
      return [];
    },
  };
  const lido = await painelCoach(deps, { id: 4, gerencial: false }, { metas: { mensal: null, diaria: null, vendedores: {}, inativoDias: null } });
  assert.equal(lido.vendedores[0].complementos[0].produto, "Cabo");
  assert.equal(lido.vendedores[0].complementos[0].junto, "Luva");
  assert.equal(lido.vendedores[0].complementos[0].suporte, 4);
  assert.equal(lido.vendedores[0].vendasMes, null);
  assert.match(lido.lacunas.join(" "), /não foi somado/);
  assert.equal(chamadas.some((sql) => sql.includes("QTDPRODUTO * sp.VLUNIT)")), false);
  assert.equal(chamadas.some((sql) => /insert|update|delete/i.test(sql)), false);
  const vazio = await painelCoach({}, { gerencial: false }, { fatos: { ...fatos, vendedores: [] } });
  assert.equal(vazio.vendedores.length, 0);
  assert.equal(vazio.loja, null);
});
