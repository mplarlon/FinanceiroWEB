import { researchProductSpecs, extractCandidate, htmlToText } from "./server/lib/product-web-specs.js";

async function show(url, product) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
    const text = htmlToText(await r.text());
    console.log("page", url.slice(0, 70), extractCandidate(product, { title: product.name, url, text }));
  } catch (err) {
    console.log("page fail", url.slice(0, 50), err.message);
  }
}

const hw = { name: "MAKITA LAVADORA ALTA PRESSAO 1450 HW101", brand: "MAKITA" };
await show("https://www.pccomponentes.pt/makita-hw101-maquina-de-lavar-a-alta-pressao-1300w", hw);
await show("https://www.hpmaquinas.com.br/lavadora-de-alta-presso-makita-hw101-azul-turquesa-de-13kw-com-100bar-de-presso-maxima-220v/p/MLB15451393", hw);

const skil = { name: "BOSCH SKIL FURADEIRA IMPACT 570 W 127V", brand: "SKIL" };
await show("https://www.ferramentaskennedy.com.br/furadeira-de-impacto-eletrica-10mm-3100rpm-570w-skil-887919/p", skil);
await show("https://loja.redeconstruutil.com.br/produto/furadeira-skil-570w-ref-f012-660-0ja---skil/12320-0", skil);

const dwt = { name: "DWT FURADEIRA IMPACTO 1/2 SBM 780w 127v", brand: "DWT" };
await show("https://dwt.com.ua/elektroinstrument/dreli/dwt-sbm-780/", dwt);

for (const product of [hw, skil, dwt]) {
  const result = await researchProductSpecs(product, { chat: null });
  console.log("research", product.name.slice(0, 40), result.specs && {
    w: result.specs.weightGrams, l: result.specs.lengthCm, wd: result.specs.widthCm, h: result.specs.heightCm, src: result.specs.source?.slice(0, 70),
  });
}
