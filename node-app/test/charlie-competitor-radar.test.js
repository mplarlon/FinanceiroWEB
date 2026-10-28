import test from "node:test";
import assert from "node:assert/strict";
import { compararReferencia, confiancaCorrespondencia } from "../server/lib/charlie-competitor-radar.js";
import { cadastrarReferencia, montarRadar, registrarConsulta, usarMemoriaDeTeste } from "../server/lib/charlie-competitor-radar-service.js";

const nosso = { nome: "Cabo 2,5mm", marca: "Pontual", codigo: "CB25", modelo: "2,5mm", preco: 30 };
const store = { products: [{ id: "P1", name: "Cabo 2,5mm", brand: "Pontual", reference: "CB25", price: 30 }] };

test("código diferente não vira equivalente", () => {
  const confianca = confiancaCorrespondencia(nosso, { marca: "Pontual", codigo: "OUTRO", modelo: "2,5mm" });
  assert.equal(confianca, "insuficiente");
  const comparacao = compararReferencia(nosso, {
    concorrente: { marca: "Pontual", codigo: "OUTRO", modelo: "2,5mm" },
    fonte: { nome: "Anúncio informado" },
    consulta: { em: "2026-10-26", preco: 10 },
  });
  assert.equal(comparacao.alerta, null);
  assert.equal(comparacao.precoReferencia, null);
  assert.equal(comparacao.frete, null);
});

test("mesma marca e código geram alerta com fonte e data", () => {
  const comparacao = compararReferencia(nosso, {
    concorrente: { marca: "Pontual", codigo: "CB25", modelo: "2,5mm" },
    fonte: { nome: "Página do anúncio" },
    consulta: { em: "2026-10-26", preco: 22, disponibilidade: "disponível" },
  });
  assert.equal(comparacao.confianca, "alta");
  assert.equal(comparacao.fonte, "Página do anúncio");
  assert.equal(comparacao.consultadoEm, "2026-10-26");
  assert.match(comparacao.alerta, /acima da referência cadastrada/);
  assert.equal(comparacao.frete, null);
});

test("marca e modelo sem código não disparam alerta", () => {
  const comparacao = compararReferencia(
    { ...nosso, codigo: null },
    { concorrente: { marca: "Pontual", modelo: "2,5mm" }, fonte: { nome: "Catálogo" }, consulta: { em: "2026-10-26", preco: 10 } },
  );
  assert.equal(comparacao.confianca, "media");
  assert.equal(comparacao.alerta, null);
  assert.equal(comparacao.precoReferencia, 10);
});

test("nova consulta registra a mudança de preço e não busca a internet", () => {
  const memoria = { referencias: [], historico: [] };
  usarMemoriaDeTeste(memoria);
  const criada = cadastrarReferencia({
    productId: "P1",
    fonte: { nome: "Anúncio informado", url: "https://exemplo.invalid/anuncio" },
    concorrente: { nome: "Cabo concorrente", marca: "Pontual", codigo: "CB25" },
    consulta: { em: "2026-10-20", preco: 25 },
  }, { idusuario: 7 }, store);
  const atualizada = registrarConsulta(criada.id, { em: "2026-10-26", preco: 21, frete: 12 }, { idusuario: 7 }, store);
  assert.equal(atualizada.alteracao.de, 25);
  assert.equal(atualizada.alteracao.para, 21);
  assert.equal(atualizada.consulta.frete, 12);
  const painel = montarRadar(store);
  assert.equal(painel.alertas.length, 1);
  assert.equal(painel.alertas[0].confianca, "alta");
  assert.match(painel.aviso, /não consulta a internet/);
  usarMemoriaDeTeste(null);
});
