import { pageShowsCatalogItem, extractListingImage, htmlToText } from "./server/lib/product-web-specs.js";

const HEADERS = {
  Accept: "text/html",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
};
const product = {
  name: "QUEIROZ ESPETO DUPLO CB MAD 65 CM",
  productName: "QUEIROZ ESPETO DUPLO CB MAD 65 CM",
  brand: "JALES E QUEIROZ COM ART ACO INOX",
};
const url = "https://churrasqueiraqueiroz.com.br/produto/espeto-duplo-cabo-de-madeira/";
const html = await (await fetch(url, { headers: HEADERS })).text();
const text = htmlToText(html);
let pageTitle = "Espeto Duplo Cabo de Madeira";
const pageCompact = text.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
for (const match of product.name.matchAll(/\b(\d{2,3})\s*CM\b/gi)) {
  if (pageCompact.includes(`${match[1]}CM`) && !pageTitle.toUpperCase().includes(`${match[1]}CM`)) {
    pageTitle = `${pageTitle} ${match[1]} CM`;
  }
}
console.log("title", pageTitle);
console.log("match", pageShowsCatalogItem(product, `${pageTitle} ${url}`, text));
const image = extractListingImage(html, url);
console.log("image", image);
const img = await fetch(image, { headers: { ...HEADERS, Accept: "image/jpeg,image/png" }, redirect: "follow" });
const buf = Buffer.from(await img.arrayBuffer());
console.log("dl", img.status, img.headers.get("content-type"), buf.length, buf.slice(0, 4));
