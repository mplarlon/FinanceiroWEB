import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTrayProduct } from "../server/lib/ecommerce-intelligence.js";
import {
  acceptListingSuggestion,
  analyzeMarketplaceListings,
  composeListingSuggestion,
  contentPayload,
  decideBoosterFinding,
  markBoosterApplied,
  markBoosterManual,
  mergeBoosterState,
  previousContent,
  recordBoosterSuggestion,
} from "../server/lib/marketplace-booster.js";

const day = (iso) => iso;

test("a normalização guarda texto e imagem só quando a Tray enviou o campo", () => {
  const withContent = normalizeTrayProduct({ id: 7, name: "Rolamento", description: "", image: "0", brand: "SKF" });
  assert.equal(withContent.description, "");
  assert.equal(withContent.imagesObserved, true);
  assert.equal(withContent.imageCount, 0);
  assert.equal(withContent.imageUrl, null);
  const comFoto = normalizeTrayProduct({
    id: 9,
    name: "Demo",
    ProductImage: [{
      https: "https://images.tcdn.com.br/img/img_prod/1/foto.jpg",
      thumbs: { 90: { https: "https://images.tcdn.com.br/img/img_prod/1/90_foto.jpg" } },
    }],
  });
  assert.equal(comFoto.imageCount, 1);
  assert.equal(comFoto.imageUrl, "https://images.tcdn.com.br/img/img_prod/1/90_foto.jpg");
  const listed = normalizeTrayProduct({ id: 8, name: "Retentor", price: "10.5", stock: "2" });
  assert.equal("description" in listed, false);
  assert.equal("imagesObserved" in listed, false);
  assert.equal(listed.price, 10.5);
});

test("o booster só aponta problema com evidência e não compara concorrente", () => {
  const store = {
    products: {
      curto: { externalId: "curto", name: "6205", reference: "6205", price: 10, cost: 12, stock: 4, description: "", descriptionSmall: "", imagesObserved: true, imageCount: 0, brand: "SKF" },
      completo: { externalId: "completo", name: "Rolamento SKF 6205 blindado", reference: "ABC", price: 50, cost: 20, stock: 2, description: "Descrição completa do rolamento com aplicação informada no cadastro e orientação de conferência.", imagesObserved: true, imageCount: 2, brand: "SKF" },
      medida: { externalId: "medida", name: "Bucha de bronze industrial", reference: "BU-1", price: 30, cost: null, stock: 1, description: "Descrição longa o bastante para não ser tratada como texto insuficiente no anúncio." },
    },
    orders: {
      antigo: { status: "Aprovado", date: day("2026-09-01"), marketplace: "Mercado Livre", items: [{ externalId: "completo", quantity: 3 }] },
      recente: { status: "Aprovado", date: day("2026-10-20"), marketplace: "Mercado Livre", items: [{ externalId: "completo", quantity: 0 }] },
    },
  };
  const erp = [{ code: "SEM-ANUNCIO", name: "Correia dentada", brand: "Gates", manufacturerCode: "", barcode: "", stock: 8, hasImage: false, length: 10, width: null, thickness: null, weight: null }];
  const result = analyzeMarketplaceListings(store, { erpProducts: [...erp, { code: "ABC", name: "Rolamento", brand: "SKF", stock: 2, length: 10 }], minimumMargin: 15 });
  const problems = result.findings.map((item) => item.problem);
  assert.equal(problems.some((item) => /concorr|competitiv/i.test(item)), false);
  assert.ok(problems.includes("Título pouco informativo"));
  assert.ok(problems.includes("Descrição ausente"));
  assert.ok(problems.includes("Sem imagem"));
  assert.ok(problems.includes("Rentabilidade negativa"));
  assert.ok(problems.includes("Queda de vendas"));
  assert.ok(problems.includes("Medidas do cadastro não aparecem na descrição"));
  assert.ok(problems.includes("Estoque no ERP sem anúncio na Tray"));
  assert.equal(result.findings.some((item) => item.reference === "ABC" && item.problem === "Estoque no ERP sem anúncio na Tray"), false);
  const decline = result.findings.find((item) => item.problem === "Queda de vendas");
  assert.equal(decline.marketplace, "Mercado Livre");
  const image = result.findings.find((item) => item.problem === "Sem imagem");
  assert.equal(image.execution, "manual");
  assert.match(image.limitation, /imagem/);
  const margin = result.findings.find((item) => item.problem === "Rentabilidade negativa");
  assert.equal(margin.execution, "manual");

  const shortHistory = analyzeMarketplaceListings({
    products: { p: { externalId: "p", name: "Produto com nome suficiente", stock: 5, price: 10, cost: null } },
    orders: { a: { status: "Aprovado", date: "2026-10-20", marketplace: "Shopee", items: [{ externalId: "outro", quantity: 1 }] } },
  }, { erpProducts: [] });
  assert.equal(shortHistory.findings.some((item) => item.problem === "Queda de vendas" || item.problem === "Estoque sem venda no histórico sincronizado"), false);
  assert.equal(shortHistory.findings.some((item) => item.problem === "Descrição ausente"), false);
});

test("a sugestão usa o cadastro e recusa número ou unidade estranhos", () => {
  const facts = { nome: "Rolamento 6205", marca: "SKF", referencia: "6205", categoria: "Rolamentos", modelo: "", codigoFabricante: "6205-2RS", medidas: "comprimento 10" };
  const suggestion = composeListingSuggestion(facts);
  assert.match(suggestion.name, /SKF/);
  assert.match(suggestion.description, /comprimento 10/);
  assert.equal(suggestion.source, "cadastro");
  assert.equal(acceptListingSuggestion({ ...suggestion, description: "Peça de 99 mm com garantia vitalícia", source: "ollama" }, facts).ok, false);
  const accepted = acceptListingSuggestion({ name: "Rolamento 6205 SKF", description: "Rolamento 6205 da marca SKF.", description_small: "Rolamento 6205", keywords: "rolamento, skf", source: "ollama" }, facts);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.suggestion.source, "ollama");
});

test("aprovação, aplicação manual e histórico preservam a decisão", () => {
  const analysis = analyzeMarketplaceListings({
    products: { p: { externalId: "p", name: "Abc", reference: "p", description: "", imagesObserved: true, imageCount: 1, price: 10, cost: 4, stock: 0 } },
    orders: {},
  }, { erpProducts: [], minimumMargin: 15 });
  let state = mergeBoosterState({ findings: {} }, analysis, "2026-10-26T12:00:00.000Z");
  const title = Object.values(state.findings).find((item) => item.problem === "Título pouco informativo");
  const image = Object.values(state.findings).find((item) => item.type === "image");
  assert.equal(image, undefined);
  state = recordBoosterSuggestion(state, title.id, composeListingSuggestion({ nome: "Abc industrial", marca: "NSK" }), { idusuario: 7 });
  state = decideBoosterFinding(state, title.id, "approve", { idusuario: 7 });
  assert.equal(state.findings[title.id].status, "approved");
  assert.throws(() => markBoosterManual(state, title.id, { idusuario: 7 }), /Tray/);
  const kept = mergeBoosterState(state, analysis, "2026-10-26T13:00:00.000Z");
  assert.equal(kept.findings[title.id].status, "approved");
  assert.equal(kept.findings[title.id].suggestion.name.includes("NSK"), true);
  const previous = previousContent({ name: "Abc", description: "" });
  const applied = markBoosterApplied(kept, title.id, { idusuario: 7 }, { previous, result: { ok: true } });
  assert.equal(applied.findings[title.id].status, "applied");
  assert.equal(applied.findings[title.id].previous.name, "Abc");
  assert.deepEqual(contentPayload(previous).description, "");
  assert.equal("metatag" in contentPayload({ description: null }), false);
});
