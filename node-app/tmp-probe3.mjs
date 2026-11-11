import { parseBingResults, htmlToText, extractCandidate, researchProductSpecs, catalogModelCodes } from "./server/lib/product-web-specs.js";

async function bing(q) {
  try {
    const r = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(20000),
    });
    return parseBingResults(await r.text()).slice(0, 6);
  } catch (err) {
    console.log("bing fail", q, err.message);
    return [];
  }
}

async function probePage(product, url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const text = htmlToText(await r.text());
    const cand = extractCandidate(product, { title: product.name, url: r.url || url, text });
    return {
      status: r.status,
      final: r.url,
      cand: cand && { w: cand.weightGrams, l: cand.lengthCm, wd: cand.widthCm, h: cand.heightCm },
      peso: text.match(/peso[\s\S]{0,70}/i)?.[0],
      dim: text.match(/dimens[\s\S]{0,90}/i)?.[0],
    };
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

console.log("codes", {
  nsz: catalogModelCodes("SERRA MARMORE 4100 NSZ 1275W 127V MAKITA"),
  cl: catalogModelCodes("MAKITA ASPIRADO DE PO BATERIA CL106FDSAW"),
  mbo: catalogModelCodes("LIXADEIRA ORBITAL MAKITA MBO452 127W"),
});

const direct = [
  { name: "MAKITA ASPIRADO DE PO BATERIA CL106FDSAW", brand: "MAKITA", url: "https://www.makita.com.br/catalogoFDetalhes.asp?codParamD=632" },
  { name: "MAKITA LAVADORA ALTA PRESSAO 1450 HW101", brand: "MAKITA", url: "https://www.makita.com.br/catalogoFDetalhes.asp?codParamD=1179" },
  { name: "LIXADEIRA ORBITAL MAKITA MBO452 127W", brand: "MAKITA", url: "https://www.makita.com/en-us/products/details/mbo452" },
  { name: "SERRA T-TICO MJV430 MAKITA", brand: "MAKITA", url: "https://www.makita.com/en-us/products/details/mjv430" },
  { name: "SERRA MARMORE 4100 NSZ", brand: "MAKITA", url: "https://www.makita.com.br/catalogoFDetalhes.asp?codParamD=1" },
];

for (const item of direct) {
  const got = await probePage(item, item.url);
  console.log("direct", item.name.slice(0, 40), got.cand || got);
}

const jobs = [
  { name: "LIXADEIRA ORBITAL MAKITA MBO452 127W", brand: "MAKITA", q: "Makita MBO452 peso kg dimensões mm" },
  { name: "SERRA T-TICO MJV430 MAKITA", brand: "MAKITA", q: "Makita MJV430 peso kg dimensões" },
  { name: "SERRA MARMORE 4100 NSZ 1275W MAKITA", brand: "MAKITA", q: "Makita 4100NSZ peso dimensões mm" },
  { name: "SERRA MARMORE MCC400 MAKITA", brand: "MAKITA", q: "Makita MCC400 peso dimensões" },
  { name: "(BOLSA VONDER LONA P/ FERRAMENTA 430x240x30)", brand: "VONDER", q: "bolsa vonder 430x240x300 peso" },
  { name: "HAMMER FURAD IMPACTO 1/2 700W FI7000", brand: "HAMMER", q: "Hammer FI7000 dimensões CxLxA peso" },
  { name: "BOSCH SKIL FURADEIRA IMPACT 570 W 127V", brand: "SKIL", q: "Skil 570W furadeira impacto peso dimensões cm" },
  { name: "DWT FURADEIRA IMPACTO 1/2 SBM 780w 127v", brand: "DWT", q: "DWT SBM 780 furadeira peso dimensões" },
  { name: "HAMMER FURAD PARAF C IMPACTO BAT 12V PLI120", brand: "HAMMER", q: "Hammer PLI120 dimensões peso" },
];

for (const job of jobs) {
  console.log("\n====", job.name);
  const links = await bing(job.q);
  for (const link of links) console.log("-", link.title.slice(0, 70), link.url.slice(0, 110));
  for (const link of links.slice(0, 4)) {
    const got = await probePage({ name: job.name, brand: job.brand }, link.url);
    console.log(" ", got.cand || { status: got.status, peso: got.peso?.slice(0, 80), dim: got.dim?.slice(0, 80), err: got.error });
  }
}

console.log("\n==== research CL106");
const r = await researchProductSpecs({ name: "MAKITA ASPIRADO DE PO BATERIA CL106FDSAW", brand: "MAKITA" }, { chat: null });
console.log(r.ok, r.specs && { w: r.specs.weightGrams, l: r.specs.lengthCm, wd: r.specs.widthCm, h: r.specs.heightCm, src: r.specs.source });
