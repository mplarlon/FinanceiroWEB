import test from "node:test";
import assert from "node:assert/strict";
import { identificarCampanhas } from "../server/lib/charlie-smart-campaigns.js";
import { autorizarPublicacao, criarCampanha, decidirCampanha, publicarCampanha, usarMemoriaDeTeste } from "../server/lib/charlie-smart-campaigns-service.js";

const hoje = "2026-10-26";
const produto = (id, extra = {}) => ({ externalId: id, name: extra.nome || id, price: extra.preco ?? 100, cost: extra.custo ?? null, stock: extra.saldo ?? null, reference: id });

test("custo ausente não vira margem e estoque parado não ganha preço sugerido", () => {
  const painel = identificarCampanhas({
    products: { A: produto("A", { saldo: 4, custo: null }), B: produto("B", { saldo: 0, custo: 0, preco: 100 }) },
    orders: {},
  }, { hoje });
  const parado = painel.sugestoes.find((item) => item.tipo === "parado");
  assert.equal(parado.produtoId, "A");
  assert.equal(parado.precoSugerido, null);
  assert.equal(parado.meta, null);
  assert.equal(parado.publico, null);
  assert.equal(parado.inicio, null);
  assert.equal(painel.sugestoes.some((item) => item.tipo === "margem_alta"), false);
});

test("queda observada, mês recorrente e compra conjunta não viram equivalência", () => {
  const pedido = (data, itens) => ({ status: "pago", date: data, items: itens.map((id) => ({ externalId: id, quantity: id === "Q" ? 1 : 1, reference: id })) });
  const painel = identificarCampanhas({
    products: { Q: produto("Q", { nome: "Cabo" }), S: produto("S", { nome: "Luva" }), C: produto("C", { nome: "Conector" }) },
    orders: {
      1: { status: "pago", date: "2026-06-01", items: [{ externalId: "Q", quantity: 10 }] },
      2: { status: "pago", date: "2026-10-01", items: [{ externalId: "Q", quantity: 4 }] },
      3: { status: "pago", date: "2024-10-02", items: [{ externalId: "S", quantity: 1 }] },
      4: { status: "pago", date: "2025-10-03", items: [{ externalId: "S", quantity: 1 }] },
      5: pedido("2026-09-01", ["C", "Q"]),
      6: pedido("2026-09-02", ["C", "Q"]),
      7: pedido("2026-09-03", ["C", "Q"]),
    },
  }, { hoje });
  const queda = painel.sugestoes.find((item) => item.tipo === "queda");
  assert.match(queda.descricao, /causa não foi inferida/i);
  const sazonal = painel.sugestoes.find((item) => item.tipo === "sazonal");
  assert.equal(sazonal.inicio, null);
  assert.equal(sazonal.fim, null);
  const cruzada = painel.sugestoes.find((item) => item.tipo === "venda_cruzada");
  assert.match(cruzada.descricao, /não comprova compatibilidade/);
  assert.equal(cruzada.precoSugerido, null);
});

test("aprovar não publica e a publicação exige autorização prévia", () => {
  const store = { products: { A: produto("A", { saldo: 3, nome: "Filtro" }) }, orders: {} };
  usarMemoriaDeTeste({ campanhas: {}, autorizada: false, historico: [] });
  const criada = criarCampanha("campanha:parado:A", { id: 4, gerencial: true }, store, { hoje });
  assert.equal(criada.campanha.enviada, false);
  const aprovada = decidirCampanha(criada.campanha.id, "aprovada", { id: 4, gerencial: true });
  assert.equal(aprovada.publicada, false);
  assert.throws(() => publicarCampanha(aprovada.id, { id: 4, gerencial: true }), /não está autorizada/);
  autorizarPublicacao(true, { id: 4, gerencial: true });
  const publicada = publicarCampanha(aprovada.id, { id: 4, gerencial: true });
  assert.equal(publicada.publicada, true);
  assert.equal(publicada.enviada, false);
  assert.equal(publicada.canal, null);
  assert.throws(() => criarCampanha("campanha:parado:A", { id: 4, gerencial: false }, store, { hoje }), /gerencial/);
  usarMemoriaDeTeste(null);
});
