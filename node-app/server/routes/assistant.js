import express from "express";
import multer from "multer";
import { query, withReadOnlyDatabase, withWriteTransaction } from "../db.js";
import {
  getCharlieConversation,
  hideCharlieConversation,
  listCharlieConversations,
  renameCharlieConversation,
  saveCharlieTurn,
} from "../lib/charlie-history.js";
import {
  improveAnswerWithOllama,
  interpretWithOllama,
} from "../lib/charlie-ai.js";
import { getOllamaStatus } from "../lib/ollama.js";
import {
  answerFinancialQuestion,
  detectFinancialIntent,
} from "../lib/finance-assistant.js";
import { answerReportQuestion, detectReportIntent } from "../lib/report-assistant.js";
import {
  answerPurchaseQuestion,
  detectPurchaseIntent,
} from "../lib/purchase-assistant.js";
import { answerOllamaSqlQuestion, referencedTables, validateReadOnlySql } from "../lib/charlie-sql.js";
import { recordCharlieAudit, listCharlieAudit } from "../lib/charlie-audit.js";
import { catalogSummary, ensureFreshCatalog, refreshFirebirdCatalog } from "../lib/charlie-metadata.js";
import { listKnowledge, saveValidatedKnowledge } from "../lib/charlie-knowledge.js";
import {
  listMonitorGaps,
  listMonitorLog,
  readMonitorSettings,
  saveMonitorSettings,
  updateMonitorAlert,
  visibleMonitorAlerts,
} from "../lib/charlie-monitor-store.js";
import { buildCompanySummary } from "../lib/charlie-monitor-rules.js";
import { runCharlieMonitor } from "../lib/charlie-monitor.js";
import { buildAlertRecommendations, recommendationPlan } from "../lib/charlie-alert-actions.js";
import { readJsonConfig } from "../lib/json-config.js";
import { parseFinancialDate } from "../lib/finance-assistant.js";
import { buildExcel, buildPdf, fileSlug, normalizeTableExport } from "../lib/table-export.js";
import { planCharlieTask, looksLikeTask, acceptModelSelection, selectTaskWithOllama } from "../lib/charlie-task-plan.js";
import { runCharlieTask, confirmCharlieTask, cancelCharlieTask, exportCharlieTask } from "../lib/charlie-task-engine.js";
import { acceptCompositeModelPlan, looksLikeCompositeTask, planCompositeTask, selectCompositeWithOllama } from "../lib/charlie-composite-plan.js";
import { retryCompositeTask, runCompositeTask } from "../lib/charlie-composite-engine.js";
import { getConversationTask, getPreference, attachTaskConversation, findAlertTask, getTask, listTasks, publicTask, saveTask } from "../lib/charlie-task-store.js";
import { planAutomation } from "../lib/charlie-automation-plan.js";
import { executeAutomation } from "../lib/charlie-automation-engine.js";
import { getAutomation, listAutomations, listAutomationExecutions, saveAutomation } from "../lib/charlie-automation-store.js";
import {
  MAX_DOCUMENT_BYTES, addKnowledgeFeedback, answerFromEnterpriseKnowledge, changeKnowledgeStatus,
  createKnowledge, enterpriseKnowledgeAudit, extractDocument, getEnterpriseKnowledge,
  knowledgeSettings, listEnterpriseKnowledge, listKnowledgeFeedback, originalDocumentPath,
  saveCategory, searchEnterpriseKnowledge, storeDocument,
} from "../lib/charlie-enterprise-knowledge.js";
import { investigateOccurrence, profitabilityDashboard } from "../lib/charlie-profitability.js";
import { cashFlowForecast, customerInactivityForecast, financialSimulation, priceSimulation, revenueForecast, stockRiskForecast } from "../lib/charlie-predictive-service.js";
import { listPredictions, savePrediction, updatePredictionActual } from "../lib/charlie-prediction-store.js";
import { auditEngineStatus, runAuditCycle } from "../lib/charlie-audit-service.js";
import { findAuditEvents, listAuditEvents, listInvestigations, readAuditSettings, saveAuditSettings, saveInvestigation, verifyAuditChain } from "../lib/charlie-audit-store.js";
import { runBehavioralRiskAnalysis } from "../lib/charlie-behavioral-risk-service.js";
import { dedupeBehavioralAlerts, presentBehavioralAlert, presentBehavioralAnalysis } from "../lib/charlie-behavioral-risk-engine.js";
import { withAlertNames } from "../lib/charlie-labels.js";
import { listBehavioralAnalyses, readBehavioralState, saveBehavioralFeedback, saveBehavioralSettings } from "../lib/charlie-behavioral-risk-store.js";
import { createTutorialDraft, explainValidation, getScreenContext, listTraining, publishTutorial, startTraining, updateTraining } from "../lib/charlie-training.js";
import { analyzeCommercialOpportunities } from "../lib/charlie-commercial-service.js";
import { commercialMetrics, listOpportunities, prepareCommercialMessage, updateOpportunity } from "../lib/charlie-commercial-store.js";
import { compareSupplySuppliers, supplyDashboard, supplySimulation } from "../lib/charlie-supply-service.js";
import { getSupplyDraft, listSupplyDrafts, markSupplyDraft, prepareSupplyDraft } from "../lib/charlie-supply-store.js";
import {
  investigateBenefit, listBenefits, listMethodologies, recordBenefit, recordCost,
  recordPurchaseBenefit, saveMethodology, validateBenefit, valueDashboard,
} from "../lib/charlie-value-intelligence.js";
import {
  answerExecutiveQuestion,
  approveExecutivePlan,
  assertDirector,
  buildExecutiveBriefing,
  createExecutivePlan,
  getExecutivePlan,
  getExecutivePreferences,
  listExecutiveDecisions,
  listExecutivePlans,
  listExecutiveVerifications,
  recordExecutiveDecision,
  saveDirectorPreferences,
  startExecutiveMeeting,
  updateExecutivePlanStatus,
  verifyExecutiveAction,
} from "../lib/charlie-executive-service.js";

const router = express.Router();
const knowledgeUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_DOCUMENT_BYTES } });
const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function detectIntent(question) {
  const p = normalize(question),
    limit = Math.max(
      1,
      Math.min(50, Number(p.match(/\btop\s+(\d+)/)?.[1] || 10)),
    );
  if (
    p.includes("abrir o dia") ||
    p.includes("abertura do dia") ||
    p.includes("bom dia charlie")
  )
    return { type: "abertura_dia" };
  if (
    p.includes("o que voce sabe") ||
    p.includes("o que sabe fazer") ||
    p.includes("como pode ajudar")
  )
    return { type: "ajuda" };
  const financialIntent = detectFinancialIntent(question);
  if (financialIntent) return financialIntent;
  const purchaseIntent = detectPurchaseIntent(question);
  if (purchaseIntent) return purchaseIntent;
  const reportIntent = detectReportIntent(question);
  if (reportIntent) return reportIntent;
  if (p.includes("estoque") && p.includes("negativ"))
    return { type: "estoque_negativo" };
  if (p.includes("estoque") && (p.includes("baixo") || p.includes("minimo"))) {
    const top = p.match(/\btop\s+(\d+)/);
    return top
      ? { type: "estoque_baixo", limit: Math.max(1, Math.min(5000, Number(top[1]))) }
      : { type: "estoque_baixo" };
  }
  if ((p.includes("estoque") || p.includes("produto")) && (p.includes("sem estoque") || p.includes("zerad") || p.includes("acabou")))
    return { type: "estoque_zerado" };
  if (p.includes("saldo") && (p.includes("banco") || p.includes("conta")))
    return { type: "saldo_bancos" };
  if ((p.includes("contas") || p.includes("titulos")) && p.includes("receber"))
    return { type: "contas_receber" };
  if ((p.includes("contas") || p.includes("titulos")) && p.includes("pagar"))
    return { type: "contas_pagar" };
  if (p.includes("produto") && (p.includes("vendid") || p.includes("top"))) {
    const date = parseFinancialDate(question);
    return date ? { type: "produtos", limit, date } : { type: "produtos", limit };
  }
  if (
    p.includes("vendedor") &&
    (p.includes("venda") || p.includes("vendeu") || p.includes("faturamento"))
  )
    return { type: "vendedores", limit };
  if (
    p.includes("cliente") &&
    (p.includes("maior") || p.includes("top") || p.includes("compr"))
  )
    return { type: "clientes", limit };
  if (p.includes("caixa")) return { type: "caixa" };
  if (
    ["venda", "vendas", "vendem", "faturamento", "receita", "ticket"].some((term) =>
      p.includes(term),
    )
  ) {
    const date = parseFinancialDate(question);
    return date ? { type: "vendas", date } : { type: "vendas" };
  }
  return null;
}
const INHERITABLE = new Set([
  "vendas", "produtos", "vendedores", "clientes", "financeiro_titulos",
  "contas_receber", "contas_pagar", "consulta_sql", "estoque_zerado",
  "estoque_baixo", "estoque_negativo", "relatorios", "compras_curva_abc",
  "compras_sugestao", "compras_cobertura", "compras_oc_pendente",
]);
function isFollowUpQuestion(question) {
  return /^(e\b|agora\b|somente\b|so\b|apenas\b|filtre\b|mostra so\b|mostre somente\b|mostre apenas\b|mas so\b)/.test(normalize(question));
}
function personFromFollowUp(question) {
  const match = String(question || "").match(/\b(?:fornecedor|cliente|vendedor)\s+(.+?)(?=\s+(?:no|na|em|de|do|da)\b|[?.!,]|$)/i);
  const value = match?.[1]?.replace(/[?.!]+$/g, "").trim();
  return value ? value.slice(0, 80) : null;
}
function modelQuestion(question, conversation, intent) {
  if (intent?.interpretador !== "contexto" || intent?.type !== "consulta_sql") return question;
  const messages = conversation?.messages || [];
  const previousUser = [...messages].reverse().find((item) => item.role === "user");
  const previousSql = [...messages].reverse().find((item) => item.role === "assistant" && item.sql)?.sql;
  return [
    previousUser?.text ? `Pergunta anterior: ${previousUser.text}` : "",
    previousSql ? `SQL anterior validado, use só como referência e gere outro SELECT: ${previousSql}` : "",
    `Pedido atual, mantendo assunto e filtros não alterados: ${question}`,
  ].filter(Boolean).join("\n");
}
function periodPredicate(intent, column, fallbackSql) {
  const start = intent?.date?.start;
  const end = intent?.date?.end;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start || "") && /^\d{4}-\d{2}-\d{2}$/.test(end || ""))
    return `CAST(${column} AS DATE) BETWEEN DATE '${start}' AND DATE '${end}'`;
  return fallbackSql;
}
export function resolveConversationIntent(intent, conversation, question = "") {
  const previousMessage = [...(conversation?.messages || [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.intent);
  const previous = previousMessage?.intent;
  const normalizedQuestion = normalize(question);
  const previousPurchaseMessage = [...(conversation?.messages || [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.intent?.type?.startsWith("compras_") && message.data?.length);
  if (
    previousPurchaseMessage &&
    /(?:quando|momento|dia).{0,45}(?:ficou|ficaram|estoque|saldo).{0,20}negativ|nesses?\s+\d+\s+dias.{0,40}negativ/.test(normalizedQuestion)
  ) {
    const productCodes = [...new Set((previousPurchaseMessage.data || [])
      .map((row) => row.CODIGO || row.CDPRODUTO)
      .filter((code) => code !== undefined && code !== null)
      .map(String))].slice(0, 50);
    if (productCodes.length)
      return { ...previousPurchaseMessage.intent, negativeTimeline: true, productCodes };
  }
  if (
    previous?.type?.startsWith("compras_") &&
    /(?:qual|como|explique|explica).{0,30}(?:calculo|calculando|criterio|formula)|como chegou|por que/.test(normalizedQuestion)
  )
    return { ...previous, explainCalculation: true };
  if (previous?.type === "alerta_monitor") {
    const explain = /por que|porque|explica|identificou|duplic|concentr|envolvid|quais clientes|quais produtos|quais lancament|quais registros/.test(normalizedQuestion);
    const date = parseFinancialDate(question);
    if (explain && !date) {
      return {
        ...previous,
        explain: true,
        explicacao: previousMessage?.text || "",
        dados: previousMessage?.data || [],
        interpretador: "contexto",
      };
    }
    if (previous.domain && (date || isFollowUpQuestion(question) || /lancament|titulo|somente|apenas/.test(normalizedQuestion))) {
      return {
        type: "financeiro_titulos",
        domain: previous.domain,
        status: previous.statusTitulo || previous.status || "vencido",
        date: date || null,
        person: personFromFollowUp(question) || previous.person || null,
        limit: 50,
        interpretador: "contexto",
        alertaId: previous.alertaId,
      };
    }
  }
  if (isFollowUpQuestion(question) && previous && INHERITABLE.has(previous.type)) {
    return {
      ...previous,
      date: parseFinancialDate(question) || previous.date || null,
      person: personFromFollowUp(question) || previous.person || null,
      needsClarification: false,
      interpretador: "contexto",
    };
  }
  if (
    intent?.type !== "financeiro_titulos" ||
    !intent.domain ||
    intent.date ||
    intent.person ||
    !conversation?.messages?.length
  )
    return intent;
  if (previous?.type !== "financeiro_titulos" || !previous.needsClarification)
    return intent;
  return {
    ...previous,
    domain: intent.domain,
    needsClarification: false,
    interpretador: intent.interpretador,
  };
}
async function answer(db, question, selectedIntent) {
  const intent = selectedIntent || detectIntent(question);
  if (!intent)
    return {
      resposta:
        'Nao consegui identificar com seguranca o indicador desejado. Informe o assunto, por exemplo: "vendas", "estoque baixo", "saldo dos bancos" ou "contas a receber".',
      intencao: null,
      dados: [],
      sugestoes: [
        "vendas deste mes",
        "top 10 produtos vendidos",
        "contas a receber",
      ],
    };
  let data = [],
    response = "";
  if (intent.type === "alerta_monitor") {
    response = intent.explicacao || "Os registros abaixo são os que a regra do monitoramento encontrou.";
    data = intent.dados || [];
  } else if (intent.type === "ajuda") {
    response =
      "Posso consultar vendas, rankings de produtos, vendedores e clientes, estoque baixo ou negativo, contas a pagar e receber, saldos bancários e caixa. Também preparo cobranças, relatórios e simulações de preço; alterações de dados só seguem depois do botão de confirmação, e baixas, exclusões e documentos fiscais continuam bloqueados. Como apoio ao comprador, também analiso curva ABC, cobertura e risco de ruptura, sugiro reposições considerando vendas, estoque, embalagem e pedidos abertos, e acompanho ordens de compra pendentes. Também posso abrir o dia com um resumo dos principais indicadores e explicar os alertas que o monitoramento identificou.";
  } else if (intent.type === "abertura_dia") {
    const sales = await query(
      db,
      "SELECT COUNT(DISTINCT se.NRPEDIDO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA WHERE CAST(se.DTSAIDA AS DATE)=CURRENT_DATE AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0",
    );
    const receivable = await query(
      db,
      "SELECT COUNT(*) AS QTD,SUM(COALESCE(VALOR,0)) AS TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC<CURRENT_DATE",
    );
    const payable = await query(
      db,
      "SELECT COUNT(*) AS QTD,SUM(COALESCE(VALOR,0)) AS TOTAL FROM CTAPAGAR WHERE STATUS=1 AND DTVENC<CURRENT_DATE AND COALESCE(STATUSVALE,0) NOT IN (1,2)",
    );
    const stock = await query(
      db,
      "SELECT COUNT(*) AS QTD FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE m.QTDEATUAL<=m.QTDEMINIMA AND m.QTDEMINIMA>0 AND COALESCE(p.INATIVO,0)=0",
    );
    data = [
      {
        INDICADOR: "Vendas de hoje",
        QTD: sales[0]?.QTD || 0,
        TOTAL: sales[0]?.TOTAL || 0,
      },
      {
        INDICADOR: "Contas a receber vencidas",
        QTD: receivable[0]?.QTD || 0,
        TOTAL: receivable[0]?.TOTAL || 0,
      },
      {
        INDICADOR: "Contas a pagar vencidas",
        QTD: payable[0]?.QTD || 0,
        TOTAL: payable[0]?.TOTAL || 0,
      },
      {
        INDICADOR: "Produtos com estoque baixo",
        QTD: stock[0]?.QTD || 0,
        TOTAL: null,
      },
    ];
    response = `Abertura do dia: ${Number(sales[0]?.QTD || 0)} venda(s), ${money(sales[0]?.TOTAL)} faturados; ${Number(receivable[0]?.QTD || 0)} conta(s) a receber vencida(s), somando ${money(receivable[0]?.TOTAL)}; ${Number(payable[0]?.QTD || 0)} conta(s) a pagar vencida(s), somando ${money(payable[0]?.TOTAL)}; ${Number(stock[0]?.QTD || 0)} produto(s) com estoque baixo.`;
  } else if (intent.type === "estoque_negativo") {
    data = await query(
      db,
      "SELECT FIRST 20 m.CDPRODUTO AS CODIGO,p.PRODUTO AS DESCRICAO,m.QTDEATUAL AS ESTOQUE FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE m.QTDEATUAL<0 AND COALESCE(p.INATIVO,0)=0 ORDER BY m.QTDEATUAL",
    );
    response = data.length
      ? `Produtos com estoque negativo: ${data.length}.`
      : "Não encontrei produtos com estoque negativo.";
  } else if (intent.type === "estoque_zerado") {
    data = await query(
      db,
      "SELECT FIRST 50 m.CDPRODUTO AS CODIGO,p.PRODUTO AS DESCRICAO,m.QTDEATUAL AS ESTOQUE FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE m.QTDEATUAL<=0 AND COALESCE(p.INATIVO,0)=0 ORDER BY m.QTDEATUAL",
    );
    response = data.length
      ? `Produtos sem estoque: ${data.length}.`
      : "Não encontrei produtos sem estoque.";
  } else if (intent.type === "estoque_baixo") {
    const where =
      "m.QTDEATUAL<=m.QTDEMINIMA AND m.QTDEMINIMA>0 AND COALESCE(p.INATIVO,0)=0";
    const from = "FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO";
    const total = Number(
      (await query(db, `SELECT COUNT(*) AS QTD ${from} WHERE ${where}`))[0]?.QTD || 0,
    );
    const cap = Math.max(1, Math.min(5000, Number(intent.limit) || 5000));
    const first = total > cap ? `FIRST ${cap} ` : "";
    data = total
      ? await query(
          db,
          `SELECT ${first}m.CDPRODUTO AS CODIGO,p.PRODUTO AS DESCRICAO,m.QTDEATUAL AS ESTOQUE_ATUAL,m.QTDEMINIMA AS ESTOQUE_MINIMO ${from} WHERE ${where} ORDER BY (m.QTDEATUAL-m.QTDEMINIMA)`,
        )
      : [];
    response = !total
      ? "Não encontrei produtos com estoque baixo."
      : data.length < total
        ? `Há ${total} produtos com estoque baixo. A lista traz os ${data.length} mais abaixo do mínimo.`
        : `Há ${total} produtos com estoque baixo.`;
  } else if (intent.type === "saldo_bancos") {
    data = await query(
      db,
      "SELECT FIRST 20 b.BANCO AS NOME_BANCO,mb.CDBANCO,mb.NUMCONTA,SUM(mb.VALOR) AS SALDO FROM MOV_BANCARIO mb LEFT JOIN BANCO b ON b.CDBANCO=mb.CDBANCO GROUP BY b.BANCO,mb.CDBANCO,mb.NUMCONTA ORDER BY SALDO DESC",
    );
    data = data.map((row) => ({
      BANCO: `${row.NOME_BANCO || `Banco ${row.CDBANCO}`} / ${row.NUMCONTA || "Sem conta"}`,
      SALDO: row.SALDO,
    }));
    response = `Saldo consolidado: ${money(data.reduce((sum, row) => sum + Number(row.SALDO || 0), 0))}.`;
  } else if (intent.type === "financeiro_titulos") {
    return answerFinancialQuestion(db, intent);
  } else if (intent.type.startsWith("compras_")) {
    return answerPurchaseQuestion(db, intent);
  } else if (intent.type === "consulta_sql") {
    return answerOllamaSqlQuestion(db, question);
  } else if (intent.type === "relatorios") {
    return answerReportQuestion(db, intent);
  } else if (intent.type.startsWith("contas_")) {
    const table = intent.type === "contas_receber" ? "CTARECEBER" : "CTAPAGAR";
    data = await query(
      db,
      `SELECT CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN 'VENCIDO' WHEN STATUS=1 THEN 'ABERTO' ELSE 'PAGO' END AS STATUS,COUNT(*) AS QTD,SUM(COALESCE(VALOR,0)) AS TOTAL FROM ${table} GROUP BY 1 ORDER BY 1`,
    );
    response = `Resumo de contas a ${intent.type === "contas_receber" ? "receber" : "pagar"}: ${data.map((row) => `${row.STATUS}: ${row.QTD} (${money(row.TOTAL)})`).join("; ")}.`;
  } else if (intent.type === "caixa") {
    data = await query(
      db,
      `SELECT r.RECEBTO AS FORMA_PAGAMENTO,
        COUNT(*) AS QTD_LANCAMENTOS,
        SUM(COALESCE(c.TOTALPG,c.VALOR,0)) AS TOTAL_RECEBIDO
       FROM CTARECEBERCAIXA c
       LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(c.TPPAGTO,c.CODPAGTO)
       WHERE CAST(c.DTCOB AS DATE)=CURRENT_DATE AND COALESCE(c.CANCELADO,0)=0
       GROUP BY r.RECEBTO
       ORDER BY TOTAL_RECEBIDO DESC`,
    );
    data = data.map((row) => ({
      FORMA_PAGAMENTO: row.FORMA_PAGAMENTO || "Não informada",
      QTD_LANCAMENTOS: Number(row.QTD_LANCAMENTOS || 0),
      TOTAL_RECEBIDO:
        Math.round(Number(row.TOTAL_RECEBIDO || 0) * 100) / 100,
    }));
    const total = data.reduce((sum, row) => sum + row.TOTAL_RECEBIDO, 0),
      lancamentos = data.reduce((sum, row) => sum + row.QTD_LANCAMENTOS, 0);
    response = `Caixa hoje: ${money(total)} em ${lancamentos} lançamento(s), distribuídos em ${data.length} forma(s) de pagamento.`;
  } else {
    const dimensions = {
      produtos: [
        "sp.CDPRODUTO AS CODIGO,COALESCE(p.PRODUTO,sp.DESCRICAO) AS NOME,SUM(sp.QTDPRODUTO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL",
        "LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO",
        "sp.CDPRODUTO,p.PRODUTO,sp.DESCRICAO",
      ],
      vendedores: [
        "se.CDVENDEDOR AS CODIGO,v.VENDEDOR AS NOME,COUNT(DISTINCT se.NRPEDIDO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL",
        "LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR",
        "se.CDVENDEDOR,v.VENDEDOR",
      ],
      clientes: [
        "se.CDCLIENTE AS CODIGO,COALESCE(c.CLIENTE,se.CLIENTE) AS NOME,COUNT(DISTINCT se.NRPEDIDO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL",
        "LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE",
        "se.CDCLIENTE,c.CLIENTE,se.CLIENTE",
      ],
    };
    if (dimensions[intent.type]) {
      const [dims, join, group] = dimensions[intent.type];
      const when = periodPredicate(intent, "se.DTSAIDA", "CAST(se.DTSAIDA AS DATE)>=DATEADD(-30 DAY TO CURRENT_DATE)");
      data = await query(
        db,
        `SELECT FIRST ${intent.limit} ${dims} FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA ${join} WHERE ${when} AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0 GROUP BY ${group} ORDER BY TOTAL DESC`,
      );
      const label = intent.date?.label || "nos últimos 30 dias";
      response = data.length
        ? `Ranking ${label}: ${data.map((row, index) => `${index + 1}. ${row.NOME} - ${money(row.TOTAL)}`).join("; ")}.`
        : `Não encontrei vendas ${label}.`;
    } else {
      const when = periodPredicate(intent, "se.DTSAIDA", "CAST(se.DTSAIDA AS DATE)=CURRENT_DATE");
      data = await query(
        db,
        `SELECT COUNT(DISTINCT se.NRPEDIDO) AS QTD_VENDAS,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA WHERE ${when} AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0`,
      );
      const label = intent.date?.label || "hoje";
      const qty = Number(data[0]?.QTD_VENDAS || 0);
      response = qty
        ? `Vendas ${label}: ${money(data[0]?.TOTAL)} em ${qty} pedido(s).`
        : `Não encontrei vendas ${label}.`;
    }
  }
  return { resposta: response, intencao: intent, dados: data };
}
router.get("/conversas", (req, res) => {
  const user = req.dashboardSession?.user?.idusuario;
  res.json({ ok: true, conversas: listCharlieConversations(user) });
});
router.get("/ollama/status", async (_req, res) => {
  res.json({ ok: true, ...(await getOllamaStatus()) });
});
router.get("/conversas/:id", (req, res) => {
  const result = getCharlieConversation(
    req.dashboardSession?.user?.idusuario,
    req.params.id,
  );
  if (!result)
    return res
      .status(404)
      .json({ ok: false, erro: "Conversa nao encontrada." });
  res.json({ ok: true, ...result });
});
router.patch("/conversas/:id", (req, res) => {
  try {
    const title = renameCharlieConversation(
      req.dashboardSession?.user?.idusuario,
      req.params.id,
      req.body?.titulo,
    );
    if (!title)
      return res
        .status(404)
        .json({ ok: false, erro: "Conversa nao encontrada." });
    res.json({ ok: true, titulo: title });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.delete("/conversas/:id", (req, res) => {
  const hidden = hideCharlieConversation(
    req.dashboardSession?.user?.idusuario,
    req.params.id,
  );
  res
    .status(hidden ? 200 : 404)
    .json(
      hidden
        ? { ok: true, oculto: true }
        : { ok: false, erro: "Conversa nao encontrada." },
    );
});
router.post("/exportar", async (req, res) => {
  try {
    const table = normalizeTableExport(req.body);
    const buffer = table.formato === "pdf" ? await buildPdf(table) : await buildExcel(table);
    const extension = table.formato === "pdf" ? "pdf" : "xlsx";
    res.set({
      "Content-Type": table.formato === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileSlug(table.title)}.${extension}"`,
    });
    res.send(buffer);
  } catch (error) {
    if (!res.headersSent)
      res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
function manager(req, res) {
  if (req.dashboardSession?.user?.permissao_gerencial) return true;
  res.status(403).json({ ok: false, erro: "Sem permissão para administrar o Charlie." });
  return false;
}
router.get("/conhecimento", (req, res) => {
  if (!manager(req, res)) return;
  res.json({ ok: true, ...listKnowledge(), catalogo: catalogSummary() });
});
router.post("/conhecimento", async (req, res) => {
  if (!manager(req, res)) return;
  try {
    const sql = validateReadOnlySql(req.body?.sql);
    const tabelas = referencedTables(sql);
    await withReadOnlyDatabase((db) => query(db, sql, [], { timeoutMs: 15000 }));
    const exemplo = saveValidatedKnowledge({ ...req.body, sql, tabelas });
    res.json({
      ok: true,
      exemplo: { id: exemplo.id, pergunta: exemplo.pergunta },
      mensagem: "Consulta validada e disponível para perguntas parecidas.",
    });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, erro: error.message });
  }
});
router.get("/memoria/configuracao", (req, res) => res.json({ ok: true, ...knowledgeSettings() }));
router.get("/memoria", (req, res) => res.json({ ok: true, itens: listEnterpriseKnowledge(taskActor(req), req.query) }));
router.get("/memoria/feedback", (req, res) => {
  try { res.json({ ok: true, feedback: listKnowledgeFeedback(taskActor(req)) }); }
  catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/memoria/auditoria", (req, res) => {
  try { res.json({ ok: true, eventos: enterpriseKnowledgeAudit(taskActor(req)) }); }
  catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/memoria/:id", (req, res) => {
  const item = getEnterpriseKnowledge(req.params.id, taskActor(req));
  res.status(item ? 200 : 404).json(item ? { ok: true, item } : { ok: false, erro: "Conhecimento não encontrado ou sem permissão." });
});
router.get("/memoria/:id/original", (req, res) => {
  const file = originalDocumentPath(req.params.id, taskActor(req));
  if (!file) return res.status(404).json({ ok: false, erro: "Documento não encontrado ou sem permissão." });
  res.download(file.target, file.name);
});
router.post("/memoria", (req, res) => {
  if (!manager(req, res)) return;
  try { res.status(201).json({ ok: true, item: createKnowledge(req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/memoria/upload", knowledgeUpload.single("arquivo"), async (req, res) => {
  if (!manager(req, res)) return;
  let storedName = null;
  try {
    if (!req.file) throw Object.assign(new Error("Selecione um arquivo."), { status: 400 });
    const extracted = await extractDocument(req.file.buffer, req.file.originalname);
    if (!extracted.searchable) throw Object.assign(new Error("O documento não contém texto pesquisável. OCR não está configurado; envie uma versão com texto."), { status: 422 });
    storedName = storeDocument(req.file.buffer, req.file.originalname);
    const permissions = req.body.permissions ? JSON.parse(req.body.permissions) : { public: true };
    const item = createKnowledge({ ...req.body, permissions }, taskActor(req), { ...extracted, name: req.file.originalname, storedName, mime: req.file.mimetype, size: req.file.size });
    res.status(201).json({ ok: true, item });
  } catch (error) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 400).json({ ok: false, erro: error.message });
  }
});
router.patch("/memoria/:id/status", (req, res) => {
  try { const item = changeKnowledgeStatus(req.params.id, req.body?.status, taskActor(req)); res.status(item ? 200 : 404).json(item ? { ok: true, item } : { ok: false, erro: "Conhecimento não encontrado." }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/memoria/categorias", (req, res) => {
  if (!manager(req, res)) return;
  try { res.json({ ok: true, categories: saveCategory(req.body?.name, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/memoria/feedback", (req, res) => {
  try { res.status(201).json({ ok: true, feedback: addKnowledgeFeedback(req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/memoria-pesquisa", (req, res) => res.json({ ok: true, resultados: searchEnterpriseKnowledge(req.query.q, taskActor(req), { officialOnly: req.query.oficial !== "false" }) }));
router.post("/metadados/atualizar", async (req, res) => {
  if (!manager(req, res)) return;
  try {
    res.json({ ok: true, ...(await withReadOnlyDatabase((db) => refreshFirebirdCatalog(db))) });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.get("/auditoria", (req, res) => {
  if (!manager(req, res)) return;
  res.json({ ok: true, eventos: listCharlieAudit(Number(req.query.limite) || 50) });
});
router.get("/auditoria-central", async (req, res) => {
  if (!manager(req, res)) return;
  const actor = taskActor(req);
  try {
    const named = await alertsWithNames(visibleMonitorAlerts(actor.id, { categoria: "auditoria", situacao: req.query.situacao }));
    const alerts = named.map((alert) => presentBehavioralAlert(alert));
    const investigations = listInvestigations(actor);
    const risks = listBehavioralAnalyses(actor, req.query);
    const riskEvents = findAuditEvents(risks.flatMap((risk) => risk.eventIds || []));
    const presented = risks.map((item) => presentBehavioralAnalysis(item, riskEvents));
    res.json({ ok: true, alerts, investigations, events: listAuditEvents(actor, req.query), risks: presented, riskState: readBehavioralState(), status: auditEngineStatus(), integrity: verifyAuditChain(), settings: readAuditSettings() });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.post("/auditoria-central/executar", async (req, res) => {
  if (!manager(req, res)) return;
  try {
    const audit = await withReadOnlyDatabase((db) => runAuditCycle(db, { actor: taskActor(req) }));
    res.json({ ok: true, audit, risks: runBehavioralRiskAnalysis() });
  }
  catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.put("/auditoria-central/configuracao", (req, res) => {
  if (!manager(req, res)) return;
  try {
    const actor = taskActor(req), before = readAuditSettings(), settings = saveAuditSettings(req.body || {}, actor);
    recordCharlieAudit({ userId: actor.id, pergunta: "Alterar configuração da auditoria", intencao: "auditoria_configuracao", origem: "CHARLIE_AUDIT", valores: { before, after: settings } });
    res.json({ ok: true, settings });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/auditoria-central/:alertId/investigacao", (req, res) => {
  if (!manager(req, res)) return;
  try {
    const actor = taskActor(req), alert = visibleMonitorAlerts(actor.id, { categoria: "auditoria" }).find((item) => item.id === Number(req.params.alertId));
    if (!alert) return res.status(404).json({ ok: false, erro: "Ocorrência de auditoria não encontrada." });
    const investigation = saveInvestigation({ alertId: alert.id, eventId: alert.evidencias?.eventId, eventActorId: alert.evidencias?.actor?.id, ...req.body }, actor);
    const situation = ({ nova: "visualizado", triagem: "em_analise", investigacao: "em_analise", aguardando_informacoes: "nao_resolvido", resolvida: "resolvido", descartada: "descartado", reaberta: "em_analise" })[investigation.status];
    if (situation) updateMonitorAlert(alert.id, actor.id, { situacao: situation, motivo: req.body?.justification || (situation === "descartado" ? "Investigação descartada com justificativa." : "") });
    res.json({ ok: true, investigation });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.put("/auditoria-central/riscos/configuracao", (req, res) => {
  if (!manager(req, res)) return;
  try { res.json({ ok: true, settings: saveBehavioralSettings(req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/auditoria-central/riscos/:analysisId/feedback", (req, res) => {
  if (!manager(req, res)) return;
  try { res.json({ ok: true, feedback: saveBehavioralFeedback(req.params.analysisId, req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/alertas/contador", (req, res) => {
  const abertos = dedupeBehavioralAlerts(visibleMonitorAlerts(req.dashboardSession?.user?.idusuario)).filter((item) => !["resolvido", "descartado"].includes(item.situacao));
  res.json({ ok: true, total: abertos.length });
});
router.get("/alertas/resumo", (req, res) => {
  const user = req.dashboardSession?.user?.idusuario;
  const state = readJsonConfig("charlie-monitor-state.json", {});
  const summary = buildCompanySummary(dedupeBehavioralAlerts(visibleMonitorAlerts(user)), state.ultimaExecucao);
  res.json({ ok: true, ...summary, lacunas: listMonitorGaps() });
});
async function alertsWithNames(alerts) {
  try {
    return await withReadOnlyDatabase((db) => withAlertNames(db, alerts));
  } catch {
    return alerts;
  }
}

router.get("/alertas", async (req, res) => {
  const actor = taskActor(req);
  const alertas = dedupeBehavioralAlerts(visibleMonitorAlerts(req.dashboardSession?.user?.idusuario, {
    situacao: req.query.situacao,
    categoria: req.query.categoria,
  }));
  const named = await alertsWithNames(alertas);
  const enriched = named.map((alerta) => {
    const legivel = presentBehavioralAlert(alerta);
    return { ...legivel, recomendacoes: buildAlertRecommendations(legivel, actor) };
  });
  res.json({ ok: true, alertas: enriched, total: enriched.length });
});
router.patch("/alertas/:id", (req, res) => {
  try {
    const alerta = updateMonitorAlert(req.params.id, req.dashboardSession?.user?.idusuario, req.body || {});
    if (!alerta) return res.status(404).json({ ok: false, erro: "Alerta não encontrado." });
    res.json({ ok: true, alerta });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post("/alertas/:id/investigar", async (req, res) => {
  const user = req.dashboardSession?.user?.idusuario;
  const actor = taskActor(req);
  const found = visibleMonitorAlerts(user).find((item) => item.id === Number(req.params.id));
  if (!found) return res.status(404).json({ ok: false, erro: "Alerta não encontrado." });
  const [named] = await alertsWithNames([found]);
  const alerta = presentBehavioralAlert(named || found);
  if (!alerta.id) return res.status(404).json({ ok: false, erro: "Alerta não encontrado." });
  const orientacoes = searchEnterpriseKnowledge(`${alerta.titulo} ${alerta.descricao || ""}`, actor, { limit: 3 });
  const auditEvidence = alerta.categoria === "auditoria" ? alerta.evidencias : null;
  const behavioralEvidence = auditEvidence?.auditCategory === "riscos_comportamentais" ? auditEvidence : null;
  const texto = [
    behavioralEvidence ? alerta.descricao : (alerta.narrativa || alerta.descricao),
    auditEvidence && !behavioralEvidence ? `Evidência preservada: evento ${auditEvidence.eventId || "não informado"}, entidade ${auditEvidence.entity || "não informada"}, registro ${auditEvidence.recordId || "não informado"}, regra ${auditEvidence.rule?.id || "não informada"} versão ${auditEvidence.rule?.version || "não informada"}.` : "",
    auditEvidence && !behavioralEvidence && !auditEvidence.actorIdentified ? "O responsável humano não pôde ser identificado de forma confiável neste evento." : "",
    alerta.recomendacao ? `O que conferir: ${alerta.recomendacao}` : "",
    orientacoes[0] ? `Procedimento interno relacionado: ${orientacoes[0].text.slice(0, 500)}` : "",
    "Posso detalhar os registros usados nessa identificação.",
  ].filter(Boolean).join("\n\n");
  const conversaId = saveCharlieTurn(user, null, `Charlie, explique o alerta: ${alerta.titulo}`, {
    resposta: texto,
    intencao: {
      type: "alerta_monitor",
      alertaId: alerta.id,
      eventoAuditoriaId: auditEvidence?.eventId || null,
      analiseComportamentalId: behavioralEvidence?.behavioralAnalysisId || null,
      domain: alerta.dominio,
      statusTitulo: alerta.statusTitulo,
      interpretador: "alerta",
    },
    dados: behavioralEvidence ? (alerta.registros || []).map((row) => ({ O_QUE: row.NOME, QUANDO: row.QUANDO, QUEM: row.QUEM || "Não identificado" })) : auditEvidence ? [{ EVENTO: auditEvidence.eventId, ENTIDADE: auditEvidence.entity, REGISTRO: auditEvidence.recordId, OCORRIDO_EM: auditEvidence.occurredAt, ORIGEM: auditEvidence.origin, REGRA: auditEvidence.rule?.id, VERSAO_REGRA: auditEvidence.rule?.version, RESPONSAVEL_IDENTIFICADO: auditEvidence.actorIdentified ? "Sim" : "Não" }] : alerta.registros || [],
    origem: "banco",
    fontes: orientacoes.map((item) => item.source),
    sugestoes: alerta.dominio
      ? ["Por que você identificou isso?", "Mostre apenas os lançamentos deste mês"]
      : ["Por que você identificou isso?", "Quais registros entraram nessa regra?"],
  }, 0);
  if (alerta.situacao === "novo")
    updateMonitorAlert(alerta.id, user, { situacao: "visualizado" });
  res.json({ ok: true, conversaId });
});
router.post("/alertas/:id/recomendacoes/:recommendationId/executar", async (req, res) => {
  const actor = taskActor(req);
  try {
    const result = await withReadOnlyDatabase(async (db) => {
      // A mesma regra que criou o alerta é executada novamente antes de preparar a tarefa.
      await runCharlieMonitor(db);
      const alerta = visibleMonitorAlerts(actor.id).find((item) => item.id === Number(req.params.id));
      if (!alerta || ["resolvido", "descartado"].includes(alerta.situacao))
        return { status: 409, body: { ok: false, erro: "A ocorrência não está mais ativa. Atualize os alertas antes de continuar." } };
      const recomendacao = buildAlertRecommendations(alerta, actor).find((item) => item.id === req.params.recommendationId);
      if (!recomendacao)
        return { status: 403, body: { ok: false, erro: "Esta ação não está disponível no catálogo ou para as permissões atuais." } };
      const duplicate = findAlertTask(alerta.id, recomendacao.id, actor.id, {});
      if (duplicate)
        return { status: 200, body: { ok: true, duplicada: true, resposta: "Esta recomendação já possui uma tarefa. Reaproveitei a tarefa existente.", tarefa: publicTask(duplicate) } };
      const taskResult = await runCharlieTask(
        recommendationPlan(alerta, recomendacao, Number(req.body?.conversaId) || null),
        actor,
        { query: (sql, params) => query(db, sql, params, { timeoutMs: 20000 }) },
      );
      const situation = taskResult.tarefa?.status === "aguardando_confirmacao"
        ? "aguardando_confirmacao"
        : ["concluida", "concluida_parcial"].includes(taskResult.tarefa?.status)
          ? "nao_resolvido"
          : "acao_preparada";
      updateMonitorAlert(alerta.id, actor.id, {
        situacao: situation,
        tratamento: {
          recomendacaoId: recomendacao.id,
          acao: recomendacao.acao,
          tarefaId: taskResult.tarefa?.id,
          resultado: taskResult.resposta,
          situacaoProblema: situation,
        },
      });
      recordCharlieAudit({
        userId: actor.id,
        pergunta: `Executar recomendação ${recomendacao.id} do alerta ${alerta.id}`,
        intencao: recomendacao.acao,
        tarefaId: taskResult.tarefa?.id || null,
        registros: taskResult.tarefa?.quantidade || 0,
        valores: taskResult.tarefa?.amostra || [],
        duracaoMs: 0,
        origem: "CHARLIE_ALERTA",
      });
      return { status: 200, body: { ok: true, ...taskResult } };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.get("/monitoramento", (req, res) => {
  if (!manager(req, res)) return;
  const state = readJsonConfig("charlie-monitor-state.json", {});
  res.json({ ok: true, configuracao: readMonitorSettings(), lacunas: listMonitorGaps(), ultimaExecucao: state.ultimaExecucao || null, ultimoErro: state.ultimoErro || null });
});
router.post("/monitoramento", (req, res) => {
  if (!manager(req, res)) return;
  try {
    res.json({ ok: true, configuracao: saveMonitorSettings(req.body || {}, req.dashboardSession?.user?.idusuario) });
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message });
  }
});
router.post("/monitoramento/executar", async (req, res) => {
  if (!manager(req, res)) return;
  try {
    const result = await withReadOnlyDatabase((db) => runCharlieMonitor(db));
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.get("/monitoramento/log", (req, res) => {
  if (!manager(req, res)) return;
  res.json({ ok: true, execucoes: listMonitorLog().slice(0, 30) });
});
function withExecutiveTimeout(promise, ms = 12000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("tempo limite da fonte executiva")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function executiveLiveSources(actor, scope) {
  const wants = (name) => !scope || scope === "empresa" || scope === name;
  return withReadOnlyDatabase(async (db) => {
    const jobs = [];
    const run = (key, enabled, load) => {
      if (enabled) jobs.push(withExecutiveTimeout(load()).then((value) => ({ key, value })).catch((error) => ({ key, error: error.message })));
    };
    run("cashFlow", wants("financeiro"), () => cashFlowForecast(db, actor, { horizon: 30 }));
    run("revenue", wants("comercial"), () => revenueForecast(db, actor, { horizon: 30 }));
    run("stock", wants("estoque") || wants("compras"), () => stockRiskForecast(db, actor, {}));
    run("supply", wants("compras") || wants("estoque"), () => supplyDashboard(db, actor, { limit: 80, horizonDays: 30 }));
    run("profitability", wants("rentabilidade"), () => profitabilityDashboard(db, actor, { days: 30 }));
    run("customers", scope === "comercial", () => customerInactivityForecast(db, actor, {}));
    const live = { limitations: [] };
    for (const item of await Promise.all(jobs)) {
      if (item.error) live.limitations.push(`${item.key}: ${item.error}`);
      else live[item.key] = item.value;
    }
    return live;
  });
}
async function executiveSimulate(actor, request) {
  try {
    if (request.kind === "cenarios" || request.kind === "financeiro") {
      const cash = await withReadOnlyDatabase((db) => cashFlowForecast(db, actor, { horizon: 30 }));
      if (request.kind === "cenarios") {
        return {
          changedData: false,
          currentLabel: `cenário base com saldo final ${money(cash.scenarios.base.closingBalance)}`,
          simulatedLabel: `otimista ${money(cash.scenarios.optimistic.closingBalance)}; conservador ${money(cash.scenarios.conservative.closingBalance)}`,
          assumptions: cash.assumptions,
          risks: "Os três cenários já existem no motor preditivo. Não são meta de crescimento.",
          limitations: "Não há meta cadastrada. Nenhum lançamento foi alterado.",
        };
      }
      const simulated = financialSimulation(cash, { adjustments: [{ date: new Date().toISOString().slice(0, 10), value: -Math.abs(request.amount) }] });
      const end = simulated.scenarios.base?.at?.(-1);
      return {
        changedData: false,
        currentLabel: `saldo base ${money(cash.scenarios.base.closingBalance)}`,
        simulatedLabel: end ? `saldo simulado ${money(end.simulatedBalance)} se ${money(request.amount)} forem antecipados no início do horizonte` : "simulação sem ponto final",
        assumptions: [...(cash.assumptions || []), "O valor foi aplicado como ajuste no primeiro dia, sem escolher títulos."],
        risks: "Antecipar pagamento reduz o caixa projetado.",
        limitations: "Títulos específicos não foram selecionados e nenhum pagamento foi lançado.",
      };
    }
    if (request.kind === "compras") {
      const supply = await withReadOnlyDatabase((db) => supplyDashboard(db, actor, { limit: 40, horizonDays: 30 }));
      const simulation = supplySimulation({ items: (supply.needs || []).slice(0, 30), criticalOnly: true });
      return {
        changedData: false,
        currentLabel: `${supply.indicators?.ruptureRisk || 0} item(ns) com urgência alta na leitura atual`,
        simulatedLabel: `${simulation.rows.length} item(ns) permaneceriam na simulação crítica. Custo conhecido: ${simulation.totalKnownCost == null ? "não calculado" : money(simulation.totalKnownCost)}.`,
        assumptions: ["A simulação reutiliza o abastecimento existente e não grava pedido."],
        risks: "Reduzir compra pode aumentar ruptura. Isso não foi gravado.",
        limitations: simulation.unknownCostItems ? `${simulation.unknownCostItems} item(ns) sem custo conhecido.` : "Sem lista de ofertas, o custo não vira economia.",
      };
    }
  } catch (error) {
    return { blocked: true, changedData: false, reason: `Simulador existente indisponível: ${error.message}` };
  }
  return { blocked: true, changedData: false, reason: "A simulação de preços existente exige produtos identificados. Informe os produtos ou a tabela. Nenhum preço foi alterado." };
}
async function rereadExecutiveIndicator(actor, action) {
  if (action.indicator === "fluxo_caixa") {
    const cash = await withReadOnlyDatabase((db) => cashFlowForecast(db, actor, { horizon: 30 }));
    const values = (cash.scenarios.base.projection || []).map((item) => Number(item.balance)).filter(Number.isFinite);
    return { value: values.length ? Math.min(...values) : cash.scenarios.base.closingBalance, polarity: "higher_better", unit: "BRL", at: new Date().toISOString() };
  }
  if (action.indicator === "ruptura_estoque" || action.indicator === "ruptureRisk") {
    const stock = await withReadOnlyDatabase((db) => stockRiskForecast(db, actor, {}));
    return { value: stock.items.filter((item) => item.risk === "alto").length, polarity: "lower_better", unit: "produtos", at: stock.generatedAt };
  }
  if (action.indicator === "verifiedNegativeResult") {
    const dashboard = await withReadOnlyDatabase((db) => profitabilityDashboard(db, actor, { days: 30 }));
    return { value: dashboard.indicators.verifiedNegativeResult, polarity: "lower_better", unit: "BRL", at: dashboard.generatedAt };
  }
  return null;
}
function taskActor(req) {
  return {
    id: req.dashboardSession?.user?.idusuario,
    name: req.dashboardSession?.user?.nome,
    gerencial: Boolean(req.dashboardSession?.user?.permissao_gerencial),
    profile: req.dashboardSession?.user?.perfil || null,
    sector: req.dashboardSession?.user?.setor || null,
    company: req.dashboardSession?.user?.idempresa || null,
    branch: req.dashboardSession?.user?.idfilial || null,
  };
}
router.get("/treinamento/contexto/:screen", (req, res) => {
  try { res.json({ ok: true, contexto: getScreenContext(req.params.screen, taskActor(req), req.query.erro) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/treinamento/catalogo", (req, res) => {
  try { res.json({ ok: true, treinamentos: listTraining(taskActor(req), req.query) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/treinamento/:id/iniciar", (req, res) => {
  try { res.json({ ok: true, ...startTraining(req.params.id, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.patch("/treinamento/progresso/:id", (req, res) => {
  try { res.json({ ok: true, ...updateTraining(req.params.id, req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/treinamento/tutoriais", (req, res) => {
  try { res.status(201).json({ ok: true, tutorial: createTutorialDraft(req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/treinamento/tutoriais/:id/publicar", (req, res) => {
  try { res.json({ ok: true, tutorial: publishTutorial(req.params.id, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/treinamento/explicar-erro", (req, res) => {
  try { res.json({ ok: true, resultado: explainValidation(req.body || {}) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/comercial/oportunidades", (req, res) => {
  try { const actor=taskActor(req); res.json({ok:true,oportunidades:listOpportunities(actor,req.query),indicadores:commercialMetrics(actor)}); }
  catch(error){res.status(error.status||400).json({ok:false,erro:error.message});}
});
router.post("/comercial/analisar", async (req, res) => {
  try { const actor=taskActor(req),result=await withReadOnlyDatabase((db)=>analyzeCommercialOpportunities(db,actor,req.body||{})); recordCharlieAudit({userId:actor.id,pergunta:"Análise de oportunidades comerciais",intencao:"inteligencia_comercial",tabelas:["SAIDAESTOQUE","SAIDAPRODUTO","CLIENTE","VENDEDOR","PRODUTO","MOVIMENTO"],sql:"consultas parametrizadas internas",registros:result.opportunities.length}); res.json({ok:true,...result}); }
  catch(error){res.status(error.status||500).json({ok:false,erro:error.message});}
});
router.patch("/comercial/oportunidades/:id", (req,res)=>{try{res.json({ok:true,oportunidade:updateOpportunity(req.params.id,req.body||{},taskActor(req))});}catch(error){res.status(error.status||400).json({ok:false,erro:error.message});}});
router.post("/comercial/oportunidades/:id/mensagem", (req,res)=>{try{const actor=taskActor(req),sources=searchEnterpriseKnowledge("política comercial regras de atendimento contato cliente",actor,{limit:4,officialOnly:true}).map((x)=>x.source);res.json({ok:true,rascunho:prepareCommercialMessage(req.params.id,actor,sources)});}catch(error){res.status(error.status||400).json({ok:false,erro:error.message});}});
router.get("/abastecimento",async(req,res)=>{try{const actor=taskActor(req),result=await withReadOnlyDatabase(db=>supplyDashboard(db,actor,req.query));result.indicators.preparedRequests=listSupplyDrafts(actor).filter(x=>x.status==="prepared").length;res.json({ok:true,...result,drafts:listSupplyDrafts(actor)});}catch(error){res.status(error.status||500).json({ok:false,erro:error.message});}});
router.post("/abastecimento/fornecedores/comparar",(req,res)=>{try{res.json({ok:true,...compareSupplySuppliers(req.body||{})});}catch(error){res.status(error.status||400).json({ok:false,erro:error.message});}});
router.post("/abastecimento/simular",(req,res)=>{try{res.json({ok:true,...supplySimulation(req.body||{})});}catch(error){res.status(error.status||400).json({ok:false,erro:error.message});}});
router.post("/abastecimento/solicitacoes",(req,res)=>{try{const actor=taskActor(req),draft=prepareSupplyDraft(req.body||{},actor);recordCharlieAudit({userId:actor.id,pergunta:"Preparar solicitação de compra",intencao:"compras_solicitacao_rascunho",tabelas:[],sql:"nenhum SQL de alteração",registros:draft.items.length});res.status(201).json({ok:true,draft});}catch(error){res.status(error.status||400).json({ok:false,erro:error.message});}});
router.post("/abastecimento/solicitacoes/:id/confirmar",async(req,res)=>{const actor=taskActor(req);try{const draft=getSupplyDraft(req.params.id,actor);if(!draft)return res.status(404).json({ok:false,erro:"Rascunho não encontrado no escopo atual."});if(draft.status!=="prepared")return res.status(409).json({ok:false,erro:"Este rascunho já foi processado."});const services=req.app.locals?.charlieServices||{};if(!services.compras?.criarSolicitacaoRascunho)return res.status(503).json({ok:false,erro:"Serviço oficial de compras indisponível. Nada foi alterado no ERP e o rascunho foi preservado.",draft});const result=await withWriteTransaction(tx=>services.compras.criarSolicitacaoRascunho(tx,draft.items,{actor,draftId:draft.id}));const saved=markSupplyDraft(draft.id,actor,{status:"created",confirmedAt:new Date().toISOString(),erpResult:result});recordCharlieAudit({userId:actor.id,pergunta:"Confirmar solicitação de compra",intencao:"compras_criar_solicitacao",tabelas:[],sql:"serviço oficial do ERP",registros:draft.items.length});res.json({ok:true,draft:saved,result});}catch(error){res.status(error.status||500).json({ok:false,erro:error.message});}});

// Charlie Value Intelligence: cálculos determinísticos e explicação opcional pelo
// fluxo conversacional existente. Nenhuma destas rotas depende do Ollama.
router.get("/resultados", (req, res) => {
  try { res.json({ ok: true, ...valueDashboard(taskActor(req), req.query) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/resultados/beneficios", (req, res) => {
  try { res.json({ ok: true, beneficios: listBenefits(taskActor(req), req.query) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/resultados/metodologias", (req, res) => {
  try { res.json({ ok: true, metodologias: listMethodologies(taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/resultados/metodologias", (req, res) => {
  try { res.status(201).json({ ok: true, metodologia: saveMethodology(req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/resultados/beneficios", (req, res) => {
  try { const result = recordBenefit(req.body || {}, taskActor(req)); res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/resultados/compras", (req, res) => {
  try { const result = recordPurchaseBenefit(req.body || {}, taskActor(req)); res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/resultados/custos", (req, res) => {
  try { res.status(201).json({ ok: true, custo: recordCost(req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.patch("/resultados/beneficios/:id/validacao", (req, res) => {
  try { res.json({ ok: true, beneficio: validateBenefit(req.params.id, req.body || {}, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/resultados/beneficios/:id/investigar", (req, res) => {
  try { res.json({ ok: true, investigacao: investigateBenefit(req.params.id, taskActor(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/rentabilidade", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await withReadOnlyDatabase((db) => profitabilityDashboard(db, actor, {
      days: req.query.dias,
      idleDays: req.query.paradoDias,
      minimumMargin: req.query.margemMinima,
    }));
    recordCharlieAudit({
      userId: actor.id, pergunta: "Painel de rentabilidade", intencao: "rentabilidade_painel",
      tabelas: ["SAIDAESTOQUE", "SAIDAPRODUTO", "MOVIMENTO", "PRODUTO"],
      sql: "consultas parametrizadas internas", duracaoMs: 0,
      registros: result.occurrences.length + result.idleStock.length,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.get("/rentabilidade/ocorrencias/:id", async (req, res) => {
  try {
    const actor = taskActor(req);
    const dashboard = await withReadOnlyDatabase((db) => profitabilityDashboard(db, actor, {
      days: req.query.dias,
      minimumMargin: req.query.margemMinima,
    }));
    const occurrence = dashboard.occurrences.find((item) => item.id === req.params.id);
    if (!occurrence) return res.status(404).json({ ok: false, erro: "Ocorrência não encontrada no escopo e período informados." });
    res.json({ ok: true, occurrence, investigation: investigateOccurrence(occurrence) });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.get("/previsoes/historico", (req, res) => {
  res.json({ ok: true, predictions: listPredictions(taskActor(req), req.query.limite) });
});
router.patch("/previsoes/historico/:id/realizado", (req, res) => {
  if (!manager(req, res)) return;
  const item = updatePredictionActual(req.params.id, req.body?.actual, taskActor(req));
  res.status(item ? 200 : 404).json(item ? { ok: true, prediction: item } : { ok: false, erro: "Previsão não encontrada no escopo atual." });
});
router.get("/previsoes/faturamento", async (req, res) => {
  try {
    const actor = taskActor(req);
    const started = Date.now();
    const result = await withReadOnlyDatabase((db) => revenueForecast(db, actor, req.query));
    const prediction = savePrediction({ indicator: "faturamento", period: { horizonDays: result.horizon }, model: result.model, modelVersion: result.modelVersion, quality: result.quality, validation: result.validation, result: { total: result.total, interval: result.interval }, assumptions: result.assumptions }, actor);
    recordCharlieAudit({ userId: actor.id, pergunta: "Previsão de faturamento", intencao: "previsao_faturamento", tabelas: ["SAIDAESTOQUE", "SAIDAPRODUTO"], sql: "consulta parametrizada interna", duracaoMs: Date.now() - started, registros: result.history?.length || 0 });
    res.json({ ok: true, predictionId: prediction.id, disclaimer: "Esta é uma projeção, não uma garantia.", ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/previsoes/fluxo-caixa", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await withReadOnlyDatabase((db) => cashFlowForecast(db, actor, req.query));
    const prediction = savePrediction({ indicator: "fluxo_caixa", period: { horizonDays: result.horizon }, model: "agenda_financeira_com_cenarios", modelVersion: "1.0.0", quality: result.quality, result: { closingBalance: result.scenarios.base.closingBalance, firstNegativeDate: result.scenarios.base.firstNegativeDate }, assumptions: result.assumptions }, actor);
    res.json({ ok: true, predictionId: prediction.id, disclaimer: "Fluxo projetado não é saldo contábil nem garantia de liquidez.", ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/previsoes/estoque", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await withReadOnlyDatabase((db) => stockRiskForecast(db, actor, req.query));
    const prediction = savePrediction({ indicator: "ruptura_estoque", period: { historyDays: req.query.historyDays || 90 }, model: "cobertura_demanda_media", modelVersion: "1.0.0", quality: result.quality, result: { highRisk: result.items.filter((item) => item.risk === "alto").length }, assumptions: result.assumptions }, actor);
    res.json({ ok: true, predictionId: prediction.id, ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/previsoes/clientes", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await withReadOnlyDatabase((db) => customerInactivityForecast(db, actor, req.query));
    const prediction = savePrediction({ indicator: "inatividade_clientes", period: { historyDays: req.query.historyDays || 365 }, model: "intervalo_medio_compras", modelVersion: "1.0.0", quality: result.quality, result: { atRisk: result.customers.filter((item) => item.classification === "risco_inatividade").length }, assumptions: result.assumptions }, actor);
    res.json({ ok: true, predictionId: prediction.id, ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.post("/simulacoes/precos", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await withReadOnlyDatabase((db) => priceSimulation(db, actor, req.body || {}));
    recordCharlieAudit({ userId: actor.id, pergunta: "Simulação de preços", intencao: "simulacao_precos", tabelas: ["PRODUTO", "PRODUTOPRECO"], sql: "consulta parametrizada interna somente leitura", duracaoMs: 0, registros: result.rows.length });
    res.json({ ok: true, scenarioId: `price-${Date.now()}`, ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.post("/simulacoes/financeiras", async (req, res) => {
  try {
    const actor = taskActor(req);
    const cash = await withReadOnlyDatabase((db) => cashFlowForecast(db, actor, { horizon: req.body?.horizon }));
    const result = financialSimulation(cash, req.body || {});
    recordCharlieAudit({ userId: actor.id, pergunta: "Simulação financeira", intencao: "simulacao_financeira", tabelas: ["MOV_BANCARIO", "CTARECEBER", "CTAPAGAR"], sql: "consulta parametrizada interna somente leitura", duracaoMs: 0, registros: req.body?.adjustments?.length || 0 });
    res.json({ ok: true, scenarioId: `financial-${Date.now()}`, ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
function taskContext(actor, conversation) {
  const previous = [...(conversation?.messages || [])].reverse().find((message) => message.role === "assistant" && message.intent);
  const stored = getConversationTask(actor.id, conversation?.conversation?.id);
  return {
    tarefa: stored ? { id: stored.id, acao: stored.acao, parametros: stored.parametros, status: stored.status } : null,
    tarefaComposta: stored?.composta ? { id: stored.id, solicitacao: stored.solicitacao, parametros: stored.parametros, status: stored.status } : null,
    pendente: stored?.status === "aguardando_confirmacao" ? { id: stored.id } : null,
    consulta: previous?.intent || null,
    registros: previous?.data || [],
    preferencia: getPreference(actor.id),
  };
}
async function finishTask(req, res, actor, question, result, started) {
  const conversationId = saveCharlieTurn(
    actor.id,
    req.body?.contexto?.conversaId,
    question,
    result,
    Date.now() - started,
  );
  if (result.tarefa?.id) attachTaskConversation(result.tarefa.id, actor.id, conversationId);
  recordCharlieAudit({
    userId: actor.id,
    pergunta: question,
    intencao: result.intencao?.acao || result.intencao?.type || null,
    tabelas: [],
    sql: "",
    duracaoMs: Date.now() - started,
    registros: result.tarefa?.quantidade || result.dados?.length || 0,
    erro: result.tarefa?.status === "falhou" ? result.tarefa.erros?.[0] : null,
  });
  res.json({
    ok: true,
    pergunta: question,
    ...result,
    sugestoes: result.sugestoes || [],
    alertas: result.alertas || [],
    colunas: result.dados?.[0] ? Object.keys(result.dados[0]) : [],
    conversaId: conversationId,
    pergunta_interpretada: question,
    interpretador: result.intencao?.interpretador || "tarefas",
  });
}
router.get("/tarefas", (req, res) => {
  const all = listTasks(taskActor(req).id, 100);
  const status = String(req.query.status || "").trim();
  const busca = normalize(req.query.busca);
  const inicio = req.query.inicio ? Date.parse(`${req.query.inicio}T00:00:00`) : NaN;
  const fim = req.query.fim ? Date.parse(`${req.query.fim}T23:59:59.999`) : NaN;
  const filtered = all.filter((task) => {
    const created = Date.parse(task.criadaEm || 0);
    if (status && task.status !== status) return false;
    if (Number.isFinite(inicio) && (!Number.isFinite(created) || created < inicio)) return false;
    if (Number.isFinite(fim) && (!Number.isFinite(created) || created > fim)) return false;
    if (busca && !normalize(`${task.titulo || ""} ${task.operacao || ""} ${task.resumo || ""} ${task.id}`).includes(busca)) return false;
    return true;
  });
  const page = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const pageSize = Math.max(5, Math.min(30, Number.parseInt(req.query.limite, 10) || 10));
  const start = (page - 1) * pageSize;
  res.json({
    ok: true,
    tarefas: filtered.slice(start, start + pageSize),
    paginacao: { pagina: page, limite: pageSize, total: filtered.length, paginas: Math.max(1, Math.ceil(filtered.length / pageSize)) },
  });
});
router.get("/automacoes", (req, res) => {
  const actor = taskActor(req);
  res.json({ ok: true, automacoes: listAutomations(actor, { status: req.query.status }) });
});
router.get("/automacoes/:id", (req, res) => {
  const actor = taskActor(req);
  const item = getAutomation(req.params.id);
  if (!item || (!actor.gerencial && item.criadaPor !== Number(actor.id)))
    return res.status(404).json({ ok: false, erro: "Automação não encontrada." });
  res.json({ ok: true, automacao: item, execucoes: listAutomationExecutions(item.id) });
});
router.post("/automacoes/:id/confirmar", (req, res) => {
  const actor = taskActor(req);
  const item = getAutomation(req.params.id);
  if (!item || item.criadaPor !== Number(actor.id)) return res.status(404).json({ ok: false, erro: "Automação não encontrada." });
  if (item.status !== "aguardando_confirmacao") return res.status(409).json({ ok: false, erro: "A automação não aguarda confirmação." });
  if (req.body?.confirmar !== true) return res.status(400).json({ ok: false, erro: "A confirmação precisa ser explícita." });
  const updated = saveAutomation({ ...item, status: "ativa", confirmadaEm: new Date().toISOString(), confirmadaPor: actor.id, atualizadaPor: actor.id });
  res.json({ ok: true, automacao: updated, resposta: "Automação ativada." });
});
router.patch("/automacoes/:id", (req, res) => {
  const actor = taskActor(req);
  const item = getAutomation(req.params.id);
  if (!item || (!actor.gerencial && item.criadaPor !== Number(actor.id))) return res.status(404).json({ ok: false, erro: "Automação não encontrada." });
  const status = req.body?.status;
  if (status && !["ativa", "pausada", "desativada"].includes(status)) return res.status(400).json({ ok: false, erro: "Situação inválida." });
  const updated = saveAutomation({ ...item, ...(status ? { status } : {}), atualizadaPor: actor.id });
  res.json({ ok: true, automacao: updated });
});
router.post("/automacoes/:id/executar", async (req, res) => {
  const actor = taskActor(req);
  const item = getAutomation(req.params.id);
  if (!item || (!actor.gerencial && item.criadaPor !== Number(actor.id))) return res.status(404).json({ ok: false, erro: "Automação não encontrada." });
  if (item.status !== "ativa") return res.status(409).json({ ok: false, erro: "A automação precisa estar ativa." });
  try {
    const result = await withReadOnlyDatabase((db) => executeAutomation(item, {
      query: (sql, params) => query(db, sql, params, { timeoutMs: 30000 }),
      resolveUser: () => ({ ...actor, ativo: true }),
    }, { manual: true }));
    res.json({ ok: result.status !== "falhou", ...result });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/tarefas/:id", (req, res) => {
  const actor = taskActor(req);
  const stored = getTask(req.params.id, actor.id);
  if (!stored) return res.status(404).json({ ok: false, erro: "Tarefa não encontrada." });
  const page = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const pageSize = Math.max(10, Math.min(100, Number.parseInt(req.query.limite, 10) || 25));
  const search = normalize(req.query.busca);
  const rows = (stored.linhas || []).filter((row) => !search || normalize(Object.values(row || {}).join(" ")).includes(search));
  const start = (page - 1) * pageSize;
  res.json({
    ok: true,
    tarefa: publicTask(stored),
    registros: rows.slice(start, start + pageSize),
    paginacao: { pagina: page, limite: pageSize, total: rows.length, paginas: Math.max(1, Math.ceil(rows.length / pageSize)) },
  });
});
router.post("/tarefas/:id/confirmar", async (req, res) => {
  const actor = taskActor(req);
  const result = await confirmCharlieTask(req.params.id, actor, req.body || {}, {
    withWriteTransaction: (action) => withWriteTransaction(action),
  });
  if (result.status === 200 && result.body?.tarefa?.alertaId && !result.body.jaExecutada) {
    const task = getTask(req.params.id, actor.id, {});
    try {
      await withReadOnlyDatabase((db) => runCharlieMonitor(db));
      const current = visibleMonitorAlerts(actor.id).find((item) => item.id === Number(task.alertaId));
      const problemStatus = !current || current.situacao === "resolvido" ? "resolvido" : "nao_resolvido";
      const verified = saveTask({
        ...task,
        verificacao: { em: new Date().toISOString(), situacao: problemStatus, alertaId: task.alertaId },
      }, {});
      updateMonitorAlert(task.alertaId, actor.id, {
        ...(current && current.situacao !== "resolvido" ? { situacao: "nao_resolvido" } : {}),
        tratamento: {
          recomendacaoId: task.recomendacaoId,
          acao: task.acao,
          tarefaId: task.id,
          resultado: verified.resumo,
          situacaoProblema: problemStatus,
        },
      });
      result.body.tarefa = publicTask(verified);
      result.body.verificacao = problemStatus;
      result.body.resposta += problemStatus === "resolvido"
        ? " A ocorrência foi reavaliada e está resolvida."
        : " A operação terminou, mas a ocorrência continua ativa.";
    } catch (error) {
      const verified = saveTask({ ...task, verificacao: { em: new Date().toISOString(), situacao: "falhou", erro: error.message } }, {});
      result.body.tarefa = publicTask(verified);
      result.body.resposta += " Não foi possível reavaliar a ocorrência agora; ela permanece em aberto.";
    }
  }
  recordCharlieAudit({
    userId: actor.id,
    pergunta: `Confirmar tarefa ${req.params.id}`,
    intencao: result.body?.tarefa?.acao || "confirmacao",
    tarefaId: Number(req.params.id),
    confirmacao: req.body?.confirmar === true,
    operacaoId: result.body?.tarefa?.execucaoId || null,
    registros: result.body?.tarefa?.quantidadeConcluida || 0,
    valores: result.body?.tarefa?.amostra || [],
    erro: result.body?.erro || null,
    duracaoMs: 0,
    origem: "CHARLIE",
  });
  if (result.body?.tarefa?.conversaId && result.body.resposta)
    saveCharlieTurn(actor.id, result.body.tarefa.conversaId, "Confirmar execução", result.body, 0);
  res.status(result.status).json(result.body);
});
router.post("/tarefas/:id/cancelar", (req, res) => {
  const actor = taskActor(req);
  const result = cancelCharlieTask(req.params.id, actor, {});
  if (result.body?.tarefa?.conversaId && result.body.resposta)
    saveCharlieTurn(actor.id, result.body.tarefa.conversaId, "Cancelar tarefa", result.body, 0);
  res.status(result.status).json(result.body);
});
router.post("/tarefas/:id/repetir", async (req, res) => {
  const actor = taskActor(req);
  const result = await withReadOnlyDatabase((db) => retryCompositeTask(req.params.id, actor, {
    query: (sql, params) => query(db, sql, params, { timeoutMs: 20000 }),
  }));
  if (result.body?.tarefa?.conversaId && result.body.resposta)
    saveCharlieTurn(actor.id, result.body.tarefa.conversaId, "Repetir etapa com falha", result.body, 0);
  res.status(result.status).json(result.body);
});
router.post("/tarefas/:id/exportar", async (req, res) => {
  try {
    const result = await exportCharlieTask(req.params.id, taskActor(req), req.body?.formato, {});
    if (result.buffer) {
      recordCharlieAudit({
        userId: taskActor(req).id,
        pergunta: `Exportar tarefa ${req.params.id} em ${req.body?.formato || "excel"}`,
        intencao: "exportacao",
        tabelas: [],
        sql: "",
        duracaoMs: 0,
        registros: result.quantidade || 0,
        erro: null,
      });
      res.set({
        "Content-Type": result.type,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.send(result.buffer);
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    if (!res.headersSent) res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post("/executivo/resumo", async (req, res) => {
  try {
    const actor = taskActor(req);
    const briefing = await buildExecutiveBriefing(actor, {
      scope: req.body?.escopo || "empresa",
      force: Boolean(req.body?.atualizar),
      live: req.body?.atualizar !== false,
      loadLive: (scope) => executiveLiveSources(actor, scope),
    });
    res.json({ ok: true, briefing });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/executivo/painel", async (req, res) => {
  try {
    const actor = taskActor(req);
    assertDirector(actor);
    const briefing = await buildExecutiveBriefing(actor, { scope: req.query.escopo || "empresa", live: false });
    res.json({
      ok: true,
      briefing,
      planos: listExecutivePlans(actor),
      preferencias: getExecutivePreferences(actor),
      decisoes: listExecutiveDecisions(actor),
    });
  } catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
});
router.get("/executivo/planos", (req, res) => {
  try { res.json({ ok: true, planos: listExecutivePlans(assertDirector(taskActor(req))) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/executivo/planos", async (req, res) => {
  try {
    const actor = taskActor(req);
    const briefing = await buildExecutiveBriefing(actor, { scope: req.body?.escopo || "empresa", live: false });
    res.status(201).json({ ok: true, plano: createExecutivePlan(actor, briefing) });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/executivo/planos/:id", (req, res) => {
  try {
    const plan = getExecutivePlan(req.params.id, assertDirector(taskActor(req)));
    if (!plan) return res.status(404).json({ ok: false, erro: "Plano não encontrado no escopo atual." });
    res.json({ ok: true, plano: plan, verificacoes: listExecutiveVerifications(plan.id, taskActor(req)) });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/executivo/planos/:id/aprovar", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await approveExecutivePlan(req.params.id, actor, req.body || {}, {
      prepareTask: (plan) => withReadOnlyDatabase((db) => runCharlieTask(plan, actor, {
        query: (sql, params) => query(db, sql, params, { timeoutMs: 20000 }),
      })),
    });
    res.json({ ok: true, ...result });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/executivo/planos/:id/verificar", async (req, res) => {
  try {
    const actor = taskActor(req);
    const result = await verifyExecutiveAction(req.params.id, actor, req.body || {}, { reread: (action) => rereadExecutiveIndicator(actor, action) });
    res.json({ ok: true, ...result });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/executivo/planos/:id/situacao", (req, res) => {
  try { res.json({ ok: true, plano: updateExecutivePlanStatus(req.params.id, taskActor(req), req.body?.status, req.body?.nota) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/executivo/reuniao", async (req, res) => {
  try {
    const actor = taskActor(req);
    const started = await startExecutiveMeeting(actor, req.body?.tema, { conversationId: req.body?.conversaId || null }, {
      scope: "empresa",
      live: req.body?.atualizar !== false,
      loadLive: (scope) => executiveLiveSources(actor, scope),
    });
    res.json({ ok: true, ...started });
  } catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/executivo/preferencias", (req, res) => {
  try { res.json({ ok: true, preferencias: getExecutivePreferences(assertDirector(taskActor(req))) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.put("/executivo/preferencias", (req, res) => {
  try { res.json({ ok: true, ...saveDirectorPreferences(taskActor(req), req.body || {}) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.get("/executivo/decisoes", (req, res) => {
  try { res.json({ ok: true, decisoes: listExecutiveDecisions(assertDirector(taskActor(req))) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/executivo/decisoes", (req, res) => {
  try { res.status(201).json({ ok: true, decisao: recordExecutiveDecision(taskActor(req), req.body || {}) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: error.message }); }
});
router.post("/perguntar", async (req, res) => {
  const question = String(
    req.body?.pergunta || req.body?.mensagem || "",
  ).trim();
  if (!question)
    return res
      .status(400)
      .json({ ok: false, erro: 'Informe a pergunta no campo "pergunta".' });
  const started = Date.now();
  const user = req.dashboardSession?.user?.idusuario;
  try {
    ensureFreshCatalog();
    const conversation = req.body?.contexto?.conversaId
      ? getCharlieConversation(user, req.body.contexto.conversaId)
      : null;
    const actor = taskActor(req);
    const normalizedPredictive = normalize(question);
    const horizonMatch = normalizedPredictive.match(/(?:proxim(?:os|as)|daqui a|em)\s+(\d+)\s+dias?/);
    const predictiveHorizon = horizonMatch ? Math.min(366, Number(horizonMatch[1])) : /seis meses/.test(normalizedPredictive) ? 180 : /tres meses/.test(normalizedPredictive) ? 90 : /15 dias/.test(normalizedPredictive) ? 15 : /7 dias|uma semana/.test(normalizedPredictive) ? 7 : 30;
    if (/prev(?:er|isao)|podera faturar|quanto.*faturar|tendencia.*faturamento/.test(normalizedPredictive) && /fatur|receita|venda/.test(normalizedPredictive)) {
      const prediction = await withReadOnlyDatabase((db) => revenueForecast(db, actor, { horizon: predictiveHorizon }));
      const result = prediction.ok ? {
        resposta: `Previsão de faturamento para os próximos ${prediction.horizon} dias: ${money(prediction.total)}. Faixa provável: ${money(prediction.interval.lower)} a ${money(prediction.interval.upper)}. Modelo: ${prediction.model}; qualidade dos dados: ${prediction.quality.status}. É uma projeção, não uma garantia.`,
        intencao: { type: "previsao_faturamento", interpretador: "motor_preditivo" }, dados: prediction.forecasts, origem: "calculo_no_banco", previsao: prediction,
        sugestoes: ["Existe risco de faltar dinheiro no próximo mês?", "Mostre as premissas da previsão"],
      } : { resposta: prediction.message, intencao: { type: "previsao_faturamento", interpretador: "motor_preditivo" }, dados: [], origem: "calculo_no_banco", previsao: prediction };
      const improved = await improveAnswerWithOllama(question, result).catch(() => null);
      if (improved) result.resposta = improved;
      savePrediction({ indicator: "faturamento", period: { horizonDays: prediction.horizon }, model: prediction.model, modelVersion: prediction.modelVersion, quality: prediction.quality, validation: prediction.validation, result: { total: prediction.total, interval: prediction.interval }, assumptions: prediction.assumptions }, actor);
      return finishTask(req, res, actor, question, result, started);
    }
    if (/saldo estimado|faltar dinheiro|caixa.*negativ|fluxo de caixa.*(?:proxim|previs|projet)/.test(normalizedPredictive)) {
      const prediction = await withReadOnlyDatabase((db) => cashFlowForecast(db, actor, { horizon: predictiveHorizon }));
      const base = prediction.scenarios.base;
      const result = { resposta: `Fluxo de caixa projetado para ${prediction.horizon} dias: saldo base de ${money(base.closingBalance)} ao final do período.${base.firstNegativeDate ? ` O caixa pode ficar negativo a partir de ${base.firstNegativeDate}.` : " O cenário base não fica negativo nesse horizonte."} Compare os cenários otimista, base e conservador em Previsões e Simulações.`, intencao: { type: "previsao_fluxo_caixa", interpretador: "motor_preditivo" }, dados: base.projection, origem: "calculo_no_banco", previsao: prediction, sugestoes: ["Simule uma despesa adicional de R$ 20.000 no próximo mês"] };
      const improved = await improveAnswerWithOllama(question, result).catch(() => null); if (improved) result.resposta = improved;
      savePrediction({ indicator: "fluxo_caixa", period: { horizonDays: prediction.horizon }, model: "agenda_financeira_com_cenarios", modelVersion: "1.0.0", quality: prediction.quality, result: { closingBalance: base.closingBalance, firstNegativeDate: base.firstNegativeDate }, assumptions: prediction.assumptions }, actor);
      return finishTask(req, res, actor, question, result, started);
    }
    if (/risco.*(?:ruptura|faltar|indispon)|ruptura.*estoque|produtos?.*risco.*estoque/.test(normalizedPredictive)) {
      const prediction = await withReadOnlyDatabase((db) => stockRiskForecast(db, actor, {}));
      const high = prediction.items.filter((item) => item.risk === "alto");
      return finishTask(req, res, actor, question, { resposta: `Identifiquei ${high.length} produto(s) com risco alto de indisponibilidade antes da reposição. Dias de cobertura são estimativas, não datas certas de ruptura.`, intencao: { type: "previsao_estoque", interpretador: "motor_preditivo" }, dados: prediction.items.slice(0, 100), origem: "calculo_no_banco", previsao: prediction, sugestoes: ["Quais quantidades de compra são sugeridas?"] }, started);
    }
    if (/clientes?.*(?:parar de comprar|inativ)|risco.*inatividade.*cliente/.test(normalizedPredictive)) {
      const prediction = await withReadOnlyDatabase((db) => customerInactivityForecast(db, actor, {}));
      const atRisk = prediction.customers.filter((item) => item.classification === "risco_inatividade");
      return finishTask(req, res, actor, question, { resposta: `Encontrei ${atRisk.length} cliente(s) com risco estimado de inatividade. A lista diferencia redução observada, comportamento atípico e risco estimado; não atribuo probabilidades sem um modelo calibrado.`, intencao: { type: "previsao_inatividade", interpretador: "motor_preditivo" }, dados: prediction.customers, origem: "calculo_no_banco", previsao: prediction }, started);
    }
    if (/\b(rentabilidade|margem de contribuicao|margem de contribuição|contribuicao negativa|contribuição negativa|prejuizo invisivel|prejuízo invisível)\b/i.test(question)) {
      const dashboard = await withReadOnlyDatabase((db) => profitabilityDashboard(db, actor, { days: 90 }));
      const saleMatch = question.match(/\bvenda\s+#?(\d+)/i);
      const selected = saleMatch ? dashboard.occurrences.find((item) => String(item.sale) === saleMatch[1]) : null;
      const investigation = selected ? investigateOccurrence(selected) : null;
      const result = investigation ? {
        resposta: `${investigation.title}\n\n${investigation.explanation}\n\n${investigation.disclaimer}`,
        intencao: { type: "rentabilidade_investigacao", interpretador: "regras" },
        dados: [selected], origem: "calculo_no_banco",
        sugestoes: ["prepare uma simulação de reajuste", "mostre os produtos com menor margem"],
      } : {
        resposta: `Analisei os últimos 90 dias. Identifiquei ${dashboard.indicators.negativeSales} ocorrência(s) com contribuição negativa e ${dashboard.indicators.insufficientMarginSales} com margem insuficiente. O resultado negativo identificado soma ${money(dashboard.indicators.verifiedNegativeResult)}. Esse valor representa margem de contribuição, não lucro líquido.`,
        intencao: { type: "rentabilidade_resumo", interpretador: "regras" },
        dados: dashboard.occurrences.slice(0, 50), origem: "calculo_no_banco",
        sugestoes: ["quais vendas tiveram contribuição negativa?", "prepare uma simulação de reajuste"],
      };
      return finishTask(req, res, actor, question, result, started);
    }
    const previousExecutive = [...(conversation?.messages || [])].reverse().find((message) => message.role === "assistant" && message.intent);
    const executive = await answerExecutiveQuestion(question, actor, {
      previousType: previousExecutive?.intent?.type || null,
      conversationId: conversation?.conversation?.id || req.body?.contexto?.conversaId || null,
    }, {
      loadLive: (scope) => executiveLiveSources(actor, scope),
      simulate: (request) => executiveSimulate(actor, request),
    });
    if (executive) {
      const improved = await improveAnswerWithOllama(question, executive).catch(() => null);
      if (improved) executive.resposta = `${executive.resposta}\n\nLeitura conversacional (não altera os números acima):\n${improved}`;
      return finishTask(req, res, actor, question, executive, started);
    }
    const enterpriseAnswer = await answerFromEnterpriseKnowledge(question, actor);
    if (enterpriseAnswer && !looksLikeTask(question))
      return finishTask(req, res, actor, question, enterpriseAnswer, started);
    if (!enterpriseAnswer && /\b(politica|procedimento|regra interna|manual interno|como faco|como fazer|orientacao interna)\b/i.test(normalize(question)) && !looksLikeTask(question))
      return finishTask(req, res, actor, question, {
        resposta: "Não encontrei uma regra interna validada que responda a essa pergunta.",
        intencao: { type: "conhecimento_empresarial", interpretador: "pesquisa_textual" }, dados: [], fontes: [], sugestoes: [], origem: "conhecimento",
      }, started);
    const automationPlan = planAutomation(question, actor);
    if (automationPlan) {
      if (!automationPlan.ok) {
        const result = { resposta: automationPlan.pergunta || automationPlan.erro, intencao: { type: "automacao", interpretador: "regras" }, dados: [], sugestoes: [] };
        return finishTask(req, res, actor, question, result, started);
      }
      const automacao = saveAutomation({ ...automationPlan.automacao, atualizadaPor: actor.id });
      const result = {
        resposta: `Preparei a automação “${automacao.nome}”. Confira a prévia e confirme antes da ativação.`,
        intencao: { type: "automacao", interpretador: "regras" }, dados: [], automacao,
        sugestoes: [], origem: "banco",
      };
      return finishTask(req, res, actor, question, result, started);
    }
    const context = taskContext(actor, conversation);
    let taskPlan = planCompositeTask(question, context) || planCharlieTask(question, context);
    if (!taskPlan && looksLikeCompositeTask(question))
      taskPlan = acceptCompositeModelPlan(await selectCompositeWithOllama(question));
    if (!taskPlan && looksLikeTask(question))
      taskPlan = acceptModelSelection(await selectTaskWithOllama(question), context);
    if (taskPlan) {
      if (enterpriseAnswer) taskPlan.conhecimento = { fontes: enterpriseAnswer.fontes, orientacao: enterpriseAnswer.resposta };
      taskPlan.conversaId = conversation?.conversation?.id || null;
      const taskResult = taskPlan.tipo === "composta" && !taskPlan.bloqueada
        ? await withReadOnlyDatabase((db) => runCompositeTask(taskPlan, actor, {
            query: (sql, params) => query(db, sql, params, { timeoutMs: 20000 }),
          }))
        : taskPlan.tipo === "executar" && !taskPlan.bloqueada
        ? await withReadOnlyDatabase((db) => runCharlieTask(taskPlan, actor, {
            query: (sql, params) => query(db, sql, params, { timeoutMs: 20000 }),
          }))
        : await runCharlieTask(taskPlan, actor, {});
      if (taskResult) return finishTask(req, res, actor, question, taskResult, started);
    }
    const localIntent = resolveConversationIntent(detectIntent(question), conversation, question);
    const intent = await interpretWithOllama(question, localIntent);
    const asked = modelQuestion(question, conversation, intent);
    const result = await withReadOnlyDatabase(async (db) => {
      const sqlLog = [];
      const original = db.executeQuery.bind(db);
      db.executeQuery = (transaction, sql, params) => {
        if (typeof sql === "string" && /^\s*(select|with)\b/i.test(sql)) sqlLog.push(sql.trim());
        return original(transaction, sql, params);
      };
      const value = await answer(db, asked, intent);
      const statements = sqlLog.filter(Boolean);
      if (!value.sql && statements.length) value.sql = statements.join("\n\n").slice(0, 8000);
      if (!value.tabelas?.length && value.sql)
        value.tabelas = [...new Set(statements.flatMap((item) => referencedTables(item)))];
      if (!value.sqlValidavel && value.sql && !String(value.sql).includes("\n\n"))
        value.sqlValidavel = value.sql;
      else if (!value.sqlValidavel && statements.length === 1)
        value.sqlValidavel = statements[0];
      if (!value.origem) value.origem = "banco";
      return value;
    });
    const improved = await improveAnswerWithOllama(question, result);
    if (improved) result.resposta = improved;
    const suggestions = result.sugestoes?.length
      ? result.sugestoes
      : [
          "vendas de hoje",
          "estoque baixo",
          "contas a receber",
          "saldo dos bancos",
          "sugestão de compras",
        ];
    const alerts = result.alertas?.length
      ? result.alertas
      : result.intencao?.type === "estoque_negativo" && result.dados.length
        ? [
            {
              tipo: "critico",
              texto: `${result.dados.length} produto(s) com estoque negativo.`,
            },
          ]
        : [];
    const conversationId = saveCharlieTurn(
      user,
      req.body?.contexto?.conversaId,
      question,
      { ...result, sugestoes: suggestions, alertas: alerts },
      Date.now() - started,
    );
    recordCharlieAudit({
      userId: user,
      pergunta: question,
      intencao: result.intencao?.type || null,
      tabelas: result.tabelas,
      sql: result.sql,
      duracaoMs: Date.now() - started,
      registros: result.dados?.length || 0,
    });
    res.json({
      ok: true,
      pergunta: question,
      ...result,
      sugestoes: suggestions,
      alertas: alerts,
      colunas: result.dados?.[0] ? Object.keys(result.dados[0]) : [],
      conversaId: conversationId,
      pergunta_interpretada: question,
      interpretador: result.intencao?.interpretador || "regras",
    });
  } catch (error) {
    recordCharlieAudit({
      userId: user,
      pergunta: question,
      erro: error.message,
      duracaoMs: Date.now() - started,
    });
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
export { answer };
export default router;
