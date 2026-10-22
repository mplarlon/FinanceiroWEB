const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};
const money = (value) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export const DEFAULT_WEIGHTS = Object.freeze({
  gravidade: 0.22,
  urgencia: 0.16,
  impactoFinanceiro: 0.18,
  impactoOperacional: 0.12,
  registros: 0.08,
  prazo: 0.08,
  evidencia: 0.08,
  dependencias: 0.04,
  mitigacao: 0.04,
});

const SEVERITY_SCORE = { critico: 100, atencao: 65, oportunidade: 30, informacao: 12 };
const EVIDENCE_SCORE = { alta: 100, media: 70, limitada: 40, insuficiente: 15 };
const SEVERITY_ORDER = { critico: 0, atencao: 1, oportunidade: 2, informacao: 3 };

export const EXECUTIVE_ACTIONS = Object.freeze({
  caixa: { actionId: "preditivo.fluxo_caixa", params: { dias: 30 }, objective: "Reavaliar a projeção de caixa já calculada pelo motor preditivo" },
  inadimplencia: { actionId: "financeiro.inadimplencia", params: { dominio: "receber", dias: 1, agrupar: "cliente", formato: "nenhum" }, objective: "Listar a inadimplência em aberto" },
  cobranca: { actionId: "financeiro.preparar_cobrancas", params: { dominio: "receber", dias: 1, agrupar: "cliente" }, objective: "Preparar rascunhos de cobrança, sem enviar mensagens" },
  ruptura: { actionId: "preditivo.ruptura_estoque", params: { dias: 90 }, objective: "Reavaliar o risco de ruptura com o motor preditivo" },
  minimo: { actionId: "estoque.abaixo_minimo", params: { sugerir: "nao", formato: "nenhum" }, objective: "Listar produtos no mínimo ou abaixo" },
  inativos: { actionId: "comercial.clientes_inativos", params: { dias: 45, formato: "nenhum" }, objective: "Listar clientes sem compra no prazo observado" },
  reducao: { actionId: "comercial.reducao_compras", params: { meses: 3, percentual: 30, formato: "nenhum" }, objective: "Detalhar clientes com redução de compras já medida" },
  margem: { actionId: "produtos.margem_insuficiente", params: { margem: 15, formato: "nenhum" }, objective: "Listar preços abaixo da margem de referência de 15%" },
  duplicidade: { actionId: "auditoria.duplicidades_financeiras", params: { dias: 90 }, objective: "Listar possíveis duplicidades para investigação" },
  resultados: { actionId: "relatorios.resultados_charlie", params: { meses: 1, formato: "nenhum" }, objective: "Consolidar resultados já registrados do Charlie" },
});

export function normalizeCriteria(input = {}) {
  const raw = { ...DEFAULT_WEIGHTS };
  for (const [key, value] of Object.entries(input.weights || {})) {
    if (Object.hasOwn(raw, key) && Number.isFinite(Number(value)) && Number(value) >= 0) raw[key] = Number(value);
  }
  raw.gravidade = Math.max(0.15, raw.gravidade);
  const keys = Object.keys(DEFAULT_WEIGHTS);
  const sum = keys.reduce((total, key) => total + raw[key], 0) || 1;
  const weights = Object.fromEntries(keys.map((key) => [key, raw[key] / sum]));
  if (weights.gravidade < 0.15) {
    const others = keys.filter((key) => key !== "gravidade");
    const otherSum = others.reduce((total, key) => total + weights[key], 0) || 1;
    const next = { gravidade: 0.15 };
    for (const key of others) next[key] = (weights[key] / otherSum) * 0.85;
    return { weights: next, mandatory: "A gravidade permanece com peso mínimo de 15%. Preferência pessoal não remove essa regra." };
  }
  return { weights, mandatory: "A gravidade permanece com peso mínimo de 15%. Preferência pessoal não remove essa regra." };
}

function urgencyScore(item) {
  if (Number.isFinite(item.deadlineDays)) {
    if (item.deadlineDays <= 2) return 100;
    if (item.deadlineDays <= 7) return 82;
    if (item.deadlineDays <= 15) return 64;
    if (item.deadlineDays <= 30) return 45;
    return 25;
  }
  if (item.severity === "critico") return 70;
  if (item.severity === "atencao") return 40;
  return 15;
}

function financialScore(value) {
  if (value == null) return 0;
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (amount >= 50000) return 100;
  if (amount >= 10000) return 80;
  if (amount >= 1000) return 55;
  return 30;
}

export function scoreSignal(item, criteria = normalizeCriteria()) {
  const factors = {
    gravidade: SEVERITY_SCORE[item.severity] ?? 0,
    urgencia: urgencyScore(item),
    impactoFinanceiro: financialScore(item.financialImpact),
    impactoOperacional: clamp(item.operationalImpact ?? (item.records > 20 ? 70 : item.records > 0 ? 40 : 15)),
    registros: clamp((item.records || 0) * 5),
    prazo: Number.isFinite(item.deadlineDays) ? urgencyScore(item) : 20,
    evidencia: EVIDENCE_SCORE[item.evidenceQuality] ?? 40,
    dependencias: clamp(100 - (item.dependencies?.length || 0) * 20),
    mitigacao: item.mitigable === false ? 25 : 80,
  };
  const score = round(Object.entries(factors).reduce((total, [key, value]) => total + value * (criteria.weights[key] || 0), 0), 2);
  const reasons = [
    `gravidade ${item.severity}`,
    Number.isFinite(item.deadlineDays) ? `prazo informado de ${item.deadlineDays} dia(s)` : "prazo não datado na fonte",
    item.financialImpact == null ? "impacto financeiro não quantificado pela fonte" : `impacto financeiro informado: ${money(item.financialImpact)}`,
    `evidência ${item.evidenceQuality || "não classificada"}`,
    `${item.records || 0} registro(s) considerado(s)`,
    item.mitigable === false ? "sem ação de mitigação no catálogo atual" : "existe ação de consulta ou preparação no catálogo atual",
  ];
  return { ...item, score, factors, reasons };
}

export function prioritize(signals = [], criteria = normalizeCriteria()) {
  return signals
    .map((item) => scoreSignal(item, criteria))
    .sort((a, b) => b.score - a.score || (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || (b.records || 0) - (a.records || 0));
}

export function markChanges(signals, previous = []) {
  const before = new Map((previous || []).map((item) => [item.id, item]));
  return signals.map((item) => {
    const old = before.get(item.id);
    const changed = !old || old.severity !== item.severity || Math.abs(Number(old.score || 0) - Number(item.score || 0)) >= 10 || old.detail !== item.detail;
    return { ...item, changed, changeNote: changed ? (old ? "alterado desde a última análise" : "novo desde a última análise") : "sem alteração relevante desde a última análise" };
  });
}

function daysUntil(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / 86400000);
}

function signal(partial) {
  return {
    kind: "fato",
    severity: "informacao",
    financialImpact: null,
    operationalImpact: null,
    records: 0,
    deadlineDays: null,
    evidenceQuality: "media",
    dependencies: [],
    mitigable: false,
    actionKey: null,
    premise: null,
    measure: null,
    ...partial,
  };
}

function lowestBalance(projection, closing) {
  const values = (projection || []).map((item) => finite(item.balance ?? item.simulatedBalance)).filter((value) => value != null);
  if (!values.length) return finite(closing);
  return Math.min(...values);
}

export function signalsFromSources(sources = {}, preferences = {}) {
  const limitations = [...(sources.limitations || [])];
  const signals = [];
  const updatedAt = sources.generatedAt || null;
  const sectors = new Set((preferences.sectors || []).map((item) => normalize(item)));
  const alertTypes = new Set((preferences.alertTypes || []).map((item) => normalize(item)));

  for (const alert of sources.alerts || []) {
    if (["resolvido", "descartado"].includes(alert.situacao)) continue;
    const severity = alert.gravidade === "critico" ? "critico" : alert.gravidade === "atencao" ? "atencao" : "informacao";
    const text = normalize(`${alert.titulo} ${alert.regra}`);
    const actionKey = /caixa|saldo|liquidez/.test(text) ? "caixa" : alert.categoria === "financeiro" ? "inadimplencia" : alert.categoria === "estoque" ? "minimo" : alert.categoria === "comercial" ? "inativos" : alert.categoria === "precos" ? "margem" : null;
    signals.push(signal({
      id: `alerta:${alert.id || alert.regra}`,
      area: alert.categoria || "monitoramento",
      title: alert.titulo || "Alerta sem título",
      detail: alert.descricao || "Descrição não informada pelo monitoramento.",
      severity,
      records: finite(alert.quantidade) || finite(alert.evidencias?.registros) || 1,
      financialImpact: finite(alert.evidencias?.valor ?? alert.evidencias?.total ?? alert.evidencias?.saldo),
      evidenceQuality: alert.evidencias ? "alta" : "media",
      mitigable: Boolean(actionKey),
      actionKey,
      source: { service: "monitoramento", indicator: alert.regra || String(alert.id), updatedAt: alert.atualizadoEm || sources.alertsUpdatedAt || updatedAt },
    }));
  }
  if (!sources.alerts) limitations.push("Monitoramento: não há alertas disponíveis para este usuário.");

  const base = sources.cashFlow?.scenarios?.base;
  if (base) {
    const lowest = lowestBalance(base.projection, base.closingBalance);
    const negative = base.firstNegativeDate || (lowest != null && lowest < 0);
    signals.push(signal({
      id: "projecao:caixa",
      area: "financeiro",
      title: negative ? "Projeção de caixa indica saldo negativo no horizonte" : "Projeção de caixa sem saldo negativo no cenário base",
      detail: negative
        ? `O cenário base do motor preditivo indica saldo negativo${base.firstNegativeDate ? ` a partir de ${base.firstNegativeDate}` : ""}. Menor saldo projetado: ${lowest == null ? "não informado" : money(lowest)}. É projeção, não saldo contábil.`
        : `Saldo final projetado no cenário base: ${money(base.closingBalance)}. É projeção, não saldo contábil.`,
      severity: negative ? "critico" : "informacao",
      kind: "projecao",
      financialImpact: lowest != null && lowest < 0 ? Math.abs(lowest) : null,
      records: base.projection?.length || 0,
      deadlineDays: base.firstNegativeDate ? daysUntil(base.firstNegativeDate) : null,
      evidenceQuality: sources.cashFlow.quality?.status === "adequada" ? "alta" : "limitada",
      mitigable: true,
      actionKey: "caixa",
      measure: lowest == null ? null : { value: lowest, polarity: "higher_better", unit: "BRL" },
      source: { service: "previsao_fluxo_caixa", indicator: "fluxo_caixa", updatedAt: sources.cashFlow.generatedAt || updatedAt },
    }));
  } else if (sources.cashFlow === undefined) limitations.push("Financeiro: a projeção de fluxo de caixa não foi consultada nesta leitura.");

  const revenue = sources.revenue;
  if (revenue?.ok) {
    signals.push(signal({
      id: "projecao:faturamento",
      area: "comercial",
      title: "Projeção de faturamento",
      detail: `Total projetado: ${money(revenue.total)}. Faixa ${money(revenue.interval?.lower)} a ${money(revenue.interval?.upper)}. Modelo ${revenue.model || "não informado"}. Qualidade ${revenue.quality?.status || "não informada"}. Não é garantia.`,
      kind: "projecao",
      records: revenue.history?.length || revenue.validation?.samples || 0,
      evidenceQuality: revenue.quality?.status === "adequada" ? "alta" : "limitada",
      source: { service: "previsao_faturamento", indicator: "faturamento", updatedAt: revenue.generatedAt || updatedAt },
    }));
  } else if (revenue && revenue.ok === false) limitations.push(`Comercial: ${revenue.message || "a previsão de faturamento não pôde ser calculada."}`);

  const highStock = (sources.stock?.items || []).filter((item) => item.risk === "alto");
  if (sources.stock) {
    const coverage = highStock.map((item) => finite(item.coverageDays)).filter((value) => value != null);
    signals.push(signal({
      id: "projecao:ruptura",
      area: "estoque",
      title: highStock.length ? "Produtos com risco alto de indisponibilidade" : "Nenhum produto com risco alto de indisponibilidade na amostra",
      detail: highStock.length
        ? `${highStock.length} produto(s) classificados como risco alto pelo motor preditivo. Dias de cobertura são estimativa, não data certa de ruptura.`
        : "A amostra retornada não trouxe risco alto.",
      severity: highStock.length ? "critico" : "informacao",
      kind: "projecao",
      records: highStock.length,
      deadlineDays: coverage.length ? Math.round(Math.min(...coverage)) : null,
      evidenceQuality: sources.stock.quality?.status === "adequada" ? "alta" : sources.stock.quality?.status === "insuficiente" ? "insuficiente" : "limitada",
      mitigable: highStock.length > 0,
      actionKey: highStock.length ? "ruptura" : null,
      measure: { value: highStock.length, polarity: "lower_better", unit: "produtos" },
      source: { service: "previsao_estoque", indicator: "ruptura_estoque", updatedAt: sources.stock.generatedAt || updatedAt },
    }));
  }

  const supply = sources.supply?.indicators;
  if (supply) {
    if (supply.ruptureRisk > 0) signals.push(signal({ id: "compras:ruptura", area: "compras", title: "Necessidade de reposição com urgência alta", detail: `${supply.ruptureRisk} item(ns) com urgência crítica ou alta no abastecimento. Reservas podem não estar descontadas.`, severity: "critico", records: supply.ruptureRisk, evidenceQuality: "media", mitigable: true, actionKey: "ruptura", measure: { value: supply.ruptureRisk, polarity: "lower_better", unit: "itens" }, source: { service: "abastecimento", indicator: "ruptureRisk", updatedAt: sources.supply.generatedAt || updatedAt } }));
    if (supply.belowMinimum > 0) signals.push(signal({ id: "compras:minimo", area: "estoque", title: "Produtos abaixo do estoque de segurança informado", detail: `${supply.belowMinimum} item(ns) com saldo disponível abaixo do estoque de segurança usado pelo abastecimento.`, severity: "atencao", records: supply.belowMinimum, evidenceQuality: "media", mitigable: true, actionKey: "minimo", source: { service: "abastecimento", indicator: "belowMinimum", updatedAt: sources.supply.generatedAt || updatedAt } }));
    if (supply.excess > 0) signals.push(signal({ id: "compras:excesso", area: "estoque", title: "Excesso de cobertura identificado", detail: `${supply.excess} item(ns) com excesso de cobertura. Isso não é economia comprovada nem capital liberado.`, severity: "oportunidade", records: supply.excess, evidenceQuality: "media", source: { service: "abastecimento", indicator: "excess", updatedAt: sources.supply.generatedAt || updatedAt } }));
    if (supply.lateOrders > 0) signals.push(signal({ id: "compras:atraso", area: "compras", title: "Pedidos de compra com previsão vencida", detail: `${supply.lateOrders} pedido(s) pendente(s) com previsão anterior a hoje. A causa do atraso não foi inferida.`, severity: "atencao", kind: "fato", records: supply.lateOrders, evidenceQuality: "media", measure: { value: supply.lateOrders, polarity: "lower_better", unit: "pedidos" }, source: { service: "abastecimento", indicator: "lateOrders", updatedAt: sources.supply.generatedAt || updatedAt } }));
    if (supply.potentialSavings == null) limitations.push("Compras: não há economia potencial quantificada. O campo permanece vazio de propósito.");
    for (const note of sources.supply.limitations || []) limitations.push(`Compras: ${note}`);
  }

  const profit = sources.profitability?.indicators;
  if (profit) {
    if (profit.negativeSales > 0) signals.push(signal({
      id: "rentabilidade:negativa",
      area: "rentabilidade",
      title: "Vendas com contribuição negativa",
      detail: `${profit.negativeSales} ocorrência(s). Resultado negativo identificado: ${money(profit.verifiedNegativeResult)}. É margem de contribuição, não lucro líquido.`,
      severity: "critico",
      financialImpact: finite(profit.verifiedNegativeResult),
      records: profit.negativeSales,
      evidenceQuality: "alta",
      mitigable: true,
      actionKey: "margem",
      premise: "A consulta de margem usa 15% como referência do catálogo quando a fonte não informa outro limite.",
      measure: { value: finite(profit.verifiedNegativeResult), polarity: "lower_better", unit: "BRL" },
      source: { service: "rentabilidade", indicator: "verifiedNegativeResult", updatedAt: sources.profitability.generatedAt || updatedAt, period: sources.profitability.period },
    }));
    if (profit.insufficientMarginSales > 0) signals.push(signal({
      id: "rentabilidade:insuficiente",
      area: "rentabilidade",
      title: "Vendas com margem insuficiente",
      detail: `${profit.insufficientMarginSales} ocorrência(s) abaixo do critério já aplicado pelo painel de rentabilidade.`,
      severity: "atencao",
      records: profit.insufficientMarginSales,
      evidenceQuality: "alta",
      mitigable: true,
      actionKey: "margem",
      premise: "A consulta de margem usa 15% como referência do catálogo quando a fonte não informa outro limite.",
      source: { service: "rentabilidade", indicator: "insufficientMarginSales", updatedAt: sources.profitability.generatedAt || updatedAt },
    }));
    for (const note of sources.profitability.limitations || []) limitations.push(`Rentabilidade: ${note}`);
  }

  for (const item of (sources.opportunities || []).slice(0, 8)) {
    const metrics = item.evidence?.metrics || item.metrics || {};
    const drop = finite(metrics.previousRevenue) != null && finite(metrics.currentRevenue) != null ? finite(metrics.previousRevenue) - finite(metrics.currentRevenue) : null;
    const opportunity = item.type === "venda_cruzada" || item.type === "recompra";
    signals.push(signal({
      id: `comercial:${item.id || item.key}`,
      area: "comercial",
      title: item.type === "reducao_compras" ? `Redução de compras de ${item.customer}` : item.type === "inatividade" ? `Cliente sem compra recente: ${item.customer}` : `Oportunidade comercial: ${item.customer}`,
      detail: item.reason || "Oportunidade registrada sem justificativa.",
      severity: opportunity ? "oportunidade" : "atencao",
      kind: item.type === "reducao_compras" || item.type === "venda_cruzada" ? "correlacao" : "fato",
      financialImpact: drop != null && drop > 0 ? drop : null,
      records: 1,
      evidenceQuality: "media",
      mitigable: item.type === "reducao_compras" || item.type === "inatividade",
      actionKey: item.type === "reducao_compras" ? "reducao" : item.type === "inatividade" ? "inativos" : null,
      source: { service: "inteligencia_comercial", indicator: item.type, updatedAt: item.updatedAt || updatedAt },
    }));
  }
  if (sources.commercialMetrics) limitations.push(sources.commercialMetrics.note || "Receita comercial incremental não é inferida.");

  const inactive = (sources.customers?.customers || []).filter((item) => item.classification === "risco_inatividade");
  if (sources.customers) {
    signals.push(signal({
      id: "projecao:inatividade",
      area: "comercial",
      title: inactive.length ? "Clientes com risco estimado de inatividade" : "Nenhum cliente com risco estimado de inatividade na amostra",
      detail: `${inactive.length} cliente(s) na classificação risco_inatividade. O motor não apresenta probabilidade calibrada.`,
      severity: inactive.length ? "atencao" : "informacao",
      kind: "projecao",
      records: inactive.length,
      evidenceQuality: sources.customers.quality?.status === "adequada" ? "media" : "limitada",
      mitigable: inactive.length > 0,
      actionKey: inactive.length ? "inativos" : null,
      source: { service: "previsao_inatividade", indicator: "inatividade_clientes", updatedAt: sources.customers.generatedAt || updatedAt },
    }));
  }

  for (const item of sources.investigations || []) {
    if (["resolvida", "descartada"].includes(item.status)) continue;
    signals.push(signal({
      id: `auditoria:${item.id}`,
      area: "auditoria",
      title: "Investigação de auditoria pendente",
      detail: `Investigação ${item.id} está ${item.status}. O encerramento continua exigindo justificativa no fluxo de auditoria.`,
      severity: "atencao",
      records: 1,
      evidenceQuality: "alta",
      source: { service: "auditoria", indicator: "investigacao", updatedAt: item.openedAt || updatedAt },
    }));
  }

  const results = sources.results;
  if (results?.totals) {
    const proven = results.totals.proven_saving || {};
    signals.push(signal({
      id: "resultados:comprovado",
      area: "resultados",
      title: proven.validated > 0 ? "Economia comprovada validada" : "Nenhuma economia comprovada validada no recorte",
      detail: proven.validated > 0 ? `${money(proven.value)} em economia comprovada, com ${proven.validated} registro(s) validado(s).` : "Valores identificados ou estimados não foram promovidos a economia comprovada.",
      severity: proven.validated > 0 ? "oportunidade" : "informacao",
      financialImpact: proven.validated > 0 ? finite(proven.value) : null,
      records: proven.validated || 0,
      evidenceQuality: proven.validated > 0 ? "alta" : "insuficiente",
      actionKey: "resultados",
      mitigable: true,
      source: { service: "resultados", indicator: "proven_saving", updatedAt: results.generatedAt || updatedAt },
    }));
    const potential = results.totals.potential_saving || {};
    if (potential.count > 0) signals.push(signal({
      id: "resultados:estimado",
      area: "resultados",
      title: "Economia potencial ainda não comprovada",
      detail: `${money(potential.value)} permanecem como estimativa. Não entram como benefício realizado.`,
      severity: "informacao",
      kind: "projecao",
      records: potential.count,
      evidenceQuality: "limitada",
      source: { service: "resultados", indicator: "potential_saving", updatedAt: results.generatedAt || updatedAt },
    }));
  } else limitations.push("Resultados do Charlie: não há consolidação disponível para o escopo.");

  if (!sources.goals) limitations.push("Metas: não há metas empresariais cadastradas nesta camada. Nenhuma comparação com meta foi declarada.");

  const filtered = signals.filter((item) => {
    if (item.severity === "critico") return true;
    if (sectors.size && !sectors.has(normalize(item.area))) return false;
    if (alertTypes.size && item.severity !== "atencao" && !alertTypes.has(item.severity) && !alertTypes.has("todos")) return false;
    return true;
  });
  if (sectors.size && filtered.length !== signals.filter((item) => item.severity === "critico" || sectors.has(normalize(item.area))).length)
    limitations.push("Preferências de setor não ocultam situações críticas.");
  if (alertTypes.size) limitations.push("Preferências de alerta não ocultam situações críticas nem pontos de atenção.");
  return { signals: filtered, limitations: [...new Set(limitations.filter(Boolean))] };
}

export function periodLabel(sources = {}) {
  const parts = [];
  if (sources.profitability?.period?.days) parts.push(`rentabilidade: últimos ${sources.profitability.period.days} dias`);
  if (sources.cashFlow?.horizon) parts.push(`fluxo de caixa: projeção de ${sources.cashFlow.horizon} dias`);
  if (sources.revenue?.horizon) parts.push(`faturamento: projeção de ${sources.revenue.horizon} dias`);
  if (sources.supply?.horizonDays) parts.push(`abastecimento: horizonte de ${sources.supply.horizonDays} dias`);
  if (sources.stock?.quality) parts.push("estoque: amostra do motor preditivo");
  return parts.length ? parts.join("; ") : "período não informado pelas fontes disponíveis";
}

export function latestUpdate(signals = []) {
  const dates = signals.map((item) => Date.parse(item.source?.updatedAt || "")).filter((value) => Number.isFinite(value));
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

function toneMark(severity) {
  if (severity === "critico") return "🔴";
  if (severity === "atencao") return "🟡";
  if (severity === "oportunidade") return "🟢";
  return "🔵";
}

function lineOf(item) {
  const when = item.source?.updatedAt ? new Date(item.source.updatedAt).toLocaleString("pt-BR") : "atualização não informada";
  return `${toneMark(item.severity)} ${item.title}. ${item.detail} Fonte: ${item.source?.service || "não informada"} / ${item.source?.indicator || "sem indicador"}. Atualização: ${when}. ${item.changeNote || ""}`.trim();
}

export function renderExecutiveBriefing(model) {
  const critical = model.critical || [];
  const attention = model.attention || [];
  const opportunities = model.opportunities || [];
  const priorities = model.priorities || [];
  const lines = [
    "CHARLIE — RESUMO EXECUTIVO",
    "",
    `Período analisado: ${model.period || "período não informado pelas fontes disponíveis"}`,
    `Última atualização: ${model.updatedAt ? new Date(model.updatedAt).toLocaleString("pt-BR") : "não há horário de atualização nas fontes usadas"}`,
    "",
    "🔴 Situações críticas",
    critical.length ? critical.map(lineOf).join("\n") : "Nenhuma situação crítica foi encontrada nas fontes autorizadas desta leitura.",
    "",
    "🟡 Pontos de atenção",
    attention.length ? attention.map(lineOf).join("\n") : "Nenhum ponto de atenção foi encontrado nas fontes autorizadas desta leitura.",
    "",
    "🟢 Oportunidades",
    opportunities.length ? opportunities.map(lineOf).join("\n") : "Nenhuma oportunidade foi encontrada nas fontes autorizadas desta leitura.",
    "",
    "📊 Indicadores",
    (model.indicators || []).length
      ? model.indicators.map((item) => `${item.kind === "projecao" ? "Projeção" : item.kind === "estimado" ? "Estimativa" : "Realizado"} — ${item.label}: ${item.valueLabel}. Fonte: ${item.source}. Atualização: ${item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : "não informada"}.`).join("\n")
      : "Nenhum indicador numérico estava disponível.",
    "",
    "🎯 Prioridades recomendadas",
    priorities.length
      ? priorities.map((item, index) => `Prioridade ${index + 1}: ${item.title}. Pontuação ${item.score}. ${item.reasons.join(". ")}. ${item.changeNote || ""}`).join("\n")
      : "Não há problema priorizado nas fontes desta leitura.",
    "",
    "🤖 Próximas ações",
    (model.actions || []).length
      ? model.actions.map((item) => `${item.label}. ${item.note}`).join("\n")
      : "Não há ação do catálogo atual ligada aos problemas desta leitura. Nada foi executado.",
    "",
    "Limitações das fontes",
    (model.limitations || []).length ? model.limitations.map((item) => `- ${item}`).join("\n") : "- Nenhuma limitação adicional foi registrada nesta leitura.",
  ];
  if (model.changesOnly) {
    lines.splice(4, 0, model.changedCount ? `Mudanças relevantes desde a última análise: ${model.changedCount}.` : "Não há mudança relevante desde a última análise. Os itens repetidos foram resumidos.");
  }
  return lines.join("\n");
}

export function indicatorCards(signals = [], favorites = []) {
  const cards = signals.filter((item) => item.measure || item.financialImpact != null || item.kind === "projecao").map((item) => ({
    id: item.id,
    label: item.title,
    value: item.measure?.value ?? item.financialImpact,
    valueLabel: item.measure ? `${item.measure.value} ${item.measure.unit}` : item.financialImpact == null ? "não quantificado" : money(item.financialImpact),
    tone: item.severity,
    kind: item.kind === "projecao" ? "projecao" : item.id.includes("estimado") ? "estimado" : "realizado",
    source: `${item.source?.service || "fonte não informada"} · ${item.source?.indicator || "indicador"}`,
    updatedAt: item.source?.updatedAt || null,
    area: item.area,
  }));
  const favorite = new Set(favorites);
  return cards.sort((a, b) => Number(favorite.has(b.id)) - Number(favorite.has(a.id)));
}

export function buildPlanDraft(priorities, actor) {
  const now = new Date().toISOString();
  const actions = priorities.filter((item) => item.actionKey && EXECUTIVE_ACTIONS[item.actionKey]).slice(0, 5).map((item, index) => {
    const template = EXECUTIVE_ACTIONS[item.actionKey];
    const due = Number.isFinite(item.deadlineDays) ? new Date(Date.now() + Math.max(0, item.deadlineDays) * 86400000).toISOString() : null;
    return {
      id: `acao-${index + 1}`,
      problemId: item.id,
      problem: item.title,
      objective: template.objective,
      description: item.detail,
      suggestedOwner: null,
      ownerNote: "Não atribuído. Não há regra validada de distribuição de responsáveis.",
      priority: index + 1,
      dueAt: due,
      dueNote: due ? "Prazo estimado a partir do indicador. Não é compromisso formal." : "Prazo não estimado: a fonte não trouxe data.",
      dependencies: item.dependencies || [],
      status: "planejada",
      expectedResult: `Reavaliar o indicador ${item.source?.indicator || item.id}.`,
      indicator: item.source?.indicator || item.id,
      baseline: item.measure ? { ...item.measure, at: item.source?.updatedAt || now } : null,
      actionId: template.actionId,
      params: { ...template.params },
      premise: item.premise || null,
      requiresDataChange: false,
      executable: true,
    };
  });
  return {
    objective: priorities[0] ? `Tratar primeiro: ${priorities[0].title}` : "Acompanhar a situação executiva sem problema priorizado",
    createdAt: now,
    ownerUserId: Number(actor?.id || 0),
    company: actor?.company || null,
    branch: actor?.branch || null,
    responsible: null,
    status: "aguardando_aprovacao",
    priorities: priorities.map((item) => ({ id: item.id, title: item.title, score: item.score, reasons: item.reasons })),
    actions,
    history: [{ at: now, action: "criado", userId: Number(actor?.id || 0), note: "Plano criado. Nenhuma tarefa foi executada." }],
  };
}

export function verifyReading(baseline, current) {
  if (!baseline || baseline.value == null || !current || current.value == null)
    return { status: "insuficiente", message: "Não há medição anterior e posterior para declarar resultado. Nenhuma economia ou lucro foi atribuído." };
  const before = Number(baseline.value);
  const after = Number(current.value);
  if (!Number.isFinite(before) || !Number.isFinite(after))
    return { status: "insuficiente", message: "A leitura não é numérica. Nenhuma economia ou lucro foi atribuído." };
  const delta = round(after - before, 2);
  const higherBetter = (current.polarity || baseline.polarity) !== "lower_better";
  const improved = higherBetter ? delta > 0 : delta < 0;
  const worse = higherBetter ? delta < 0 : delta > 0;
  if (delta === 0) return { status: "inalterado", delta, message: "O indicador permanece igual. O problema continua. Nenhuma economia foi declarada." };
  if (improved) return { status: "melhorou", delta, message: "O indicador melhorou na comparação das duas leituras. Isso registra o resultado observado e não comprova, sozinho, economia ou lucro." };
  if (worse) return { status: "piorou", delta, message: "O indicador piorou na comparação. O problema continua." };
  return { status: "insuficiente", delta, message: "Não foi possível classificar a variação." };
}

export function classifyFindings(items = []) {
  const groups = { fato: [], correlacao: [], hipotese: [], projecao: [] };
  for (const item of items) {
    const kind = groups[item.kind] ? item.kind : "fato";
    groups[kind].push(item);
  }
  return groups;
}

export function investigationText(topic, groups) {
  const titles = {
    faturamento: "Investigação: faturamento",
    clientes: "Investigação: clientes",
    margem: "Investigação: margem",
    estoque: "Investigação: estoque",
    fornecedores: "Investigação: fornecedores",
  };
  const render = (name, list) => list.length ? list.map((item) => `- ${item.title}. ${item.detail}`).join("\n") : "- Nenhum item desta classe nas fontes consultadas.";
  return [
    titles[topic] || "Investigação executiva",
    "Fatos observados e projeções não são apresentados como causa comprovada.",
    "",
    "Fatos observados",
    render("fato", groups.fato),
    "",
    "Correlações",
    render("correlacao", groups.correlacao),
    "",
    "Hipóteses",
    groups.hipotese.length ? groups.hipotese.map((item) => `- Hipótese, não causa comprovada: ${item.detail}`).join("\n") : "- Nenhuma hipótese foi registrada. Correlação não foi convertida em causa.",
    "",
    "Projeções",
    render("projecao", groups.projecao),
  ].join("\n");
}

export function parseSimulationRequest(text) {
  const value = normalize(text);
  const percent = value.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const amount = value.match(/r\$\s*([\d.]+(?:,\d+)?)/);
  const parsedAmount = amount ? Number(amount[1].replaceAll(".", "").replace(",", ".")) : null;
  if (/compare tres cenarios|tres cenarios/.test(value)) return { kind: "cenarios", changedData: false };
  if (/antecipar pagamento/.test(value)) return { kind: "financeiro", amount: Number.isFinite(parsedAmount) ? parsedAmount : null, changedData: false };
  if (/reduzirmos compras|reduzir compras|reduza compras/.test(value)) return { kind: "compras", changedData: false };
  if (/(aumento|aumentar).{0,20}(\d|preco)|nos precos/.test(value))
    return { kind: "precos", percent: percent ? Number(percent[1].replace(",", ".")) : null, changedData: false };
  return { kind: "indefinida", changedData: false };
}

export function detectExecutiveRequest(text, context = {}) {
  const value = normalize(text);
  if (!value) return null;
  if (/\b(todo|toda|todos|todas|sempre que|quando|a cada|diariamente|semanalmente|mensalmente)\b/.test(value)
    && /\b(dia|dias|semana|mes|meses|hora|horas|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(value))
    return null;
  if (/\b(reajuste|tabela)\b/.test(value) && /\b(simule|simular|aplique|aplicar)\b/.test(value)) return null;
  const previous = String(context.previousType || "");
  const inExecutive = previous.startsWith("executivo") || Boolean(context.meetingId);
  const scopeFrom = (fallback = "empresa") => {
    if (/financeiro|caixa/.test(value)) return "financeiro";
    if (/comercial|venda|faturamento|cliente/.test(value)) return "comercial";
    if (/estoque|ruptura/.test(value)) return "estoque";
    if (/compra|fornecedor/.test(value)) return "compras";
    if (/auditoria/.test(value)) return "auditoria";
    if (/margem|rentabilidade|dinheiro/.test(value)) return "rentabilidade";
    return context.scope || fallback;
  };
  if (/\b(confirmo|confirmar|autorizo|pode executar|execute agora)\b/.test(value) && (inExecutive || /plano|acao/.test(value)))
    return { type: "confirmacao_conversa" };
  if (/como (esta|estamos|anda)|situacao da empresa|como esta minha empresa|como estamos hoje/.test(value))
    return { type: "resumo", scope: "empresa" };
  if (/como esta o financeiro|situacao financeira|como esta o caixa/.test(value))
    return { type: "resumo", scope: "financeiro" };
  if (/onde (estamos )?perdendo dinheiro|perdendo dinheiro/.test(value))
    return { type: "resumo", scope: "rentabilidade" };
  if (/quais setores|setores precisam|onde preciso de atencao/.test(value))
    return { type: "setores", scope: "empresa" };
  if (/maiores problemas|o que mais preocupa|problemas da empresa|resolver primeiro|quais sao as prioridades|prioridades recomendadas/.test(value))
    return { type: "prioridades", scope: scopeFrom() };
  if (/oportunidades de crescimento/.test(value))
    return { type: "resumo", scope: "comercial" };
  if (/prepare um plano|montar um plano|monte um plano|plano para (resolver|melhorar)|plano de acao/.test(value))
    return { type: "plano", scope: scopeFrom() };
  if (/organize as tarefas/.test(value))
    return { type: "plano", scope: scopeFrom(), organize: true };
  if (/\bresolva\b/.test(value))
    return { type: "executar_plano", scope: scopeFrom(), authorizeWrites: false };
  if (/comece pelo financeiro/.test(value) && inExecutive)
    return { type: "resumo", scope: "financeiro" };
  if (/faca uma reuniao|fazer uma reuniao|reuniao sobre|reuniao com charlie|reuniao executiva/.test(value))
    return { type: "reuniao", scope: "empresa", topic: String(text).slice(0, 180) };
  if (/por que o faturamento|faturamento caiu|quais clientes contribuiram/.test(value))
    return { type: "investigacao", topic: /cliente/.test(value) ? "clientes" : "faturamento", scope: "comercial" };
  if (/produtos perderam margem|perderam margem/.test(value))
    return { type: "investigacao", topic: "margem", scope: "rentabilidade" };
  if (/risco de falta de estoque|causando o risco de falta|falta de estoque/.test(value))
    return { type: "investigacao", topic: "estoque", scope: "estoque" };
  if (/fornecedores estao atrasando|fornecedor.*atras/.test(value))
    return { type: "investigacao", topic: "fornecedores", scope: "compras" };
  const simulation = parseSimulationRequest(value);
  if (/simule|simulacao|o que acontece se|compare tres cenarios|impacto de antecipar|reduzirmos compras|aumento de \d+/.test(value) && simulation.kind !== "indefinida")
    return { type: "simulacao", scope: "empresa", simulation };
  if (inExecutive && /me mostre os resultados|mostrar os resultados|resultados do plano/.test(value))
    return { type: "resultados", scope: context.scope || "empresa" };
  if (inExecutive && /\b(financeiro|comercial|estoque|compras|auditoria|prioridade|resultado)\b/.test(value))
    return { type: "reuniao_pergunta", scope: scopeFrom(context.scope || "empresa"), topic: value };
  return null;
}

export function cashRiskConditionMet(task) {
  const rows = task?.amostra || task?.linhas || [];
  const text = normalize(task?.resumo);
  const saysNegative = /primeiro saldo negativo|pode ficar negativo|ficara negativo/.test(text) && !/sem saldo negativo|nao fica negativo/.test(text);
  return saysNegative || rows.some((row) => row?.negative === true || Number(row?.balance) < 0 || Number(row?.simulatedBalance) < 0);
}

export function simulationNarrative(request, outcome) {
  if (!outcome) return "A simulação não foi executada. Nenhum dado real foi alterado.";
  if (outcome.blocked) return `${outcome.reason} Nenhum dado real foi alterado.`;
  const assumptions = outcome.assumptions || outcome.result?.assumptions || [];
  return [
    "Simulação sobre o motor já existente. Nenhum lançamento, preço ou pedido foi alterado.",
    `Cenário atual: ${outcome.currentLabel || "conforme a fonte consultada"}.`,
    `Cenário simulado: ${outcome.simulatedLabel || "não calculado"}.`,
    `Premissas: ${assumptions.length ? assumptions.join(" ") : "não informadas pelo motor."}`,
    `Riscos: ${outcome.risks || "A simulação não estima elasticidade nem garante o resultado."}`,
    `Limitações: ${outcome.limitations || "Os componentes ausentes permanecem ausentes."}`,
  ].join("\n");
}
