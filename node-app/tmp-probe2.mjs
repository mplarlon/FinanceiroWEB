import { catalogModelCodes, extractCandidate, htmlToText, researchProductSpecs } from "./server/lib/product-web-specs.js";

async function makitaSearch(model) {
  const response = await fetch("https://www.makita.com.br/busca.asp", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www.makita.com.br",
      Referer: "https://www.makita.com.br/",
      "User-Agent": "Mozilla/5.0",
    },
    body: new URLSearchParams({ s: model }).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const html = await response.text();
  const ids = [...html.matchAll(/catalogoFDetalhes\.asp\?codParamD=(\d+)/gi)].map((m) => m[1]);
  return [...new Set(ids)].slice(0, 3);
}

async function makitaDetail(id) {
  const url = `https://www.makita.com.br/catalogoFDetalhes.asp?codParamD=${id}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR" },
    signal: AbortSignal.timeout(20000),
  });
  const html = await response.text();
  const text = htmlToText(html);
  const snippets = [];
  for (const re of [/peso[\s\S]{0,80}/gi, /dimens[\s\S]{0,100}/gi, /CxLxA[\s\S]{0,80}/gi, /\d+[.,]?\d*\s*kg/gi, /\d+\s*[x×]\s*\d+\s*[x×]\s*\d+/gi]) {
    const m = text.match(re);
    if (m) snippets.push(...m.slice(0, 2));
  }
  return { url, status: response.status, len: text.length, snippets: [...new Set(snippets)].slice(0, 8), head: text.slice(0, 400) };
}

const models = ["MBO452", "MJV430", "HW101", "HW102", "4100NSZ", "MCC400", "CL106FDSAW", "CL106", "5007N"];
for (const model of models) {
  const ids = await makitaSearch(model);
  console.log("\n===", model, "ids", ids);
  if (!ids[0]) continue;
  const detail = await makitaDetail(ids[0]);
  console.log(detail);
  const cand = extractCandidate(
    { name: `MAKITA ${model}`, brand: "MAKITA" },
    { title: `Makita ${model}`, url: detail.url, text: (await (async () => {
      const r = await fetch(detail.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      return htmlToText(await r.text());
    })()) },
  );
  console.log("cand", cand && { w: cand.weightGrams, l: cand.lengthCm, wd: cand.widthCm, h: cand.heightCm, score: cand.score });
}
