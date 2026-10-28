import test from "node:test";
import assert from "node:assert/strict";
import { montarCompras } from "../server/lib/charlie-smart-purchasing.js";
import { autorizarEmissao, criarSolicitacao, emitirPedido, painelCompras, usarMemoriaDeTeste } from "../server/lib/charlie-smart-purchasing-service.js";

const produto = { id: "10", nome: "Cabo", saldo: 2, minimo: 0, depositoId: 1, empresaId: 3 };

test("custo, prazo e qualidade ausentes não viram zero nem quinze dias", () => {
  const painel = montarCompras({
    produtos: [{ ...produto, saldo: null }, produto, { id: "11", nome: "Luva", saldo: 0, minimo: 4, depositoId: 2, empresaId: 3 }],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    pendentes: [],
    entradas: [
      { produtoId: "10", fornecedorId: 7, fornecedor: "Mais caro", entrada: "2026-10-20", pedido: "2026-10-01", custo: 12, preco: 12 },
      { produtoId: "10", fornecedorId: 8, fornecedor: "Mais barato", entrada: "2026-10-11", pedido: "2026-10-01", custo: 0, preco: 8 },
      { produtoId: "10", fornecedorId: 8, fornecedor: "Mais barato", entrada: "2026-09-21", pedido: "2026-09-01", custo: null, preco: 8 },
      { produtoId: "11", fornecedorId: 9, fornecedor: "Sem preço", entrada: "2026-10-01", custo: null, preco: null },
    ],
    qualidades: [{ fornecedorId: 8, indice: 70 }, { fornecedorId: 8, indice: 40 }],
  }, { janelaDias: 15 });
  const cabo = painel.itens.find((item) => item.produtoId === "10");
  const luva = painel.itens.find((item) => item.produtoId === "11");
  assert.equal(painel.itens.some((item) => item.saldo == null), false);
  assert.equal(cabo.fornecedor, "Mais barato");
  assert.equal(cabo.custoUnitario, 8);
  assert.equal(cabo.prazoDias, 15);
  assert.equal(cabo.qualidade, null);
  assert.equal(cabo.demandaPrevista, 15);
  assert.equal(cabo.quantidade, 13);
  assert.equal(cabo.pedidoEmitido, false);
  assert.match(cabo.prioridade.aviso, /Não é probabilidade/);
  assert.equal(luva.custoUnitario, null);
  assert.equal(luva.prazoDias, null);
  assert.equal(luva.custoEstimado, null);
  assert.match(painel.aviso, /demanda prevista repete a média/);
});

test("quantidade ausente não vira zero nem reduz a sugestão", async () => {
  const base = {
    produtos: [produto],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    entradas: [],
    qualidades: [],
  };
  const semPedido = montarCompras({ ...base, pendentes: [{ produtoId: "10", quantidade: null }] }, { janelaDias: 15 });
  assert.equal(semPedido.itens[0].quantidade, 13);
  assert.equal(semPedido.itens[0].pendente, null);
  assert.match(semPedido.itens[0].justificativa, /não entraram/);
  assert.match(semPedido.lacunas.join(" "), /não foi descontado/);
  const pedidoZero = montarCompras({ ...base, pendentes: [{ produtoId: "10", quantidade: 0 }] }, { janelaDias: 15 });
  assert.equal(pedidoZero.itens[0].pendente, 0);
  assert.equal(pedidoZero.itens[0].quantidade, 13);
  assert.doesNotMatch(pedidoZero.lacunas.join(" "), /não foi descontado/);
  const semSaida = montarCompras({ ...base, vendas: [{ produtoId: "10", quantidade: null }], pendentes: [] }, { janelaDias: 15 });
  assert.equal(semSaida.itens.length, 0);
  assert.match(semSaida.lacunas.join(" "), /não entra na sugestão/);
  usarMemoriaDeTeste({ solicitacoes: {}, emissaoAutorizada: false, historico: [] });
  const consultas = [];
  const painel = await painelCompras({
    query: async (sql) => {
      consultas.push(String(sql));
      if (String(sql).includes("FROM PRODUTO")) return [{ CDPRODUTO: "10", PRODUTO: "Cabo", SALDO: 0, MINIMO: 4 }];
      if (String(sql).includes("SAIDAPRODUTO")) return [{ CDPRODUTO: "10", QTD: 9, SEM_QTD: 1 }];
      if (String(sql).includes("ORDEMCOMPRAPROD")) return [{ CDPRODUTO: "10", QTD: 3, SEM_QTD: 1 }];
      return [];
    },
  }, {}, {});
  const pedido = consultas.find((sql) => sql.includes("ORDEMCOMPRAPROD"));
  assert.doesNotMatch(pedido, /COALESCE\(op\.QTDE,0\)/);
  assert.match(pedido, /op\.QTDE IS NULL/);
  assert.match(consultas.find((sql) => sql.includes("SAIDAPRODUTO")), /QTDPRODUTO IS NULL/);
  assert.equal(painel.itens.length, 0);
  assert.match(painel.lacunas.join(" "), /não entra na sugestão/);
  usarMemoriaDeTeste(null);
});

test("pedido em aberto que cobre a janela não gera compra e a emissão exige autorização", async () => {
  const coberto = montarCompras({
    produtos: [produto],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    pendentes: [{ produtoId: "10", quantidade: 20 }],
    entradas: [],
    qualidades: [],
  });
  assert.equal(coberto.itens.length, 0);
  usarMemoriaDeTeste({ solicitacoes: {}, emissaoAutorizada: false, historico: [] });
  const fatos = {
    produtos: [produto],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    pendentes: [],
    entradas: [{ produtoId: "10", fornecedorId: 8, fornecedor: "Mais barato", entrada: "2026-10-11", pedido: "2026-10-01", custo: 8 }],
    qualidades: [{ fornecedorId: 8, indice: 70 }],
  };
  const painel = await painelCompras({}, {}, { fatos });
  assert.equal(painel.itens[0].solicitacaoId, undefined);
  let gravacoes = 0;
  let emissoes = 0;
  const criada = await criarSolicitacao("compra:10", { id: 4, gerencial: true }, {
    gravarSolicitacao: () => {
      gravacoes += 1;
      return { id: 55 };
    },
  }, { fatos });
  assert.equal(criada.pedidoEmitido, false);
  assert.equal(criada.solicitacaoId, 55);
  await assert.rejects(() => emitirPedido("compra:10", { id: 4, gerencial: true }, {
    emitirPedido: () => { emissoes += 1; },
  }), /não está autorizada/);
  assert.equal(emissoes, 0);
  await autorizarEmissao({ autorizada: true }, { id: 4, gerencial: true });
  const emitida = await emitirPedido("compra:10", { id: 4, gerencial: true }, {
    emitirPedido: () => { emissoes += 1; },
  });
  assert.equal(emitida.pedidoEmitido, true);
  assert.equal(emissoes, 1);
  assert.equal(gravacoes, 1);
  await assert.rejects(() => criarSolicitacao("compra:11", { id: 4, gerencial: false }, {}, { fatos }), /gerencial/);
  usarMemoriaDeTeste(null);
});
