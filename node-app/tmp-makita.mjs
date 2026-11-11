const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9",
};
const urls = [
  "https://www.makita.com.br/catalogoFDetalhes.asp?codParamD=1003",
  "https://www.makita.com.br/catalogoBusca.asp?busca=M0801",
  "https://www.makita.com.br/catalogo.asp?busca=DHP482",
  "https://www.makita.com.br/busca.asp?q=GA7020",
];
for (const url of urls) {
  try {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    const title = (html.match(/<title>[^<]+/i) || [""])[0].slice(0, 80);
    const dims = (html.match(/Dimens[\s\S]{0,80}/i) || [""])[0].replace(/\s+/g, " ").slice(0, 90);
    console.log(response.status, html.length, title, "|", dims, "|", response.url.slice(0, 90));
  } catch (error) {
    console.log("FAIL", error.cause?.code || error.message, url.slice(0, 70));
  }
}
