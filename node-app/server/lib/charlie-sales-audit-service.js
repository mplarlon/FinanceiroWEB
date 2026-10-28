import { readJsonConfig } from "./json-config.js";
import { montarAuditoria } from "./charlie-sales-audit.js";

const ARQUIVOS = [
  "ecommerce_intelligence_control.json",
  "ecommerce_marketplace_booster.json",
  "charlie-leads.json",
  "charlie-automations.json",
  "charlie_rebuy.json",
  "charlie_buying_signals.json",
  "charlie_stock_guardian.json",
  "charlie_autopilot.json",
  "charlie_smart_purchasing.json",
  "charlie_smart_campaigns.json",
  "charlie_competitor_radar.json",
  "charlie_whatsapp_sales.json",
  "charlie_recovery.json",
  "charlie_smart_quotes.json",
  "charlie_price_rules.json",
];

export async function painelAuditoria(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return montarAuditoria(opcoes.fatos);
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
  return montarAuditoria({ arquivos, ator: opcoes.ator || {} });
}
