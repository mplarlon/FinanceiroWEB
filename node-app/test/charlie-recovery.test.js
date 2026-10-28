import assert from "node:assert/strict";
import test from "node:test";
import { montarRecuperacao, prioridadeComercial, registrarAcao } from "../server/lib/charlie-recovery.js";
import { lerFatos } from "../server/lib/charlie-recovery-service.js";

const hoje = new Date("2026-10-26T12:00:00-03:00");

test("a recuperação ordena fatos reais e não inventa carrinho nem probabilidade", () => {
  const painel = montarRecuperacao({
    orcamentos: [
      { numero: 10, empresa: 1, cliente: "Ana", vendedor: "Marina", data: "2026-10-20", valor: 100 },
      { numero: 11, empresa: 1, cliente: "Bia", vendedor: "Marina", data: "2026-09-01", valor: 8000 },
    ],
    clientes: [{ codigo: 7, nome: "Caio", vendedor: "Leo", ultimaCompra: "2026-01-01", historico: 500, frequencia: 4 }],
    reducoes: [{ clienteId: 8, cliente: "Dani", vendedor: "Leo", ultimaCompra: "2026-10-01", atual: 100, anterior: 400, frequencia: 3 }],
    pedidos: [{ numero: 90, empresa: 1, cliente: "Eva", vendedor: "Marina", data: "2026-10-01", valor: 50 }],
    negociacoes: [{ id: "lead-1", cliente: "Fábio", vendedor: "Leo", atualizadoEm: "2026-10-01", valor: null }],
    carrinhos: null,
  }, { hoje, diasOrcamento: 15, diasCliente: 60, quedaMinima: 30 });
  assert.equal(painel.itens.some((item) => item.documento === 10), false);
  assert.equal(painel.itens.some((item) => item.tipo === "carrinho_abandonado"), false);
  assert.match(painel.lacunas.join(" "), /Carrinho abandonado/);
  const orcamento = painel.itens.find((item) => item.tipo === "orcamento_parado");
  assert.equal(orcamento.prioridade.pontos >= 70, true);
  assert.match(orcamento.prioridade.aviso, /Não é probabilidade/);
  assert.match(orcamento.rascunho, /Bia/);
  assert.doesNotMatch(orcamento.rascunho, /desconto|probabilidade/i);
  const cliente = painel.itens.find((item) => item.tipo === "cliente_inativo");
  assert.equal(cliente.valor, null);
  assert.equal(cliente.historico, 500);
  assert.equal(cliente.frequencia, 4);
  const queda = painel.itens.find((item) => item.tipo === "reducao_compras");
  assert.equal(queda.valor, 300);
  assert.match(queda.valorRotulo, /Não é previsão/);
  assert.equal(prioridadeComercial(0, 0).pontos, 0);
});

test("comparação sem valor não vira queda", () => {
  const painel = montarRecuperacao({
    orcamentos: [],
    clientes: [],
    reducoes: [{ clienteId: 8, cliente: "Dani", vendedor: "Leo", ultimaCompra: "2026-10-01", atual: null, anterior: 400, frequencia: 3 }],
    reducoesIncompletas: 1,
    pedidos: [{ numero: 90, empresa: 1, cliente: "Eva", vendedor: "Marina", data: "2026-10-01", valor: null }],
    negociacoes: [],
    carrinhos: null,
  }, { hoje, diasOrcamento: 15, diasCliente: 60, quedaMinima: 30 });
  assert.equal(painel.itens.some((item) => item.tipo === "reducao_compras"), false);
  assert.equal(painel.itens.find((item) => item.tipo === "pedido_nao_finalizado").valor, null);
  assert.match(painel.lacunas.join(" "), /sem valor/);
  const zerada = montarRecuperacao({
    orcamentos: [], clientes: [], pedidos: [], negociacoes: [], carrinhos: null,
    reducoes: [{ clienteId: 8, cliente: "Dani", ultimaCompra: "2026-10-01", atual: 0, anterior: 400 }],
  }, { hoje, quedaMinima: 30 });
  assert.equal(zerada.itens.find((item) => item.tipo === "reducao_compras").valor, 400);
});

test("a consulta da queda não completa pedido sem valor", async () => {
  const consultas = [];
  await lerFatos({ query: async (sql) => { consultas.push(sql); return []; } });
  const queda = consultas.find((sql) => sql.includes("ANTERIOR"));
  assert.match(queda, /VLTOTAL IS NULL AND se.SUBTOTAL IS NULL/);
  assert.doesNotMatch(queda, /SUBTOTAL, 0\)/);
  const pedido = consultas.find((sql) => sql.includes("STATUS_ORC"));
  assert.doesNotMatch(pedido, /SUBTOTAL, 0\)/);
});

test("a ação interna não marca envio nem publica campanha", () => {
  const tarefa = registrarAcao({}, { tipo: "tarefa", id: "1", em: "2026-10-26", texto: "Ligar para a Bia" });
  assert.equal(tarefa.acoes[0].enviada, false);
  const campanha = registrarAcao(tarefa, { tipo: "campanha", id: "2", em: "2026-10-26", texto: "Retomar orçamentos abertos" });
  assert.equal(campanha.acoes[1].publicada, false);
  assert.throws(() => registrarAcao({}, { tipo: "resultado", resultado: "ganho" }), /resultado/);
  const resultado = registrarAcao({}, { tipo: "resultado", resultado: "recuperado", id: "3", em: "2026-10-26", texto: "Voltou a comprar" });
  assert.equal(resultado.resultado, "recuperado");
});
