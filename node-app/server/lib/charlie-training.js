import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { searchEnterpriseKnowledge } from "./charlie-enterprise-knowledge.js";

const FILE = "charlie-training.json";
const STATUS = new Set(["nao_iniciado", "em_andamento", "concluido", "interrompido"]);
const now = () => new Date().toISOString();
const read = () => readJsonConfig(FILE, { progress: [], tutorials: [], preferences: {} });
const write = (state) => writeJsonConfig(FILE, state);

// Catálogo determinístico: seletores são mantidos pelo ERP, nunca produzidos pelo modelo.
export const SCREEN_CATALOG = {
  overview: { module: "Administrativo", title: "Visão geral", description: "Resumo dos principais indicadores do ERP.", controls: [
    { id: "page-title", label: "Título da tela", selector: "[data-charlie-control='page-title']", purpose: "Identifica a área atualmente aberta." },
    { id: "nav-charlie", label: "Charlie", selector: "[data-charlie-control='nav-charlie']", purpose: "Abre o assistente integrado." },
  ] },
  charlie: { module: "Administrativo", title: "Charlie", description: "Consultas, tarefas, alertas, conhecimento e treinamento.", controls: [
    { id: "charlie-composer", label: "Pergunta ao Charlie", selector: "[data-charlie-control='charlie-composer']", purpose: "Digite uma dúvida em linguagem natural." },
    { id: "charlie-send", label: "Enviar", selector: "[data-charlie-control='charlie-send']", purpose: "Envia a pergunta ao Charlie." },
  ] },
  financeiro: { module: "Financeiro", title: "Contas a pagar e receber", description: "Consulta e gestão dos títulos financeiros.", controls: [
    { id: "page-title", label: "Título da tela", selector: "[data-charlie-control='page-title']", purpose: "Confirma que o módulo financeiro está aberto." },
  ] },
  caixa: { module: "Financeiro", title: "Controle de caixa", description: "Indicadores e movimentos de caixa.", controls: [] },
  conciliacao: { module: "Financeiro", title: "Conciliação", description: "Conferência dos movimentos bancários e títulos.", controls: [] },
  dre: { module: "Financeiro", title: "DRE completo", description: "Demonstrativo de resultado e indicadores.", controls: [] },
  fechamento: { module: "Financeiro", title: "Fechamento de carteira", description: "Conferência e fechamento da carteira financeira.", controls: [] },
  fiscal: { module: "Fiscal", title: "Fiscal", description: "Consultas e operações fiscais disponíveis no ERP.", controls: [] },
  compras: { module: "Compras", title: "Compras", description: "Indicadores, fornecedores e necessidades de reposição.", controls: [] },
  clientes: { module: "Comercial", title: "Clientes", description: "Indicadores e consultas relacionadas a clientes.", controls: [] },
  estoque: { module: "Estoque", title: "Estoque", description: "Saldos, movimentações e alertas de estoque.", controls: [] },
};

export const BUILTIN_TUTORIALS = [
  { id: "financeiro-consultar-titulos", version: 1, status: "vigente", module: "Financeiro", level: "basico", title: "Consultar títulos", screen: "financeiro", permissions: { public: true }, steps: [
    { id: "abrir", title: "Abra o Financeiro", description: "Acesse Contas a pagar/receber pelo menu.", componentId: "nav-financeiro", selector: "[data-charlie-control='nav-financeiro']", instruction: "Clique em Contas pagar/receber.", criterion: { type: "screen", value: "financeiro" } },
    { id: "conferir", title: "Confirme a tela", description: "Confira o título e os filtros disponíveis antes da consulta.", componentId: "page-title", selector: "[data-charlie-control='page-title']", instruction: "Confira se o título da tela é Contas pagar/receber.", criterion: { type: "click", value: "page-title" } },
  ] },
  { id: "estoque-verificar-saldos", version: 1, status: "vigente", module: "Estoque", level: "basico", title: "Verificar saldos de estoque", screen: "estoque", permissions: { public: true }, steps: [
    { id: "abrir", title: "Abra Estoque", description: "Acesse o painel de estoque.", componentId: "page-title", selector: "[data-charlie-control='page-title']", instruction: "Abra a tela de Estoque.", criterion: { type: "screen", value: "estoque" } },
  ] },
  { id: "compras-consultar", version: 1, status: "vigente", module: "Compras", level: "basico", title: "Consultar necessidades de compra", screen: "compras", permissions: { public: true }, steps: [
    { id: "abrir", title: "Abra Compras", description: "Acesse o painel de compras.", componentId: "page-title", selector: "[data-charlie-control='page-title']", instruction: "Abra a tela de Compras.", criterion: { type: "screen", value: "compras" } },
  ] },
  { id: "administrativo-charlie", version: 1, status: "vigente", module: "Administrativo", level: "basico", title: "Fazer uma consulta ao Charlie", screen: "charlie", permissions: { public: true }, steps: [
    { id: "abrir", title: "Abra o Charlie", description: "Acesse o assistente pelo menu principal.", componentId: "nav-charlie", selector: "[data-charlie-control='nav-charlie']", instruction: "Clique em Charlie.", criterion: { type: "screen", value: "charlie" } },
    { id: "perguntar", title: "Localize o campo de pergunta", description: "Use o campo inferior para formular sua dúvida.", componentId: "charlie-composer", selector: "[data-charlie-control='charlie-composer']", instruction: "Clique no campo de pergunta.", criterion: { type: "click", value: "charlie-composer" } },
  ] },
];

function canRead(tutorial, actor) {
  if (actor.gerencial) return true;
  const p = tutorial.permissions || { public: true };
  return p.public || (p.sectors || []).includes(actor.sector) || (p.profiles || []).includes(actor.profile) || (p.users || []).includes(Number(actor.id));
}
function allTutorials(state) { return [...BUILTIN_TUTORIALS, ...(state.tutorials || [])]; }
function publicTutorial(item) { const { selector, ...safe } = item; return safe; }

export function getScreenContext(screenId, actor, error = "") {
  const screen = SCREEN_CATALOG[screenId];
  if (!screen) throw Object.assign(new Error("Tela não integrada ao instrutor."), { status: 404 });
  const sensitive = /senha|password|token|chave|conta bancaria|cartao/i;
  const controls = screen.controls.filter((item) => !sensitive.test(`${item.id} ${item.label}`));
  const procedures = searchEnterpriseKnowledge(`${screen.module} ${screen.title}`, actor, { limit: 4, officialOnly: true }).map((x) => x.source);
  return { id: screenId, ...screen, controls, error: String(error || "").slice(0, 500), procedures };
}

export function listTraining(actor, filters = {}) {
  const state = read();
  const items = allTutorials(state).filter((x) => x.status === "vigente" && canRead(x, actor))
    .filter((x) => !filters.screen || x.screen === filters.screen).filter((x) => !filters.module || x.module === filters.module);
  const progress = state.progress.filter((x) => Number(x.userId) === Number(actor.id));
  return items.map((item) => ({ ...publicTutorial(item), progress: progress.find((x) => x.tutorialId === item.id && x.tutorialVersion === item.version) || null }));
}

export function startTraining(id, actor) {
  const state = read(); const item = allTutorials(state).find((x) => x.id === id && x.status === "vigente" && canRead(x, actor));
  if (!item) throw Object.assign(new Error("Treinamento não encontrado ou não autorizado."), { status: 404 });
  let progress = state.progress.find((x) => Number(x.userId) === Number(actor.id) && x.tutorialId === id && x.tutorialVersion === item.version);
  if (!progress) { progress = { id: crypto.randomUUID(), userId: Number(actor.id), tutorialId: id, tutorialVersion: item.version, module: item.module, completedSteps: [], startedAt: now(), completedAt: null, status: "em_andamento", difficulties: [] }; state.progress.push(progress); }
  else if (progress.status !== "concluido") progress.status = "em_andamento";
  progress.updatedAt = now(); write(state); return { tutorial: publicTutorial(item), progress };
}

export function updateTraining(id, body, actor) {
  const state = read(); const progress = state.progress.find((x) => x.id === id && Number(x.userId) === Number(actor.id));
  if (!progress) throw Object.assign(new Error("Progresso não encontrado."), { status: 404 });
  const item = allTutorials(state).find((x) => x.id === progress.tutorialId && x.version === progress.tutorialVersion);
  if (!item) throw Object.assign(new Error("Versão do treinamento indisponível."), { status: 409 });
  if (body.stepId) {
    const step = item.steps.find((x) => x.id === body.stepId); if (!step) throw Object.assign(new Error("Etapa inválida."), { status: 400 });
    if (!progress.completedSteps.includes(step.id)) progress.completedSteps.push(step.id);
  }
  if (body.difficulty) progress.difficulties.push({ text: String(body.difficulty).slice(0, 500), at: now() });
  if (body.status && STATUS.has(body.status)) progress.status = body.status;
  if (progress.completedSteps.length === item.steps.length) { progress.status = "concluido"; progress.completedAt ||= now(); }
  progress.updatedAt = now(); write(state); return { tutorial: publicTutorial(item), progress };
}

export function createTutorialDraft(body, actor) {
  if (!actor.gerencial) throw Object.assign(new Error("Somente administradores autorizados podem criar tutoriais."), { status: 403 });
  const state = read(); const screen = SCREEN_CATALOG[body.screen];
  if (!screen) throw Object.assign(new Error("Selecione uma tela integrada."), { status: 400 });
  const title = String(body.title || "").trim(); if (!title) throw Object.assign(new Error("Informe o título."), { status: 400 });
  const steps = (body.steps || []).map((step, index) => { const control = screen.controls.find((x) => x.id === step.componentId); if (!control) throw Object.assign(new Error(`Componente inválido na etapa ${index + 1}.`), { status: 400 }); return { id: step.id || `etapa-${index + 1}`, title: String(step.title || `Etapa ${index + 1}`).slice(0, 120), description: String(step.description || "").slice(0, 500), instruction: String(step.instruction || "").slice(0, 500), componentId: control.id, selector: control.selector, criterion: { type: "click", value: control.id } }; });
  if (!steps.length) throw Object.assign(new Error("Inclua ao menos uma etapa validada."), { status: 400 });
  const prior = state.tutorials.filter((x) => x.logicalId === body.logicalId).sort((a, b) => b.version - a.version)[0];
  const tutorial = { id: crypto.randomUUID(), logicalId: body.logicalId || crypto.randomUUID(), version: (prior?.version || 0) + 1, status: "rascunho", module: screen.module, level: body.level || "basico", title: title.slice(0, 180), screen: body.screen, permissions: body.permissions || { public: true }, steps, createdBy: Number(actor.id), createdAt: now(), affectedBy: null };
  state.tutorials.push(tutorial); write(state); return publicTutorial(tutorial);
}

export function publishTutorial(id, actor) {
  if (!actor.gerencial) throw Object.assign(new Error("Somente administradores autorizados podem publicar tutoriais."), { status: 403 });
  const state = read(); const item = state.tutorials.find((x) => x.id === id); if (!item) throw Object.assign(new Error("Tutorial não encontrado."), { status: 404 });
  state.tutorials.filter((x) => x.logicalId === item.logicalId && x.id !== item.id && x.status === "vigente").forEach((x) => { x.status = "substituido"; });
  item.status = "vigente"; item.approvedBy = Number(actor.id); item.approvedAt = now(); write(state); return publicTutorial(item);
}

export function explainValidation(body) {
  const message = String(body.message || "").trim(); if (!message) throw Object.assign(new Error("Informe a mensagem real do ERP."), { status: 400 });
  const control = SCREEN_CATALOG[body.screen]?.controls.find((x) => x.id === body.componentId);
  return { title: "Validação do ERP", explanation: control ? `${message} Verifique ${control.label}: ${control.purpose}` : `${message} A causa técnica não foi informada pelo ERP; pode ser necessária análise adicional.`, control: control || null, source: "erp_validation" };
}
