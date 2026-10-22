import crypto from "node:crypto";
import { getAction, userCan } from "./charlie-task-catalog.js";

const OPEN_ALERT = new Set(["novo", "visualizado", "em_analise", "acao_preparada", "aguardando_confirmacao", "em_tratamento", "nao_resolvido"]);

const RULE_ACTIONS = {
  receber_vencidos: [
    ["financeiro.titulos_vencidos", "Mostrar os títulos", { dominio: "receber", dias: 1, limite: 100 }],
    ["financeiro.inadimplencia", "Organizar por cliente", { dominio: "receber", dias: 1, agrupar: "cliente", limite: 200 }],
    ["financeiro.preparar_cobrancas", "Preparar cobranças", { dominio: "receber", dias: 1, agrupar: "cliente", limite: 50 }],
    ["financeiro.preparar_cobrancas", "Preparar cobranças e Excel", { dominio: "receber", dias: 1, agrupar: "vendedor", limite: 50, formato: "excel" }],
  ],
  receber_concentracao: [
    ["financeiro.inadimplencia", "Analisar a concentração", { dominio: "receber", dias: 1, agrupar: "cliente", limite: 100 }],
    ["financeiro.preparar_cobrancas", "Preparar cobranças", { dominio: "receber", dias: 1, agrupar: "cliente", limite: 50 }],
  ],
  margem_preco: [
    ["produtos.margem_insuficiente", "Ver produtos", {}],
    ["produtos.comparativo_precos", "Analisar preços e custos", { formato: "excel", limite: 200 }],
  ],
  preco_abaixo_custo: [
    ["produtos.comparativo_precos", "Analisar preços e custos", { formato: "excel", limite: 200 }],
    ["produtos.margem_insuficiente", "Ver margens", {}],
  ],
  estoque_minimo: [
    ["estoque.abaixo_minimo", "Ver produtos", { limite: 100 }],
    ["estoque.sugestao_compra", "Preparar sugestão de compra", { limite: 100 }],
    ["estoque.sugestao_compra", "Preparar sugestão e Excel", { limite: 100, formato: "excel" }],
  ],
  ruptura: [
    ["estoque.sugestao_compra", "Preparar sugestão de compra", { limite: 100 }],
  ],
  clientes_sumidos: [
    ["comercial.clientes_inativos", "Preparar lista por vendedor", { dias: 60, agrupar: "vendedor", limite: 100 }],
    ["comercial.clientes_inativos", "Preparar lista e Excel", { dias: 60, agrupar: "vendedor", limite: 100, formato: "excel" }],
  ],
  vendas_queda: [
    ["comercial.reducao_compras", "Analisar clientes por vendedor", { meses: 3, percentual: 10, limite: 200 }],
    ["comercial.reducao_compras", "Gerar lista em Excel", { meses: 3, percentual: 10, limite: 200, formato: "excel" }],
  ],
};

function ids(alert, key = "CODIGO") {
  return (alert.registros || []).map((row) => Number(row[key] ?? row.ID)).filter(Number.isFinite).slice(0, 150);
}

function parameters(alert, actionId, defaults) {
  const params = { ...defaults, alertaId: alert.id };
  if (actionId === "financeiro.preparar_cobrancas" && ids(alert).length) params.clientes = ids(alert);
  if (actionId === "produtos.margem_insuficiente") {
    params.margem = Number(alert.evidencias?.limite ?? alert.evidencias?.margemMinima ?? 15);
    const table = Number(alert.registros?.[0]?.TABELA);
    if (Number.isFinite(table) && table > 0) params.tabela = table;
  }
  return params;
}

function score(alert) {
  const severity = { critico: 50, atencao: 30, informativo: 10 }[alert.gravidade] || 20;
  const evidence = alert.evidencias || {};
  const amount = Number(evidence.total || evidence.valor || evidence.vencido || 0);
  const records = Number(evidence.quantidade || evidence.qtd || alert.registros?.length || 0);
  const recurrence = Math.min(10, Number(alert.reincidencias || 0) * 2);
  return Math.min(100, Math.round(severity + Math.min(20, Math.log10(Math.max(1, amount)) * 3) + Math.min(15, records) + recurrence));
}

export function recommendationId(alertId, actionId, params) {
  const hash = crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 10);
  return `alerta-${Number(alertId)}:${actionId}:${hash}`;
}

export function buildAlertRecommendations(alert, user = {}) {
  if (!alert || !OPEN_ALERT.has(alert.situacao)) return [];
  const candidates = RULE_ACTIONS[alert.regra] || [];
  return candidates.flatMap(([actionId, description, defaults]) => {
    const action = getAction(actionId);
    if (!action?.habilitada || action.nivel >= 4 || !userCan(action, user, "preparar")) return [];
    const params = parameters(alert, actionId, defaults);
    return [{
      id: recommendationId(alert.id, actionId, params),
      alertaId: alert.id,
      descricao: description,
      acao: action.id,
      nomeAcao: action.nome,
      parametros: params,
      justificativa: alert.recomendacao || action.descricao,
      evidencias: alert.evidencias || {},
      risco: action.nivel,
      permissao: action.permissao,
      confirmacao: Boolean(action.confirmacao),
      prioridade: score(alert),
    }];
  }).sort((a, b) => b.prioridade - a.prioridade || a.risco - b.risco);
}

export function recommendationPlan(alert, recommendation, conversationId = null) {
  return {
    tipo: "executar",
    acao: recommendation.acao,
    parametros: recommendation.parametros,
    interpretador: "alerta",
    conversaId: conversationId,
    alertaId: alert.id,
    alertaRegra: alert.regra,
    recomendacaoId: recommendation.id,
    evidenciaEm: alert.atualizadoEm,
  };
}

