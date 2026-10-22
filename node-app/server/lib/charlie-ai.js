import { parseFinancialDate } from "./finance-assistant.js";
import { ollamaChat } from "./ollama.js";

export const INTENT_TYPES = [
  "abertura_dia",
  "ajuda",
  "estoque_negativo",
  "estoque_baixo",
  "saldo_bancos",
  "contas_receber",
  "contas_pagar",
  "produtos",
  "vendedores",
  "clientes",
  "caixa",
  "vendas",
  "financeiro_titulos",
  "relatorios",
  "compras_curva_abc",
  "compras_sugestao",
  "compras_cobertura",
  "compras_oc_pendente",
  "consulta_sql",
];
const RANKING_TYPES = ["produtos", "vendedores", "clientes"];
const INTENT_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: ["tipo"],
  properties: {
    tipo: { type: "string", enum: [...INTENT_TYPES, "desconhecida"] },
    limite: { type: "integer", minimum: 1, maximum: 50 },
    dominio: { type: "string", enum: ["pagar", "receber"] },
    status: { type: "string", enum: ["aberto", "vencido", "quitado", "parcial"] },
    pessoa: { type: "string" },
    secao: { type: "string", enum: ["help", "executive", "stores", "goals", "margins", "inventory", "cashflow", "sellers", "retention", "suppliers", "alerts", "daily"] },
  },
};

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function validateAiIntent(value) {
  if (!value || !INTENT_TYPES.includes(value.tipo)) return null;
  const intent = { type: value.tipo, interpretador: "ollama" };
  if (RANKING_TYPES.includes(value.tipo))
    intent.limit = Math.max(1, Math.min(50, Number(value.limite) || 10));
  if (value.tipo === "financeiro_titulos") {
    intent.domain = ["pagar", "receber"].includes(value.dominio) ? value.dominio : null;
    intent.status = ["aberto", "vencido", "quitado", "parcial"].includes(value.status)
      ? value.status
      : "aberto";
    const person = String(value.pessoa || "").trim().slice(0, 80);
    intent.person = /^(desconhecid[ao]|nenhum|null|nao informado)$/i.test(person) ? null : person || null;
    intent.limit = Math.max(1, Math.min(50, Number(value.limite) || 50));
  }
  if (value.tipo === "relatorios")
    intent.section = value.secao || "help";
  return intent;
}

function coerceAiValue(value) {
  if (!value || typeof value !== "object") return value;
  if (value.tipo === "contas_pagar")
    return { ...value, tipo: "financeiro_titulos", dominio: value.dominio || "pagar" };
  if (value.tipo === "contas_receber")
    return { ...value, tipo: "financeiro_titulos", dominio: value.dominio || "receber" };
  return value;
}

function explicitTop(question, maximum = 50) {
  const match = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/\btop\s+(\d+)/);
  return match ? Math.max(1, Math.min(maximum, Number(match[1]))) : null;
}

function finalizeLowStockIntent(intent, question) {
  if (intent?.type !== "estoque_baixo") return intent;
  const top = explicitTop(question, 5000);
  const next = { ...intent };
  if (top) next.limit = top;
  else delete next.limit;
  return next;
}

export function resolveInterpretedIntent(question, deterministicIntent, aiValue) {
  if (deterministicIntent?.explainCalculation || deterministicIntent?.negativeTimeline)
    return { ...deterministicIntent, interpretador: "contexto" };
  const interpreted = validateAiIntent(coerceAiValue(aiValue));
  if (interpreted?.type === "financeiro_titulos" && !interpreted.date)
    interpreted.date = parseFinancialDate(question);
  let intent = null;
  if (!interpreted)
    intent = deterministicIntent ? { ...deterministicIntent, interpretador: "regras_fallback" } : null;
  else if (!deterministicIntent) intent = interpreted;
  else if (interpreted.type === deterministicIntent.type) {
    const merged = { ...deterministicIntent, ...interpreted, interpretador: "ollama" };
    if (interpreted.type === "financeiro_titulos") {
      merged.date = deterministicIntent.date || interpreted.date || null;
      merged.person = interpreted.person || deterministicIntent.person || null;
      merged.domain = interpreted.domain || deterministicIntent.domain || null;
      merged.status = interpreted.status || deterministicIntent.status || "aberto";
    }
    intent = merged;
  } else {
    // Specialized financial and purchasing knowledge stays in charge when Ollama
    // would send a known question to free-form SQL. A matching type still comes
    // from Ollama, including contas a pagar/receber coerced to financeiro_titulos.
    intent = { ...deterministicIntent, interpretador: "conhecimento_predefinido" };
  }
  return finalizeLowStockIntent(intent, question);
}

export async function interpretWithOllama(question, deterministicIntent) {
  if (deterministicIntent?.explainCalculation || deterministicIntent?.negativeTimeline || deterministicIntent?.interpretador === "contexto")
    return { ...deterministicIntent, interpretador: "contexto" };
  const content = await ollamaChat({
    format: INTENT_FORMAT,
    messages: [
      {
        role: "system",
        content:
          "Você é o planejador do Charlie, assistente de gestão de um ERP. Classifique todas as perguntas. Quando a intenção sugerida já tiver o tipo certo, preserve esse tipo e apenas refine os campos. Perguntas de contas, títulos, vencimentos, pagamentos e recebimentos usam financeiro_titulos, com dominio pagar ou receber, status aberto, vencido, quitado ou parcial, e a pessoa citada. Compras usam compras_sugestao, compras_cobertura, compras_curva_abc ou compras_oc_pendente. Estoque baixo lista todos os produtos; não preencha limite. Limite só vale para ranking de produtos, vendedores ou clientes quando a pergunta pedir top N. Use consulta_sql para qualquer outra consulta de leitura ao banco. Nunca gere SQL nesta etapa, comandos, explicações ou ações. Use desconhecida apenas quando não for uma consulta de dados. Retorne somente JSON.",
      },
      { role: "user", content: JSON.stringify({ pergunta: String(question).slice(0, 500), intencao_sugerida: deterministicIntent || null }) },
    ],
  });
  return resolveInterpretedIntent(question, deterministicIntent, safeJson(content));
}

const NARRATIVE_FORMAT = {
  type: "object",
  additionalProperties: false,
  required: ["resumo"],
  properties: { resumo: { type: "string" } },
};
const numbers = (text) => String(text || "").match(/\d+(?:[.,]\d+)*/g) || [];

export function validAiSummary(summary, source) {
  const clean = String(summary || "").trim();
  if (!clean || clean.length > 1400 || clean.includes("```")) return false;
  const facts = new Set(numbers(source));
  return numbers(clean).every((number) => facts.has(number));
}

export async function improveAnswerWithOllama(question, result) {
  const original = String(result?.resposta || "").trim();
  if (!original || !result?.intencao?.type) return null;
  const content = await ollamaChat({
    format: NARRATIVE_FORMAT,
    maxTokens: 360,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "Você é Charlie, assistente financeira empresarial. Responda em português do Brasil, de forma clara, breve e adequada a usuários leigos. Use somente fatos, datas e números presentes no relatório fornecido. Não invente causas, registros ou ações e não mencione SQL, tabelas ou campos. Retorne apenas o JSON solicitado.",
      },
      {
        role: "user",
        content: JSON.stringify({
          pergunta: String(question).slice(0, 500),
          relatorio: original.slice(0, 6000),
        }),
      },
    ],
  });
  const summary = safeJson(content)?.resumo;
  return validAiSummary(summary, original) ? String(summary).trim() : null;
}
