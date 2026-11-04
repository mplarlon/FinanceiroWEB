import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptTecnospeedSuggestion,
  aggregateTecnospeedRows,
  analyzeTecnospeedProducts,
  applyResearchedSpecs,
  applyStoredMeasures,
  applyWebCategory,
  categoryFromProductGroup,
  availableFrommodulo_removidoFlag,
  forgetTecnospeedProduct,
  matchingmodulo_removidoProductId,
  publicTecnospeedReview,
  removeTecnospeedCharacteristic,
  tecnospeedRemovalMessage,
  tecnospeedRemovalTarget,
  buildmodulo_removidoPayloadFromTecnospeed,
  composeTecnospeedSuggestion,
  decideTecnospeedItem,
  mapTecnospeedRow,
  markTecnospeedUploaded,
  mergeTecnospeedState,
  parseOllamaReview,
  persistProposedCategory,
  productSpecUpdate,
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
  const result = analyzeTecnospeedProducts(products, { modulo_removidoProducts: [] });
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].problem, /Título pouco informativo/);
  assert.match(result.findings[0].problem, /Descrição ausente/);
  const title = result.findings[0];
  assert.equal(title.execution, "modulo_removido_upload");
  assert.equal(title.canUpload, false);
  assert.ok(title.gaps.includes("categoria"));
  assert.ok(title.gaps.includes("peso"));
});

test("produto completo sem modulo_removido fica pronto para subir após IA", () => {
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
  const result = analyzeTecnospeedProducts([product], { modulo_removidoProducts: [] });
  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].problem, /Pronto para revisar/);
  assert.equal(result.findings[0].canUpload, true);
});

test("sugestão rejeita número inventado e a subida monta o payload modulo_removido", () => {
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
  })], { modulo_removidoProducts: [] });
  let state = mergeTecnospeedState({}, analysis);
  const id = analysis.findings[0].id;
  state = recordTecnospeedSuggestion(state, id, safe, { id: 1 });
  state = decideTecnospeedItem(state, id, "approve", { id: 1 });
  state = decideTecnospeedItem(state, id, "unapprove", { id: 1 });
  assert.equal(state.items[id].status, "suggested");
  state = decideTecnospeedItem(state, id, "approve", { id: 1 });
  const built = buildmodulo_removidoPayloadFromTecnospeed(state.items[id]);
  assert.equal(built.gaps.length, 0);
  assert.equal(built.payload.reference, "6205");
  assert.equal(built.payload.category_id, 15);
  assert.equal(built.payload.available, 1);
  assert.equal("keywords" in built.payload, false);
  assert.equal(built.payload.metatag[0].type, "keywords");
  assert.equal(built.payload.metatag[0].local, 1);
  assert.match(built.payload.metatag[0].content, /rolamento/);
  state = markTecnospeedUploaded(state, id, { id: 1 }, { modulo_removidoId: "777", mode: "create", result: { ok: true } });
  assert.equal(state.items[id].status, "uploaded");
  assert.equal(state.items[id].modulo_removidoId, "777");
});

test("remover da fila apaga só a característica tecnospeed do produto", async () => {
  const calls = [];
  const tx = {
    singleton: async (sql) => {
      if (sql.includes("FROM CARACTERISTICAS")) return { CDCARACTER: 334 };
      if (sql.includes("FROM PRODUTOCARACTER")) return { QTD: 1 };
      if (sql.includes("INATIVA_modulo_removido")) return { QTD: 1 };
      return null;
    },
    execute: async (sql, params) => { calls.push({ sql, params }); },
  };
  const target = tecnospeedRemovalTarget({ sku: "2604", productId: "2604", productName: "ADAPTADOR" });
  const removed = await removeTecnospeedCharacteristic(tx, target);
  assert.equal(removed.characteristicsRemoved, 1);
  assert.equal(removed.flagCleared, 1);
  assert.deepEqual(calls[0].params, ["2604", 334]);
  assert.match(calls[0].sql, /DELETE FROM PRODUTOCARACTER/);
  assert.match(calls[1].sql, /INATIVA_modulo_removido = 0/);
  assert.match(tecnospeedRemovalMessage("ADAPTADOR", removed), /tecnospeed/);
  const state = forgetTecnospeedProduct({
    items: {
      a: { id: "a", productId: "2604", sku: "2604" },
      b: { id: "b", productId: "17400", sku: "17400" },
    },
  }, { id: "a", productId: "2604", sku: "2604" });
  assert.deepEqual(Object.keys(state.items), ["b"]);
});

test("ACTIVE da view é INATIVA_modulo_removido e o produto disponível sobe à venda", () => {
  assert.equal(mapTecnospeedRow({ PRODUCTID: "2579", NAME: "Adaptador soldavel", ACTIVE: 0 }).active, true);
  assert.equal(mapTecnospeedRow({ PRODUCTID: "2579", NAME: "Adaptador soldavel", ACTIVE: -1 }).active, false);
  assert.equal(availableFrommodulo_removidoFlag(0), 1);
  assert.equal(availableFrommodulo_removidoFlag(-1), 0);
  const inactive = buildmodulo_removidoPayloadFromTecnospeed({
    product: mapTecnospeedRow({ PRODUCTID: "2579", NAME: "Adaptador soldavel", PRICE: 2, STOCK: 1, ACTIVE: -1, CATEGORYID: "13", WEIGHT: 50, LENGTH: 5, WIDTH: 4, HEIGHT: 5 }),
    suggestion: { name: "Adaptador soldavel Krona" },
  });
  assert.equal(inactive.payload.available, 0);
});

test("produto sem a característica tecnospeed não gera exclusão", async () => {
  const calls = [];
  const tx = {
    singleton: async (sql) => {
      if (sql.includes("FROM CARACTERISTICAS")) return { CDCARACTER: 334 };
      return { QTD: 0 };
    },
    execute: async (sql, params) => { calls.push({ sql, params }); },
  };
  const removed = await removeTecnospeedCharacteristic(tx, tecnospeedRemovalTarget({
    sku: "17400",
    productId: "17400",
    productName: "TESTE 2603",
  }));
  assert.equal(removed.characteristicsRemoved, 0);
  assert.equal(removed.flagCleared, 0);
  assert.equal(calls.length, 0);
  assert.equal(tecnospeedRemovalMessage("TESTE 2603", removed), "");
  assert.equal(matchingmodulo_removidoProductId([
    { id: "10", reference: "outros" },
    { id: "777", reference: "17400" },
  ], "17400"), "777");
  assert.match(tecnospeedRemovalMessage("TESTE 2603", { modulo_removidoDeleted: true }), /excluído da modulo_removido/);
});

test("a leitura publica as durações usadas na estimativa", () => {
  const view = publicTecnospeedReview({ reviewDurations: [10000, 4000, 20000], items: {} });
  assert.deepEqual(view.reviewDurations, [10000, 20000]);
});

test("a lista mostra cada produto uma vez e junta os problemas", () => {
  const view = publicTecnospeedReview({
    analyzedAt: "2026-10-30T21:00:00.000Z",
    items: {
      a: { id: "a", productId: "2604", sku: "2604", productName: "ADAPTADOR SOLDAVEL", problem: "Descrição ausente", priority: "high", status: "open" },
      b: { id: "b", productId: "2604", sku: "2604", productName: "ADAPTADOR SOLDAVEL", problem: "Título sem a marca cadastrada", priority: "medium", status: "open" },
      c: { id: "c", productId: "17400", sku: "17400", productName: "TESTE 2603", problem: "Título pouco informativo", priority: "high", status: "open" },
    },
  });
  assert.deepEqual(view.reviewDurations, []);
  assert.equal(view.items.length, 2);
  const adaptador = view.items.find((item) => item.productId === "2604");
  assert.deepEqual(adaptador.problems, ["Descrição ausente", "Título sem a marca cadastrada"]);
  assert.equal(adaptador.priority, "high");
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
  let tentativas = 0;
  const recovered = await reviewTecnospeedWithOllama(facts, async () => {
    tentativas += 1;
    if (tentativas === 1) return null;
    return JSON.stringify({
      name: "Rolamento SKF 6205",
      description_small: "Rolamento SKF referência 6205.",
      description: "Rolamento SKF 6205 com peso 0.2. Confira a compatibilidade antes da compra.",
      keywords: "rolamento, skf, 6205",
    });
  });
  assert.equal(tentativas, 2);
  assert.equal(recovered.suggestion.source, "ollama");
  const fallen = await reviewTecnospeedWithOllama(facts, async () => JSON.stringify({
    name: "Rolamento 99mm",
    description_small: "99mm",
    description: "Peça com 99mm",
    keywords: "x",
  }));
  assert.equal(fallen.suggestion.source, "cadastro");
  assert.match(fallen.notice, /cadastro foi mantido/);
  assert.doesNotMatch(`${fallen.suggestion.name} ${fallen.suggestion.description}`, /99/);
  const ok = parseOllamaReview(JSON.stringify({
    name: "Rolamento SKF 6205",
    description_small: "Rolamento SKF referência 6205.",
    description: "Rolamento SKF 6205. Confira a compatibilidade antes da compra.",
    keywords: "rolamento, skf, 6205",
  }), facts);
  assert.equal(ok.ok, true);
  assert.equal(ok.suggestion.source, "ollama");
  let pedido = null;
  const reviewed = await reviewTecnospeedWithOllama(facts, async (options) => {
    pedido = options;
    return JSON.stringify({
      name: "Rolamento SKF 6205 blindado",
      description_small: "Rolamento SKF 6205.",
      description: "Rolamento SKF referência 6205 com peso 0.2. Confira a compatibilidade antes da compra.",
      keywords: "rolamento, skf, 6205",
    });
  });
  assert.ok(pedido.timeoutMs >= 120000);
  assert.equal(reviewed.suggestion.source, "ollama");
  assert.equal(reviewed.notice, "");
  assert.match(reviewed.suggestion.name, /Rolamento/);
});

test("grupo e subgrupo web fecham a categoria e a pesquisa preenche peso e medidas", () => {
  const product = applyWebCategory(mapTecnospeedRow({
    PRODUCTID: "2579",
    NAME: "ADAPTADOR SOLDAVEL KR CA 25 x 3/4",
    SKU: "2579",
    BRAND: "KRONA",
    PRICE: 4.5,
    STOCK: 8,
    CATEGORYID: "",
    WEIGHT: 0,
  }), { CDGRUPOWEB: 1, GRUPOWEB: "CONEXOES", CDTIPOWEB: 1, TIPOWEB: "ADAPTADOR SOLDAVEL" });
  const finding = analyzeTecnospeedProducts([product], { modulo_removidoProducts: [] }).findings[0];
  assert.equal(finding.gaps.includes("categoria"), false);
  assert.ok(finding.gaps.includes("peso"));
  const reviewed = applyResearchedSpecs(finding, {
    weightGrams: 10.2,
    lengthCm: 3.6,
    widthCm: 2.8,
    heightCm: 2.8,
    source: "https://exemplo.loja/krona-25",
    grupoWebId: 2,
    tipoWebId: 2,
    grupoWeb: "TESTE",
    tipoWeb: "TESTE1",
  });
  assert.equal(reviewed.product.grupoWeb, "CONEXOES");
  assert.equal(reviewed.product.weight, 10.2);
  assert.equal(reviewed.gaps.length, 0);
  const update = productSpecUpdate(reviewed.sku, reviewed);
  assert.match(update.sql, /PESOBRUTO/);
  assert.match(update.sql, /PROFUNDIDADEWEB/);
  assert.equal(update.sql.includes("CDGRUPOWEB"), false);
  assert.equal(update.params[0], 0.0102);
  const stored = applyStoredMeasures({
    product: { name: "ADAPTADOR", weight: null, length: null, width: 2, height: null, ean: "7898067900509" },
    filled: ["largura"],
    specNote: "",
  }, {
    PESOBRUTO: 0.05,
    PROFUNDIDADEWEB: 5,
    LARGURAWEB: 4,
    ALTURAWEB: 5.5,
    CODIGOBARRA: "7898067901995",
    CODBARRA_FULL: "7898067900509-7898067901995",
  });
  assert.equal(stored.product.weight, 50);
  assert.equal(stored.product.length, 5);
  assert.equal(stored.product.width, 2);
  assert.equal(stored.product.height, 5.5);
  assert.equal(stored.product.eans[0], "7898067901995");
  assert.match(stored.specNote, /Cadastro já tinha/);
  assert.equal(stored.filled.includes("largura"), false);
});

test("sem grupo web, a revisão usa o grupo e o subgrupo do produto", () => {
  const product = applyWebCategory(mapTecnospeedRow({
    PRODUCTID: "95",
    NAME: "BOSCH PARAFUSADEIRA GSR 1000 127v",
    SKU: "95",
    BRAND: "BOSCH",
    PRICE: 350,
    STOCK: 2,
    WEIGHT: 1800,
    LENGTH: 25,
    WIDTH: 8,
    HEIGHT: 22,
  }), { GRUPO_PRODUTO: "Ferramentas", SUBGRUPO: "Parafusadeiras" });
  assert.equal(product.categoryFromProduct, true);
  assert.equal(product.grupoWeb, "Ferramentas");
  assert.equal(product.tipoWeb, "Parafusadeiras");
  const finding = analyzeTecnospeedProducts([product], { modulo_removidoProducts: [] }).findings[0];
  assert.equal(finding.gaps.includes("categoria"), false);
  assert.equal(finding.product.grupoWeb, "Ferramentas");
  assert.equal(finding.product.tipoWeb, "Parafusadeiras");
  const kept = applyResearchedSpecs(finding, {
    grupoWebId: 9,
    tipoWebId: 9,
    grupoWeb: "OUTRO",
    tipoWeb: "OUTRO",
  });
  assert.equal(kept.product.grupoWeb, "Ferramentas");
  const catalog = [{ grupoWebId: 4, grupoWeb: "Ferramentas", tipoWebId: 12, tipoWeb: "Parafusadeiras" }];
  const matched = categoryFromProductGroup(product, catalog);
  assert.equal(matched.matched, true);
  assert.equal(matched.product.grupoWebId, 4);
  assert.equal(matched.product.categoryFromProduct, false);
  const saved = productSpecUpdate("95", { ...finding, product: matched.product, filled: ["categoria"] });
  assert.match(saved.sql, /CDGRUPOWEB/);
  assert.equal(saved.params[0], 4);
  assert.equal(saved.params[1], 12);
  const missingSubgroup = applyWebCategory(mapTecnospeedRow({
    PRODUCTID: "96",
    NAME: "PRODUTO SEM SUBGRUPO WEB",
    SKU: "96",
    PRICE: 10,
    STOCK: 1,
  }), { GRUPO_PRODUTO: "Ferramentas" });
  assert.equal(missingSubgroup.categoryFromProduct, undefined);
  assert.equal(analyzeTecnospeedProducts([missingSubgroup]).findings[0].gaps.includes("categoria"), true);
});

test("categoria nova é gravada e a releitura conserva peso e medidas", async () => {
  const calls = [];
  const saved = await persistProposedCategory({
    grupoWeb: "FERRAMENTAS",
    tipoWeb: "PARAFUSADEIRAS",
    weightGrams: 730,
  }, [], {
    singleton: async (sql) => {
      calls.push(sql);
      if (sql.includes("MAX(CDGRUPOWEB)")) return { ID: 3 };
      if (sql.includes("MAX(CDTIPOWEB)")) return { ID: 4 };
      return null;
    },
    execute: async (sql, params) => { calls.push({ sql, params }); },
  });
  assert.equal(saved.grupoWebId, 3);
  assert.equal(saved.tipoWebId, 4);
  assert.match(calls.find((entry) => entry.sql)?.sql || "", /INSERT INTO GRUPO_WEB/);
  const product = mapTecnospeedRow({
    PRODUCTID: "12496",
    NAME: "BLACK DECKER PARAF KIT 16 ACESS BAT 4,8 V BIV",
    SKU: "12496",
    BRAND: "BLACK&DECK",
    PRICE: 209.99,
    STOCK: 0,
  });
  const analysis = analyzeTecnospeedProducts([product], { modulo_removidoProducts: [] });
  const id = analysis.findings[0].id;
  const reviewed = applyResearchedSpecs(analysis.findings[0], saved);
  assert.equal(reviewed.gaps.includes("categoria"), false);
  assert.equal(reviewed.gaps.includes("peso"), false);
  assert.equal(reviewed.product.grupoWeb, "FERRAMENTAS");
  assert.equal(reviewed.product.weight, 730);
  const again = analyzeTecnospeedProducts([product], { modulo_removidoProducts: [] });
  const merged = mergeTecnospeedState({ items: { [id]: reviewed } }, again);
  assert.equal(merged.items[id].product.weight, 730);
  assert.equal(merged.items[id].product.grupoWebId, 3);
  assert.equal(merged.items[id].gaps.includes("peso"), false);
  assert.equal(merged.items[id].gaps.includes("categoria"), false);
});
