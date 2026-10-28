import { listAutomations } from "./charlie-automation-store.js";
import { resumirAutomacoes } from "./charlie-automation-center.js";

export async function painelAutomacoes(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return resumirAutomacoes(opcoes.fatos);
  try {
    return resumirAutomacoes(listAutomations(opcoes.ator || {}, {}, deps));
  } catch {
    return resumirAutomacoes(null);
  }
}
