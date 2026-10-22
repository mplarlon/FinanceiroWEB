import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultAuditRules, evaluateAuditEvent, findFinancialDuplicates } from "../server/lib/charlie-audit-engine.js";
import { planAutomation } from "../server/lib/charlie-automation-plan.js";

const storageTemp = fs.mkdtempSync(path.join(os.tmpdir(), "charlie-audit-suite-"));
process.env.DASHBOARD_DATA_DIR = storageTemp;

const priceEvent = (extra = {}) => ({ id: "event-1", hash: "hash-1", occurredAt: "2026-10-21T12:00:00.000Z", type: "price_change", entity: "PRODUTOPRECO", recordId: "10:70:UN", origin: "CHARLIE_TASK", actor: { id: 8, name: "Auditable User" }, previous: { price: 250 }, next: { price: 145, cost: 100 }, ...extra });

test("alteração de preço preserva antes, depois, usuário e regra verificável", () => {
  const [result] = evaluateAuditEvent(priceEvent());
  assert.equal(result.title, "Alteração relevante de preço");
  assert.equal(result.severity, "critico");
  assert.equal(result.evidence.previous.price, 250);
  assert.equal(result.evidence.next.price, 145);
  assert.equal(result.evidence.actorIdentified, true);
  assert.equal(result.evidence.rule.id, "price-reduction");
});

test("preço abaixo do custo é crítico por critério configurado", () => {
  const [result] = evaluateAuditEvent(priceEvent({ previous: { price: 110 }, next: { price: 99, cost: 100 } }));
  assert.equal(result.severity, "critico");
  assert.equal(result.evidence.criteria.belowCost, true);
});

test("alteração pequena de preço não vira ocorrência", () => assert.equal(evaluateAuditEvent(priceEvent({ previous: { price: 100 }, next: { price: 95, cost: 60 } })).length, 0));

test("desconto acima da regra continua situação para investigação", () => {
  const [result] = evaluateAuditEvent({ ...priceEvent(), type: "discount", previous: {}, next: { discountPercent: 22, authorizedLimit: 15 }, authorization: null });
  assert.equal(result.classification, "situacao_para_investigacao");
  assert.match(result.summary, /Não foi encontrada aprovação/);
});

test("desconto com aprovação vinculada não gera falso alerta", () => assert.equal(evaluateAuditEvent({ ...priceEvent(), type: "discount", previous: {}, next: { discountPercent: 30, authorizedLimit: 15 }, authorization: { id: 42 } }).length, 0));

test("duplicidades financeiras usam chave composta e são chamadas possíveis", () => {
  const rows = [{ id: 1, domain: "pagar", partyId: 7, document: "NF1", installment: 1, amount: 50, dueDate: "2026-11-01" }, { id: 2, domain: "pagar", partyId: 7, document: "NF1", installment: 1, amount: 50, dueDate: "2026-11-01" }, { id: 3, domain: "pagar", partyId: 7, document: "NF1", installment: 2, amount: 50, dueDate: "2026-11-01" }];
  const result = findFinancialDuplicates(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].classification, "possivel_duplicidade");
  assert.equal(result[0].records.length, 2);
});

test("alteração relevante de vencimento calcula dias", () => {
  const [result] = evaluateAuditEvent({ ...priceEvent(), type: "due_date_change", previous: { dueDate: "2026-10-01" }, next: { dueDate: "2026-11-01" } });
  assert.equal(result.evidence.criteria.changedDays, 31);
});

test("movimentação manual alta não é descrita como fraude", () => {
  const [result] = evaluateAuditEvent({ ...priceEvent(), type: "stock_movement", previous: {}, next: { quantity: -100, manual: true } });
  assert.match(result.summary, /não comprova desvio ou fraude/i);
});

test("cadastro só alerta campos classificados como críticos", () => {
  const event = { ...priceEvent(), type: "sensitive_registration", changedFields: ["TELEFONE", "LIMITE"], previous: {}, next: {} };
  const [result] = evaluateAuditEvent(event);
  assert.deepEqual(result.evidence.criteria.changedFields, ["LIMITE"]);
});

test("dados bancários não são exibidos pelo motor", () => {
  const [result] = evaluateAuditEvent({ ...priceEvent(), type: "bank_data_change", actor: null, previous: {}, next: {} });
  assert.equal(result.evidence.actorIdentified, false);
  assert.equal(JSON.stringify(result).includes("agencia"), false);
});

test("mudança de permissão sem identidade declara a limitação", () => {
  const [result] = evaluateAuditEvent({ ...priceEvent(), type: "permission_change", actor: null, previous: {}, next: {} });
  assert.match(result.summary, /não pôde ser identificado/);
});

test("divergência fiscal apoia conferência sem interpretar tributo", () => {
  const [result] = evaluateAuditEvent({ ...priceEvent(), type: "fiscal_divergence", previous: {}, next: { divergent: true, differences: ["quantidade"] } });
  assert.match(result.summary, /conferência fiscal oficial/);
});

test("parâmetros das regras são configuráveis", () => {
  const rules = defaultAuditRules();
  rules.find((rule) => rule.id === "price-reduction").parameters.reductionPercent = 50;
  assert.equal(evaluateAuditEvent(priceEvent(), rules).length, 0);
});

test("fluxo registrado gera alerta deduplicado e investigação com justificativa", async () => {
  const store = await import(`../server/lib/charlie-audit-store.js?store=${Date.now()}`);
  const service = await import(`../server/lib/charlie-audit-service.js?service=${Date.now()}`);
  const first = service.captureAndAudit({ type: "price_change", operation: "update", entity: "PRODUTOPRECO", recordId: "10:70:UN", actor: { id: 8, name: "User" }, origin: "HOMOLOGACAO", previous: { price: 250 }, next: { price: 145, cost: 100 }, authorization: { id: "task-1" } });
  assert.equal(first.alerts.length, 1);
  service.processAuditEvent(first.event);
  const monitor = await import(`../server/lib/charlie-monitor-store.js?monitor=${Date.now()}`);
  assert.equal(monitor.listMonitorAlerts().filter((x) => x.regra.includes(first.occurrences[0].fingerprint)).length, 1);
  const investigation = store.saveInvestigation({ alertId: first.alerts[0].id, eventId: first.event.id, eventActorId: 8, status: "resolvida", justification: "Autorização task-1 validada." }, { id: 9, gerencial: true });
  assert.equal(investigation.status, "resolvida");
  assert.match(investigation.history.at(-1).justification, /task-1/);
});

test("trilha encadeada detecta adulteração e remove segredos", async () => {
  const store = await import(`../server/lib/charlie-audit-store.js?chain=${Date.now()}`);
  const event = store.appendAuditEvent({ type: "bank_data_change", entity: "FORNECEDOR", recordId: "9", previous: { conta: "123", nome: "Fornecedor" }, next: { conta: "456" } });
  assert.equal(event.previous.conta, "[PROTEGIDO]");
  assert.equal(store.verifyAuditChain().valid, true);
  const file = path.join(storageTemp, "charlie-business-audit-events.json"), state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.events.at(-1).recordId = "adulterado"; fs.writeFileSync(file, JSON.stringify(state));
  assert.equal(store.verifyAuditChain().valid, false);
});

test("segregação impede autor do evento de encerrar sozinho", async () => {
  const store = await import(`../server/lib/charlie-audit-store.js?sod=${Date.now()}`);
  store.saveInvestigation({ alertId: 999, eventActorId: 8, status: "investigacao" }, { id: 8, gerencial: true });
  assert.throws(() => store.saveInvestigation({ alertId: 999, status: "resolvida", justification: "Eu mesmo aprovei." }, { id: 8, gerencial: true }), /revisão independente/);
});

test("motor determinístico não depende do Ollama", () => {
  const [result] = evaluateAuditEvent(priceEvent());
  assert.equal(result.evidence.eventId, "event-1");
  assert.equal(typeof result.summary, "string");
});

test("auditoria recorrente reutiliza o agendador e o catálogo existentes", () => {
  const plan = planAutomation("Diariamente às 7h verifique possíveis duplicidades financeiras", { id: 9, gerencial: true }, { now: new Date("2026-10-21T10:00:00Z") });
  assert.equal(plan.ok, true);
  assert.equal(plan.automacao.acao, "auditoria.duplicidades_financeiras");
  assert.equal(plan.automacao.politicaConfirmacao, "automatica_leitura");
});
