import { readJsonConfig } from "./json-config.js";
import { montarOportunidades } from "./charlie-sales-opportunities.js";

const ARQUIVOS = ["charlie-commercial-opportunities.json", "ecommerce_intelligence_control.json"];

export async function painelOportunidades(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return montarOportunidades(opcoes.fatos);
  const arquivos = {};
  for (const nome of ARQUIVOS) {
    if (opcoes.arquivos && Object.prototype.hasOwnProperty.call(opcoes.arquivos, nome)) {
      arquivos[nome] = opcoes.arquivos[nome];
      continue;
    }
    if (opcoes.arquivos) continue;
    try { arquivos[nome] = readJsonConfig(nome, null); }
    catch { arquivos[nome] = null; }
  }
  return montarOportunidades({ arquivos, ator: opcoes.ator || {} });
}
