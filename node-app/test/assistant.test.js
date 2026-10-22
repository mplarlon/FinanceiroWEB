import assert from "node:assert/strict";
import test from "node:test";
import { detectIntent, resolveConversationIntent } from "../server/routes/assistant.js";
import { resolveInterpretedIntent, validateAiIntent, validAiSummary } from "../server/lib/charlie-ai.js";
import { detectFinancialIntent, parseFinancialDate } from "../server/lib/finance-assistant.js";
import { detectReportIntent } from "../server/lib/report-assistant.js";
import { detectPurchaseIntent, PURCHASE_DEMAND_SOURCE, PURCHASE_ENTRY_SOURCES, PURCHASE_MOVEMENT_SOURCE } from "../server/lib/purchase-assistant.js";
import { selectKnownTables, validateReadOnlySql } from "../server/lib/charlie-sql.js";
import { narrateQueryResult } from "../server/lib/charlie-answer.js";
import { matchExample, rulesForQuestion } from "../server/lib/charlie-knowledge.js";

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

test("traz a inteligência do comprador para as tabelas do dashboard", () => {
  assert.equal(PURCHASE_DEMAND_SOURCE, "SAIDAESTOQUE/SAIDAPRODUTO");
  assert.equal(PURCHASE_MOVEMENT_SOURCE, "MOV_PRODUTO");
  assert.deepEqual(PURCHASE_ENTRY_SOURCES, ["ENTRESTOQUE", "ENTRPRODUTO"]);
  assert.deepEqual(detectPurchaseIntent("o que preciso comprar hoje?"), {
    type: "compras_sugestao", limit: 15, coverageDays: 15,
  });
  assert.deepEqual(detectPurchaseIntent("risco de ruptura em 30 dias"), {
    type: "compras_cobertura", limit: 15, coverageDays: 30,
  });
  assert.deepEqual(detectPurchaseIntent("ruptura 18 dias"), {
    type: "compras_cobertura", limit: 15, coverageDays: 18,
  });
  assert.deepEqual(detectIntent("ruptura 18 dias"), {
    type: "compras_cobertura", limit: 15, coverageDays: 18,
  });
  assert.equal(detectReportIntent("ruptura 18 dias"), null);
  assert.deepEqual(detectPurchaseIntent("top 8 produtos da curva ABC"), {
    type: "compras_curva_abc", limit: 8,
  });
  assert.deepEqual(detectPurchaseIntent("ordens de compra pendentes"), {
    type: "compras_oc_pendente", limit: 15,
  });
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

test("explica o cálculo de compras usando o contexto anterior", () => {
  const previous = { type: "compras_cobertura", limit: 15, coverageDays: 15 };
  const resolved = resolveConversationIntent(null, {
    messages: [{ role: "assistant", intent: previous }],
  }, "Qual cálculo está fazendo para ruptura?");
  assert.deepEqual(resolved, { ...previous, explainCalculation: true });
});

test("analisa quando os produtos da resposta anterior ficaram negativos", () => {
  const previous = { type: "compras_cobertura", limit: 15, coverageDays: 15 };
  const resolved = resolveConversationIntent(null, {
    messages: [{ role: "assistant", intent: previous, data: [{ CODIGO: 10 }, { CODIGO: "20" }] }],
  }, "Verifique nesses 15 dias em que momento o produto ficou negativo");
  assert.deepEqual(resolved, { ...previous, negativeTimeline: true, productCodes: ["10", "20"] });
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

test("perguntas financeiras seguem o Ollama no mesmo tipo das compras", () => {
  const now = new Date(2026, 9, 13);
  const local = detectFinancialIntent("O que tenho para pagar hoje?", now);
  const resolved = resolveInterpretedIntent("O que tenho para pagar hoje?", local, {
    tipo: "contas_pagar",
    status: "aberto",
  });
  assert.equal(resolved.type, "financeiro_titulos");
  assert.equal(resolved.domain, "pagar");
  assert.equal(resolved.interpretador, "ollama");
  assert.equal(resolved.date.start, "2026-10-13");
  assert.equal(resolved.date.end, "2026-10-13");

  const refined = resolveInterpretedIntent("Quanto tenho para pagar para a Duratex?", local, {
    tipo: "financeiro_titulos",
    dominio: "pagar",
    status: "vencido",
    pessoa: "Duratex",
  });
  assert.equal(refined.person, "Duratex");
  assert.equal(refined.status, "vencido");
  assert.equal(refined.date.start, "2026-10-13");
  assert.equal(refined.interpretador, "ollama");

  const purchase = detectPurchaseIntent("o que preciso comprar hoje?");
  const purchaseResolved = resolveInterpretedIntent("o que preciso comprar hoje?", purchase, {
    tipo: "compras_sugestao",
  });
  assert.equal(purchaseResolved.interpretador, "ollama");
  assert.equal(purchaseResolved.coverageDays, 15);

  const kept = resolveInterpretedIntent("O que tenho para pagar hoje?", local, { tipo: "consulta_sql" });
  assert.equal(kept.type, "financeiro_titulos");
  assert.equal(kept.interpretador, "conhecimento_predefinido");
  assert.equal(kept.date.start, "2026-10-13");

  const onlyModel = resolveInterpretedIntent("O que recebo hoje?", null, {
    tipo: "contas_receber",
    status: "aberto",
  });
  assert.equal(onlyModel.type, "financeiro_titulos");
  assert.equal(onlyModel.domain, "receber");
  assert.equal(onlyModel.interpretador, "ollama");
  assert.ok(onlyModel.date?.start);
});

test("estoque baixo lista o mesmo conjunto da abertura, sem recorte de top 10", () => {
  assert.deepEqual(detectIntent("Quais são esses produtos com estoque baixo?"), {
    type: "estoque_baixo",
  });
  assert.equal(detectIntent("produtos com estoque minimo").limit, undefined);
  assert.deepEqual(detectIntent("top 15 produtos com estoque baixo"), {
    type: "estoque_baixo",
    limit: 15,
  });
  const listed = resolveInterpretedIntent(
    "Quais são esses produtos com estoque baixo?",
    { type: "estoque_baixo", limit: 10 },
    { tipo: "estoque_baixo", limite: 10 },
  );
  assert.equal(listed.type, "estoque_baixo");
  assert.equal(listed.limit, undefined);
  assert.equal(
    resolveInterpretedIntent(
      "top 15 produtos com estoque baixo",
      { type: "estoque_baixo", limit: 10 },
      { tipo: "estoque_baixo", limite: 10 },
    ).limit,
    15,
  );
  assert.equal(validateAiIntent({ tipo: "estoque_baixo", limite: 10 }).limit, undefined);
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

test("consultas livres do Ollama permanecem somente leitura", () => {
  assert.equal(validateReadOnlySql("SELECT NOME FROM CLIENTE"), "SELECT FIRST 200 NOME FROM CLIENTE");
  assert.throws(() => validateReadOnlySql("UPDATE CLIENTE SET NOME='X'"), /SELECT válida/);
  assert.throws(() => validateReadOnlySql("SELECT * FROM CLIENTE; DELETE FROM CLIENTE"), /múltiplas/);
  assert.throws(() => validateReadOnlySql("SELECT * FROM CLIENTE -- ignorar"), /comentários/);
});

test("usa conhecimento local para escolher tabelas antes do Ollama", () => {
  assert.deepEqual(selectKnownTables("Quantos fornecedores ativos existem?"), ["FORNECEDOR"]);
  assert.deepEqual(selectKnownTables("vendas por cliente e produto"), [
    "CLIENTE", "PRODUTO", "MOVIMENTO", "DEPOSITO", "MOV_PRODUTO",
    "SAIDAESTOQUE", "SAIDAPRODUTO",
  ]);
});

test("entende mês, ontem e ano nas datas", () => {
  const now = new Date(2026, 9, 20);
  assert.deepEqual(parseFinancialDate("quanto vendemos em agosto?", now), {
    start: "2026-08-01", end: "2026-08-31", label: "em agosto",
  });
  assert.deepEqual(parseFinancialDate("faturamento do mês passado", now), {
    start: "2026-09-01", end: "2026-09-30", label: "no mês passado",
  });
  assert.equal(parseFinancialDate("notas de ontem", now).start, "2026-10-19");
  assert.equal(detectIntent("Quanto vendemos neste mês?").type, "vendas");
  assert.equal(detectIntent("Quanto vendemos neste mês?").date.label, "neste mês");
  assert.equal(detectIntent("Quais produtos estão sem estoque?").type, "estoque_zerado");
  assert.equal(detectIntent("Qual vendedor vendeu mais?").section, "sellers");
});

test("mantém o assunto quando a pergunta seguinte só muda o período ou o fornecedor", () => {
  const previous = { type: "vendas", date: { start: "2026-09-01", end: "2026-09-30", label: "em setembro" } };
  const resolved = resolveConversationIntent(null, {
    messages: [
      { role: "user", text: "Quanto vendemos em setembro?" },
      { role: "assistant", intent: previous },
    ],
  }, "E em agosto?");
  assert.equal(resolved.type, "vendas");
  assert.equal(resolved.interpretador, "contexto");
  assert.deepEqual(resolved.date, parseFinancialDate("E em agosto?"));

  const titles = {
    type: "financeiro_titulos", domain: "pagar", status: "aberto",
    date: { start: "2026-10-20", end: "2026-10-20", label: "hoje" },
    person: null, limit: 50,
  };
  const filtered = resolveConversationIntent(null, {
    messages: [{ role: "assistant", intent: titles }],
  }, "Mostre somente as do fornecedor ABC");
  assert.equal(filtered.domain, "pagar");
  assert.equal(filtered.person, "ABC");
  assert.equal(filtered.date.start, "2026-10-20");
  assert.equal(filtered.interpretador, "contexto");
});

test("o validador de SELECT olha a estrutura, não só uma lista de palavras", () => {
  assert.equal(validateReadOnlySql("SELECT SETOR FROM CLIENTE"), "SELECT FIRST 200 SETOR FROM CLIENTE");
  assert.equal(
    validateReadOnlySql("SELECT 'DROP TABLE X' AS TEXTO FROM CLIENTE"),
    "SELECT FIRST 200 'DROP TABLE X' AS TEXTO FROM CLIENTE",
  );
  assert.throws(() => validateReadOnlySql("SELECT * FROM MINHA_PROC(1)"), /procedimento/);
  assert.throws(() => validateReadOnlySql("SELECT NOME FROM CLIENTE INTO :X"), /INTO/);
  assert.throws(() => validateReadOnlySql("EXECUTE BLOCK AS BEGIN DELETE FROM CLIENTE; END"), /SELECT válida/);
  assert.throws(() => validateReadOnlySql("SELECT * FROM NOTAFISCAL"), /filtro/);
  assert.throws(() => validateReadOnlySql("SELECT SENHA FROM USUARIOS"), /confidenciais/);
  assert.throws(() => validateReadOnlySql("SELECT NOME FROM TABELA_INEXISTENTE_XYZ"), /catálogo/);
});

test("resposta vazia e regras de negócio não inventam dados", () => {
  assert.match(narrateQueryResult([], "Faturamento").resposta, /não encontrei registros/);
  const narrative = narrateQueryResult([{ QTD: 18, TOTAL: 45780 }], "Contas a receber hoje");
  assert.match(narrative.resposta, /18/);
  assert.match(narrative.resposta, /45\.780,00/);
  assert.equal(narrative.origem, "calculo_no_banco");
  assert.match(rulesForQuestion("quanto vendemos em setembro", ["SAIDAESTOQUE"]).map((rule) => rule.id).join(","), /venda-efetiva/);
  assert.equal(matchExample("quais notas fiscais foram emitidas ontem", { executableOnly: true }), null);
  assert.equal(matchExample("quais notas fiscais foram emitidas ontem").tabelas[0], "NOTAFISCAL");
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
