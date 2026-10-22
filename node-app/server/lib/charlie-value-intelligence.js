import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-value-intelligence.json";
export const BENEFIT_CATEGORIES = Object.freeze({
  proven_saving: "Economia financeira comprovada",
  potential_saving: "Economia potencial",
  avoided_loss: "Perda potencialmente evitada",
  associated_receipt: "Recebimento associado",
  associated_revenue: "Receita comercial associada",
  productivity: "Ganho de produtividade estimado",
  operational: "Melhoria operacional",
  inventory_capital: "Capital de estoque liberado",
});
export const BENEFIT_STATES = Object.freeze(["identified", "estimated", "awaiting_evidence", "validated", "rejected", "reviewed"]);
const FINANCIAL = new Set(["proven_saving", "potential_saving", "avoided_loss", "associated_receipt", "associated_revenue", "inventory_capital"]);
const CONFIDENTIAL = new Set(["proven_saving", "potential_saving", "avoided_loss", "associated_receipt", "associated_revenue", "inventory_capital"]);
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const emptyState = () => ({ benefits: [], methodologies: [], costs: [], audit: [], processing: {} });
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const scopeKey = (value = {}) => `${Number(value.company || 0)}:${Number(value.branch || 0)}`;
const visible = (item, actor = {}) => (!actor.company || Number(item.company) === Number(actor.company)) && (!actor.branch || Number(item.branch || 0) === Number(actor.branch));
const manager = (actor = {}) => Boolean(actor.gerencial);

function load(deps = {}) { return deps.valueStore?.state || readJsonConfig(FILE, emptyState()); }
function persist(state, deps = {}) {
  state.benefits = state.benefits.slice(-10000); state.costs = state.costs.slice(-5000); state.audit = state.audit.slice(-20000);
  if (deps.valueStore) deps.valueStore.state = state; else writeJsonConfig(FILE, state);
  return state;
}
export function createValueMemoryStore(initial = emptyState()) { return { state: clone({ ...emptyState(), ...initial }) }; }
function audit(state, action, actor, target, details = {}) { state.audit.push({ id: crypto.randomUUID(), at: now(), action, target, userId: Number(actor?.id || 0), company: actor?.company || null, branch: actor?.branch || null, details }); }
function assertManager(actor) { if (!manager(actor)) throw Object.assign(new Error("Indicadores financeiros exigem permissão gerencial."), { status: 403 }); }
function dateInRange(value, from, to) { const date = Date.parse(value || 0); return (!from || date >= Date.parse(from)) && (!to || date <= Date.parse(`${to}T23:59:59.999`)); }
function sanitizeEvidence(items = []) { return items.slice(0, 100).map((x) => ({ type: String(x.type || "record").slice(0, 40), source: String(x.source || "").slice(0, 80), recordId: String(x.recordId || "").slice(0, 120), description: String(x.description || "").slice(0, 500), observedAt: x.observedAt || null, verified: Boolean(x.verified) })); }

export function saveMethodology(input, actor = {}, deps = {}) {
  assertManager(actor); const state = load(deps), id = String(input.id || "").trim();
  if (!id || !input.name || !input.definition || !input.formula || !Array.isArray(input.sources) || !input.sources.length) throw Object.assign(new Error("Metodologia exige identificador, nome, definição, fórmula e fontes."), { status: 400 });
  const previous = [...state.methodologies].reverse().find((x) => x.id === id);
  const version = previous ? Number(previous.version) + 1 : 1;
  const item = { id, version, name: String(input.name), definition: String(input.definition), formula: String(input.formula), sources: input.sources.map(String), criteria: String(input.criteria || ""), limitations: String(input.limitations || ""), validFrom: input.validFrom || now().slice(0, 10), validTo: null, approved: input.approved === true, approvedBy: input.approved === true ? Number(actor.id) : null, createdAt: now(), createdBy: Number(actor.id) };
  if (previous && !previous.validTo) previous.validTo = item.validFrom;
  state.methodologies.push(item); audit(state, "methodology_version_created", actor, `${id}:${version}`); persist(state, deps); return clone(item);
}
export function listMethodologies(actor = {}, deps = {}) { if (!manager(actor)) return []; return clone(load(deps).methodologies); }
function methodology(state, ref) { return state.methodologies.find((x) => x.id === ref?.id && Number(x.version) === Number(ref?.version) && x.approved); }

export function comparablePurchase(input = {}) {
  const qty = Number(input.quantity), reference = input.reference || {}, actual = input.actual || {};
  if (!(qty > 0)) return { valid: false, reason: "Quantidade inválida." };
  const required = ["unitPrice", "freight", "taxes"];
  if (!input.productId || !input.purchaseId || !input.referenceId || required.some((k) => !Number.isFinite(Number(reference[k])) || !Number.isFinite(Number(actual[k])))) return { valid: false, reason: "Produto, compra, referência, preços, frete e tributos são obrigatórios." };
  if (input.qualityComparable !== true || input.commercialTermsComparable !== true) return { valid: false, reason: "Qualidade e condições comerciais precisam ser comparáveis." };
  const referenceCost = money(qty * Number(reference.unitPrice) + Number(reference.freight) + Number(reference.taxes) - Number(reference.discounts || 0));
  const actualCost = money(qty * Number(actual.unitPrice) + Number(actual.freight) + Number(actual.taxes) - Number(actual.discounts || 0));
  return { valid: true, referenceCost, actualCost, saving: money(referenceCost - actualCost), calculation: `(${qty} × ${Number(reference.unitPrice)}) + ${Number(reference.freight)} + ${Number(reference.taxes)} - ${Number(reference.discounts || 0)} - [(${qty} × ${Number(actual.unitPrice)}) + ${Number(actual.freight)} + ${Number(actual.taxes)} - ${Number(actual.discounts || 0)}]` };
}

export function recordBenefit(input, actor = {}, deps = {}) {
  const state = load(deps), category = String(input.category || "");
  if (!BENEFIT_CATEGORIES[category]) throw Object.assign(new Error("Categoria de benefício inválida."), { status: 400 });
  if (CONFIDENTIAL.has(category)) assertManager(actor);
  const method = methodology(state, input.methodology);
  if (!method) throw Object.assign(new Error("Use uma metodologia aprovada e informe sua versão."), { status: 400 });
  const economicKey = String(input.economicKey || "").trim();
  if (!economicKey) throw Object.assign(new Error("Informe a chave do resultado econômico para prevenir dupla contagem."), { status: 400 });
  const duplicate = state.benefits.find((x) => x.scope === scopeKey(actor) && x.economicKey === economicKey && x.state !== "rejected");
  if (duplicate) {
    const refs = [...(duplicate.relatedEvents || []), ...(input.relatedEvents || [])]; duplicate.relatedEvents = [...new Map(refs.map((x) => [`${x.type}:${x.id}`, x])).values()]; duplicate.updatedAt = now();
    audit(state, "duplicate_linked", actor, duplicate.id, { economicKey }); persist(state, deps); return { benefit: clone(duplicate), duplicate: true };
  }
  const evidence = sanitizeEvidence(input.evidence);
  const item = { id: crypto.randomUUID(), category, categoryLabel: BENEFIT_CATEGORIES[category], value: FINANCIAL.has(category) ? money(input.value || 0) : null, currency: input.currency || "BRL", minutes: category === "productivity" ? Math.max(0, Number(input.minutes || 0)) : null, quantity: category === "operational" ? Math.max(0, Number(input.quantity || 0)) : null, unit: input.unit || null, periodStart: input.periodStart, periodEnd: input.periodEnd, identifiedAt: input.identifiedAt || now(), realizedAt: input.realizedAt || null, origin: String(input.origin || "").slice(0, 80), actionId: input.actionId ? String(input.actionId) : null, economicKey, relatedEvents: input.relatedEvents || [], evidence, calculation: input.calculation || null, assumptions: input.assumptions || [], limitations: input.limitations || [], methodology: { id: method.id, version: method.version }, attribution: input.attribution || { level: "associated", rationale: "Associação registrada; causalidade incremental não demonstrada." }, state: input.state || (evidence.length ? "awaiting_evidence" : "identified"), company: actor.company || null, branch: actor.branch || null, sector: input.sector || actor.sector || null, scope: scopeKey(actor), createdAt: now(), createdBy: Number(actor.id), updatedAt: now(), validation: null };
  if (!BENEFIT_STATES.includes(item.state) || item.state === "validated") item.state = "awaiting_evidence";
  state.benefits.push(item); audit(state, "benefit_recorded", actor, item.id, { category, economicKey }); persist(state, deps); return { benefit: clone(item), duplicate: false };
}

export function recordPurchaseBenefit(input, actor = {}, deps = {}) {
  const result = comparablePurchase(input);
  if (!result.valid) return recordBenefit({ ...input, category: "potential_saving", value: Number(input.potentialValue || 0), state: "estimated", calculation: { comparable: false, reason: result.reason } }, actor, deps);
  return recordBenefit({ ...input, category: result.saving >= 0 ? "proven_saving" : "operational", value: Math.max(0, result.saving), state: "awaiting_evidence", calculation: result, economicKey: input.economicKey || `purchase:${input.purchaseId}:product:${input.productId}` }, actor, deps);
}

export function validateBenefit(id, input, actor = {}, deps = {}) {
  assertManager(actor); const state = load(deps), item = state.benefits.find((x) => x.id === id && visible(x, actor));
  if (!item) throw Object.assign(new Error("Benefício não encontrado."), { status: 404 });
  const target = String(input.state || ""); if (!BENEFIT_STATES.includes(target) || target === "identified") throw Object.assign(new Error("Estado de validação inválido."), { status: 400 });
  if (["validated", "reviewed"].includes(target)) {
    if (!item.evidence.length || item.evidence.some((x) => !x.verified)) throw Object.assign(new Error("Todas as evidências precisam estar verificadas."), { status: 409 });
    if (!String(input.justification || "").trim()) throw Object.assign(new Error("Informe a justificativa da validação."), { status: 400 });
    if (Number(item.createdBy) === Number(actor.id) && Number(input.independentReviewRequired ?? 1)) throw Object.assign(new Error("A validação financeira exige um responsável diferente de quem registrou o benefício."), { status: 403 });
  }
  item.state = target; item.validation = { at: now(), userId: Number(actor.id), userName: actor.name || null, justification: String(input.justification || "").slice(0, 1000) }; item.updatedAt = now();
  audit(state, "benefit_state_changed", actor, item.id, { state: target }); persist(state, deps); return clone(item);
}

export function recordCost(input, actor = {}, deps = {}) {
  assertManager(actor); if (!(Number(input.value) >= 0) || !input.periodStart || !input.periodEnd) throw Object.assign(new Error("Custo exige valor e período."), { status: 400 });
  const state = load(deps), item = { id: crypto.randomUUID(), type: String(input.type || "other"), description: String(input.description || "").slice(0, 300), value: money(input.value), currency: input.currency || "BRL", periodStart: input.periodStart, periodEnd: input.periodEnd, evidence: sanitizeEvidence(input.evidence), company: actor.company || null, branch: actor.branch || null, scope: scopeKey(actor), createdAt: now(), createdBy: Number(actor.id) };
  state.costs.push(item); audit(state, "cost_recorded", actor, item.id); persist(state, deps); return clone(item);
}

export function listBenefits(actor = {}, filters = {}, deps = {}) {
  let rows = load(deps).benefits.filter((x) => visible(x, actor));
  if (!manager(actor)) rows = rows.filter((x) => !CONFIDENTIAL.has(x.category));
  rows = rows.filter((x) => !filters.category || x.category === filters.category).filter((x) => !filters.state || x.state === filters.state).filter((x) => !filters.sector || x.sector === filters.sector).filter((x) => dateInRange(x.realizedAt || x.identifiedAt, filters.from, filters.to));
  return clone(rows.slice(-Math.max(1, Math.min(1000, Number(filters.limit) || 300))).reverse());
}
export function investigateBenefit(id, actor = {}, deps = {}) {
  const item = listBenefits(actor, { limit: 1000 }, deps).find((x) => x.id === id); if (!item) throw Object.assign(new Error("Benefício não encontrado."), { status: 404 });
  const state = load(deps), method = state.methodologies.find((x) => x.id === item.methodology.id && Number(x.version) === Number(item.methodology.version));
  return { benefit: item, methodology: clone(method), trace: item.relatedEvents, evidence: item.evidence, explanation: `${item.categoryLabel}: ${item.calculation?.calculation || method?.formula || "cálculo registrado"}. Estado ${item.state}; atribuição ${item.attribution?.level || "não definida"}.`, limitations: [...(item.limitations || []), method?.limitations].filter(Boolean) };
}

export function valueDashboard(actor = {}, filters = {}, deps = {}) {
  const benefits = listBenefits(actor, { ...filters, limit: 1000 }, deps), state = load(deps);
  const totals = Object.fromEntries(Object.keys(BENEFIT_CATEGORIES).map((key) => [key, { value: 0, minutes: 0, quantity: 0, count: 0, validated: 0 }]));
  for (const item of benefits) { const row = totals[item.category]; row.count++; row.value = money(row.value + Number(item.value || 0)); row.minutes += Number(item.minutes || 0); row.quantity += Number(item.quantity || 0); if (["validated", "reviewed"].includes(item.state)) row.validated++; }
  const costs = manager(actor) ? state.costs.filter((x) => visible(x, actor) && dateInRange(x.periodEnd, filters.from, filters.to)) : [];
  const totalCosts = money(costs.reduce((s, x) => s + Number(x.value || 0), 0));
  const attributable = benefits.filter((x) => ["validated", "reviewed"].includes(x.state) && x.attribution?.level === "attributable" && x.category === "proven_saving").reduce((s, x) => s + Number(x.value || 0), 0);
  const roi = totalCosts > 0 && attributable > 0 ? { available: true, percentage: money(((attributable - totalCosts) / totalCosts) * 100), benefits: money(attributable), costs: totalCosts, basis: "Somente economias comprovadas, validadas e atribuíveis no mesmo período." } : { available: false, reason: "Não há custos e benefícios comprovados atribuíveis suficientes no período.", benefits: money(attributable), costs: totalCosts };
  const monthly = new Map(); for (const item of benefits) { const key = String(item.realizedAt || item.identifiedAt).slice(0, 7); if (!monthly.has(key)) monthly.set(key, {}); monthly.get(key)[item.category] = money(Number(monthly.get(key)[item.category] || 0) + Number(item.value || 0)); }
  return { generatedAt: now(), filters, totals, roi, costs: { total: totalCosts, count: costs.length }, monthly: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, categories]) => ({ month, categories })), benefits };
}

export function productivitySaving(input = {}) { const manual = Number(input.manualMinutes), actual = Number(input.actualMinutes); if (!(manual >= 0) || !(actual >= 0) || !input.referenceApproved) return { valid: false, minutes: 0, reason: "A referência manual precisa ser medida e aprovada." }; return { valid: true, minutes: Math.max(0, manual - actual), reason: null }; }
export function calculateAssociatedReceipt(action = {}, payments = []) { const actionAt = Date.parse(action.at || 0); return payments.filter((x) => action.titleIds?.map(String).includes(String(x.titleId)) && Date.parse(x.paidAt) >= actionAt).reduce((sum, x) => sum + Number(x.value || 0), 0); }
export function processingCheckpoint(source, actor = {}, deps = {}) { return clone(load(deps).processing[`${scopeKey(actor)}:${source}`] || null); }
export function saveProcessingCheckpoint(source, cursor, actor = {}, deps = {}) { const state = load(deps); state.processing[`${scopeKey(actor)}:${source}`] = { cursor, at: now() }; persist(state, deps); return state.processing[`${scopeKey(actor)}:${source}`]; }
