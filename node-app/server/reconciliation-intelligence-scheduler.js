import { withDatabase, withWriteTransaction } from "./db.js";
import { puxarExtratosAutorizados, enviarAvisosConciliacao } from "./lib/reconciliation-intelligence-delivery.js";
import {
  aplicarConciliacao,
  carregarConciliacao,
  cicloDevido,
  executarCiclo,
  importarExtratoConfirmado,
  lerEstado,
  registrarFalhaCiclo,
} from "./lib/reconciliation-intelligence-service.js";

async function importarFontes() {
  const fontes = await puxarExtratosAutorizados();
  for (const fonte of fontes) {
    if (fonte.status !== "recebido" || !fonte.itens?.length || !fonte.empresa) continue;
    await withWriteTransaction((tx) => importarExtratoConfirmado(tx, {
      confirmado: true,
      cdbanco: fonte.banco,
      agencia: fonte.agencia || "",
      numconta: fonte.conta,
      empresa: fonte.empresa,
      usuario: 1,
      itens: fonte.itens,
      nomeArquivo: "open-finance",
    }));
  }
}

export async function tickReconciliacao() {
  const estado = lerEstado();
  if (!cicloDevido(estado)) return null;
  let carga;
  try {
    await importarFontes().catch((error) => console.error(`[conciliacao] extrato ${error.message}`));
    carga = await withDatabase((db) => carregarConciliacao(db, null, estado.configuracao.maxMovimentos || 500, estado.fila || 0));
  } catch (error) {
    registrarFalhaCiclo(error);
    throw error;
  }
  return executarCiclo({
    ...carga,
    aplicar: (decisao, ator) => withWriteTransaction((tx) => aplicarConciliacao(tx, decisao, ator)),
    enviarAvisos: enviarAvisosConciliacao,
  });
}

export function startReconciliationIntelligence() {
  const timer = setInterval(() => {
    tickReconciliacao().catch((error) => console.error(`[conciliacao] ${error.message}`));
  }, 60_000);
  timer.unref?.();
  tickReconciliacao().catch((error) => console.error(`[conciliacao] ${error.message}`));
  return timer;
}
