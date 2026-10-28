import { servicoOpenFinance } from "./lib/open-finance-runtime.js";

let ciclo = null;

export function startOpenFinance() {
  const executar = () => {
    if (ciclo) return ciclo;
    ciclo = servicoOpenFinance().orquestrar().catch((error) => {
      console.error(`[open-finance] ${error.message}`);
    }).finally(() => {
      ciclo = null;
    });
    return ciclo;
  };
  const timer = setInterval(executar, 60_000);
  timer.unref?.();
  executar();
  return timer;
}
