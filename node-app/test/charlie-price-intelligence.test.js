import assert from "node:assert/strict";
import test from "node:test";
import { avaliarProposta, margemSobrePreco, painelPrecos, precoMinimo, rentabilidadePorCanal, simularPreco, vendasDoProduto } from "../server/lib/charlie-price-intelligence.js";

const regras = { minimumMargin: 20, maximumAutomaticChange: 5, protegidos: ["B1"], pisos: { P1: 80 }, canais: { Shopee: 30 } };

test("preço mínimo e margem usam só preço e custo", () => {
  assert.equal(margemSobrePreco(100, null), null);
  assert.equal(precoMinimo(null, 20), null);
  assert.equal(precoMinimo(40, 20), 50);
  assert.equal(margemSobrePreco(100, 40), 60);
  const simulacao = simularPreco({ id: "P1", nome: "Cabo", preco: 100, custo: 40 }, { desconto: 10 }, regras);
  assert.equal(simulacao.proposto, 90);
  assert.equal(simulacao.margemProposta, 55.6);
  assert.equal(simulacao.componentes.imposto, null);
  assert.equal(simulacao.componentes.taxa, null);
  assert.match(simulacao.componentes.motivo, /não estão conciliados/i);
  assert.equal(simularPreco({ id: "P1", preco: 100, custo: 40 }, { reajuste: 10 }, regras).excedeuTeto, true);
  assert.equal(simularPreco({ id: "P1", preco: 100, custo: 40 }, { desconto: 25 }, regras).abaixoDoPiso, true);
  assert.equal(simularPreco({ id: "B1", preco: 100, custo: 40 }, { reajuste: 1 }, regras).bloqueado, true);
  assert.equal(simularPreco({ id: "P2", preco: 100, custo: 40 }, { desconto: 5, canal: "Shopee" }, regras).margemAlvo, 30);
});

test("canal sem taxa e modo análise não gravam alteração", () => {
  const canais = rentabilidadePorCanal([{ canal: "Shopee", quantidade: 2, receita: 200 }], 40);
  assert.equal(canais[0].contribuicao, 120);
  assert.equal(canais[0].taxa, null);
  assert.equal(rentabilidadePorCanal([{ canal: "Shopee", quantidade: 2, receita: 200 }], null)[0].contribuicao, null);
  const semValor = rentabilidadePorCanal([{ canal: "Shopee", quantidade: null, receita: null }], 40)[0];
  assert.equal(semValor.receita, null);
  assert.equal(semValor.contribuicao, null);
  assert.equal(rentabilidadePorCanal([{ canal: "Shopee", quantidade: 0, receita: 0 }], 40)[0].receita, 0);
  const painel = painelPrecos({
    products: { P1: { externalId: "P1", name: "Cabo", price: 100, cost: null } },
    orders: { O1: { status: "Aprovado", marketplace: "Shopee", items: [{ externalId: "P1", quantity: 1, total: 100 }] } },
  }, regras);
  assert.equal(painel[0].margem, null);
  assert.equal(painel[0].imagem, null);
  const comFoto = painelPrecos({
    products: { P1: { externalId: "P1", name: "Cabo", price: 100, cost: 40, imageUrl: "https://images.tcdn.com.br/img/img_prod/1/90_foto.jpg" } },
    orders: {},
  }, regras);
  assert.equal(comFoto[0].imagem, "https://images.tcdn.com.br/img/img_prod/1/90_foto.jpg");
  assert.equal(painelPrecos({ products: { P1: { externalId: "P1", name: "Cabo", price: 100, imageUrl: "https://evil.example/foto.jpg" } } }, regras)[0].imagem, null);
  assert.equal(painel[0].canais[0].taxa, null);
  assert.equal(painel[0].canais[0].receita, 100);
  const incompleto = vendasDoProduto({
    orders: { O1: { status: "Aprovado", marketplace: "Shopee", items: [
      { externalId: "P1", quantity: 1, total: null },
      { externalId: "P1", quantity: 2, total: 10 },
    ] } },
  }, "P1");
  assert.equal(incompleto[0].receita, null);
  assert.equal(incompleto[0].quantidade, 3);
  assert.match(incompleto[0].observacao, /sem valor/);
  assert.equal(avaliarProposta({ bloqueado: false, abaixoDoPiso: false, custo: 10, excedeuTeto: false, abaixoDaMargem: false }, "analysis").gravar, false);
  assert.equal(avaliarProposta({ bloqueado: false, abaixoDoPiso: false, custo: 10, excedeuTeto: true, abaixoDaMargem: false }, "automatic").gravar, false);
  assert.equal(avaliarProposta({ bloqueado: false, abaixoDoPiso: false, custo: 10, excedeuTeto: true, abaixoDaMargem: false }, "manual").gravar, true);
});
