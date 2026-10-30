import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptTecnospeedSuggestion,
  aggregateTecnospeedRows,
  analyzeTecnospeedProducts,
  buildTrayPayloadFromTecnospeed,
  composeTecnospeedSuggestion,
  decideTecnospeedItem,
  mapTecnospeedRow,
  markTecnospeedUploaded,
  mergeTecnospeedState,
  parseOllamaReview,
  recordTecnospeedSuggestion,
  reviewTecnospeedWithOllama,
} from "../server/lib/charlie-tecnospeed-review.js";

test("agrega depósitos da view pelo mesmo PRODUCTID", () => {
  const products = aggregateTecnospeedRows([
    { PRODUCTID: "10", NAME: "Buchão", BRAND: "SKF", PRICE: 12, STOCK: 2, WEIGHT: 0, CATEGORYID: "" },
    { PRODUCTID: "10", NAME: "Buchão", BRAND: "SKF", PRICE: 12, STOCK: 5, WEIGHT: 0, CATEGORYID: "" },
    { PRODUCTID: "11", NAME: "Outro", PRICE: 3, STOCK: 1 },
  ]);
  assert.equal(products.length, 2);
  assert.equal(products.find((item) => item.productId === "10").stock, 5);
});

test("análise marca falta de texto e bloqueio de criação sem categoria/peso", () => {
  const products = [
    mapTecnospeedRow({
      PRODUCTID: "2579",
      NAME: "ADAPTADOR",
      SKU: "2579",
      BRAND: "Tigre",
      PRICE: 1.9,
      STOCK: 10,
      CATEGORYID: "",
      WEIGHT: 0,
      DESCRIPTION: null,
    }),
  ];
  const result = analyzeTecnospeedProducts(products, { trayProducts: [] });
  assert.ok(result.findings.some((item) => item.problem === "Título pouco informativo"));
  assert.ok(result.findings.some((item) => item.problem === "Descrição ausente"));
  const title = result.findings.find((item) => item.type === "title");
  assert.equal(title.execution, "tray_upload");
  assert.equal(title.canUpload, false);
  assert.ok(title.gaps.includes("categoria"));
  assert.ok(title.gaps.includes("peso"));
});

test("produto completo sem Tray fica pronto para subir após IA", () => {
  const product = mapTecnospeedRow({
    PRODUCTID: "99",
    NAME: "Rolamento SKF 6205 blindado",
    SKU: "99",
    BRAND: "SKF",
    PRICE: 40,
    STOCK: 3,
    CATEGORYID: "15",
    WEIGHT: 0.2,
    LENGTH: 10,
    WIDTH: 5,
    HEIGHT: 5,
    DESCRIPTION: "Descrição completa do rolamento com aplicação e orientação de conferência.",
  });
  const result = analyzeTecnospeedProducts([product], { trayProducts: [] });
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].problem, /Pronto para revisar/);
  assert.equal(result.findings[0].canUpload, true);
});

test("sugestão rejeita número inventado e a subida monta o payload Tray", () => {
  const facts = {
    nome: "Rolamento SKF 6205",
    marca: "SKF",
    referencia: "6205",
    categoria: "15",
    modelo: "",
    codigoFabricante: "",
    medidas: "peso 0.2",
  };
  const safe = composeTecnospeedSuggestion(facts);
  assert.match(safe.name, /Rolamento/);
  const rejected = acceptTecnospeedSuggestion({
    name: "Rolamento 99mm",
    description: "Peça com 99mm",
    description_small: "99mm",
    keywords: "rolamento",
    source: "ollama",
  }, facts);
  assert.equal(rejected.ok, false);

  const analysis = analyzeTecnospeedProducts([mapTecnospeedRow({
    PRODUCTID: "6205",
    NAME: "Rolamento SKF 6205",
    SKU: "6205",
    BRAND: "SKF",
    PRICE: 40,
    STOCK: 2,
    CATEGORYID: "15",
    WEIGHT: 0.2,
    LENGTH: 10,
    WIDTH: 5,
    HEIGHT: 5,
    DESCRIPTION: "Descrição completa do rolamento com aplicação informada no cadastro.",
  })], { trayProducts: [] });
  let state = mergeTecnospeedState({}, analysis);
  const id = analysis.findings[0].id;
  state = recordTecnospeedSuggestion(state, id, safe, { id: 1 });
  state = decideTecnospeedItem(state, id, "approve", { id: 1 });
  const built = buildTrayPayloadFromTecnospeed(state.items[id]);
  assert.equal(built.gaps.length, 0);
  assert.equal(built.payload.reference, "6205");
  assert.equal(built.payload.category_id, 15);
  state = markTecnospeedUploaded(state, id, { id: 1 }, { trayId: "777", mode: "create", result: { ok: true } });
  assert.equal(state.items[id].status, "uploaded");
  assert.equal(state.items[id].trayId, "777");
});

test("a revisão exige resposta válida do Ollama", async () => {
  const facts = {
    nome: "Rolamento SKF 6205",
    marca: "SKF",
    referencia: "6205",
    categoria: "",
    modelo: "",
    codigoFabricante: "",
    medidas: "peso 0.2",
  };
  await assert.rejects(() => reviewTecnospeedWithOllama(facts, null), /Ollama/);
  await assert.rejects(() => reviewTecnospeedWithOllama(facts, async () => null), /não respondeu|Ollama/i);
  await assert.rejects(
    () => reviewTecnospeedWithOllama(facts, async () => JSON.stringify({
      name: "Rolamento 99mm",
      description_small: "99mm",
      description: "Peça com 99mm",
      keywords: "x",
    })),
    /número|recusada/i,
  );
  const ok = parseOllamaReview(JSON.stringify({
    name: "Rolamento SKF 6205",
    description_small: "Rolamento SKF referência 6205.",
    description: "Rolamento SKF 6205. Confira a compatibilidade antes da compra.",
    keywords: "rolamento, skf, 6205",
  }), facts);
  assert.equal(ok.ok, true);
  assert.equal(ok.suggestion.source, "ollama");
  const reviewed = await reviewTecnospeedWithOllama(facts, async () => JSON.stringify({
    name: "Rolamento SKF 6205 blindado",
    description_small: "Rolamento SKF 6205.",
    description: "Rolamento SKF referência 6205 com peso 0.2. Confira a compatibilidade antes da compra.",
    keywords: "rolamento, skf, 6205",
  }));
  assert.equal(reviewed.source, "ollama");
  assert.match(reviewed.name, /Rolamento/);
});
