import test from "node:test";
import assert from "node:assert/strict";
import { sugerirSeo } from "../server/lib/charlie-seo.js";
import { painelSeo } from "../server/lib/charlie-seo-service.js";

const completo = {
  externalId: "1",
  reference: "CB",
  name: "Cabo flexível 2,5 mm",
  description: "Cabo flexível de cobre",
  brand: "Cabo",
  model: "2,5 mm",
};

test("a sugestão só usa campos cadastrados e não inventa descrição", () => {
  const painel = sugerirSeo({
    produtos: [
      completo,
      { externalId: "2", reference: "SV", name: "Produto sem descrição" },
      { externalId: "3", reference: "HTML", name: "Tomada", description: "<p>Tomada <b>10A</b></p>", brand: "Tramontina" },
      { externalId: "4", reference: "DUP", name: "Cabo flexível 2,5 mm", description: "Outro texto" },
      { externalId: "5", reference: "ERP", name: "Produto sem descrição", description: "" },
    ],
    nomesErp: { ERP: "Disjuntor bipolar", CB: "Cabo no ERP" },
  });
  assert.equal(painel.itens.some((item) => item.id === "1"), true);
  const pronto = painel.itens.find((item) => item.id === "1");
  assert.equal(pronto.nomesDiferentes, true);
  assert.equal(pronto.origemTitulo, "tray");
  assert.match(pronto.tituloSugerido, /^Cabo flexível/);
  const sem = painel.itens.find((item) => item.id === "2");
  assert.equal(sem.tituloSugerido, null);
  assert.equal(sem.descricaoSugerida, null);
  assert.ok(sem.faltas.includes("descricao_nao_sincronizada"));
  assert.ok(sem.faltas.includes("titulo"));
  const html = painel.itens.find((item) => item.id === "3");
  assert.equal(html.descricaoSugerida, "Tomada 10A");
  assert.equal(html.tituloSugerido, "Tomada Tramontina");
  assert.equal(html.caminhoSugerido, "/tomada-tramontina");
  const repetido = painel.itens.find((item) => item.id === "4");
  assert.equal(repetido.caminhoRepetido, true);
  const erp = painel.itens.find((item) => item.id === "5");
  assert.equal(erp.tituloSugerido, "Disjuntor bipolar");
  assert.equal(erp.origemTitulo, "erp");
  assert.equal(erp.descricaoSugerida, null);
  assert.equal(erp.urlPublicada, null);
  assert.match(painel.aviso, /Nenhum texto foi gravado/);
  assert.equal(JSON.stringify(painel).includes("volume de busca"), false);
});

test("a consulta não grava o catálogo", async () => {
  let gravou = false;
  const painel = await painelSeo({
    store: () => {
      gravou = true;
      return { products: { 1: completo } };
    },
  }, { nomesErp: { CB: "Cabo no ERP" } });
  assert.equal(gravou, true);
  assert.equal(painel.lidos, 1);
  assert.equal(painel.itens[0].origemTitulo, "tray");
  assert.equal(painel.semDescricao, 0);
});
