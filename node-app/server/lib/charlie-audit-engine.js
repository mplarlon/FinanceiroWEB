import crypto from "node:crypto";

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const percentage = (before, after) => before ? ((after - before) / Math.abs(before)) * 100 : null;

export const AUDIT_RULE_TYPES = Object.freeze([
  "price_change", "discount", "financial_duplicate", "due_date_change", "stock_movement",
  "sensitive_registration", "bank_data_change", "permission_change", "fiscal_divergence",
]);

export function defaultAuditRules() {
  return [
    { id: "price-reduction", version: 1, name: "Redução relevante de preço", category: "precos", type: "price_change", enabled: true, severity: "atencao", parameters: { reductionPercent: 20, criticalPercent: 40, belowCostCritical: true }, frequency: "event", permissions: ["gerencial"] },
    { id: "discount-policy", version: 1, name: "Desconto acima da política", category: "comercial", type: "discount", enabled: true, severity: "atencao", parameters: { maximumPercent: 15 }, frequency: "event", permissions: ["gerencial"] },
    { id: "financial-duplicate", version: 1, name: "Possível duplicidade financeira", category: "financeiro", type: "financial_duplicate", enabled: true, severity: "atencao", parameters: { amountTolerance: 0.01, dueDateToleranceDays: 0 }, frequency: "periodic", permissions: ["gerencial"] },
    { id: "due-date-change", version: 1, name: "Alteração relevante de vencimento", category: "financeiro", type: "due_date_change", enabled: true, severity: "atencao", parameters: { days: 15, repetitions: 2 }, frequency: "event", permissions: ["gerencial"] },
    { id: "manual-stock", version: 1, name: "Movimentação manual relevante", category: "estoque", type: "stock_movement", enabled: true, severity: "atencao", parameters: { quantity: 50 }, frequency: "event", permissions: ["gerencial"] },
    { id: "sensitive-registration", version: 1, name: "Alteração cadastral sensível", category: "cadastros", type: "sensitive_registration", enabled: true, severity: "atencao", parameters: { fields: ["LIMITE", "CPF", "CNPJ", "INSCRICAO", "CONDICAO_PAGAMENTO"] }, frequency: "event", permissions: ["gerencial"] },
    { id: "bank-data", version: 1, name: "Alteração de dados bancários", category: "cadastros", type: "bank_data_change", enabled: true, severity: "atencao", parameters: {}, frequency: "event", permissions: ["gerencial"] },
    { id: "permission-change", version: 1, name: "Alteração de permissões", category: "seguranca", type: "permission_change", enabled: true, severity: "atencao", parameters: {}, frequency: "event", permissions: ["gerencial"] },
    { id: "fiscal-divergence", version: 1, name: "Divergência documental fiscal", category: "fiscal", type: "fiscal_divergence", enabled: true, severity: "atencao", parameters: { amountTolerance: 0.01, quantityTolerance: 0 }, frequency: "periodic", permissions: ["gerencial"] },
  ];
}

function evidence(event, rule, details) {
  return {
    eventId: event.id, eventHash: event.hash, occurredAt: event.occurredAt,
    entity: event.entity, recordId: event.recordId, company: event.company, branch: event.branch,
    actorIdentified: Boolean(event.actor?.id), origin: event.origin,
    previous: event.previous, next: event.next, criteria: details,
    rule: { id: rule.id, version: rule.version, parameters: rule.parameters },
  };
}

function result(event, rule, title, summary, details = {}, severity = rule.severity) {
  return {
    fingerprint: crypto.createHash("sha256").update(`${rule.id}:${event.id}`).digest("hex"),
    ruleId: rule.id, ruleVersion: rule.version, eventId: event.id, category: rule.category,
    severity, title, summary, evidence: evidence(event, rule, details),
    recommendation: "Verifique a operação, a política vigente e a autorização registrada antes de concluir a investigação.",
    classification: severity === "critico" ? "violacao_regra_validada" : "situacao_para_investigacao",
  };
}

export function evaluateAuditEvent(event, rules = defaultAuditRules()) {
  const occurrences = [];
  for (const rule of rules.filter((item) => item.enabled && item.type === event.type)) {
    const p = rule.parameters || {};
    if (rule.type === "price_change") {
      const before = number(event.previous?.price), after = number(event.next?.price), variation = percentage(before, after);
      const belowCost = number(event.next?.cost) > 0 && after < number(event.next.cost);
      if (variation != null && variation <= -Math.abs(number(p.reductionPercent)) || belowCost) {
        const critical = belowCost && p.belowCostCritical || variation <= -Math.abs(number(p.criticalPercent));
        occurrences.push(result(event, rule, "Alteração relevante de preço", `O preço mudou de ${before.toFixed(2)} para ${after.toFixed(2)} (${variation.toFixed(1)}%).${belowCost ? " O novo preço está abaixo do custo registrado." : ""}`, { variationPercent: variation, belowCost, thresholdPercent: p.reductionPercent }, critical ? "critico" : rule.severity));
      }
    } else if (rule.type === "discount") {
      const applied = number(event.next?.discountPercent), limit = number(event.next?.authorizedLimit ?? p.maximumPercent);
      if (applied > limit && !event.authorization?.id) occurrences.push(result(event, rule, "Desconto acima do limite sem aprovação vinculada", `O desconto registrado foi ${applied.toFixed(1)}%, acima do limite aplicável de ${limit.toFixed(1)}%. Não foi encontrada aprovação vinculada ao evento.`, { appliedPercent: applied, authorizedPercent: limit, approvalFound: false }));
    } else if (rule.type === "due_date_change") {
      const before = Date.parse(event.previous?.dueDate), after = Date.parse(event.next?.dueDate);
      const days = Number.isFinite(before) && Number.isFinite(after) ? Math.abs(after - before) / 86400000 : 0;
      if (days >= number(p.days)) occurrences.push(result(event, rule, "Alteração relevante de vencimento", `O vencimento foi alterado em ${days} dia(s).`, { changedDays: days, thresholdDays: p.days }));
    } else if (rule.type === "stock_movement") {
      const quantity = Math.abs(number(event.next?.quantity));
      if (event.next?.manual === true && quantity >= number(p.quantity)) occurrences.push(result(event, rule, "Movimentação manual de estoque para análise", `Foi registrada movimentação manual de ${quantity} unidade(s). Isso não comprova desvio ou fraude.`, { quantity, threshold: p.quantity }));
    } else if (rule.type === "sensitive_registration") {
      const changed = (event.changedFields || []).filter((field) => (p.fields || []).includes(String(field).toUpperCase()));
      if (changed.length) occurrences.push(result(event, rule, "Alteração cadastral sensível", `Campos críticos alterados: ${changed.join(", ")}.`, { changedFields: changed }));
    } else if (["bank_data_change", "permission_change"].includes(rule.type)) {
      occurrences.push(result(event, rule, rule.type === "bank_data_change" ? "Alteração sensível em dados bancários" : "Alteração de permissões", event.actor?.id ? "O evento possui responsável registrado e requer revisão independente." : "O responsável humano não pôde ser identificado de forma confiável.", { actorIdentified: Boolean(event.actor?.id) }));
    } else if (rule.type === "fiscal_divergence" && event.next?.divergent === true) {
      occurrences.push(result(event, rule, "Divergência documental para conferência fiscal", "Há diferença estruturada entre o documento fiscal e sua operação de origem. A conferência fiscal oficial continua necessária.", { differences: event.next?.differences || [] }));
    }
  }
  return occurrences;
}

export function findFinancialDuplicates(rows = [], rule = defaultAuditRules().find((item) => item.type === "financial_duplicate")) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.domain, row.partyId, String(row.document || "").trim().toUpperCase(), row.installment, number(row.amount).toFixed(2), String(row.dueDate || "").slice(0, 10)].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].filter((items) => items.length > 1).map((items) => ({ ruleId: rule.id, classification: "possivel_duplicidade", severity: rule.severity, records: items, evidence: { criteria: ["domínio", "pessoa", "documento", "parcela", "valor", "vencimento"], ruleVersion: rule.version } }));
}
