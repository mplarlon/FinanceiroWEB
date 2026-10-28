import assert from "node:assert/strict";
import test from "node:test";
import {
  classificarItem,
  confirmarOrcamento,
  interpretarTabela,
  interpretarTexto,
  linhaDePedido,
  resumirOrcamento,
} from "../server/lib/charlie-smart-quotes.js";
import { confirmar, interpretarEntrada, usarMemoriaDeTeste } from "../server/lib/charlie-smart-quotes-service.js";

const cabo = { codigo: "55", nome: "Cabo flexível", preco: 12.5, estoque: 3 };
const outro = { codigo: "56", nome: "Cabo rígido", preco: 9, estoque: 1 };

test("o texto e a planilha extraem quantidade sem inventar item solto", () => {
  assert.equal(linhaDePedido("bom dia"), null);
  assert.equal(interpretarTexto("qual o preço do cabo").length, 0);
  const linhas = interpretarTexto("10 cabo flexível\nCABO123;4\n55");
  assert.equal(linhas[0].quantidade, 10);
  assert.equal(linhas[1].codigo, "CABO123");
  assert.equal(linhas[1].quantidade, 4);
  assert.equal(linhas[2].quantidade, null);
  const tabela = interpretarTabela([
    ["codigo", "descricao", "quantidade"],
    ["55", "Cabo flexível", "2"],
    ["", "parafuso", ""],
  ]);
  assert.equal(tabela[0].codigo, "55");
  assert.equal(tabela[0].quantidade, 2);
  assert.equal(tabela[1].quantidade, null);
});

test("produto parecido não entra no total e o código ausente não é substituído", () => {
  const ambiguo = classificarItem({ descricao: "cabo", quantidade: 2 }, { disponivel: true, produtos: [cabo, outro] });
  const unico = classificarItem({ descricao: "flexivel", quantidade: 2 }, { disponivel: true, produtos: [cabo] });
  const ausente = classificarItem({ codigo: "NAOEXISTE", descricao: "NAOEXISTE", quantidade: 1 }, { disponivel: true, produtos: [] });
  assert.equal(ambiguo.situacao, "ambiguo");
  assert.equal(ambiguo.produto, null);
  assert.equal(unico.situacao, "revisar");
  assert.equal(unico.produto, null);
  assert.match(ausente.aviso, /equivalência/);
  const resumo = resumirOrcamento([
    ambiguo,
    classificarItem({ codigo: "55", descricao: "55", quantidade: 2 }, { disponivel: true, exato: cabo, produtos: [cabo] }),
    classificarItem({ codigo: "77", descricao: "77", quantidade: 1 }, { disponivel: true, exato: { codigo: "77", nome: "Sem preço", preco: null, estoque: null }, produtos: [] }),
  ]);
  assert.equal(resumo.total, 25);
  assert.equal(resumo.totalParcial, true);
  assert.throws(() => confirmarOrcamento({ itens: [ambiguo] }), /Escolha o produto/);
});

test("a confirmação guarda o rascunho e não cria número de ORCAMENTO", async () => {
  usarMemoriaDeTeste({ orcamentos: [] });
  const criado = await interpretarEntrada({ texto: "2 CABO123", origem: "texto" }, {
    query: async () => [{ CDPRODUTO: "CABO123", PRODUTO: "Cabo", PRECO: 10, ESTOQUE: 4, UNIDADE: "UN" }],
  });
  const confirmado = confirmar(criado.orcamento.id);
  assert.equal(confirmado.status, "confirmado");
  assert.equal(confirmado.gravadoNoErp, false);
  assert.equal(confirmado.nrorcamento, undefined);
  assert.equal(confirmado.total, 20);
  assert.match(confirmado.motivo, /não grava ORCAMENTO/);
  const imagem = await interpretarEntrada({ nome: "lista.png", conteudo: Buffer.from("nada").toString("base64") }, {});
  assert.equal(imagem.orcamento, null);
  assert.match(imagem.aviso, /Imagem não é lida/);
});
