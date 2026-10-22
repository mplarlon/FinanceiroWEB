import { withDatabase } from "../server/db.js";
import { interpretWithOllama } from "../server/lib/charlie-ai.js";
import { answer, detectIntent } from "../server/routes/assistant.js";

const questions = [
  "O que tenho para pagar hoje?",
  "O que vence amanhã?",
  "Tem alguma conta atrasada?",
  "Quanto preciso pagar até sexta?",
  "Contas a receber vencidas",
  "Contas parcialmente pagas",
  "Saldo dos bancos",
  "O que preciso comprar hoje?",
  "Risco de ruptura em 15 dias",
  "Ordens de compra pendentes",
  "Top 10 produtos da curva ABC",
  "O que você olharia nos relatórios?",
  "Abrir o dia",
  "Top 5 produtos vendidos",
  "Top 5 vendedores por faturamento",
  "Top 5 clientes que mais compraram",
  "Estoque negativo",
  "Estoque baixo",
  "Caixa hoje",
  "Quantos fornecedores ativos existem?",
];

let failures = 0;
for (const question of questions) {
  const started = Date.now();
  try {
    const suggested = detectIntent(question);
    const intent = await interpretWithOllama(question, suggested);
    const result = await withDatabase((db) => answer(db, question, intent));
    console.log(JSON.stringify({ ok: true, question, intent: intent?.type, rows: result.dados?.length || 0, ms: Date.now() - started }));
  } catch (error) {
    failures += 1;
    console.error(JSON.stringify({ ok: false, question, error: error.message, ms: Date.now() - started }));
  }
}
if (failures) process.exitCode = 1;
