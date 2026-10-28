import { readJsonConfig } from "./json-config.js";
import { resumirAlertas } from "./charlie-alert-center.js";

const ARQUIVO = "ecommerce_intelligence_control.json";

export async function painelAlertas(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return resumirAlertas(opcoes.fatos);
  let bruto = opcoes.arquivo;
  if (bruto === undefined) {
    try { bruto = readJsonConfig(ARQUIVO, null); }
    catch { bruto = null; }
  }
  if (bruto == null || typeof bruto !== "object") return resumirAlertas({ configuracao: null, alertas: null });
  return resumirAlertas({
    configuracao: Object.prototype.hasOwnProperty.call(bruto, "settings") && bruto.settings && typeof bruto.settings === "object" ? bruto.settings : null,
    alertas: Object.prototype.hasOwnProperty.call(bruto, "opportunities") ? Object.values(bruto.opportunities || {}) : null,
  });
}
