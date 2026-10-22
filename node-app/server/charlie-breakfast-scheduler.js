import { isDue, nextRetry, referenceDay } from "./lib/charlie-breakfast-engine.js";
import { readRuns, readSettings, readState, saveState } from "./lib/charlie-breakfast-store.js";
import { runBreakfast, dispatchSellerNotices } from "./lib/charlie-breakfast-service.js";

let running = false;

async function execute(settings, decision, now, state) {
  try {
    const companies = settings.empresas?.length ? settings.empresas : [null];
    const relatorios = [];
    for (const companyId of companies) {
      relatorios.push(await runBreakfast({
        companyId,
        now,
        reason: "agenda",
        send: true,
        user: { permissao_gerencial: true, nome: "Agenda do Charlie Daily" },
        settings,
      }));
    }
    const failed = relatorios.find((item) => item.entrega?.email === "falha" || item.entrega?.whatsapp === "falha");
    if (failed) throw new Error(failed.entrega.motivos?.[0] || "Falha no envio.");
    saveState({ lastSuccessKey: decision.key, lastSuccessAt: new Date().toISOString(), retry: null });
    return { ok: true, key: decision.key, relatorios: relatorios.length };
  } catch (error) {
    const attempts = Number(state.retry?.key === decision.key ? state.retry.attempts : 0) + 1;
    const giveUp = attempts >= (settings.tentativas || 3);
    saveState({
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
      retry: giveUp ? null : { key: decision.key, reference: decision.reference || referenceDay(now), attempts, nextAt: nextRetry(attempts, now), erro: error.message },
    });
    console.error(`[cafe-manha] tentativa ${attempts}: ${error.message}`);
    return { ok: false, erro: error.message, attempts, esgotado: giveUp };
  }
}

export async function tickBreakfast(now = new Date()) {
  if (running) return { skipped: true, reason: "em execução" };
  running = true;
  try {
    const settings = readSettings();
    const state = readState();
    const decision = isDue(settings, now, state);
    let agenda = decision;
    if (decision.due) agenda = await execute(settings, decision, now, state);
    else if (state.retry?.nextAt && Date.parse(state.retry.nextAt) <= Date.parse(now) && state.retry.attempts < (settings.tentativas || 3)) {
      agenda = await execute(settings, { key: state.retry.key, reference: state.retry.reference, due: true }, now, state);
    }
    const report = readRuns().find((item) => item.referencia === referenceDay(now));
    const vendedores = await dispatchSellerNotices(report, settings, now);
    return { agenda, vendedores };
  } catch (error) {
    console.error(`[cafe-manha] ${error.message}`);
    return { ok: false, erro: error.message };
  } finally {
    running = false;
  }
}

export function startBreakfastScheduler() {
  const timer = setInterval(() => {
    tickBreakfast().catch((error) => console.error(`[cafe-manha] ${error.message}`));
  }, 30_000);
  timer.unref();
  tickBreakfast().catch((error) => console.error(`[cafe-manha] ${error.message}`));
  return timer;
}
