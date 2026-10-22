import { getAction, userCan } from "./charlie-task-catalog.js";
import { visibleMonitorAlerts, readMonitorSnapshot } from "./charlie-monitor-store.js";
import { listOpportunities, commercialMetrics } from "./charlie-commercial-store.js";
import { listInvestigations } from "./charlie-audit-store.js";
import { valueDashboard } from "./charlie-value-intelligence.js";
import { listPredictions } from "./charlie-prediction-store.js";
import { createKnowledge } from "./charlie-enterprise-knowledge.js";
import {
  EXECUTIVE_ACTIONS,
  buildPlanDraft,
  classifyFindings,
  detectExecutiveRequest,
  indicatorCards,
  investigationText,
  latestUpdate,
  markChanges,
  normalizeCriteria,
  periodLabel,
  prioritize,
  renderExecutiveBriefing,
  signalsFromSources,
  simulationNarrative,
  verifyReading,
} from "./charlie-executive-engine.js";
import {
  activeExecutiveMeeting,
  getExecutivePlan,
  getExecutivePreferences,
  listExecutiveDecisions,
  listExecutivePlans,
  listExecutiveVerifications,
  readExecutiveSnapshot,
  saveExecutiveDecision,
  saveExecutiveMeeting,
  saveExecutivePlan,
  saveExecutivePreferences,
  saveExecutiveSnapshot,
  saveExecutiveVerification,
} from "./charlie-executive-store.js";

const CACHE_TTL = Math.max(15000, Number(process.env.CHARLIE_EXECUTIVE_CACHE_MS) || 120000);
const cache = new Map();
const inflight = new Map();

export function clearExecutiveCache() {
  cache.clear();
  inflight.clear();
}

function assertDirector(actor) {
  if (!actor?.gerencial) throw Object.assign(new Error("O Modo Diretor exige permissão gerencial. A autoridade do Charlie não ultrapassa a do usuário."), { status: 403 });
  return actor;
}

function scopeSignals(signals, scope) {
  if (!scope || scope === "empresa") return signals;
  const area = { financeiro: "financeiro", comercial: "comercial", estoque: "estoque", compras: "compras", auditoria: "auditoria", rentabilidade: "rentabilidade", resultados: "resultados" }[scope];
  if (!area) return signals;
  return signals.filter((item) => item.area === area || item.severity === "critico");
}

function storedPredictionSources(actor) {
  const predictions = listPredictions(actor, 20);
  const latest = (indicator) => predictions.find((item) => item.indicator === indicator);
  const sources = {};
  const cash = latest("fluxo_caixa");
  if (cash?.result) {
    sources.cashFlow = {
      horizon: cash.period?.horizonDays || 30,
      generatedAt: cash.generatedAt,
      quality: cash.quality || { status: "limitada" },
      scenarios: { base: { closingBalance: cash.result.closingBalance, firstNegativeDate: cash.result.firstNegativeDate, projection: [] } },
      fromHistory: true,
    };
  }
  const revenue = latest("faturamento");
  if (revenue?.result) {
    sources.revenue = { ok: true, total: revenue.result.total, interval: revenue.result.interval, model: revenue.model, quality: revenue.quality, horizon: revenue.period?.horizonDays, generatedAt: revenue.generatedAt, fromHistory: true };
  }
  return sources;
}

export function collectStoredSources(actor = {}) {
  const snapshot = readMonitorSnapshot();
  let results = null;
  try { results = valueDashboard(actor, {}); } catch (error) { results = { error: error.message }; }
  return {
    generatedAt: new Date().toISOString(),
    limitations: results?.error ? [`Resultados do Charlie: ${results.error}`] : [],
    alerts: visibleMonitorAlerts(actor.id),
    alertsUpdatedAt: snapshot?.analisadoEm || snapshot?.analyzedAt || null,
    opportunities: listOpportunities(actor, { limit: 30 }),
    commercialMetrics: commercialMetrics(actor),
    investigations: listInvestigations(actor),
    results: results?.error ? null : results,
    ...storedPredictionSources(actor),
  };
}

function compose(actor, sources, options = {}) {
  const preferences = options.preferences || getExecutivePreferences(actor) || {};
  const criteria = normalizeCriteria(preferences.criteria || {});
  const built = signalsFromSources(sources, preferences);
  const scoped = scopeSignals(built.signals, options.scope);
  const previous = readExecutiveSnapshot(actor, options.scope || "empresa");
  const ranked = markChanges(prioritize(scoped, criteria), previous?.signals || []);
  const problems = ranked.filter((item) => item.severity === "critico" || item.severity === "atencao");
  const changedProblems = options.changesOnly ? problems.filter((item) => item.changed) : problems;
  const priorities = (changedProblems.length || !options.changesOnly ? changedProblems : problems).slice(0, options.limit || 5);
  const cards = indicatorCards(ranked, preferences.favoriteIndicators || []);
  const actions = priorities.filter((item) => item.actionKey && EXECUTIVE_ACTIONS[item.actionKey]).map((item) => {
    const template = EXECUTIVE_ACTIONS[item.actionKey];
    const action = getAction(template.actionId);
    const allowed = action && userCan(action, actor, "preparar");
    return {
      label: allowed ? `Posso preparar: ${action.nome}` : `Ação indisponível para o seu perfil: ${template.actionId}`,
      note: allowed
        ? "A preparação usa o executor existente e não altera dados empresariais. Confirmação continua obrigatória antes de qualquer gravação."
        : "Nada foi preparado.",
      actionId: allowed ? template.actionId : null,
    };
  });
  const model = {
    period: periodLabel(sources),
    updatedAt: latestUpdate(ranked),
    scope: options.scope || "empresa",
    critical: ranked.filter((item) => item.severity === "critico"),
    attention: ranked.filter((item) => item.severity === "atencao"),
    opportunities: ranked.filter((item) => item.severity === "oportunidade"),
    priorities,
    indicators: cards,
    actions,
    limitations: [...built.limitations, criteria.mandatory],
    changesOnly: Boolean(options.changesOnly),
    changedCount: ranked.filter((item) => item.changed).length,
    criteria,
  };
  const briefing = { ...model, text: renderExecutiveBriefing(model), generatedAt: new Date().toISOString() };
  saveExecutiveSnapshot(actor, briefing.scope, briefing);
  return briefing;
}

async function cachedBriefing(actor, options) {
  const key = `${actor.company || 0}:${actor.branch || 0}:${actor.id}:${options.scope || "empresa"}:${options.changesOnly ? "delta" : "full"}`;
  if (!options.force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return structuredClone(hit.value);
    if (inflight.has(key)) return inflight.get(key);
  }
  const run = (async () => {
    const stored = collectStoredSources(actor);
    const live = options.sources || {};
    if (options.loadLive && options.live !== false) {
      try {
        const loaded = await options.loadLive(options.scope || "empresa");
        Object.assign(live, loaded || {});
      } catch (error) {
        stored.limitations.push(`Consulta ao banco indisponível: ${error.message}`);
      }
    }
    const sources = { ...stored, ...live, limitations: [...(stored.limitations || []), ...(live.limitations || [])] };
    if (live.cashFlow) delete sources.fromHistory;
    const briefing = compose(actor, sources, { ...options, preferences: getExecutivePreferences(actor) });
    cache.set(key, { at: Date.now(), value: briefing });
    return structuredClone(briefing);
  })();
  inflight.set(key, run);
  try { return await run; }
  finally { inflight.delete(key); }
}

export async function buildExecutiveBriefing(actor, options = {}) {
  assertDirector(actor);
  return cachedBriefing(actor, options);
}

export function createExecutivePlan(actor, briefing, deps = {}) {
  assertDirector(actor);
  const draft = buildPlanDraft(briefing.priorities || [], actor);
  draft.actions = draft.actions.map((action) => {
    const catalog = getAction(action.actionId);
    const allowed = catalog && userCan(catalog, actor, "preparar") && catalog.nivel < 3 && catalog.habilitada;
    return { ...action, executable: Boolean(allowed), blockedReason: allowed ? null : "Ação fora do catálogo autorizado ou sem permissão." };
  });
  draft.company = actor.company || null;
  draft.branch = actor.branch || null;
  draft.fingerprint = draft.actions.map((action) => action.actionId).join("|") || "vazio";
  const recent = listExecutivePlans(actor).find((plan) => plan.fingerprint === draft.fingerprint && plan.company === draft.company && ["aguardando_aprovacao", "planejado"].includes(plan.status) && Date.now() - Date.parse(plan.createdAt) < 10 * 60 * 1000);
  if (recent) return recent;
  return saveExecutivePlan(draft, deps.store ? deps : {});
}

export async function approveExecutivePlan(id, actor, body = {}, hooks = {}) {
  assertDirector(actor);
  if (body.confirmado !== true) throw Object.assign(new Error("A confirmação precisa ser explícita. O pedido genérico para resolver não autoriza a preparação."), { status: 400 });
  const plan = getExecutivePlan(id, actor);
  if (!plan) throw Object.assign(new Error("Plano não encontrado no escopo atual."), { status: 404 });
  const selected = new Set((body.acoes || []).map(String));
  if (!selected.size) throw Object.assign(new Error("Selecione ao menos uma ação do plano."), { status: 400 });
  const prepared = [];
  for (const action of plan.actions) {
    if (!selected.has(action.id)) continue;
    if (action.taskId) { prepared.push({ ...action, alreadyPrepared: true }); continue; }
    if (!action.executable || action.requiresDataChange) {
      action.status = "aguardando_confirmacao";
      action.note = "Esta ação não foi preparada porque alteraria dados ou não está autorizada.";
      continue;
    }
    const catalog = getAction(action.actionId);
    if (!catalog || catalog.nivel >= 3 || !userCan(catalog, actor, "preparar")) {
      action.status = "bloqueada";
      action.note = "Permissão ou catálogo não autorizam esta ação.";
      continue;
    }
    if (!hooks.prepareTask) throw Object.assign(new Error("O executor existente não está disponível nesta operação."), { status: 503 });
    const result = await hooks.prepareTask({ tipo: "executar", acao: action.actionId, parametros: action.params, interpretador: "executivo" });
    action.taskId = result?.tarefa?.id || null;
    action.status = result?.tarefa?.status === "aguardando_confirmacao" ? "aguardando_confirmacao" : "preparada";
    action.note = result?.resposta || "Preparação encaminhada ao executor existente.";
    prepared.push(action);
  }
  const anyPrepared = plan.actions.some((action) => ["preparada", "aguardando_confirmacao"].includes(action.status));
  plan.status = anyPrepared ? "em_execucao" : plan.status;
  plan.history.push({ at: new Date().toISOString(), action: "preparacao", userId: Number(actor.id), note: "Tarefas preparadas não concluem o plano." });
  const saved = saveExecutivePlan(plan);
  return { plan: saved, prepared, message: "As ações selecionadas foram preparadas no executor existente. O plano não foi marcado como concluído." };
}

export async function verifyExecutiveAction(planId, actor, body = {}, hooks = {}) {
  assertDirector(actor);
  const plan = getExecutivePlan(planId, actor);
  if (!plan) throw Object.assign(new Error("Plano não encontrado no escopo atual."), { status: 404 });
  const action = plan.actions.find((item) => item.id === body.acaoId) || plan.actions.find((item) => item.indicator === body.indicador);
  if (!action) throw Object.assign(new Error("Ação não encontrada neste plano."), { status: 404 });
  let current = body.leitura || null;
  if (!current && hooks.reread) current = await hooks.reread(action);
  const outcome = verifyReading(action.baseline, current);
  const verification = saveExecutiveVerification({
    planId: plan.id,
    actionId: action.id,
    indicator: action.indicator,
    before: action.baseline || null,
    after: current || null,
    outcome,
    provenSaving: false,
    company: actor.company || null,
    branch: actor.branch || null,
    userId: Number(actor.id),
  });
  action.lastVerification = verification.id;
  action.verificationStatus = outcome.status;
  plan.history.push({ at: new Date().toISOString(), action: "verificacao", userId: Number(actor.id), note: outcome.message });
  saveExecutivePlan(plan);
  return { plan: getExecutivePlan(plan.id, actor), verification, message: outcome.message };
}

export function updateExecutivePlanStatus(id, actor, status, note = "") {
  assertDirector(actor);
  const plan = getExecutivePlan(id, actor);
  if (!plan) throw Object.assign(new Error("Plano não encontrado no escopo atual."), { status: 404 });
  if (status === "concluido") {
    const verified = plan.actions.every((action) => ["melhorou", "inalterado", "piorou"].includes(action.verificationStatus));
    if (!verified || !plan.actions.length) throw Object.assign(new Error("O plano não pode ser concluído apenas porque as tarefas foram criadas. Falta verificação dos indicadores."), { status: 409 });
  }
  if (status === "parcialmente_concluido" && !plan.actions.some((action) => action.verificationStatus))
    throw Object.assign(new Error("A conclusão parcial exige ao menos uma verificação de indicador."), { status: 409 });
  plan.history.push({ at: new Date().toISOString(), from: plan.status, to: status, userId: Number(actor.id), note: String(note || "").slice(0, 300) });
  plan.status = status;
  return saveExecutivePlan(plan);
}

function meetingSections(briefing) {
  const byArea = (area) => [...(briefing.critical || []), ...(briefing.attention || []), ...(briefing.opportunities || [])].filter((item) => item.area === area);
  return {
    financeiro: byArea("financeiro"),
    comercial: byArea("comercial"),
    estoque: byArea("estoque"),
    compras: byArea("compras"),
    auditoria: byArea("auditoria"),
    plano: briefing.priorities || [],
  };
}

export async function startExecutiveMeeting(actor, topic, context, options = {}) {
  const briefing = await buildExecutiveBriefing(actor, options);
  const sections = meetingSections(briefing);
  const text = [
    "REUNIÃO COM CHARLIE",
    `Tema: ${topic || "situação da empresa"}`,
    `Período analisado: ${briefing.period}`,
    "",
    "Financeiro",
    sections.financeiro.map((item) => `- ${item.title}. ${item.detail}`).join("\n") || "- Sem indicador financeiro nesta leitura.",
    "",
    "Comercial",
    sections.comercial.map((item) => `- ${item.title}. ${item.detail}`).join("\n") || "- Sem indicador comercial nesta leitura.",
    "",
    "Estoque",
    sections.estoque.map((item) => `- ${item.title}. ${item.detail}`).join("\n") || "- Sem indicador de estoque nesta leitura.",
    "",
    "Compras",
    sections.compras.map((item) => `- ${item.title}. ${item.detail}`).join("\n") || "- Sem indicador de compras nesta leitura.",
    "",
    "Auditoria",
    sections.auditoria.map((item) => `- ${item.title}. ${item.detail}`).join("\n") || "- Nenhuma investigação pendente visível.",
    "",
    "Plano de ação",
    sections.plano.map((item, index) => `- Prioridade ${index + 1}: ${item.title}. Responsável: não atribuído.`).join("\n") || "- Nenhum problema priorizado.",
    "",
    "Você pode interromper e perguntar sobre qualquer área. O contexto desta reunião fica preservado.",
  ].join("\n");
  const meeting = saveExecutiveMeeting({
    company: actor.company || null,
    branch: actor.branch || null,
    userId: Number(actor.id),
    conversationId: context.conversationId || null,
    topic: topic || "situação da empresa",
    status: "em_andamento",
    startedAt: new Date().toISOString(),
    snapshotGeneratedAt: briefing.generatedAt,
    sections,
    questions: [],
    briefing,
  });
  return { meeting, resposta: text, briefing };
}

export function recordExecutiveDecision(actor, input = {}) {
  assertDirector(actor);
  if (input.formal !== true) throw Object.assign(new Error("Conversa informal não é registrada como decisão nem vira política oficial."), { status: 400 });
  const justification = String(input.justification || "").trim();
  const context = String(input.context || "").trim();
  if (justification.length < 10 || context.length < 5) throw Object.assign(new Error("Informe contexto e justificativa da decisão formal."), { status: 400 });
  const knowledge = createKnowledge({
    title: String(input.title || "Decisão executiva").slice(0, 180),
    category: "Administrativo",
    description: "Decisão formal registrada pelo Modo Diretor. Permanece como rascunho até aprovação no fluxo de memória.",
    content: `Contexto: ${context}\nEscopo: ${input.scope || "não informado"}\nSituação: ${input.status || "registrada"}\nJustificativa: ${justification}`,
    type: "decisao",
    scope: String(input.scope || "").slice(0, 500),
    responsible: actor.name || String(actor.id),
    permissions: { public: false, companies: actor.company ? [String(actor.company)] : [], branches: actor.branch ? [String(actor.branch)] : [] },
  }, actor);
  return saveExecutiveDecision({
    userId: Number(actor.id),
    company: actor.company || null,
    branch: actor.branch || null,
    context,
    responsible: actor.name || String(actor.id),
    scope: input.scope || null,
    status: input.status || "registrada",
    justification,
    knowledgeId: knowledge.id,
    officialPolicy: false,
  });
}

function resultOf(type, resposta, extra = {}) {
  return {
    resposta,
    intencao: { type, interpretador: "regras" },
    dados: extra.dados || [],
    origem: "consolidacao",
    sugestoes: extra.sugestoes || [],
    executivo: extra.executivo || null,
    plano: extra.plano || null,
    reuniao: extra.reuniao || null,
    simulacao: extra.simulacao || null,
  };
}

function priorityRows(briefing) {
  return (briefing.priorities || []).map((item, index) => ({
    PRIORIDADE: index + 1,
    AREA: item.area,
    SITUACAO: item.title,
    PONTUACAO: item.score,
    FONTE: item.source?.service || "",
    ATUALIZADO_EM: item.source?.updatedAt || "",
  }));
}

export async function answerExecutiveQuestion(question, actor, context = {}, hooks = {}) {
  const meeting = context.conversationId ? activeExecutiveMeeting(actor, context.conversationId) : null;
  const detected = detectExecutiveRequest(question, { ...context, meetingId: meeting?.id || context.meetingId });
  if (!detected) return null;
  if (!actor?.gerencial) {
    return resultOf("executivo_permissao", "O Modo Diretor exige permissão gerencial. Nenhuma consulta executiva foi feita e nenhum dado foi alterado.");
  }
  if (detected.type === "confirmacao_conversa") {
    return resultOf("executivo_confirmacao", "A confirmação precisa ser feita no botão do plano ou da tarefa. Uma frase na conversa não autoriza preparar nem alterar dados.");
  }
  const options = { scope: detected.scope, loadLive: hooks.loadLive, live: hooks.live !== false, force: Boolean(hooks.force), sources: hooks.sources };
  if (detected.type === "prioridades") {
    const briefing = await buildExecutiveBriefing(actor, options);
    const text = briefing.priorities.length
      ? briefing.priorities.map((item, index) => `Prioridade ${index + 1}: ${item.title}. Pontuação ${item.score}. ${item.reasons.join(". ")}.`).join("\n")
      : "Não há problema priorizado nas fontes autorizadas.";
    return resultOf("executivo_prioridades", text, { dados: priorityRows(briefing), executivo: briefing, sugestoes: ["Prepare um plano para resolver os problemas mais urgentes"] });
  }
  if (detected.type === "plano" || detected.type === "executar_plano") {
    const briefing = await buildExecutiveBriefing(actor, options);
    const plan = createExecutivePlan(actor, briefing);
    const intro = detected.type === "executar_plano"
      ? "Preparei o plano, mas o pedido para resolver não autoriza alteração. Nada foi executado. Escolha uma ação e confirme no Modo Diretor."
      : "Plano preparado para aprovação. Nenhum responsável foi atribuído e nenhuma tarefa foi criada.";
    return resultOf("executivo_plano", `${intro}\n\n${plan.actions.map((action) => `${action.id}: ${action.objective}. Responsável: não atribuído. Situação: ${action.status}. ${action.premise || ""}`).join("\n") || "Não há ação disponível no catálogo para os problemas encontrados."}`, {
      dados: plan.actions.map((action) => ({ ACAO: action.id, PROBLEMA: action.problem, OBJETIVO: action.objective, RESPONSAVEL: "não atribuído", PRAZO: action.dueNote, SITUACAO: action.status })),
      executivo: briefing,
      plano: plan,
      sugestoes: ["Me mostre os resultados"],
    });
  }
  if (detected.type === "reuniao") {
    const started = await startExecutiveMeeting(actor, detected.topic, context, options);
    return resultOf("executivo_reuniao", started.resposta, { executivo: started.briefing, reuniao: started.meeting, sugestoes: ["O que mais preocupa?", "Comece pelo financeiro"] });
  }
  if (detected.type === "reuniao_pergunta" && meeting) {
    const area = detected.scope;
    const items = meeting.sections?.[area] || meeting.sections?.plano || [];
    const answer = items.length ? items.map((item) => `${item.title}. ${item.detail || item.reasons?.join(". ") || ""}`).join("\n") : "Não há item dessa área no contexto preservado da reunião.";
    meeting.questions.push({ at: new Date().toISOString(), question, answer });
    const saved = saveExecutiveMeeting(meeting);
    return resultOf("executivo_reuniao", answer, { reuniao: saved, executivo: meeting.briefing });
  }
  if (detected.type === "investigacao") {
    const briefing = meeting?.briefing || await buildExecutiveBriefing(actor, options);
    const pool = [...(briefing.critical || []), ...(briefing.attention || []), ...(briefing.opportunities || []), ...(briefing.priorities || [])];
    const related = pool.filter((item) => item.area === detected.scope || (detected.topic === "faturamento" && /fatur|venda|cliente/.test(`${item.area} ${item.title}`)) || (detected.topic === "clientes" && /cliente|comercial/.test(`${item.area} ${item.title}`)));
    const groups = classifyFindings(related.length ? related : pool);
    return resultOf("executivo_investigacao", investigationText(detected.topic, groups), { executivo: briefing, dados: related.map((item) => ({ CLASSE: item.kind, TITULO: item.title, FONTE: item.source?.service || "" })) });
  }
  if (detected.type === "simulacao") {
    const request = detected.simulation;
    let outcome = { blocked: true, reason: "Não identifiquei um cenário compatível com os simuladores existentes.", changedData: false };
    if (request.kind === "precos" && !request.percent) outcome = { blocked: true, reason: "Informe o percentual. Não vou presumir um aumento.", changedData: false };
    else if (request.kind === "precos") outcome = hooks.simulate ? await hooks.simulate(request) : { blocked: true, reason: "O simulador de preços existente não foi chamado porque não há produtos identificados nesta leitura.", changedData: false };
    else if (request.kind === "financeiro" && !request.amount) outcome = { blocked: true, reason: "Informe o valor a antecipar. Não vou presumir um montante.", changedData: false };
    else if (hooks.simulate) outcome = await hooks.simulate(request);
    return resultOf("executivo_simulacao", simulationNarrative(request, outcome), { simulacao: { ...request, ...outcome, changedData: false }, sugestoes: ["Como está minha empresa hoje?"] });
  }
  if (detected.type === "resultados") {
    const plans = listExecutivePlans(actor);
    const lines = plans.slice(0, 5).map((plan) => `${plan.objective}. Situação: ${plan.status}. Verificações: ${listExecutiveVerifications(plan.id, actor).length}.`);
    const results = valueDashboard(actor, {});
    const proven = results.totals?.proven_saving;
    return resultOf("executivo_resultados", `${lines.join("\n") || "Não há plano executivo neste escopo."}\n\nEconomia comprovada validada: ${proven?.validated ? `${proven.validated} registro(s).` : "nenhuma no recorte."} Estimativas não foram somadas como lucro.`, { dados: plans.slice(0, 10).map((plan) => ({ PLANO: plan.objective, SITUACAO: plan.status, CRIADO_EM: plan.createdAt })) });
  }
  if (detected.type === "setores") {
    const briefing = await buildExecutiveBriefing(actor, { ...options, scope: "empresa" });
    const areas = ["financeiro", "comercial", "estoque", "compras", "auditoria", "rentabilidade"];
    const text = areas.map((area) => {
      const items = [...briefing.critical, ...briefing.attention].filter((item) => item.area === area);
      return items.length ? `${area}: ${items.map((item) => item.title).join("; ")}` : `${area}: sem ocorrência nas fontes desta leitura.`;
    }).join("\n");
    return resultOf("executivo_setores", text, { executivo: briefing, dados: priorityRows(briefing) });
  }
  const briefing = await buildExecutiveBriefing(actor, options);
  return resultOf("executivo_resumo", briefing.text, {
    dados: priorityRows(briefing),
    executivo: briefing,
    sugestoes: ["Quais são as prioridades?", "Prepare um plano para resolver os problemas mais urgentes", "Faça uma reunião sobre os resultados deste mês"],
  });
}

export function saveDirectorPreferences(actor, input = {}) {
  assertDirector(actor);
  const criteria = input.criteria ? normalizeCriteria(input.criteria) : undefined;
  const saved = saveExecutivePreferences(actor, { ...input, criteria });
  clearExecutiveCache();
  return { preferences: saved, note: "Preferências alteram a apresentação. Não alteram regras obrigatórias, permissões nem dados do ERP." };
}

export { assertDirector, listExecutivePlans, getExecutivePlan, listExecutiveDecisions, listExecutiveVerifications, getExecutivePreferences, activeExecutiveMeeting };
