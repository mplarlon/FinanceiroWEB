import fs from "node:fs";
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9",
};
const response = await fetch("https://www.makita.com.br/", { headers, signal: AbortSignal.timeout(15000) });
const html = await response.text();
fs.writeFileSync("tmp-makita-home.html", html);
const forms = [...html.matchAll(/<form[\s\S]{0,400}/gi)].slice(0, 6).map((match) => match[0].replace(/\s+/g, " ").slice(0, 220));
console.log(forms.join("\n---\n"));
const search = [...html.matchAll(/busca[^"' ]{0,40}/gi)].slice(0, 15);
console.log("busca", search.map((match) => match[0]));
