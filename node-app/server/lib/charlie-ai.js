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
];
const RANKING_TYPES = ["produtos", "vendedores", "clientes", "estoque_baixo"];
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
    intent.person = String(value.pessoa || "").trim().slice(0, 80) || null;
    intent.limit = Math.max(1, Math.min(50, Number(value.limite) || 50));
  }
  if (value.tipo === "relatorios")
    intent.section = value.secao || "help";
  return intent;
}

export async function interpretWithOllama(question, deterministicIntent) {
  if (deterministicIntent)
    return { ...deterministicIntent, interpretador: "regras" };
  const content = await ollamaChat({
    format: INTENT_FORMAT,
    messages: [
      {
        role: "system",
        content:
          "Você é o classificador do Charlie, assistente de gestão financeira de um ERP. Entenda sinônimos e linguagem cotidiana: dever, débito, compromisso e saída são pagar; cobrar, crédito e entrada são receber; em atraso e fora do prazo são vencido; liquidado e baixado são quitado. Para financeiro_titulos, classifique dominio como pagar ou receber, status e pessoa citada. Escolha somente uma intenção permitida. Nunca gere SQL, comandos, explicações ou ações. Use desconhecida quando a pergunta não for uma consulta operacional suportada. Retorne apenas o JSON do schema.",
      },
      { role: "user", content: String(question).slice(0, 500) },
    ],
  });
  return validateAiIntent(safeJson(content));
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
