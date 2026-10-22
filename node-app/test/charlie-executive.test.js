import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charlie-executive-"));
process.env.DASHBOARD_DATA_DIR = dir;

const engine = await import("../server/lib/charlie-executive-engine.js");
const service = await import("../server/lib/charlie-executive-service.js");
const { planAutomation } = await import("../server/lib/charlie-automation-plan.js");
const { planCharlieTask } = await import("../server/lib/charlie-task-plan.js");

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const manager = { id: 7, name: "Gestor", gerencial: true, company: 1, branch: 2 };
const other = { id: 8, name: "Outra empresa", gerencial: true, company: 2, branch: 1 };
const sources = {
  generatedAt: "2026-10-21T12:00:00.000Z",
  alerts: [{ id: 1, regra: "caixa_curto", titulo: "Pressão de caixa", descricao: "Títulos a pagar concentram o vencimento.", gravidade: "critico", categoria: "financeiro", situacao: "novo", atualizadoEm: "2026-10-21T11:00:00.000Z", quantidade: 4, evidencias: { valor: 8000, registros: 4 } }],
  alertsUpdatedAt: "2026-10-21T11:00:00.000Z",
  cashFlow: { horizon: 15, generatedAt: "2026-10-21T11:30:00.000Z", quality: { status: "adequada" }, scenarios: { base: { closingBalance: -1200, firstNegativeDate: "2026-10-23", projection: [{ date: "2026-10-23", balance: -1200 }] } } },
  stock: { generatedAt: "2026-10-21T11:40:00.000Z", quality: { status: "adequada" }, items: [{ risk: "alto", coverageDays: 4, product: "Filtro" }, { risk: "baixo", product: "Parafuso" }] },
  opportunities: [{ id: "op1", customer: "Cliente A", type: "reducao_compras", reason: "Faturamento caiu 40% entre períodos equivalentes; a causa não foi inferida.", evidence: { metrics: { previousRevenue: 1000, currentRevenue: 600 } }, updatedAt: "2026-10-21T10:00:00.000Z" }],
  profitability: { generatedAt: "2026-10-21T11:00:00.000Z", period: { days: 30 }, indicators: { negativeSales: 2, verifiedNegativeResult: 500, insufficientMarginSales: 1 }, limitations: ["O resultado é margem de contribuição estimada, não lucro líquido."] },
  supply: { generatedAt: "2026-10-21T11:20:00.000Z", horizonDays: 30, indicators: { ruptureRisk: 2, belowMinimum: 1, excess: 3, lateOrders: 1, potentialSavings: null }, limitations: [] },
  results: { generatedAt: "2026-10-21T09:00:00.000Z", totals: { proven_saving: { value: 0, validated: 0, count: 0 }, potential_saving: { value: 90, count: 1, validated: 0 } } },
};

test("resumo executivo usa período e fontes reais e não inventa meta", async () => {
  service.clearExecutiveCache();
  const briefing = await service.buildExecutiveBriefing(manager, { sources, live: false, force: true, scope: "empresa" });
  assert.match(briefing.text, /CHARLIE — RESUMO EXECUTIVO/);
  assert.match(briefing.text, /rentabilidade: últimos 30 dias/);
  assert.match(briefing.text, /fluxo de caixa: projeção de 15 dias/);
  assert.match(briefing.text, /Situações críticas/);
  assert.match(briefing.text, /Prioridades recomendadas/);
  assert.match(briefing.text, /não há metas empresariais/i);
  assert.equal(briefing.text.includes("R$ 999.999,00"), false);
  assert.ok(briefing.indicators.every((item) => item.source && item.kind));
});

test("consolidação reaproveita indicadores recebidos", () => {
  const built = engine.signalsFromSources(sources, {});
  const cash = built.signals.find((item) => item.id === "projecao:caixa");
  const margin = built.signals.find((item) => item.id === "rentabilidade:negativa");
  assert.equal(cash.financialImpact, 1200);
  assert.equal(cash.kind, "projecao");
  assert.equal(margin.financialImpact, 500);
  assert.equal(margin.kind, "fato");
  assert.match(built.limitations.join(" "), /economia potencial quantificada/);
});

test("alertas críticos entram na priorização com evidência", () => {
  const built = engine.signalsFromSources({ alerts: sources.alerts }, {});
  const alert = built.signals.find((item) => item.id === "alerta:1");
  assert.equal(alert.severity, "critico");
  assert.equal(alert.financialImpact, 8000);
  assert.equal(alert.evidenceQuality, "alta");
  assert.equal(alert.source.service, "monitoramento");
});

test("priorização é determinística e a gravidade não pode ser anulada", () => {
  const criteria = engine.normalizeCriteria({ weights: { gravidade: 0, urgencia: 1 } });
  assert.ok(criteria.weights.gravidade >= 0.15);
  const ranked = engine.prioritize([
    { id: "caixa", severity: "critico", title: "Caixa", detail: "negativo", financialImpact: 20000, records: 4, deadlineDays: 2, evidenceQuality: "alta", mitigable: true, dependencies: [] },
    { id: "estoque", severity: "atencao", title: "Ruptura", detail: "cobertura", financialImpact: null, records: 2, deadlineDays: 10, evidenceQuality: "media", mitigable: true, dependencies: [] },
    { id: "cliente", severity: "atencao", title: "Cliente", detail: "queda", financialImpact: 400, records: 1, deadlineDays: 30, evidenceQuality: "limitada", mitigable: true, dependencies: ["vendedor"] },
  ], criteria);
  assert.deepEqual(ranked.map((item) => item.id), ["caixa", "estoque", "cliente"]);
  assert.match(ranked[0].reasons.join(" "), /gravidade critico/);
  assert.match(ranked[1].reasons.join(" "), /não quantificado/);
});

test("plano não atribui responsável e não nasce concluído", async () => {
  service.clearExecutiveCache();
  const briefing = await service.buildExecutiveBriefing(manager, { sources, live: false, force: true });
  const plan = service.createExecutivePlan(manager, briefing);
  assert.equal(plan.status, "aguardando_aprovacao");
  assert.equal(plan.responsible, null);
  assert.ok(plan.actions.length > 0);
  assert.ok(plan.actions.every((action) => action.suggestedOwner == null && action.indicator && action.objective));
  const again = service.createExecutivePlan(manager, briefing);
  assert.equal(again.id, plan.id);
});

test("resolver não executa e a preparação exige confirmação explícita", async () => {
  service.clearExecutiveCache();
  let prepared = 0;
  const answer = await service.answerExecutiveQuestion("Charlie, resolva os problemas financeiros prioritários.", manager, {}, {
    sources, live: false, force: true,
    prepareTask: async () => { prepared += 1; return { tarefa: { id: 1, status: "concluida" }, resposta: "não deveria" }; },
  });
  assert.equal(prepared, 0);
  assert.match(answer.resposta, /não autoriza alteração/i);
  await assert.rejects(() => service.approveExecutivePlan(answer.plano.id, manager, { confirmado: false, acoes: [answer.plano.actions[0].id] }, {}), /confirmação precisa ser explícita/i);
  const approved = await service.approveExecutivePlan(answer.plano.id, manager, { confirmado: true, acoes: [answer.plano.actions[0].id] }, {
    prepareTask: async (plan) => { prepared += 1; assert.equal(plan.acao, answer.plano.actions[0].actionId); return { tarefa: { id: 41, status: "concluida" }, resposta: "Consulta preparada." }; },
  });
  assert.equal(prepared, 1);
  assert.equal(approved.plan.status, "em_execucao");
  assert.notEqual(approved.plan.status, "concluido");
  assert.throws(() => service.updateExecutivePlanStatus(answer.plano.id, manager, "concluido"), /não pode ser concluído/i);
});

test("frase de confirmação não prepara tarefa", async () => {
  const answer = await service.answerExecutiveQuestion("confirmo, pode executar", manager, { previousType: "executivo_plano" }, {});
  assert.match(answer.resposta, /botão/);
  assert.equal(answer.plano, null);
});

test("investigação separa fato, correlação, hipótese e projeção", async () => {
  service.clearExecutiveCache();
  const answer = await service.answerExecutiveQuestion("Por que o faturamento caiu?", manager, {}, { sources, live: false, force: true });
  assert.match(answer.resposta, /Correlações/);
  assert.match(answer.resposta, /não foi convertida em causa|não são apresentados como causa/i);
  assert.match(answer.resposta, /Hipóteses/);
  assert.equal(answer.resposta.includes("a causa é"), false);
});

test("simulação não altera dados e não inventa produtos", async () => {
  const blocked = await service.answerExecutiveQuestion("Charlie, simule um aumento de 5% nos preços.", manager, {}, { live: false });
  assert.equal(blocked.simulacao.changedData, false);
  assert.match(blocked.resposta, /Nenhum dado real foi alterado/);
  assert.match(blocked.resposta, /produtos identificados/);
  let called = 0;
  const compared = await service.answerExecutiveQuestion("Charlie, compare três cenários de crescimento.", manager, {}, {
    live: false,
    simulate: async (request) => { called += 1; assert.equal(request.kind, "cenarios"); return { changedData: true, currentLabel: "base 10", simulatedLabel: "otimista 12", assumptions: ["quantidades constantes"], risks: "projeção", limitations: "sem meta" }; },
  });
  assert.equal(called, 1);
  assert.equal(compared.simulacao.changedData, false);
});

test("reunião preserva o contexto da área", async () => {
  service.clearExecutiveCache();
  let live = 0;
  const started = await service.startExecutiveMeeting(manager, "resultados do mês", { conversationId: "conversa-1" }, { sources, live: false, force: true });
  const follow = await service.answerExecutiveQuestion("e o estoque?", manager, { conversationId: "conversa-1", previousType: "executivo_reuniao" }, { loadLive: async () => { live += 1; return {}; } });
  assert.equal(live, 0);
  assert.match(follow.resposta, /indisponibilidade|estoque/i);
  assert.equal(started.meeting.status, "em_andamento");
  assert.equal(follow.reuniao.questions.length, 1);
});

test("verificação não declara economia sem leitura comparável", async () => {
  const insufficient = engine.verifyReading(null, { value: 10 });
  assert.equal(insufficient.status, "insuficiente");
  assert.match(insufficient.message, /Nenhuma economia/);
  const improved = engine.verifyReading({ value: 4, polarity: "lower_better" }, { value: 1, polarity: "lower_better" });
  assert.equal(improved.status, "melhorou");
  assert.match(improved.message, /não comprova, sozinho, economia/);
  service.clearExecutiveCache();
  const briefing = await service.buildExecutiveBriefing(manager, { sources, live: false, force: true, scope: "financeiro" });
  const plan = service.createExecutivePlan({ ...manager, company: 9, branch: 9 }, briefing);
  const checked = await service.verifyExecutiveAction(plan.id, { ...manager, company: 9, branch: 9 }, { acaoId: plan.actions[0].id, leitura: { value: 0, polarity: "higher_better" } }, {});
  assert.equal(checked.verification.provenSaving, false);
  assert.notEqual(checked.plan.status, "concluido");
});

test("memória de decisão exige formalização e não vira política", () => {
  assert.throws(() => service.recordExecutiveDecision(manager, { formal: false, context: "conversa solta", justification: "porque sim agora" }), /informal/i);
  const decision = service.recordExecutiveDecision(manager, { formal: true, title: "Priorizar caixa", context: "Caixa projetado negativo no horizonte de 15 dias", scope: "financeiro", justification: "A projeção base ficou negativa e a cobrança será só rascunho." });
  assert.equal(decision.officialPolicy, false);
  assert.ok(decision.knowledgeId);
  assert.equal(service.listExecutiveDecisions(other).some((item) => item.id === decision.id), false);
});

test("automações executivas reutilizam o planejador existente", () => {
  const daily = planAutomation("Charlie, todos os dias às 8h apresente os três maiores problemas da empresa.", manager, { now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(daily.ok, true);
  assert.equal(daily.automacao.acao, "executivo.resumo");
  assert.equal(daily.automacao.agenda.tipo, "diaria");
  assert.equal(daily.automacao.politicaConfirmacao, "automatica_leitura");
  const weekly = planAutomation("Charlie, toda segunda às 8h gere um resumo executivo.", manager, { now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(weekly.automacao.acao, "executivo.resumo");
  assert.equal(weekly.automacao.agenda.tipo, "semanal");
  const risk = planAutomation("Charlie, avise quando uma previsão indicar risco financeiro elevado.", manager, { now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(risk.automacao.acao, "preditivo.fluxo_caixa");
  assert.equal(risk.automacao.condicao.tipo, "projecao_caixa_negativa");
  const monthly = planAutomation("Charlie, mensalmente às 8h compare os resultados com as metas.", manager, { now: new Date("2026-10-21T12:00:00Z") });
  assert.equal(monthly.automacao.acao, "executivo.resumo");
  assert.equal(monthly.automacao.agenda.tipo, "mensal");
  assert.equal(planAutomation("Todo dia às 8h apresente os três maiores problemas.", { id: 3, gerencial: false }).ok, false);
  assert.equal(engine.cashRiskConditionMet({ resumo: "Primeiro saldo negativo em 2026-10-23." }), true);
  assert.equal(engine.cashRiskConditionMet({ resumo: "Sem saldo negativo no cenário base.", amostra: [{ balance: 10 }] }), false);
});

test("permissão e isolamento de empresa", async () => {
  const denied = await service.answerExecutiveQuestion("Como está minha empresa hoje?", { id: 4, gerencial: false, company: 1 }, {});
  assert.match(denied.resposta, /permissão gerencial/);
  await assert.rejects(() => service.buildExecutiveBriefing({ id: 4, gerencial: false, company: 1 }, { live: false }), /permissão gerencial/);
  service.clearExecutiveCache();
  const briefing = await service.buildExecutiveBriefing(manager, { sources, live: false, force: true });
  const plan = service.createExecutivePlan(manager, briefing);
  assert.equal(service.listExecutivePlans(other).some((item) => item.id === plan.id), false);
  assert.equal(service.getExecutivePlan(plan.id, other), null);
});

test("funciona sem Ollama e distingue tarefa antiga", async () => {
  service.clearExecutiveCache();
  const answer = await service.answerExecutiveQuestion("Charlie, como está minha empresa hoje?", manager, {}, { sources, live: false, force: true });
  assert.match(answer.resposta, /Próximas ações/);
  assert.equal(answer.intencao.interpretador, "regras");
  assert.equal(engine.detectExecutiveRequest("Contas a receber vencidas"), null);
  assert.equal(engine.detectExecutiveRequest("Todo dia às 8h apresente os três maiores problemas da empresa."), null);
  assert.equal(engine.detectExecutiveRequest("Simule um reajuste de 5% na tabela 2."), null);
  const task = planCharlieTask("Relatório dos títulos vencidos separados por vendedor.", {});
  assert.equal(task.acao, "financeiro.titulos_vencidos");
});

test("cache evita nova coleta e a priorização permanece barata", async () => {
  service.clearExecutiveCache();
  let calls = 0;
  await service.buildExecutiveBriefing(manager, { scope: "comercial", force: true, loadLive: async () => { calls += 1; return { limitations: [] }; } });
  await service.buildExecutiveBriefing(manager, { scope: "comercial", loadLive: async () => { calls += 1; return { limitations: [] }; } });
  assert.equal(calls, 1);
  const many = Array.from({ length: 300 }, (_, index) => ({ id: `s${index}`, severity: index % 7 === 0 ? "critico" : "atencao", title: `Item ${index}`, detail: "registrado", records: index % 15, financialImpact: index % 3 === 0 ? null : index * 20, deadlineDays: index % 12, evidenceQuality: "media", mitigable: true, dependencies: [] }));
  const started = performance.now();
  const ranked = engine.prioritize(many);
  assert.ok(performance.now() - started < 100);
  assert.equal(ranked.length, 300);
  assert.ok(ranked[0].score >= ranked.at(-1).score);
});
