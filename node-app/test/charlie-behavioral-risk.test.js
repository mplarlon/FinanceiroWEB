import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeBehavioralEvents, authorizedContext, buildBehavioralBaselines, classifyBehavioralRisk, codigoENome, comparableGroup, correlateEventSequences, dedupeBehavioralAlerts, detectBurst, explainBehavior, presentBehavioralAlert, presentBehavioralAnalysis, robustBehavioralScore } from "../server/lib/charlie-behavioral-risk-engine.js";
import { planAutomation } from "../server/lib/charlie-automation-plan.js";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "charlie-behavior-"));
process.env.DASHBOARD_DATA_DIR = temp;
const baseDate = Date.parse("2026-01-05T14:00:00Z");
const event = (index, value = 10, extra = {}) => ({ id: `e${index}`, occurredAt: new Date(baseDate + index * 7 * 86400000).toISOString(), type: "stock_movement", entity: "MOVIMENTO", recordId: "P1", actor: { id: 4, sector: "estoque", profile: "operador" }, previous: {}, next: { quantity: value }, ...extra });

test("constrói linha de base apenas entre função, setor, operação e dia comparáveis", () => {
  const baseline = buildBehavioralBaselines(Array.from({ length: 8 }, (_, index) => event(index, 10 + index % 2)))[0];
  assert.equal(baseline.sufficient, true);
  assert.equal(baseline.samples, 8);
  assert.match(baseline.key, /estoque\|operador\|stock_movement/);
  assert.equal(baseline.model, "mediana_mad_percentil");
});

test("não mistura perfis operacionais diferentes", () => {
  const a = event(0), b = event(1, 10, { actor: { id: 5, sector: "financeiro", profile: "gerente" } });
  assert.notEqual(comparableGroup(a), comparableGroup(b));
  assert.equal(buildBehavioralBaselines([a, b]).length, 2);
});

test("identifica desvio robusto em relação à mediana e MAD", () => {
  const historical = Array.from({ length: 8 }, (_, index) => event(index, 10 + index % 2));
  const baseline = buildBehavioralBaselines(historical)[0], result = robustBehavioralScore(event(8, 80), baseline);
  assert.equal(result.anomalous, true);
  assert.ok(result.score >= result.threshold);
  assert.equal(result.samples, 8);
});

test("histórico insuficiente não produz acusação estatística", () => {
  const baseline = buildBehavioralBaselines([event(0), event(1)])[0];
  assert.deepEqual(robustBehavioralScore(event(2, 100), baseline), { evaluable: false, reason: "historico_insuficiente", samples: 2 });
});

test("detecta rajada de operações do mesmo tipo e ator", () => {
  const start = Date.parse("2026-10-21T12:00:00Z");
  const events = Array.from({ length: 6 }, (_, index) => event(index, 10, { id: `b${index}`, occurredAt: new Date(start + index * 60000).toISOString(), type: "price_change", actor: { id: 9, sector: "comercial", profile: "precificador" } }));
  const result = detectBurst(events, events.at(-1), { windowMinutes: 30, countThreshold: 5 });
  assert.equal(result.detected, true);
  assert.equal(result.count, 6);
});

test("correlaciona preço, venda e restauração somente na mesma entidade", () => {
  const start = Date.parse("2026-10-21T12:00:00Z");
  const events = ["price_change", "sale", "price_change"].map((type, index) => ({ ...event(index), id: `s${index}`, type, recordId: "P55", occurredAt: new Date(start + index * 60000).toISOString() }));
  const [sequence] = correlateEventSequences(events);
  assert.equal(sequence.definitionId, "price-sale-restore");
  assert.equal(sequence.causalClaim, false);
  events[1].recordId = "OUTRO";
  assert.equal(correlateEventSequences(events).length, 0);
});

test("correlaciona alteração bancária e pagamento sem expor dados bancários", () => {
  const events = [{ ...event(0), id: "bank", type: "bank_data_change", entity: "FORNECEDOR", recordId: "F7" }, { ...event(0), id: "pay", type: "payment_preparation", entity: "FORNECEDOR", recordId: "F7", occurredAt: new Date(baseDate + 60000).toISOString() }];
  const [result] = correlateEventSequences(events);
  assert.equal(result.definitionId, "bank-payment");
  assert.equal(JSON.stringify(result).includes("conta"), false);
});

test("classificação representa prioridade e nunca probabilidade", () => {
  const result = classifyBehavioralRisk({ anomaly: { anomalous: true }, burst: { detected: true }, sequence: {}, authorization: null, evidenceQuality: "adequada" });
  assert.equal(result.level, "elevado");
  assert.equal(result.label, "prioridade_de_investigacao");
  assert.equal(result.probability, null);
});

test("evidência insuficiente reduz a prioridade", () => {
  const result = classifyBehavioralRisk({ anomaly: { anomalous: true }, burst: { detected: false }, authorization: null, evidenceQuality: "insuficiente" });
  assert.equal(result.level, "baixo");
});

test("contexto autorizado exige tipo, período e entidade verificáveis", () => {
  const target = event(8, 80), contexts = [{ type: "stock_movement", from: "2026-01-01", to: "2027-01-01", entity: "MOVIMENTO", verified: true, reason: "Inventário aprovado" }];
  assert.equal(authorizedContext(target, contexts)?.reason, "Inventário aprovado");
  assert.equal(authorizedContext(target, [{ ...contexts[0], verified: false }]), null);
});

test("análise completa preserva linha de base, critérios e eventos", () => {
  const historical = Array.from({ length: 8 }, (_, index) => event(index, 10 + index % 2));
  const target = event(8, 90, { analysisTarget: true });
  const result = analyzeBehavioralEvents([...historical, target]);
  assert.equal(result.analyses.length, 1);
  assert.equal(result.analyses[0].eventIds.includes(target.id), true);
  assert.equal(result.analyses[0].modelVersion, "1.0.0");
  assert.match(result.analyses[0].disclaimer, /não prova/);
});

test("operação em lote autorizada evita falso positivo", () => {
  const historical = Array.from({ length: 8 }, (_, index) => event(index, 10));
  const target = event(8, 100, { analysisTarget: true });
  const result = analyzeBehavioralEvents([...historical, target], { authorizedContexts: [{ type: "stock_movement", entity: "MOVIMENTO", from: "2026-01-01", to: "2027-01-01", verified: true }] });
  assert.equal(result.analyses.length, 0);
});

test("feedback exige permissão e justificativa e não muda limites", async () => {
  const store = await import(`../server/lib/charlie-behavioral-risk-store.js?feedback=${Date.now()}`);
  store.saveBehavioralRun({ analyses: [{ id: "risk-1", eventIds: ["e1"], risk: { level: "moderado" } }], baselines: [] }, ["e1"], 1);
  assert.throws(() => store.saveBehavioralFeedback("risk-1", { classification: "falso_positivo", justification: "Campanha aprovada" }, { id: 2, gerencial: false }), /Sem permissão/);
  assert.throws(() => store.saveBehavioralFeedback("risk-1", { classification: "falso_positivo" }, { id: 3, gerencial: true }), /justificativa/);
  const before = store.readBehavioralState().settings.scoreThreshold;
  const feedback = store.saveBehavioralFeedback("risk-1", { classification: "falso_positivo", justification: "Campanha CMP-10 validada." }, { id: 3, gerencial: true });
  assert.equal(feedback.classification, "falso_positivo");
  assert.equal(store.readBehavioralState().settings.scoreThreshold, before);
});

test("automação de anomalias reutiliza catálogo e agendador", () => {
  const plan = planAutomation("Diariamente às 8h avise quando houver quantidade incomum de cancelamentos", { id: 3, gerencial: true }, { now: new Date("2026-10-21T10:00:00Z") });
  assert.equal(plan.ok, true);
  assert.equal(plan.automacao.acao, "auditoria.anomalias_comportamentais");
  assert.equal(plan.automacao.politicaConfirmacao, "automatica_leitura");
});

test("frequência de preço explica a operação sem jargão estatístico", () => {
  const wednesday = Date.parse("2026-10-21T14:00:00Z");
  const price = (index, extra = {}) => event(index, 10, {
    type: "price_change", entity: "PRODUTOPRECO", recordId: `${10 + index}:1:UN`,
    actor: { id: 9, name: "Maria", sector: "comercial", profile: "precificador" },
    previous: { price: 100 }, next: { price: 110 }, ...extra,
  });
  const historical = Array.from({ length: 8 }, (_, index) => price(index, { occurredAt: new Date(wednesday - (index + 1) * 7 * 86400000).toISOString() }));
  const burst = Array.from({ length: 5 }, (_, index) => price(index, {
    id: `p${index}`, analysisTarget: true, occurredAt: new Date(wednesday + index * 60000).toISOString(),
    authorization: { id: "tarefa-1", type: "confirmacao_explicita" },
  }));
  const analysis = analyzeBehavioralEvents([...historical, ...burst]).analyses.find((item) => item.eventIds.includes("p4"));
  assert.equal(analysis.title, "Várias alterações de preço em seguida");
  assert.equal(analysis.itens.length, 5);
  assert.match(analysis.itens[0].objeto, /Produto 10, tabela 1, UN/);
  assert.match(analysis.itens[0].mudanca, /R\$ 100,00 → R\$ 110,00 \(10%\)/);
  assert.match(analysis.explanation, /5 alterações de preço em 4 minutos, feitas por Maria/);
  assert.match(analysis.explanation, /cerca de 10%/);
  assert.match(analysis.explanation, /quantidade seguida/);
  assert.match(analysis.explanation, /confirmação já registrada no Charlie/);
  assert.equal(/MAD|mediana|percentil/i.test(analysis.explanation), false);
  assert.match(analysis.registros[0].NOME, /Produto 10, tabela 1, UN: de R\$ 100,00 para R\$ 110,00 \(10%\) · Maria/);
  const stored = presentBehavioralAlert({
    titulo: "Frequência operacional incomum",
    descricao: "O valor observado foi 10, comparado à mediana 10, MAD 0 e percentil 90 10.",
    evidencias: { auditCategory: "riscos_comportamentais", events: burst, criteria: analysis.criteria, baseline: analysis.baseline },
  });
  assert.equal(stored.titulo, analysis.title);
  assert.equal(/MAD/.test(stored.descricao), false);
  assert.equal(explainBehavior({ events: [], criteria: {} }).title, "Operação para conferir");
});

test("a mesma gravação de preço repetida vira um único aviso compreensível", () => {
  const start = Date.parse("2026-10-21T12:36:51.150Z");
  const events = Array.from({ length: 5 }, (_, index) => ({
    id: `r${index}`, type: "price_change", entity: "PRODUTOPRECO", recordId: "1:70:UN",
    occurredAt: new Date(start + index * 60000).toISOString(),
    actor: { id: 7, name: "" }, origin: "CHARLIE_TASK",
    previous: { price: 10 }, next: { price: 11, cost: 4 },
    authorization: { id: "1", type: "confirmacao_explicita" },
  }));
  const criteria = { anomaly: { evaluable: true, value: 10, anomalous: false, samples: 8 }, burst: { detected: true, count: 5, windowMinutes: 30 } };
  const text = explainBehavior({ events, criteria, baseline: { median: 10, samples: 8 } });
  assert.match(text.title, /Produto 1, tabela 70, UN: R\$ 10,00 → R\$ 11,00 \(10%\)/);
  assert.match(text.itens[0].objeto, /Produto 1, tabela 70, UN/);
  assert.match(text.problema, /5 vezes em 4 minutos, pelo usuário 7/);
  assert.match(text.explanation, /produto 1, tabela 70, UN passou de R\$ 10,00 para R\$ 11,00 \(10%\)/);
  const named = explainBehavior({ events: events.map((item) => ({ ...item, productName: "Parafuso sextavado" })), criteria, baseline: { median: 10, samples: 8 } });
  assert.match(named.title, /Produto 1 - Parafuso sextavado, tabela 70, UN: R\$ 10,00 → R\$ 11,00 \(10%\)/);
  assert.match(named.explanation, /produto 1 - Parafuso sextavado, tabela 70, UN/);
  assert.match(named.registros[0].NOME, /Produto 1 - Parafuso sextavado, tabela 70, UN/);
  assert.equal(codigoENome(19062, "OFICINA LESTE"), "19062 - OFICINA LESTE");
  assert.equal(codigoENome("1", ""), "1");
  assert.match(text.explanation, /5 vezes em 4 minutos, pelo usuário 7/);
  assert.match(text.explanation, /confirmação já registrada no Charlie/);
  assert.equal(text.registros.length, 1);
  const shown = presentBehavioralAnalysis({ id: "antigo", title: "antigo", explanation: "antigo", eventIds: events.map((item) => item.id), criteria, baseline: { median: 10, samples: 8 } }, events);
  assert.match(shown.title, /Produto 1, tabela 70, UN/);
  assert.equal(shown.itens.length, 1);
  assert.equal(presentBehavioralAnalysis({ title: "antigo", eventIds: ["ausente"], criteria, baseline: {} }, events).title, "antigo");
  const alerts = events.map((event, index) => ({ id: index + 1, situacao: "novo", evidencias: { auditCategory: "riscos_comportamentais", events: events.slice(0, index + 1) } }));
  assert.deepEqual(dedupeBehavioralAlerts(alerts).map((item) => item.id), [5]);
});

test("motor funciona sem qualquer chamada ao Ollama", () => {
  const result = analyzeBehavioralEvents([...Array.from({ length: 8 }, (_, index) => event(index, 10)), event(8, 100, { analysisTarget: true })]);
  assert.equal(result.analyses.length, 1);
  assert.equal(typeof result.analyses[0].explanation, "string");
});
