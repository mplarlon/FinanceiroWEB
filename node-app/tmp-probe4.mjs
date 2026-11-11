import { researchProductSpecs } from "./server/lib/product-web-specs.js";

const products = [
  { name: "(BOLSA VONDER LONA P/ FERRAMENTA 430x240x30)", brand: "VONDER" },
  { name: "LIXADEIRA ORBITAL MAKITA MBO452 127W", brand: "MAKITA" },
  { name: "SERRA T-TICO MJV430 MAKITA", brand: "MAKITA" },
  { name: "SERRA MARMORE 4100 NSZ 1275W 127V MAKITA", brand: "MAKITA" },
  { name: "MAKITA LAVADORA ALTA PRESSAO 1450 HW101", brand: "MAKITA" },
  { name: "MAKITA ASPIRADO DE PO BATERIA CL106FDSAW", brand: "MAKITA" },
  { name: "BOSCH SKIL FURADEIRA IMPACT 570 W 127V", brand: "SKIL" },
  { name: "DWT FURADEIRA IMPACTO 1/2 SBM 780w 127v", brand: "DWT" },
];

for (const product of products) {
  process.stdout.write(`\n${product.name.slice(0, 50)} ... `);
  try {
    const result = await researchProductSpecs(product, { chat: null });
    const s = result.specs;
    console.log(result.ok
      ? { w: s?.weightGrams, l: s?.lengthCm, wd: s?.widthCm, h: s?.heightCm, src: s?.source?.slice(0, 70) }
      : result.reason?.slice(0, 80));
  } catch (err) {
    console.log("ERR", err.message);
  }
}
