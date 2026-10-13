import assert from "node:assert/strict";
import test from "node:test";
import { detectIntent, resolveConversationIntent } from "../server/routes/assistant.js";
import { validateAiIntent, validAiSummary } from "../server/lib/charlie-ai.js";
import { detectFinancialIntent, parseFinancialDate } from "../server/lib/finance-assistant.js";
import { detectReportIntent } from "../server/lib/report-assistant.js";

test("interpreta perguntas operacionais sem IA externa", () => {
  assert.deepEqual(detectIntent("top 5 produtos vendidos"), {
    type: "produtos",
    limit: 5,
  });
  assert.deepEqual(detectIntent("saldo dos bancos"), {
    type: "saldo_bancos",
  });
  assert.deepEqual(detectIntent("contas a receber"), {
    type: "financeiro_titulos",
    domain: "receber",
    status: "aberto",
    date: null,
    person: null,
    limit: 50,
  });
  assert.deepEqual(detectIntent("Bom dia Charlie, vamos abrir o dia"), {
    type: "abertura_dia",
  });
  assert.deepEqual(detectIntent("o que você sabe fazer?"), { type: "ajuda" });
  assert.equal(detectIntent("qualquer coisa"), null);
});

test("interpreta perguntas financeiras informais e datas relativas", () => {
  const now = new Date(2026, 9, 13);
  assert.deepEqual(detectFinancialIntent("O que tenho para pagar hoje?", now), {
    type: "financeiro_titulos", domain: "pagar", status: "aberto",
    date: { start: "2026-10-13", end: "2026-10-13", label: "hoje" }, person: null, limit: 50,
  });
  assert.deepEqual(detectFinancialIntent("Quanto tenho para pagar para a Duratex?", now).person, "Duratex");
  assert.deepEqual(detectFinancialIntent("O que vence amanhã?", now).domain, null);
  assert.deepEqual(parseFinancialDate("Quanto preciso pagar até sexta?", now), {
    start: "2026-10-13", end: "2026-10-16", label: "até sexta",
  });
  assert.deepEqual(parseFinancialDate("Quanto devo a CSN até o dia 19/10?", now), {
    start: "2026-10-13", end: "2026-10-19", label: "até o dia 19/10/2026",
  });
  assert.equal(detectFinancialIntent("Tem alguma conta atrasada?", now).domain, "pagar");
  assert.equal(detectFinancialIntent("Tem alguma conta atrasada?", now).status, "vencido");
  assert.equal(detectFinancialIntent("Quais débitos estão fora do prazo?", now).status, "vencido");
  assert.equal(detectFinancialIntent("Quais títulos já foram liquidados?", now).status, "quitado");
  assert.equal(detectFinancialIntent("O que vai sair do caixa nesta semana?", now).domain, "pagar");
  assert.equal(detectFinancialIntent("Quais valores vão entrar no caixa?", now).domain, "receber");
  assert.equal(detectFinancialIntent("Estou devendo algo para a Pontual?", now).person, "Pontual");
  assert.deepEqual(parseFinancialDate("O que vence neste mês?", now), {
    start: "2026-10-01", end: "2026-10-31", label: "neste mês",
  });
});

test("preserva o contexto depois de pedir pagar ou receber", () => {
  const current = detectFinancialIntent("contas a pagar", new Date(2026, 9, 13));
  const previous = {
    type: "financeiro_titulos", domain: null, status: "aberto",
    date: { start: "2026-10-14", end: "2026-10-14", label: "amanhã" },
    person: null, limit: 50, needsClarification: true,
  };
  const merged = resolveConversationIntent(current, {
    messages: [{ role: "assistant", intent: previous }],
  });
  assert.equal(merged.domain, "pagar");
  assert.equal(merged.date.start, "2026-10-14");
  assert.equal(merged.needsClarification, false);
});

test("direciona perguntas naturais para os relatorios existentes", () => {
  const now = new Date(2026, 9, 13);
  assert.equal(detectReportIntent("O que você olharia nos relatórios?", now).section, "help");
  assert.equal(detectReportIntent("Quais clientes estão em risco?", now).section, "retention");
  assert.equal(detectReportIntent("Vou precisar de capital de giro?", now).section, "cashflow");
  assert.equal(detectReportIntent("Qual loja teve o melhor resultado este mês?", now).section, "stores");
  assert.equal(detectReportIntent("Como estão as lojas este mês?", now).section, "stores");
  assert.equal(detectReportIntent("Quais clientes pararam de comprar?", now).section, "retention");
  assert.equal(detectReportIntent("O que preciso comprar agora?", now).section, "inventory");
  assert.deepEqual(detectReportIntent("Como foram os vendedores nos últimos 90 dias?", now).query, { dias: 90 });
});

test("Ollama fica limitado as intencoes permitidas", () => {
  assert.deepEqual(validateAiIntent({ tipo: "produtos", limite: 999 }), {
    type: "produtos",
    limit: 50,
    interpretador: "ollama",
  });
  assert.equal(validateAiIntent({ tipo: "executar_sql" }), null);
  assert.equal(
    validateAiIntent({ tipo: "vendas", sql: "DROP TABLE X" }).sql,
    undefined,
  );
});

test("narrativa do Ollama nao pode inventar numeros", () => {
  assert.equal(
    validAiSummary("Foram 12 vendas, total de 150,00.", "12 vendas; R$ 150,00"),
    true,
  );
  assert.equal(
    validAiSummary("Foram 13 vendas.", "12 vendas; R$ 150,00"),
    false,
  );
});
