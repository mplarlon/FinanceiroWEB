import { extractCandidate, htmlToText, researchProductSpecs, catalogModelCodes } from "./server/lib/product-web-specs.js";

async function page(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, url: response.url, html: await response.text() };
}

const bolsaUrl = "https://www.lojadomecanico.com.br/produto/126395/2/425/bolsa-em-lona-para-ferramentas-430-x-240-x-300-mm-vonder";
const bolsa = await page(bolsaUrl);
const bolsaText = htmlToText(bolsa.html);
console.log("bolsa", bolsa.status, bolsaText.match(/peso[\s\S]{0,50}/i)?.[0]);
console.log("cand", extractCandidate({
  name: "(BOLSA VONDER LONA P/ FERRAMENTA 430x240x30)",
  brand: "VONDER",
}, { title: "Bolsa Vonder", url: bolsaUrl, text: bolsaText }));

console.log("models MBO", catalogModelCodes("LIXADEIRA ORBITAL MAKITA MBO452 127W"));
const mbo = await researchProductSpecs({ name: "LIXADEIRA ORBITAL MAKITA MBO452 127W", brand: "MAKITA" }, { chat: null });
console.log("mbo", mbo.specs && { w: mbo.specs.weightGrams, l: mbo.specs.lengthCm, src: mbo.specs.source });

const mjv = await researchProductSpecs({ name: "SERRA T-TICO MJV430 MAKITA", brand: "MAKITA" }, { chat: null });
console.log("mjv", mjv.specs && { w: mjv.specs.weightGrams, l: mjv.specs.lengthCm, src: mjv.specs.source });

const hw = await researchProductSpecs({ name: "MAKITA LAVADORA ALTA PRESSAO 1450 HW101", brand: "MAKITA" }, { chat: null });
console.log("hw", hw.specs && { w: hw.specs.weightGrams, l: hw.specs.lengthCm, wd: hw.specs.widthCm, h: hw.specs.heightCm, src: hw.specs.source });
