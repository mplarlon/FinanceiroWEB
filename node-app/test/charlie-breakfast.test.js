import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charlie-breakfast-"));
process.env.DASHBOARD_DATA_DIR = dir;

const engine = await import("../server/lib/charlie-breakfast-engine.js");
const store = await import("../server/lib/charlie-breakfast-store.js");
const delivery = await import("../server/lib/charlie-breakfast-delivery.js");
const { salesWhere } = await import("../server/lib/charlie-breakfast-service.js");

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const day = [
  { companyId: 1, sellerId: 1, seller: "João", orders: 4, revenue: 35000 },
  { companyId: 1, sellerId: 2, seller: "Maria", orders: 3, revenue: 29000 },
  { companyId: 1, sellerId: 3, seller: "Carlos", orders: 2, revenue: 21000 },
  { companyId: 1, sellerId: 4, seller: "Pedro", orders: 1, revenue: 4500 },
  { companyId: 2, sellerId: 9, seller: "Outra loja", orders: 8, revenue: 90000 },
];

test("ranking, empate e filtro de empresa", () => {
  const ranked = engine.rankSellers(day, 1);
  assert.deepEqual(ranked.ranking.map((item) => item.nome), ["João", "Maria", "Carlos", "Pedro"]);
  assert.equal(ranked.ranking[0].ticket, 8750);
  assert.equal(ranked.menor.nome, "Pedro");
  assert.equal(ranked.ranking.some((item) => item.nome === "Outra loja"), false);
  const tied = engine.rankSellers([
    { companyId: 1, sellerId: 1, seller: "Ana", orders: 1, revenue: 100 },
    { companyId: 1, sellerId: 2, seller: "Bia", orders: 1, revenue: 100 },
  ], 1);
  assert.equal(tied.ranking[0].posicao, 1);
  assert.equal(tied.ranking[1].posicao, 1);
  assert.equal(tied.menor.empate, true);
});

test("conversão de orçamento separa aberto, finalizado, cancelado e remessa", () => {
  const report = engine.composeBreakfast({
    reference: "2026-10-21",
    companyId: 1,
    companyName: "Pontual",
    quotesPeriod: [
      { status: 0, count: 4, value: 1000, companyId: 1 },
      { status: 1, count: 1, value: 500, companyId: 1 },
      { status: 2, count: 2, value: 80, companyId: 1 },
      { status: 3, count: 1, value: 70, companyId: 1 },
      { status: 1, count: 9, value: 9999, companyId: 2 },
    ],
    openTotal: { count: 8, value: 188000 },
    openBySeller: [
      { companyId: 1, sellerId: 1, seller: "João", count: 3, value: 85000 },
      { companyId: 1, sellerId: 2, seller: "Maria", count: 2, value: 62000 },
    ],
  });
  assert.equal(report.orcamentos.novos, 5);
  assert.equal(report.orcamentos.convertidos, 1);
  assert.equal(report.orcamentos.taxa, 20);
  assert.equal(report.orcamentos.remessa, 1);
  assert.equal(report.orcamentos.abertos, 8);
  assert.equal(report.orcamentos.porVendedor[0].vendedor, "João");
});

test("meta usa dias úteis e não inventa percentual sem meta", () => {
  const withGoal = engine.assessGoal(500000, 385000, "2026-10-21", "teste");
  assert.equal(withGoal.atingimento, 77);
  assert.equal(withGoal.faltam, 115000);
  assert.equal(typeof withGoal.ritmoSuficiente, "boolean");
  assert.ok(withGoal.diasUteisRestantes > 0);
  const missing = engine.assessGoal(0, 100, "2026-10-21");
  assert.equal(missing.atingimento, null);
  assert.match(missing.texto, /Meta não cadastrada/);
  const change = engine.variation(123, 0);
  assert.equal(change.percentual, null);
  const up = engine.variation(123, 100);
  assert.equal(up.percentual, 23);
});

test("estoque crítico, baixa manual e relatório sem número inventado", () => {
  const risks = engine.stockRisk([{ product: "Correia", productId: "1", stock: 12, qty90: 540, minimum: 10 }], {});
  assert.equal(risks[0].cobertura, 2);
  assert.equal(risks[0].prioridade, "alta");
  assert.ok(risks[0].sugestao > 0);
  const manual = engine.movementReading({ product: "Rolamento", initial: 100, entries: 50, sales: 80, manualOut: 10, actual: 60, history: "Ajuste na Tela de Inventário", avgDaily: 2 });
  assert.equal(manual.atipica, false);
  assert.match(manual.texto, /Não indica fraude/);
  const atypical = engine.movementReading({ product: "Rolamento", manualOut: 40, avgDaily: 1, history: "Baixa manual" });
  assert.equal(atypical.atipica, true);
  const report = engine.composeBreakfast({
    reference: "2026-10-21",
    companyId: 1,
    companyName: "Pontual",
    salesDay: day,
    salesMonth: day,
    stockCritical: [{ companyId: 1, product: "Correia", productId: "1", stock: 12, qty90: 540 }],
    stockIdle: { value: 48000, count: 6 },
    finance: { receivableOpen: 1000, receivableOverdue: 2000, contracts: null },
    settings: { metas: { mensal: 500000 } },
  });
  assert.match(report.texto, /Charlie Daily/);
  assert.match(report.texto, /R\$\s*35\.000,00/);
  assert.equal(report.texto.includes("Dado indisponível para esta análise"), false);
  assert.equal(report.texto.includes("Meta não cadastrada"), false);
  assert.equal(report.precos.concorrencia, null);
  assert.equal(report.financeiro.contratos, null);
  assert.equal(engine.narrativeAccepts("O ritmo ficou em R$ 999.999,00.", report), false);
  assert.equal(report.alertas.some((item) => item.categoria === "estoque"), true);
  const ruptura = report.alertas.find((item) => String(item.chave).startsWith("ruptura:"));
  assert.equal(ruptura.titulo, "Correia");
  assert.equal(ruptura.contexto, "Cobertura baixa");
});

test("agenda às 07:00 em São Paulo, dia da semana e duplicidade", () => {
  const thursday = new Date("2026-10-22T10:00:00.000Z");
  assert.equal(engine.saoPauloParts(thursday).hhmm, "07:00");
  const due = engine.isDue({ enabled: true, time: "07:00", weekdays: [4] }, thursday, {});
  assert.equal(due.due, true);
  assert.equal(due.reference, "2026-10-21");
  assert.equal(engine.isDue({ enabled: true, time: "07:00", weekdays: [4] }, thursday, { lastSuccessKey: due.key }).reason, "duplicado");
  assert.equal(engine.isDue({ enabled: false, time: "07:00", weekdays: [4] }, thursday, {}).reason, "desligado");
  assert.equal(engine.isDue({ enabled: true, time: "07:00", weekdays: [1, 2, 3, 4, 5] }, new Date("2026-10-25T10:00:00.000Z"), {}).reason, "dia");
});

test("alerta duplicado, permissão e consulta por empresa", () => {
  const first = store.upsertAlerts([{ chave: "meta:1:2026-10", categoria: "comercial", severidade: "alta", descricao: "Meta", indicadores: {}, acao: "Revisar", status: "novo", data: "2026-10-21", origem: "cafe-manha" }]);
  const second = store.upsertAlerts([{ chave: "meta:1:2026-10", categoria: "comercial", severidade: "alta", descricao: "Meta atualizada", indicadores: { faltam: 10 }, acao: "Revisar", status: "novo" }]);
  assert.equal(second.filter((item) => item.chave === "meta:1:2026-10").length, 1);
  assert.equal(second.find((item) => item.chave === "meta:1:2026-10").id, first.find((item) => item.chave === "meta:1:2026-10").id);
  assert.throws(() => store.updateAlert(second[0].id, { status: "ignorado" }, { nome: "Gestor" }), /motivo/i);
  const updated = store.updateAlert(second[0].id, { status: "ignorado", motivo: "Já tratado fora do ERP" }, { nome: "Gestor" });
  assert.equal(updated.status, "ignorado");
  assert.throws(() => engine.assertBreakfastAccess({ permissao_gerencial: false }, 1, {}), /permissão/i);
  assert.throws(() => engine.assertBreakfastAccess({ permissao_gerencial: true }, 2, { empresas: [1] }), /recorte/i);
  assert.match(salesWhere("se", 1), /IDEMPRESA=\?/);
  assert.equal(salesWhere("se", null).includes("IDEMPRESA"), false);
});

test("e-mail e WhatsApp não disparam sem liberação e disparam quando autorizados", async () => {
  const report = engine.composeBreakfast({ reference: "2026-10-21", companyName: "Pontual", salesDay: day.filter((item) => item.companyId === 1) });
  let called = 0;
  const blocked = await delivery.deliverReport(report, { ...engine.DEFAULT_SETTINGS, emails: "gestor@pontual.test", whatsapp: "5521999999999", enviarReal: false }, {
    probes: { smtp: { smtp_host: "smtp", smtp_user: "a", smtp_password: "b" }, whatsapp: { access_token: "t", phone_number_id: "1" } },
    sendEmail: () => { called += 1; },
    sendWhatsApp: () => { called += 1; },
  });
  assert.equal(blocked.email, "simulado");
  assert.equal(blocked.whatsapp, "simulado");
  assert.equal(called, 0);
  const sent = await delivery.deliverReport(report, { ...engine.DEFAULT_SETTINGS, emails: "gestor@pontual.test", whatsapp: "5521999999999", enviarReal: true, templateWhatsapp: "cafe_manha" }, {
    probes: { smtp: { smtp_host: "smtp", smtp_user: "a", smtp_password: "b" }, whatsapp: { access_token: "t", phone_number_id: "1" } },
    sendEmail: async () => { called += 1; },
    sendWhatsApp: async () => { called += 1; },
  });
  assert.equal(sent.email, "real");
  assert.equal(sent.whatsapp, "real");
  assert.equal(called, 2);
  assert.equal(sent.enviados.length, 2);
});

test("recado individual e campanha respeitam autorização", () => {
  const report = engine.composeBreakfast({
    reference: "2026-10-21",
    openQuotes: [
      { companyId: 1, number: 10, sellerId: 1, seller: "João", customer: "Cliente A", value: 42800, date: "2026-10-18" },
      { companyId: 1, number: 11, sellerId: 2, seller: "Maria", customer: "Cliente B", value: 7777, date: "2026-10-18" },
    ],
    settings: { metas: { vendedores: { 1: 1000 } }, notificacaoIndividual: { ativo: true, inicio: "08:00", fim: "18:00" } },
    salesMonth: [{ companyId: 1, sellerId: 1, seller: "João", orders: 1, revenue: 780 }],
  });
  const parts = { hour: 9, minute: 0 };
  const blocked = engine.sellerMessage({ id: 1, nome: "João", telefone: "5521999999999", consentimento: false }, report, report.indicadores && { notificacaoIndividual: { ativo: true, inicio: "08:00", fim: "18:00" } }, parts);
  assert.equal(blocked.enviar, false);
  const message = engine.sellerMessage({ id: 1, nome: "João", telefone: "5521999999999", consentimento: true }, report, { notificacaoIndividual: { ativo: true, inicio: "08:00", fim: "18:00" } }, parts);
  assert.equal(message.enviar, true);
  assert.match(message.texto, /João/);
  assert.equal(message.texto.includes("7777"), false);
  assert.equal(message.texto.includes("Maria"), false);
  const early = engine.sellerMessage({ id: 1, nome: "João", telefone: "5521999999999", consentimento: true }, report, { notificacaoIndividual: { ativo: true, inicio: "08:00", fim: "18:00" } }, { hour: 7, minute: 0 });
  assert.match(early.motivo, /horário/);
  const campaign = engine.prepareCampaign([
    { consentimento: true, orcamentoAberto: true, nome: "Ana" },
    { consentimento: false, orcamentoAberto: true, nome: "Bia" },
    { consentimento: true, descadastrado: true, orcamentoAberto: true, nome: "Caio" },
  ], { produto: "Rolamento" });
  assert.equal(campaign.destinatarios.length, 1);
  assert.equal(engine.dispatchAllowed(campaign, { campanhas: { aprovada: false } }).ok, false);
  assert.equal(engine.dispatchAllowed(campaign, { campanhas: { aprovada: true } }).ok, true);
});

test("metas parciais, giro, classificação e filtro do painel", () => {
  const dayGoal = engine.assessWindow(1000, 400, "dia");
  assert.equal(dayGoal.atingimento, 40);
  assert.equal(dayGoal.faltam, 600);
  assert.equal(engine.assessWindow(0, 10, "semana").atingimento, null);
  const chance = engine.quoteProbability(10, 4);
  assert.equal(chance.taxa, 40);
  assert.equal(engine.quoteProbability(3, 1).taxa, null);
  const expense = engine.classifyExpense("Pagamento de aluguel da loja");
  assert.equal(expense.classe, "aluguel");
  assert.equal(expense.confirmada, false);
  assert.equal(engine.classifyExpense("Lançamento sem padrão").classe, null);
  const conta = engine.accountClassificationLabel({ CONTA: "Despesas", SUBCONTA: "Energia", CDCONTA: "2", CDSUBCONTA: "10" });
  assert.equal(conta.classe, "Despesas · Energia");
  assert.equal(conta.origem, "contabil");
  assert.equal(engine.accountClassificationLabel({ CDCONTA: "4" }).classe, "4");
  assert.equal(engine.accountClassificationLabel({}).classe, null);
  const grouped = engine.groupExpensesByClassification([
    { historico: "COMPRA DE MERCADORIA", valor: 325067.88, quantidade: 2, classe: "FORNECEDOR · FORNECEDOR PRODUTO", confirmada: true, origem: "contabil", texto: "" },
    { historico: "", valor: 750.44, quantidade: 1, classe: "FORNECEDOR · FORNECEDOR PRODUTO", confirmada: true, origem: "contabil", texto: "" },
    { historico: "ALUGUEL", valor: 10, quantidade: 1, classe: "DESPESAS · ALUGUEL", confirmada: true, origem: "contabil", texto: "" },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].classe, "FORNECEDOR · FORNECEDOR PRODUTO");
  assert.equal(grouped[0].valor, 325818.32);
  assert.equal(grouped[0].quantidade, 3);
  assert.equal(grouped[0].historico, "COMPRA DE MERCADORIA · Sem histórico");
  const quote = engine.prioritizeQuote({ number: 9, value: 100, date: "2026-10-21", historicoOrcamentos: 8, historicoConvertidos: 2, semEstoque: 1 }, {}, "2026-10-21");
  assert.equal(quote.probabilidade, 25);
  assert.equal(quote.semEstoque, 1);
  assert.match(quote.motivo, /sem saldo/);
  const report = engine.composeBreakfast({
    reference: "2026-10-21",
    companyId: 1,
    salesDay: day.filter((item) => item.companyId === 1),
    salesWeek: day.filter((item) => item.companyId === 1),
    salesMonth: day.filter((item) => item.companyId === 1),
    settings: { metas: { diaria: 100000, semanal: 200000, equipe: 300000 } },
    stockAging: { 30: { quantidade: 4, capital: 10 }, 60: { quantidade: 3, capital: 8 }, 90: { quantidade: 2, capital: 5 } },
    openQuotes: [{ companyId: 1, number: 1, sellerId: 1, seller: "João", customer: "Ana", value: 100, date: "2026-10-21" }],
  });
  assert.equal(report.metaDiaria.atingimento, 89.5);
  assert.match(report.texto, /Sem venda há 90 dias/);
  const view = engine.applyView(report, { vendedor: 1, categoria: "comercial" });
  assert.equal(view.ranking.every((item) => item.id === 1), true);
  assert.equal(view.alertas.every((item) => item.categoria === "comercial"), true);
  const params = engine.whatsappTemplateParameters(report);
  assert.equal(params.length, 3);
  assert.match(params[0], /21\/10\/2026/);
});

test("dias úteis e complemento de venda", () => {
  assert.equal(engine.businessDaysInclusive("2026-10-02", "2026-10-05"), 2);
  const pairs = engine.complements([
    { orderId: 1, productId: "A", product: "Rolamento" },
    { orderId: 1, productId: "B", product: "Graxa" },
    { orderId: 2, productId: "A", product: "Rolamento" },
    { orderId: 2, productId: "B", product: "Graxa" },
  ]);
  assert.equal(pairs[0].pedidos, 2);
  assert.match(pairs[0].compatibilidadeTecnica, /indisponível/i);
});

test("gráfico em português, meta da loja e conversão do mês", () => {
  assert.equal(engine.chartDateLabel("Thu Oct 08 2026 00:00:00 GMT-0300"), "qui. 08 out.");
  assert.equal(engine.chartDateLabel(new Date(2026, 9, 8)), "qui. 08 out.");
  assert.equal(engine.isoDay("2026-10-08T03:00:00.000Z"), "2026-10-08");
  const picked = engine.monthlyGoalFrom({ metas: {} }, { 1: 500000 }, null);
  assert.equal(picked.value, 500000);
  const report = engine.composeBreakfast({
    reference: "2026-10-21",
    salesMonth: [{ companyId: 1, sellerId: 1, seller: "Ana", revenue: 235905.55, orders: 10 }],
    legacyGoals: { 1: 500000 },
    quotesPeriod: [],
    quotesMonth: [{ status: 0, count: 152, value: 230000 }, { status: 1, count: 69, value: 65000 }],
    series: [{ date: "Thu Oct 08 2026 00:00:00 GMT-0300", revenue: 16634.26 }],
  });
  assert.equal(report.meta.atingimento, 47.2);
  assert.match(report.meta.origem, /relatorios gerenciais/);
  assert.equal(report.metaDiaria.texto, "Meta não cadastrada.");
  assert.equal(report.metaSemanal.texto, "Meta não cadastrada.");
  assert.equal(report.metaEquipe.texto, "Meta não cadastrada.");
  assert.equal(report.orcamentos.taxa, null);
  assert.equal(report.orcamentos.conversao.taxa, 31.2);
  assert.equal(report.evolucao[0].date, "2026-10-08");
  assert.equal(report.evolucao[0].label, "qui. 08 out.");
  assert.equal(report.ranking.length, 0);
  assert.equal(report.rankingMes[0].nome, "Ana");
  assert.equal(report.rankingMes[0].faturamento, 235905.55);
  assert.match(report.texto, /Nenhuma venda em 21\/10\/2026/);
  assert.match(report.texto, /Ranking do mês/);
  assert.match(report.texto, /Ana/);
  const aged = engine.prioritizeQuote({ number: 9, value: 100, date: new Date(2026, 9, 8), historicoOrcamentos: 8, historicoConvertidos: 2 }, {}, "2026-10-21");
  assert.equal(aged.emissao, "2026-10-08");
  assert.equal(aged.idadeDias, 13);
});
