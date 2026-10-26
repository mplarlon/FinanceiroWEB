import { query, withReadOnlyDatabase } from "./db.js";
import { loadState } from "./lib/charlie-leads-store.js";
import { executarAutomacao } from "./lib/charlie-leads-service.js";

function hora(data) {
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

export async function tickCharlieLeads(agora = new Date(), deps = {}) {
  const estado = loadState();
  if (!estado.automacao.ativa) return { executado: false, motivo: "desativada" };
  if (!estado.automacao.diasSemana.includes(agora.getDay())) return { executado: false, motivo: "fora_do_dia" };
  if (estado.automacao.hora !== hora(agora)) return { executado: false, motivo: "fora_do_horario" };
  const ultima = estado.automacao.ultimaExecucao ? new Date(estado.automacao.ultimaExecucao) : null;
  if (ultima && ultima.toDateString() === agora.toDateString()) return { executado: false, motivo: "ja_executada" };
  const consulta = deps.query || ((sql, params) => withReadOnlyDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })));
  return executarAutomacao(null, { query: consulta, client: deps.client });
}

export function startCharlieLeads() {
  const timer = setInterval(() => {
    tickCharlieLeads().catch((error) => console.error(`[charlie-leads] ${error.message}`));
  }, 60_000);
  timer.unref?.();
  return timer;
}
