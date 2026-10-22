import crypto from "node:crypto";

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 2) => Number(n(value).toFixed(digits));
const hour = (value) => new Date(value).getUTCHours();
const weekday = (value) => new Date(value).getUTCDay();
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return null; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const percentile = (values, ratio) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] : null; };

export function comparableGroup(event = {}) {
  return [event.company || "empresa_desconhecida", event.branch || "filial_desconhecida", event.actor?.sector || "setor_desconhecido", event.actor?.profile || "perfil_desconhecido", event.type || "tipo_desconhecido", weekday(event.occurredAt)].join("|");
}

function magnitude(event) {
  if (event.type === "price_change") {
    const before = n(event.previous?.price), after = n(event.next?.price);
    return before ? Math.abs((after - before) / before * 100) : 0;
  }
  if (event.type === "discount") return Math.abs(n(event.next?.discountPercent));
  if (event.type === "cancellation" || event.type === "financial_reversal") return Math.abs(n(event.next?.amount));
  if (event.type === "stock_movement") return Math.abs(n(event.next?.quantity));
  return 1;
}

export function buildBehavioralBaselines(events = [], options = {}) {
  const minimum = Math.max(5, Number(options.minimumSamples) || 8);
  const buckets = new Map();
  for (const event of events) {
    const key = comparableGroup(event);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  }
  return [...buckets].map(([key, items]) => {
    const values = items.map(magnitude), center = median(values);
    const deviations = values.map((value) => Math.abs(value - center));
    const hours = items.map((item) => hour(item.occurredAt));
    return {
      key, samples: items.length, sufficient: items.length >= minimum,
      median: round(center), mad: round(median(deviations)), p90: round(percentile(values, 0.9)),
      hourly: Object.fromEntries([...new Set(hours)].map((h) => [h, hours.filter((value) => value === h).length])),
      typicalHours: [...new Set(hours)].filter((h) => hours.filter((value) => value === h).length / items.length >= 0.1),
      eventType: items[0]?.type, sector: items[0]?.actor?.sector || null, profile: items[0]?.actor?.profile || null,
      from: items.map((x) => x.occurredAt).sort()[0], to: items.map((x) => x.occurredAt).sort().at(-1),
      model: "mediana_mad_percentil", version: "1.0.0",
    };
  });
}

export function robustBehavioralScore(event, baseline, options = {}) {
  if (!baseline?.sufficient) return { evaluable: false, reason: "historico_insuficiente", samples: baseline?.samples || 0 };
  const value = magnitude(event), mad = n(baseline.mad);
  const score = mad > 0 ? 0.6745 * (value - n(baseline.median)) / mad : value > n(baseline.p90) ? 4 : 0;
  const unusualHour = baseline.typicalHours.length > 0 && !baseline.typicalHours.includes(hour(event.occurredAt));
  const threshold = Number(options.scoreThreshold) || 3.5;
  return { evaluable: true, value: round(value), score: round(score), threshold, unusualHour, anomalous: score >= threshold || value > n(baseline.p90) * (Number(options.percentileMultiplier) || 1.5), method: baseline.model, samples: baseline.samples };
}

export function detectBurst(events = [], current, options = {}) {
  const windowMinutes = Math.max(5, Number(options.windowMinutes) || 30), threshold = Math.max(2, Number(options.countThreshold) || 5);
  const currentTime = Date.parse(current.occurredAt), actor = current.actor?.id;
  const related = events.filter((event) => event.type === current.type && (!actor || event.actor?.id === actor) && currentTime - Date.parse(event.occurredAt) >= 0 && currentTime - Date.parse(event.occurredAt) <= windowMinutes * 60000);
  return { detected: related.length >= threshold, count: related.length, threshold, windowMinutes, eventIds: related.map((event) => event.id) };
}

const SEQUENCES = [
  { id: "price-sale-restore", steps: ["price_change", "sale", "price_change"], maximumMinutes: 240, same: ["recordId"] },
  { id: "bank-payment", steps: ["bank_data_change", "payment_preparation"], maximumMinutes: 1440, same: ["recordId"] },
  { id: "limit-order", steps: ["commercial_limit_change", "sale_order"], maximumMinutes: 1440, same: ["recordId"] },
  { id: "stock-cancel", steps: ["stock_movement", "movement_cancellation"], maximumMinutes: 240, same: ["recordId"] },
];

export function correlateEventSequences(events = [], definitions = SEQUENCES) {
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)), matches = [];
  for (const definition of definitions) {
    for (let start = 0; start < sorted.length; start += 1) {
      if (sorted[start].type !== definition.steps[0]) continue;
      const chain = [sorted[start]];
      for (let step = 1; step < definition.steps.length; step += 1) {
        const previous = chain.at(-1);
        const found = sorted.find((event) => Date.parse(event.occurredAt) >= Date.parse(previous.occurredAt) && Date.parse(event.occurredAt) - Date.parse(chain[0].occurredAt) <= definition.maximumMinutes * 60000 && event.type === definition.steps[step] && definition.same.every((field) => String(event[field] || "") === String(chain[0][field] || "")));
        if (!found) break;
        chain.push(found);
      }
      if (chain.length === definition.steps.length) matches.push({ definitionId: definition.id, eventIds: chain.map((event) => event.id), events: chain, maximumMinutes: definition.maximumMinutes, relationship: "mesma_entidade_e_janela_temporal", causalClaim: false });
    }
  }
  return [...new Map(matches.map((match) => [`${match.definitionId}:${match.eventIds.join(":")}`, match])).values()];
}

export function classifyBehavioralRisk({ anomaly, burst, sequence, authorization, amount = 0, evidenceQuality = "adequada" } = {}, options = {}) {
  let signals = 0;
  if (anomaly?.anomalous) signals += 2;
  if (burst?.detected) signals += 2;
  if (sequence) signals += 2;
  if (!authorization) signals += 1;
  if (n(amount) >= n(options.highValueThreshold || 10000)) signals += 1;
  if (evidenceQuality !== "adequada") signals = Math.max(0, signals - 2);
  const level = signals >= 6 ? "elevado" : signals >= 3 ? "moderado" : "baixo";
  return { level, signals, label: "prioridade_de_investigacao", probability: null, evidenceQuality };
}

export function authorizedContext(event, contexts = []) {
  return contexts.find((context) => context.verified === true && context.type === event.type && Date.parse(event.occurredAt) >= Date.parse(context.from) && Date.parse(event.occurredAt) <= Date.parse(context.to) && (!context.entity || context.entity === event.entity)) || null;
}

const OPERATION = {
  price_change: { one: "alteração de preço", many: "alterações de preço", subject: "Preços" },
  discount: { one: "desconto", many: "descontos", subject: "Descontos" },
  stock_movement: { one: "movimentação de estoque", many: "movimentações de estoque", subject: "Estoque" },
  cancellation: { one: "cancelamento", many: "cancelamentos", subject: "Cancelamentos" },
  financial_reversal: { one: "estorno", many: "estornos", subject: "Financeiro" },
  sale: { one: "venda", many: "vendas", subject: "Vendas" },
  bank_data_change: { one: "alteração de dados bancários", many: "alterações de dados bancários", subject: "Cadastro" },
  payment_preparation: { one: "preparação de pagamento", many: "preparações de pagamento", subject: "Pagamentos" },
  commercial_limit_change: { one: "alteração de limite", many: "alterações de limite", subject: "Comercial" },
  sale_order: { one: "pedido", many: "pedidos", subject: "Comercial" },
  movement_cancellation: { one: "cancelamento de movimento", many: "cancelamentos de movimento", subject: "Estoque" },
};
const SEQUENCE_TEXT = {
  "price-sale-restore": { title: "Preço mudou, houve venda e o preço mudou de novo", text: (minutes) => `No mesmo item, o preço foi alterado, houve uma venda e o preço foi alterado outra vez, em até ${minutes} minutos.` },
  "bank-payment": { title: "Dados bancários alterados e pagamento em seguida", text: (minutes) => `No mesmo cadastro, os dados bancários mudaram e depois houve preparação de pagamento, em até ${minutes} minutos.` },
  "limit-order": { title: "Limite alterado e pedido em seguida", text: (minutes) => `No mesmo cadastro, o limite comercial mudou e depois entrou um pedido, em até ${minutes} minutos.` },
  "stock-cancel": { title: "Estoque movimentado e cancelado em seguida", text: (minutes) => `No mesmo registro, houve movimentação de estoque e depois um cancelamento, em até ${minutes} minutos.` },
};

function operation(type) {
  return OPERATION[type] || { one: "operação", many: "operações", subject: "Auditoria" };
}
function formatPct(value) {
  const rounded = round(value, 1);
  return `${Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",")}%`;
}
function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const [whole, frac] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "-" : ""}R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}
function pricePercent(event) {
  const before = n(event.previous?.price), after = n(event.next?.price);
  return before ? round(Math.abs((after - before) / before * 100), 1) : null;
}
function personName(event) {
  if (event.actor?.name) return event.actor.name;
  if (event.actor?.id) return `usuário ${event.actor.id}`;
  return "";
}
function byPhrase(events) {
  const names = [...new Set(events.map(personName).filter(Boolean))];
  if (!names.length) return "";
  if (names.length === 1 && names[0].startsWith("usuário ")) return `, pelo ${names[0]}`;
  if (names.length === 1) return `, por ${names[0]}`;
  if (names.length === 2) return `, por ${names[0]} e ${names[1]}`;
  return `, por ${names.slice(0, 3).join(", ")}`;
}
function peoplePhrase(events, plural) {
  const names = [...new Set(events.map(personName).filter(Boolean))];
  if (!names.length) return "";
  const verb = plural ? "feitas" : "feita";
  if (names.length === 1 && names[0].startsWith("usuário ")) return `, ${verb} pelo ${names[0]}`;
  if (names.length === 1) return `, ${verb} por ${names[0]}`;
  if (names.length === 2) return `, ${verb} por ${names[0]} e ${names[1]}`;
  return `, ${verb} por ${names.slice(0, 3).join(", ")}`;
}
function durationPhrase(events) {
  const times = events.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);
  if (times.length < 2) return "no mesmo minuto";
  const minutes = Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 60000));
  if (minutes <= 1) return minutes === 0 ? "no mesmo minuto" : "em 1 minuto";
  if (minutes < 60) return `em ${minutes} minutos`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return hours === 1 ? "em cerca de 1 hora" : `em cerca de ${hours} horas`;
}
function authorizationPhrase(events) {
  if (!events.some((event) => event.authorization?.id)) return "";
  const explicit = events.every((event) => !event.authorization?.id || event.authorization?.type === "confirmacao_explicita");
  return explicit ? "Elas saíram de uma confirmação já registrada no Charlie." : "Há autorização vinculada a essas operações.";
}

export function codigoENome(codigo, nome) {
  const code = String(codigo ?? "").trim();
  const name = String(nome ?? "").replace(/\s+/g, " ").trim();
  if (!code) return name;
  if (!name || name === code) return code;
  if (name.startsWith(`${code} - `) || name.startsWith(`${code} – `)) return name;
  return `${code} - ${name}`;
}

function priceParts(event = {}) {
  const [produto, tabela, unidade] = String(event.recordId || "").split(":");
  const name = event.productName || event.next?.productName || "";
  return { product: produto ? codigoENome(produto, name) : "", tabela: tabela || "", unidade: unidade || "" };
}

export function describeAuditEvent(event = {}) {
  const who = personName(event);
  if (event.type === "price_change") {
    const { product, tabela, unidade } = priceParts(event);
    const where = [product ? `Produto ${product}` : "", tabela ? `tabela ${tabela}` : "", unidade || ""].filter(Boolean).join(", ");
    const from = money(event.previous?.price), to = money(event.next?.price);
    const percent = pricePercent(event);
    const change = from && to ? `: de ${from} para ${to}${percent != null ? ` (${formatPct(percent)})` : ""}` : "";
    return `${where || "Preço"}${change}${who ? ` · ${who}` : ""}`;
  }
  const id = event.recordId ? `registro ${event.recordId}` : (event.entity || "registro");
  return `${operation(event.type).one} · ${id}${who ? ` · ${who}` : ""}`;
}

function priceWhere(event) {
  const { product, tabela, unidade } = priceParts(event);
  return [product ? `produto ${product}` : "", tabela ? `tabela ${tabela}` : "", unidade || ""].filter(Boolean).join(", ");
}
function priceSentence(event) {
  const where = priceWhere(event);
  const from = money(event.previous?.price), to = money(event.next?.price);
  const percent = pricePercent(event);
  if (from && to) return `O preço do ${where || "item"} passou de ${from} para ${to}${percent != null ? ` (${formatPct(percent)})` : ""}`;
  return `O preço do ${where || "item"} foi alterado`;
}
function changeKey(event) {
  if (event.type === "price_change") return `price:${event.recordId}|${event.previous?.price}|${event.next?.price}`;
  return `${event.type}:${event.recordId}|${event.occurredAt}`;
}
function groupEvents(events) {
  const groups = new Map();
  for (const event of events) {
    const key = changeKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.values()];
}
function recordRow(group) {
  const event = group[0];
  const who = personName(event);
  const times = group.length > 1 ? ` · ${group.length} vezes` : "";
  const name = describeAuditEvent({ ...event, actor: null });
  return { CODIGO: event.recordId || "", NOME: `${name}${times}${who ? ` · ${who}` : ""}`, QUANDO: group.at(-1)?.occurredAt || null, QUEM: who };
}

export function behavioralSignature(alert = {}) {
  const events = alert.evidencias?.auditCategory === "riscos_comportamentais" ? alert.evidencias.events || [] : [];
  if (!events.length) return "";
  return [...new Set(events.map((event) => `${event.type}|${event.recordId}|${event.previous?.price ?? ""}|${event.next?.price ?? ""}|${event.actor?.id || ""}`))].sort().join(";");
}

export function dedupeBehavioralAlerts(alerts = []) {
  const bestId = new Map();
  for (const alert of alerts) {
    const signature = behavioralSignature(alert);
    if (!signature) continue;
    const rank = (item) => (["resolvido", "descartado"].includes(item.situacao) ? 0 : 1_000_000) + (item.evidencias?.events?.length || 0);
    const current = alerts.find((item) => item.id === bestId.get(signature));
    if (!current || rank(alert) >= rank(current)) bestId.set(signature, alert.id);
  }
  return alerts.filter((alert) => {
    const signature = behavioralSignature(alert);
    return !signature || bestId.get(signature) === alert.id;
  });
}

export function explainBehavior({ events = [], criteria = {}, baseline = null } = {}) {
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const type = ordered[0]?.type || baseline?.eventType || criteria.anomaly?.eventType;
  const op = operation(type);
  const anomaly = criteria.anomaly || {};
  const burst = criteria.burst || {};
  const sequence = criteria.sequence || null;
  const knownSequence = sequence?.definitionId ? SEQUENCE_TEXT[sequence.definitionId] : null;
  const groups = groupEvents(ordered);
  const repeatedPrice = type === "price_change" && groups.length === 1 && ordered.length > 1;
  const parts = [];
  let title = "Operação para conferir";
  if (repeatedPrice) {
    title = "A mesma alteração de preço foi registrada várias vezes";
    parts.push(`${priceSentence(ordered[0])}. Essa mesma alteração foi registrada ${ordered.length} vezes ${durationPhrase(ordered)}${byPhrase(ordered)}.`);
    if (anomaly.anomalous) parts.push(`Esse percentual ficou acima do habitual, que fica em torno de ${formatPct(baseline?.median)} nas ${anomaly.samples} alterações parecidas.`);
    else if (anomaly.evaluable) parts.push(`O percentual está na mesma faixa das ${anomaly.samples} alterações parecidas. O aviso é pela repetição.`);
    else parts.push("O aviso é pela repetição. Ainda há pouco histórico parecido para comparar o percentual.");
  } else if (knownSequence) {
    title = knownSequence.title;
    parts.push(knownSequence.text(sequence.maximumMinutes || 0));
  } else if (burst.detected) {
    title = type === "price_change" ? "Várias alterações de preço em seguida" : `Várias ${op.many} em seguida`;
    parts.push(`Houve ${burst.count} ${op.many} ${durationPhrase(ordered)}${peoplePhrase(ordered, true)}.`);
    if (anomaly.anomalous) parts.push(`O tamanho ficou em ${formatPct(anomaly.value)}. Nas ${anomaly.samples} operações parecidas, o habitual fica em torno de ${formatPct(baseline?.median)}.`);
    else if (anomaly.evaluable) parts.push(`O tamanho de cada uma ficou em cerca de ${formatPct(anomaly.value)}, na mesma faixa das ${anomaly.samples} operações parecidas. O aviso é pela quantidade seguida.`);
    else parts.push("O aviso é pela quantidade seguida. Ainda há pouco histórico parecido para comparar o tamanho.");
  } else if (anomaly.anomalous) {
    title = type === "price_change" ? "Alteração de preço fora do habitual" : `${op.one.charAt(0).toUpperCase()}${op.one.slice(1)} fora do habitual`;
    parts.push(`Esta ${op.one} ficou em ${formatPct(anomaly.value)}${peoplePhrase(ordered, false)}. Nas ${anomaly.samples} operações parecidas, o habitual fica em torno de ${formatPct(baseline?.median)}.`);
  } else if (!anomaly.evaluable) {
    title = `${op.one.charAt(0).toUpperCase()}${op.one.slice(1)} para conferir`;
    parts.push(`Esta ${op.one} foi destacada por um sinal objetivo${peoplePhrase(ordered, false)}. Ainda há pouco histórico parecido para comparar o tamanho.`);
  }
  const authorization = authorizationPhrase(ordered);
  if (authorization) parts.push(repeatedPrice && authorization.startsWith("Elas") ? "Isso saiu de uma confirmação já registrada no Charlie." : authorization);
  const knownProfile = ordered.some((event) => event.actor?.sector || event.actor?.profile);
  if (anomaly.unusualHour && knownProfile) parts.push("O horário também foge do que esse perfil costuma operar.");
  if (groups.length > 8) parts.push(`A lista mostra 8 de ${groups.length}.`);
  parts.push("Isso pede conferência e não prova fraude.");
  const recommendation = knownSequence?.title === SEQUENCE_TEXT["price-sale-restore"].title
    ? "Confira o preço usado na venda do meio e as duas alterações do mesmo item."
    : sequence?.definitionId === "bank-payment"
      ? "Confira se a alteração cadastral e o pagamento seguinte foram autorizados."
      : sequence?.definitionId === "limit-order"
        ? "Confira se o limite novo autorizava o pedido que entrou em seguida."
        : sequence?.definitionId === "stock-cancel"
          ? "Confira o movimento e o cancelamento no mesmo registro."
          : repeatedPrice
            ? "Confira se essa gravação deveria ter acontecido uma vez só. O preço novo está descrito acima."
            : type === "price_change" && ordered.some((event) => event.authorization?.id)
            ? "Veja na lista se os preços novos estão corretos."
            : type === "price_change"
              ? "Confira quem fez, se havia autorização e se os preços novos estão corretos."
              : burst.detected
                ? "Confira quem fez essas operações e se havia autorização para o conjunto."
                : "Confira a autorização e se o valor novo está de acordo com a rotina da empresa.";
  return {
    title, subject: op.subject, explanation: parts.join(" "), recommendation,
    registros: groups.slice(0, 8).map(recordRow),
  };
}

export function presentBehavioralAlert(alert = {}) {
  const evidence = alert.evidencias;
  if (evidence?.auditCategory !== "riscos_comportamentais") return alert;
  const text = explainBehavior({ events: evidence.events || [], criteria: evidence.criteria || {}, baseline: evidence.baseline || null });
  return { ...alert, titulo: text.title, descricao: text.explanation, recomendacao: text.recommendation, assunto: text.subject, registros: text.registros.length ? text.registros : alert.registros };
}

export function analyzeBehavioralEvents(events = [], options = {}) {
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const baselineEvents = sorted.filter((event) => !event.analysisTarget), targets = sorted.filter((event) => event.analysisTarget);
  const baselines = buildBehavioralBaselines(baselineEvents, options);
  const sequences = correlateEventSequences(sorted);
  const analyses = [];
  for (const event of targets) {
    const baseline = baselines.find((item) => item.key === comparableGroup(event));
    const anomaly = robustBehavioralScore(event, baseline, options);
    const burst = detectBurst(sorted, event, options);
    const sequence = sequences.find((item) => item.eventIds.includes(event.id));
    const authorized = authorizedContext(event, options.authorizedContexts || []);
    if (authorized) continue;
    const risk = classifyBehavioralRisk({ anomaly, burst, sequence, authorization: event.authorization?.id, amount: event.next?.amount ?? event.next?.value, evidenceQuality: anomaly.evaluable ? "adequada" : "insuficiente" }, options);
    if (!anomaly.anomalous && !burst.detected && !sequence) continue;
    const eventIds = [...new Set([event.id, ...(burst.eventIds || []), ...(sequence?.eventIds || [])])];
    const sequenceInfo = sequence ? { definitionId: sequence.definitionId, maximumMinutes: sequence.maximumMinutes, relationship: sequence.relationship, causalClaim: false } : null;
    const criteria = { anomaly, burst, sequence: sequenceInfo };
    const related = sorted.filter((item) => eventIds.includes(item.id));
    const anchor = related.slice().sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || String(a.id).localeCompare(String(b.id)))[0]?.id || event.id;
    const text = explainBehavior({ events: related, criteria, baseline });
    analyses.push({
      id: crypto.createHash("sha256").update(`behavior:${anchor}:${sequence?.definitionId || ""}`).digest("hex"),
      company: event.company || null, branch: event.branch || null,
      title: text.title, subject: text.subject,
      category: event.type, risk, eventIds, period: { from: baseline?.from, to: event.occurredAt },
      criteria, baseline, model: "charlie_behavioral_risk", modelVersion: "1.0.0",
      explanation: text.explanation, recommendation: text.recommendation, registros: text.registros,
      disclaimer: "A classificação indica prioridade de investigação, não prova nem probabilidade de fraude.",
    });
  }
  return { baselines, sequences, analyses };
}

export { magnitude as behavioralMagnitude };
