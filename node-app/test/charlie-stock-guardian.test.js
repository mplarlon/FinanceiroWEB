import test from "node:test";
import assert from "node:assert/strict";
import { montarGuardian } from "../server/lib/charlie-stock-guardian.js";
import { painelEstoque, registrarAcao, usarMemoriaDeTeste } from "../server/lib/charlie-stock-guardian-service.js";

const base = { id: "10", nome: "Filtro", saldo: 10, minimo: 0, maximo: 0, seguranca: 0 };

test("cobertura usa a saída do ERP e deixa reservado e prazo em branco", () => {
  const painel = montarGuardian({
    produtos: [base],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    pendentes: [],
    depositos: [{ produtoId: "10", depositoId: 1, deposito: "Loja", saldo: 10 }],
    tray: [{ referencia: "10", saldo: 4, canais: [{ canal: "Shopee", quantidade: 50 }] }],
  }, { janelaDias: 15 });
  const item = painel.itens[0];
  assert.equal(item.demandaDia, 1);
  assert.equal(item.cobertura, 10);
  assert.equal(item.reservado, null);
  assert.equal(item.prazoFornecedor, null);
  assert.ok(item.situacoes.includes("ruptura"));
  assert.ok(item.situacoes.includes("divergencia"));
  assert.equal(item.canaisTray[0].quantidade, 50);
  assert.equal(item.compra.quantidade, 5);
  assert.match(item.prioridade.aviso, /Não é probabilidade de ruptura/);
  assert.match(painel.aviso, /Nenhuma quantidade física/);
});

test("sem saída e saldo positivo fica parado, sem campanha publicada", () => {
  const painel = montarGuardian({
    produtos: [{ ...base, saldo: 8 }],
    vendas: [],
    pendentes: [],
    depositos: [],
    tray: [],
  });
  assert.deepEqual(painel.itens[0].situacoes, ["parado"]);
  assert.equal(painel.itens[0].campanha.publicada, false);
  assert.equal(painel.itens[0].compra, null);
});

test("saída sem quantidade não vira estoque parado", () => {
  const painel = montarGuardian({
    produtos: [{ ...base, saldo: 8 }],
    vendas: [{ produtoId: "10", quantidade: null }],
    pendentes: [{ produtoId: "10", quantidade: null }],
    depositos: [],
    tray: [],
  });
  assert.equal(painel.itens.length, 0);
  assert.match(painel.lacunas.join(" "), /não entra como parado/);
  assert.match(painel.lacunas.join(" "), /não foi descontado/);
});

test("canal da Tray sem quantidade não vira zero", async () => {
  usarMemoriaDeTeste({ acoes: {}, historico: [] });
  const painel = await painelEstoque({
    query: async (sql) => {
      if (String(sql).includes("FROM PRODUTO")) return [{ CDPRODUTO: "10", PRODUTO: "Filtro", SALDO: 8, MINIMO: 0, MAXIMO: 0, SEGURANCA: 0 }];
      return [];
    },
    store: () => ({
      products: { P: { reference: "10", stock: 4 } },
      orders: {
        O1: { status: "Aprovado", marketplace: "Shopee", items: [{ reference: "10", quantity: null }] },
        O2: { status: "Aprovado", marketplace: "Magalu", items: [{ reference: "10", quantity: 0 }] },
      },
    }),
  }, {}, {});
  const canais = painel.itens[0].canaisTray;
  assert.equal(canais.find((item) => item.canal === "Shopee").quantidade, null);
  assert.equal(canais.find((item) => item.canal === "Magalu").quantidade, 0);
});

test("a consulta não transforma quantidade ausente em zero", async () => {
  usarMemoriaDeTeste({ acoes: {}, historico: [] });
  const consultas = [];
  const incompleto = await painelEstoque({
    query: async (sql) => {
      consultas.push(String(sql));
      if (String(sql).includes("FROM PRODUTO")) return [{ CDPRODUTO: "10", PRODUTO: "Filtro", SALDO: 8, MINIMO: 0, MAXIMO: 0, SEGURANCA: 0 }];
      if (String(sql).includes("ORDEMCOMPRAPROD")) return [{ CDPRODUTO: "10", QTD: 4, SEM_QTD: 1 }];
      if (String(sql).includes("SAIDAPRODUTO")) return [{ CDPRODUTO: "10", QTD: 3, SEM_QTD: 1 }];
      return [];
    },
    store: () => ({ products: {}, orders: {} }),
  }, {}, {});
  const pedido = consultas.find((sql) => sql.includes("ORDEMCOMPRAPROD"));
  const saida = consultas.find((sql) => sql.includes("SAIDAPRODUTO"));
  assert.doesNotMatch(pedido, /COALESCE\(op\.QTDE,0\)/);
  assert.match(pedido, /op\.QTDE IS NULL/);
  assert.match(saida, /QTDPRODUTO IS NULL/);
  assert.equal(incompleto.itens.length, 0);
  assert.match(incompleto.lacunas.join(" "), /não foi descontado/);
  assert.match(incompleto.lacunas.join(" "), /não entra como parado/);
  const zerado = await painelEstoque({
    query: async (sql) => {
      if (String(sql).includes("FROM PRODUTO")) return [{ CDPRODUTO: "10", PRODUTO: "Filtro", SALDO: 8, MINIMO: 0, MAXIMO: 0, SEGURANCA: 0 }];
      if (String(sql).includes("ORDEMCOMPRAPROD")) return [{ CDPRODUTO: "10", QTD: 0, SEM_QTD: 0 }];
      return [];
    },
    store: () => ({ products: {}, orders: {} }),
  }, {}, {});
  assert.equal(zerado.itens[0].pendente, 0);
  assert.equal(zerado.itens[0].situacoes.includes("parado"), true);
  assert.doesNotMatch(zerado.lacunas.join(" "), /não foi descontado/);
  usarMemoriaDeTeste(null);
});

test("saldo nulo não vira zero e pedido em aberto pode cobrir a janela", () => {
  const semSaldo = montarGuardian({
    produtos: [{ ...base, saldo: null }],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    pendentes: [],
    depositos: [],
    tray: [],
  });
  assert.equal(semSaldo.itens.length, 0);
  const coberto = montarGuardian({
    produtos: [base],
    vendas: [{ produtoId: "10", quantidade: 90 }],
    pendentes: [{ produtoId: "10", quantidade: 10 }],
    depositos: [],
    tray: [],
  }, { janelaDias: 15 });
  assert.equal(coberto.itens[0].compra, null);
  assert.equal(coberto.itens[0].coberturaComPedido, 20);
});

test("redistribuição só descreve depósitos e a ação não muda o saldo", async () => {
  const fatos = {
    produtos: [{ ...base, saldo: 5, maximo: 2 }],
    vendas: [],
    pendentes: [],
    depositos: [
      { produtoId: "10", depositoId: 1, deposito: "Matriz", saldo: 5 },
      { produtoId: "10", depositoId: 2, deposito: "Filial", saldo: 0 },
    ],
    tray: [],
  };
  const painel = montarGuardian(fatos);
  assert.equal(painel.itens[0].redistribuicao.origem, "Matriz");
  assert.match(painel.itens[0].redistribuicao.texto, /Nenhuma transferência/);
  assert.ok(painel.itens[0].situacoes.includes("excesso"));
  usarMemoriaDeTeste({ acoes: {}, historico: [] });
  const registro = await registrarAcao("estoque:10", "alerta", { id: 4, gerencial: true }, {}, { fatos });
  const deNovo = await registrarAcao("estoque:10", "alerta", { id: 4, gerencial: true }, {}, { fatos });
  assert.equal(registro.saldo, 5);
  assert.equal(deNovo.repetida, true);
  const visto = await painelEstoque({}, { fatos });
  assert.equal(visto.itens[0].saldo, 5);
  assert.equal(visto.itens[0].acoes.length, 1);
  await assert.rejects(() => registrarAcao("estoque:10", "redistribuicao", { id: 4, gerencial: false }, {}, { fatos }), /gerencial/);
  usarMemoriaDeTeste(null);
});
