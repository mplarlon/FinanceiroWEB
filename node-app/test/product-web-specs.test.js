import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptResearchedSpecs,
  extractCandidate,
  extractEmbeddedWeight,
  extractListingImage,
  fetchCatalogPhoto,
  fichaPdfUrls,
  isBulkListing,
  listingImageUrl,
  catalogModelCodes,
  KRONA_CURTO_SHA256,
  matchmodulo_removidoCategory,
  pageShowsCatalogItem,
  parseBingResults,
  parseImageResults,
  parseSearchResults,
  photoSearchQueries,
  listingSourceConflicts,
  productBitola,
  proposeWebCategory,
  researchProductSpecs,
  searchQueries,
  specPageMatches,
  specsFromOfficialSheet,
} from "../server/lib/product-web-specs.js";

const product = {
  name: "ADAPTADOR SOLDAVEL KR CA 25 x 3/4",
  brand: "KRONA",
  grupoWebId: 1,
  tipoWebId: 1,
  grupoWeb: "CONEXOES",
  tipoWeb: "ADAPTADOR SOLDAVEL",
};

const ficha = "Marca: Krona. Peso: 0,0102 kg. Dimensões: A: 2,8 cm x L: 2,8 cm x P: 3,6 cm. Medida 25 mm x 3/4.";

test("extrai peso e medidas da ficha e ignora kit e comprimento em metros", () => {
  assert.equal(isBulkListing("Kit 50 Adaptador Krona 25mm", product.name), true);
  const candidate = extractCandidate(product, {
    title: "Adaptador Curto Soldável 25mm x 3/4 Krona",
    url: "https://exemplo.loja/krona-25",
    text: ficha,
  });
  assert.equal(candidate.weightGrams, 10.2);
  assert.equal(candidate.lengthCm, 3.6);
  assert.equal(candidate.widthCm, 2.8);
  assert.equal(candidate.heightCm, 2.8);
  const meters = extractCandidate(product, {
    title: "Adaptador Krona 25 mm",
    url: "https://exemplo.loja/leroy",
    text: "Krona 25 mm. Altura 3,00 cm Largura 4,00 cm Comprimento 3,00 m",
  });
  assert.equal(meters.lengthCm, null);
  assert.equal(meters.heightCm, 3);
  assert.equal(extractCandidate(product, {
    title: "Kit 50 Adaptador Krona 25mm",
    url: "https://exemplo.loja/kit",
    text: ficha,
  }), null);
});

test("a pesquisa escolhe o candidato do Charlie e não troca categoria já cadastrada", async () => {
  const search = `<a class="result__a" href="https://exemplo.loja/krona-25">Adaptador Krona 25 x 3/4</a>
    <a class="result__a" href="https://exemplo.loja/kit">Kit 50 peças Krona 25</a>`;
  const calls = [];
  const result = await researchProductSpecs(product, {
    catalog: [
      { grupoWebId: 1, grupoWeb: "CONEXOES", tipoWebId: 1, tipoWeb: "ADAPTADOR SOLDAVEL" },
      { grupoWebId: 2, grupoWeb: "TESTE", tipoWebId: 2, tipoWeb: "TESTE1" },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      if (String(url).includes("duckduckgo")) return search;
      return `<html><body>${ficha}</body></html>`;
    },
    chat: async () => JSON.stringify({ candidato: "c1", grupo_web: "TESTE", subgrupo_web: "TESTE1" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.specs.weightGrams, 10.2);
  assert.equal(result.specs.grupoWebId, null);
  assert.equal(calls.some((url) => url.includes("/kit")), false);
  const modulo_removido = matchmodulo_removidoCategory([
    { id: "10", name: "CONEXOES", parent_id: "0" },
    { id: "11", name: "ADAPTADOR SOLDAVEL", parent_id: "10" },
    { id: "12", name: "TESTE", parent_id: "0" },
  ], "CONEXOES", "ADAPTADOR SOLDAVEL");
  assert.equal(modulo_removido.child.id, "11");
});

test("sem categoria, o par web só entra quando o subgrupo combina com o produto", () => {
  const accepted = acceptResearchedSpecs({
    choice: { candidato: "c1", grupo_web: "CONEXOES", subgrupo_web: "ADAPTADOR SOLDAVEL" },
    candidates: [{ id: "c1", weightGrams: 14, lengthCm: 3.4, widthCm: 4, heightCm: 3.4, url: "https://exemplo.loja/luca", title: "Adaptador Krona" }],
    catalog: [{ grupoWebId: 1, grupoWeb: "CONEXOES", tipoWebId: 1, tipoWeb: "ADAPTADOR SOLDAVEL" }],
    product: { name: product.name, brand: product.brand },
  });
  assert.equal(accepted.specs.grupoWeb, "CONEXOES");
  assert.equal(accepted.specs.tipoWeb, "ADAPTADOR SOLDAVEL");
  const rejected = acceptResearchedSpecs({
    choice: { candidato: "c1", grupo_web: "TESTE", subgrupo_web: "TESTE1" },
    candidates: [{ id: "c1", weightGrams: 14, url: "https://exemplo.loja/luca", title: "Adaptador" }],
    catalog: [{ grupoWebId: 2, grupoWeb: "TESTE", tipoWebId: 2, tipoWeb: "TESTE1" }],
    product: { name: product.name, brand: product.brand },
  });
  assert.equal(rejected.specs.grupoWebId, null);
  const fromProduct = acceptResearchedSpecs({
    choice: { candidato: "c1", grupo_web: "TESTE", subgrupo_web: "TESTE1" },
    candidates: [{ id: "c1", weightGrams: 14, url: "https://exemplo.loja/luca", title: "Adaptador" }],
    catalog: [{ grupoWebId: 2, grupoWeb: "TESTE", tipoWebId: 2, tipoWeb: "TESTE1" }],
    product: { name: product.name, brand: product.brand, grupoWeb: "Ferramentas", tipoWeb: "Parafusadeiras", categoryFromProduct: true },
  });
  assert.equal(fromProduct.specs.grupoWebId, null);
  assert.equal(fromProduct.specs.grupoWeb, "");
});

test("peso do código de barras e cota C da ficha fecham o adaptador 20x1/2", async () => {
  const adapter = {
    name: "ADAPTADOR SOLDAVEL KR/CA 20x1/2",
    brand: "KRONA",
    eans: ["7897801300520"],
    grupoWebId: 1,
    tipoWebId: 1,
    grupoWeb: "CONEXOES",
    tipoWeb: "ADAPTADOR SOLDAVEL",
  };
  assert.equal(productBitola(adapter.name), "20x1/2");
  assert.equal(productBitola("ADAPTADOR SOLDAVEL KR/CA 40x1\"1/4"), "40x1.1/4");
  assert.equal(productBitola("ADAPTADOR SOLDAVEL KR/CA 32x1\""), "32x1");
  assert.notEqual(productBitola("32x1"), productBitola("40x1.1/4"));
  const sheet = specsFromOfficialSheet(adapter, {
    text: "PE000991 Adaptador Soldável Curto",
    sha256: KRONA_CURTO_SHA256,
  });
  assert.equal(sheet.lengthCm, 3.78);
  assert.equal(sheet.widthCm, 2);
  assert.equal(sheet.heightCm, 2);
  assert.equal(specsFromOfficialSheet(adapter, {
    text: "PE000991 Adaptador Soldável Curto",
    sha256: "outro",
  }), null);
  const tidao = `"descComp":"ADAPTADOR SOLD.CURTO 20 x 1/2 KRONA","unidade":"UN","pesoBruto":"0.01000000","codBarra":"7897801300520"`;
  assert.equal(extractEmbeddedWeight(adapter, tidao, "https://www.tidao.com.br/produto/4152").weightGrams, 10);
  const pdf = "https://www.krona.com.br/wp-content/uploads/2016/03/PE000991-Ficha-Tecnica-Adaptador-Soldavel-Curto.pdf";
  const encoded = Buffer.from("https://www.tidao.com.br/produto/4152/adaptador").toString("base64").replace(/=+$/, "");
  const bing = `<a href="https://www.bing.com/ck/a?&amp;u=a1${encoded}&amp;ntb=1"><h2>Tidao</h2></a>`;
  assert.equal(parseBingResults(bing)[0].url, "https://www.tidao.com.br/produto/4152/adaptador");
  const result = await researchProductSpecs(adapter, {
    catalog: [],
    parsePdf: async () => ({ text: "PE000991 Adaptador Soldável Curto", sha256: KRONA_CURTO_SHA256 }),
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes("duckduckgo")) return `<a class="result__a" href="https://www.tidao.com.br/produto/4152/adaptador">Krona 20</a>`;
      if (target.includes("bing.com")) return bing;
      if (target.includes("krona.com.br/produtos")) return `<a href="${pdf}">Ficha</a>`;
      if (target.endsWith(".pdf")) return "%PDF-1.7 ficha";
      if (target.includes("tidao")) return tidao;
      return "<html></html>";
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.specs.weightGrams, 10);
  assert.equal(result.specs.lengthCm, 3.78);
  assert.match(result.specs.detail, /10 g/);
  assert.match(result.specs.detail, /3,78 cm/);
  assert.deepEqual(fichaPdfUrls(`<a href="${pdf}">baixar</a>`, "https://www.krona.com.br/produtos/adaptador-curto-soldavel/"), [pdf]);
});

test("a foto vem do anúncio do mesmo modelo e não de outra página", async () => {
  const drill = {
    name: "HAMMER FURAD IMPACTO 570W FI2000",
    brand: "AULIK INDUSTRIA E COMERCIO LTDA",
    ean: "7897181903793",
  };
  assert.match(photoSearchQueries(drill)[0], /furadeira/);
  assert.match(photoSearchQueries(drill)[1], /7897181903793/);
  assert.equal(pageShowsCatalogItem(drill, "Furadeira de Impacto Hammer GYFI2000 570W", "Mandril 10 mm"), true);
  assert.equal(pageShowsCatalogItem(drill, "Kit 10 furadeiras Hammer FI2000", "570W"), false);
  assert.equal(pageShowsCatalogItem(drill, "Alicate Hammer", "ferramenta manual"), false);
  const photo = "https://exemplo.loja/arquivos/furadeira-gyfi2000.jpg";
  assert.equal(listingImageUrl("https://exemplo.loja/foto-200x200.jpg", "https://exemplo.loja/item"), null);
  assert.equal(listingImageUrl(photo, "https://exemplo.loja/item"), photo);
  const page = `<html><head><meta property="og:image" content="${photo}"></head><body>Furadeira Hammer GYFI2000 570W</body></html>`;
  assert.equal(extractListingImage(page, "https://exemplo.loja/gyfi2000"), photo);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9000, 7)]);
  const calls = [];
  const bytes = await fetchCatalogPhoto(drill, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("duckduckgo")) {
        return `<a class="result__a" href="https://exemplo.loja/outra">Alicate</a>
          <a class="result__a" href="https://exemplo.loja/gyfi2000-hammer">Furadeira Hammer GYFI2000</a>`;
      }
      if (String(url).includes("bing.com")) return "<html></html>";
      if (String(url).includes("/outra")) return "<html><meta property=\"og:image\" content=\"https://exemplo.loja/alicate.jpg\"><body>Alicate</body></html>";
      if (String(url).includes("/gyfi2000")) return page;
      if (String(url) === photo) {
        return {
          ok: true,
          url: photo,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength),
        };
      }
      return "<html></html>";
    },
  });
  assert.equal(bytes.equals(jpg), true);
  assert.equal(calls.some((url) => url.includes("alicate.jpg")), false);
  const imageHtml = `<a class="iusc" m="{&quot;murl&quot;:&quot;https://exemplo.loja/alicate.jpg&quot;,&quot;t&quot;:&quot;Alicate&quot;,&quot;mid&quot;:&quot;1&quot;}"></a>
    <a class="iusc" m="{&quot;murl&quot;:&quot;https://exemplo.loja/foto-200x200.jpg&quot;,&quot;t&quot;:&quot;Furadeira Hammer GYFI2000&quot;,&quot;mid&quot;:&quot;2&quot;}"></a>
    <a class="iusc" m="{&quot;murl&quot;:&quot;${photo}&quot;,&quot;t&quot;:&quot;Furadeira De Impacto GYFI2000 570W Hammer&quot;,&quot;mid&quot;:&quot;3&quot;}"></a>`;
  const parsed = parseImageResults(imageHtml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].url, photo);
  const fromImages = await fetchCatalogPhoto(drill, {
    fetchImpl: async (url) => {
      if (String(url).includes("/images/search")) return imageHtml;
      if (String(url) === photo) {
        return {
          ok: true,
          url: photo,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => jpg.buffer.slice(jpg.byteOffset, jpg.byteOffset + jpg.byteLength),
        };
      }
      return "<html></html>";
    },
  });
  assert.equal(fromImages.equals(jpg), true);
});

test("furadeira DWT SBM 780 aceita a foto do anúncio mesmo com a marca jurídica", () => {
  const drill = {
    name: "DWT FURADEIRA IMPACTO 1/2 SBM 780w 127v",
    brand: "DWT DO BRASIL FERRAMENTAS LTDA",
    ean: "7640134131770",
  };
  assert.deepEqual(catalogModelCodes(drill.name), ["SBM780"]);
  assert.deepEqual(catalogModelCodes("BOSCH FURADEIRA IMPACTO GSB 450 RE 127v"), ["GSB450"]);
  assert.equal(photoSearchQueries(drill)[1].includes("LTDA"), false);
  assert.match(photoSearchQueries(drill)[1], /SBM 780w 127v/i);
  assert.equal(pageShowsCatalogItem(drill, "Furadeira Dwt Sbm 780 | Mercado Livre", "https://http2.mlstatic.com/D_NQ_NP_sbm780.jpg"), true);
  assert.equal(pageShowsCatalogItem(drill, "Furadeira 1/2 DWT - SBM-780 com o cabo", "https://exemplo.loja/dwt-sbm-780.jpg"), true);
  assert.equal(pageShowsCatalogItem(drill, "Furadeira de Impacto DWT SBM-780C - 780W", "https://imgs.extra.com.br/sbm780.jpg"), true);
  assert.equal(pageShowsCatalogItem(drill, "Furadeira DWT SBM 500W 127V", "https://exemplo.loja/sbm500.jpg"), false);
  assert.equal(pageShowsCatalogItem(drill, "FURADEIRA DEWALT IMPACTO 1/2 127V 800W", "https://exemplo.loja/dewalt.jpg"), false);
  assert.equal(pageShowsCatalogItem(drill, "Furadeira de Impacto Velocidade", "https://exemplo.loja/generica.jpg"), false);
});

test("a foto usa a marca do anúncio, a potência e o modelo, sem exigir voltagem nem razão social", () => {
  const skil = {
    name: "BOSCH SKIL FURADEIRA IMPACT 570 W 127V",
    brand: "ROBERT BOSCH LIMITADA",
    ean: "7891009850412",
  };
  assert.deepEqual(catalogModelCodes(skil.name), []);
  assert.equal(photoSearchQueries(skil)[1].includes("LIMITADA"), false);
  assert.match(photoSearchQueries(skil)[1], /impacto/i);
  assert.equal(pageShowsCatalogItem(skil, "Furadeira de Impacto Skil 6600 570W", "https://exemplo.loja/skil6600.jpg"), true);
  assert.equal(pageShowsCatalogItem(skil, "Furad.Skil Impact 6600 3/8 570W 127", "https://exemplo.loja/skil.jpg"), true);
  assert.equal(pageShowsCatalogItem(skil, "Furadeira Bosch Skil 570W 127V", "https://exemplo.loja/bosch.jpg"), true);
  assert.equal(pageShowsCatalogItem(skil, "Furadeira Impacto 1/2 Pol 550w Gsb550", "https://exemplo.loja/gsb550.jpg"), false);
  assert.equal(pageShowsCatalogItem(skil, "Bosch Martelete Perfurador Gbh 2-26", "https://exemplo.loja/martelete.jpg"), false);
  assert.equal(pageShowsCatalogItem(skil, "Furadeira Skil 570W 220V", "https://exemplo.loja/220.jpg"), false);

  const gamma = { name: "FURADEIRA GAMMA IMP 1/2 500 W 127V", brand: "GAMMA" };
  assert.deepEqual(catalogModelCodes(gamma.name), []);
  assert.equal(pageShowsCatalogItem(gamma, "Furadeira de Impacto Gamma 1/2 500W", "https://exemplo.loja/gamma.jpg"), true);
  assert.equal(pageShowsCatalogItem(gamma, "Furadeira Gamma 600W", "https://exemplo.loja/gamma600.jpg"), false);

  const makita = { name: "ESMERILHADEIRA ANGULAR MAKITA MGA 92", brand: "MAKITA" };
  assert.deepEqual(catalogModelCodes(makita.name), ["MGA92"]);
  assert.equal(pageShowsCatalogItem(makita, "Esmerilhadeira Angular Makita MGA92", "https://exemplo.loja/mga92.jpg"), true);
  assert.equal(pageShowsCatalogItem(makita, "Esmerilhadeira Makita MGA 452", "https://exemplo.loja/mga452.jpg"), false);

  const decker = { name: "FURADEIRA BeD IMPACTO 3/8 500w 127v", brand: "BLACK&DECK" };
  assert.equal(pageShowsCatalogItem(decker, "Furadeira de Impacto Black Decker 500W", "https://exemplo.loja/bd.jpg"), true);
  assert.equal(pageShowsCatalogItem(decker, "Furadeira Black Decker 600W", "https://exemplo.loja/bd600.jpg"), false);

  const tram = { name: "FURADEIRA IMPACTO TRAM.500W 3/8P 127V", brand: "TRAMONTINA" };
  assert.equal(pageShowsCatalogItem(tram, "Furadeira de Impacto Tramontina 500W", "https://exemplo.loja/tram.jpg"), true);
  assert.equal(pageShowsCatalogItem(tram, "Furadeira Tramontina 650W", "https://exemplo.loja/tram650.jpg"), false);
  assert.deepEqual(catalogModelCodes("ADAPTADOR SOLDAVEL KR/CA 20x1/2"), []);
  assert.deepEqual(catalogModelCodes("HAMMER FURAD IMPACTO 570W FI2000"), ["FI2000"]);
  assert.deepEqual(catalogModelCodes("FURADEIRA MAKITA IMPACTO 16mm 5/8 HP 1630"), ["HP1630"]);
});

test("parafusadeira a bateria sem potência usa a voltagem e a quantidade de peças", () => {
  const tool = {
    name: "TITANIUM PARAFUSADEIRA A BATERIA CARBON 21V COM ACESSORIOS 35 PECAS",
    brand: "TITANIUM",
    ean: "7908200006040",
  };
  assert.deepEqual(catalogModelCodes(tool.name), []);
  assert.match(photoSearchQueries(tool)[0], /CARBON 21V/i);
  assert.equal(pageShowsCatalogItem(
    tool,
    "Parafusadeira Furadeira Bateria 21V Carbon + 35 Acessórios - Titanium",
    "https://www.ccpvirtual.com.br/parafusadeira-furadeira-bateria-21v-carbon-35-acessessorios-titanium",
  ), true);
  assert.equal(pageShowsCatalogItem(
    tool,
    "Parafusadeira/Furadeira à bateria CARBON 21V com acessórios - 35 peças",
    "https://automaqbrasil.com.br/products/parafusadeira-a-bateria-carbon-21v-com-acessorios-35-pecas",
  ), true);
  assert.equal(pageShowsCatalogItem(
    tool,
    "Parafusadeira 21v 3/8 com 2 Baterias Carbon 05625 Titanium",
    "https://exemplo.loja/carbon-05625.jpg",
  ), false);
  assert.equal(pageShowsCatalogItem(
    tool,
    "Parafusadeira Titanium Carbon 12V 35 peças",
    "https://exemplo.loja/carbon-12v.jpg",
  ), false);
  assert.equal(pageShowsCatalogItem(
    tool,
    "Parafusadeira 21V com 35 peças",
    "https://exemplo.loja/generica.jpg",
  ), false);
});

test("a revisão lê peso e medidas do anúncio mesmo com razão social no cadastro", () => {
  const drill = {
    name: "HAMMER FURAD IMPACTO 570W FI2000",
    brand: "AULIK INDUSTRIA E COMERCIO LTDA",
    ean: "7897181903793",
  };
  const queries = searchQueries(drill);
  assert.equal(queries.some((query) => /AULIK|LTDA/i.test(query)), false);
  assert.match(queries.join(" "), /furadeira/i);
  assert.match(queries.join(" "), /FI2000/i);
  const page = {
    title: "Furadeira De Impacto Hammer Fi2000 Mandril 3/8 10mm 570w",
    url: "https://www.leroymerlin.com.br/furadeira-hammer-fi2000",
    text: "Possui Impacto Peso do Produto 1,50 Kg Garantia do Fabricante",
  };
  const candidate = extractCandidate(drill, page);
  assert.equal(candidate.weightGrams, 1500);
  const bag = {
    name: "(BOLSA VONDER LONA P/ FERRAMENTA 430x240x30)",
    brand: "VONDER",
    ean: "7893946512668",
  };
  assert.equal(specPageMatches(bag, "Furadeira Reversível De Impacto Vonder 3/8", "Peso: 1,70 kg Código 7893946512668"), false);
  assert.equal(listingSourceConflicts(bag, "https://www.comercialtupi.com.br/furadeira-eletrica-de-impacto-vonder"), true);
  const sized = extractCandidate(bag, {
    title: "Bolsa Em Lona Para Ferramentas 430 mm X 240 mm X 300 mm VONDER",
    url: "https://www.lojadomecanico.com.br/bolsa-vonder",
    text: "",
  });
  assert.equal(sized.lengthCm, 43);
  assert.equal(sized.widthCm, 24);
  assert.equal(sized.heightCm, 30);
  assert.deepEqual(proposeWebCategory({ name: "ESMERILHADEIRA ANGULAR MAKITA MGA 452", brand: "MAKITA" }), {
    grupoWeb: "FERRAMENTAS",
    tipoWeb: "ESMERILHADEIRAS",
  });
  assert.equal(proposeWebCategory({ name: "SERRA T-TICO MJV430 MAKITA" }).tipoWeb, "SERRAS");
  assert.equal(proposeWebCategory({ name: "MAKITA LAVADORA ALTA PRESSAO 1450 HW101" }).tipoWeb, "LAVADORAS");
  assert.equal(proposeWebCategory({ name: "MAKITA ASPIRADO DE PO BATERIA CL106FDSAW" }).tipoWeb, "ASPIRADORES");
  assert.equal(proposeWebCategory(bag).tipoWeb, "BOLSAS");
});

test("bolsa sem código de modelo usa a foto do anúncio com a mesma marca e as mesmas medidas", () => {
  const bag = {
    name: "(BOLSA VONDER LONA P/ FERRAMENTA 430x240x30)",
    brand: "VONDER",
    ean: "7893946512668",
  };
  assert.match(photoSearchQueries(bag)[1], /BOLSA VONDER LONA/);
  assert.equal(photoSearchQueries(bag)[1].includes("("), false);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Bolsa em lona para ferramentas 430 mm x 240 mm x 300 mm Vonder",
    "https://www.lojadomecanico.com.br/produto/bolsa-vonder",
  ), true);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Bolsa em Lona Para Ferramentas 43cm x 24cm x 30cm Vonder",
    "https://static.felap.com.br/bolsa-bl017.jpg",
  ), true);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Bolsa Vonder 143cm x 24cm",
    "ferramenta",
  ), false);
  assert.equal(pageShowsCatalogItem(
    bag,
    "BOLSA EM LONA 430X240X300MM VONDER",
    "https://dosanjosferramentas.com.br/produtos/bolsa-em-lona-430x240x300mm-vonder/",
  ), true);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Bolsa em lona para ferramentas BL 008 Vonder",
    "Medidas 470 mm x 300 mm x 350 mm",
  ), false);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Kit 10 bolsas Vonder 430x240",
    "ferramentas",
  ), false);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Bolsas para ferramentas",
    `${"catalogo ".repeat(80)} bolsa vonder 430 x 240`,
  ), false);
  assert.equal(pageShowsCatalogItem(
    bag,
    "Consulta de código de barras",
    "GTIN 7893946512668",
  ), true);
});

test("o parser ignora anúncio e endereço interno", () => {
  const results = parseSearchResults(`
    <a class="result__a" href="//duckduckgo.com/y.js?ad_domain=loja">Anúncio</a>
    <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.krona.com.br%2Fprodutos%2Fadaptador">Krona</a>
    <a class="result__a" href="http://192.168.0.8/produto">Interno</a>
  `);
  assert.deepEqual(results, [{ title: "Krona", url: "https://www.krona.com.br/produtos/adaptador" }]);
});

test("a ficha da parafusadeira preenche peso, medidas e categoria web", () => {
  const kit = {
    name: "BLACK DECKER PARAF KIT 16 ACESS BAT 4,8 V BIV",
    brand: "BLACK&DECK",
    ean: "885911522632",
  };
  const queries = searchQueries(kit);
  assert.match(queries[0], /885911522632/);
  assert.equal(queries[0].includes("adaptador"), false);
  assert.match(queries[1], /parafusadeira/i);
  const page = {
    title: "Parafusadeira a Bateria 4,8V Black & Decker com 16 peças",
    url: "https://exemplo.loja/parafusadeira-48",
    text: `Black & Decker 4,8V 16 acessórios. GTIN/EAN 885911522632.
      Altura (cm) | 5
      Largura (cm) | 26
      Comprimento (cm) | 28
      Peso (Kg) | 0.730
      Peso bruto > 730g`,
  };
  const candidate = extractCandidate(kit, page);
  assert.equal(candidate.weightGrams, 730);
  assert.equal(candidate.lengthCm, 28);
  assert.equal(candidate.widthCm, 26);
  assert.equal(candidate.heightCm, 5);
  assert.equal(extractCandidate(kit, {
    ...page,
    text: page.text.replace("885911522632", "885911418003"),
  }), null);
  const accepted = acceptResearchedSpecs({
    choice: { candidato: "c1", grupo_web: "TESTE", subgrupo_web: "TESTE1" },
    candidates: [{ ...candidate, id: "c1" }],
    catalog: [
      { grupoWebId: 1, grupoWeb: "CONEXOES", tipoWebId: 1, tipoWeb: "ADAPTADOR SOLDAVEL" },
      { grupoWebId: 2, grupoWeb: "TESTE", tipoWebId: 2, tipoWeb: "TESTE1" },
    ],
    product: kit,
  });
  assert.equal(accepted.specs.grupoWeb, "FERRAMENTAS");
  assert.equal(accepted.specs.tipoWeb, "PARAFUSADEIRAS");
  assert.equal(accepted.specs.grupoWebId, null);
  assert.equal(accepted.specs.weightGrams, 730);
  const boxed = extractCandidate(kit, {
    title: "Parafusadeira Black+Decker 4,8V 16 acessórios",
    url: "https://exemplo.loja/caixa",
    text: "EAN 885911522632. Peso 0,860 kg. Dimensões 21,0 × 17,0 × 6,0 cm (C × L × A).",
  });
  assert.equal(boxed.weightGrams, 860);
  assert.equal(boxed.lengthCm, 21);
  assert.equal(boxed.widthCm, 17);
  assert.equal(boxed.heightCm, 6);
});
