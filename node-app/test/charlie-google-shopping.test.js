import test from "node:test";
import assert from "node:assert/strict";
import { conferirCatalogo } from "../server/lib/charlie-google-shopping.js";
import { painelShopping } from "../server/lib/charlie-google-shopping-service.js";

const completo = {
  externalId: "1",
  reference: "CB",
  name: "Cabo",
  description: "Cabo flexível",
  brand: "Marca",
  price: 10,
  available: 3,
  imagesObserved: true,
  imageCount: 1,
};

test("campo ausente não vira zero e o Google não é consultado", () => {
  const painel = conferirCatalogo({
    produtos: [
      completo,
      { externalId: "2", reference: "SV", name: "Produto sem descrição", price: null, brand: "" },
      { externalId: "3", reference: "ST", name: "Sem saldo", description: "Texto", brand: "Marca", price: 8, imagesObserved: true, imageCount: 1 },
      { externalId: "4", reference: "DV", name: "Divergente", description: "Texto", brand: "Marca", price: 10, available: 1, imagesObserved: true, imageCount: 1 },
    ],
    precosErp: { CB: 10, DV: 12, ST: 0 },
    errosTray: [{ at: "2026-10-26", message: "Tempo esgotado na Tray" }],
  });
  assert.equal(painel.itens.some((item) => item.id === "1"), false);
  const sem = painel.itens.find((item) => item.id === "2");
  assert.equal(sem.preco, null);
  assert.ok(sem.faltas.includes("descricao_nao_sincronizada"));
  assert.ok(sem.faltas.includes("titulo"));
  assert.match(sem.sugestao, /não grava título/);
  const saldo = painel.itens.find((item) => item.id === "3");
  assert.equal(saldo.disponibilidade, null);
  assert.equal(saldo.precoErp, null);
  assert.equal(saldo.divergencia, null);
  const divergente = painel.itens.find((item) => item.id === "4");
  assert.equal(divergente.divergencia, -2);
  assert.equal(painel.errosTray[0].origem, "sincronizacao_tray");
  assert.deepEqual(painel.errosGoogle, []);
  assert.match(painel.aviso, /não consulta o Google|catálogo já sincronizado/i);
  assert.equal(painel.lidos, 4);
});

test("a consulta não grava anúncio", async () => {
  let gravou = false;
  const painel = await painelShopping({ store: () => { gravou = true; return { products: { 1: completo }, sync: { errors: [] } }; } }, { precosErp: { CB: 10 } });
  assert.equal(gravou, true);
  assert.equal(painel.incompletos, 0);
  assert.equal(painel.divergentes, 0);
  assert.equal(painel.errosGoogle.length, 0);
});
