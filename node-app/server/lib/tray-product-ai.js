import { ollamaChat } from "./ollama.js";

const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    description_small: { type: "string" },
    description: { type: "string" },
    brand: { type: "string" },
    model: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    keywords: { type: "string" },
  },
  required: ["name", "description_small", "description", "brand", "model", "meta_title", "meta_description", "keywords"],
};

const text = (value, limit) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);

export function sanitizeTrayProductSuggestion(value = {}) {
  return {
    name: text(value.name, 120),
    description_small: text(value.description_small, 500),
    description: text(value.description, 5000),
    brand: text(value.brand, 100),
    model: text(value.model, 100),
    meta_title: text(value.meta_title, 70),
    meta_description: text(value.meta_description, 160),
    keywords: text(value.keywords, 255),
  };
}

export async function suggestTrayProduct(input = {}) {
  const context = {
    produto: text(input.product, 300),
    marca: text(input.brand, 100),
    modelo: text(input.model, 100),
    categoria: text(input.category, 120),
    aplicacao: text(input.application, 500),
    caracteristicas: text(input.features, 1200),
    publico: text(input.audience, 300),
    tom: text(input.tone || "profissional, claro e comercial", 120),
  };
  if (!context.produto) throw Object.assign(new Error("Informe o produto que será anunciado."), { status: 400 });
  const content = await ollamaChat({
    maxTokens: 900,
    temperature: 0.25,
    format: schema,
    messages: [
      { role: "system", content: "Você é redator de e-commerce brasileiro especializado em autopeças. Produza somente JSON válido no esquema solicitado. Não invente compatibilidade, certificação, garantia, medida, material ou benefício técnico não informado. Não use HTML, emojis, superlativos absolutos ou alegações enganosas. A descrição deve ser original, objetiva, em português do Brasil e útil para busca." },
      { role: "user", content: `Crie o cadastro comercial para a Tray a partir destes dados verificáveis: ${JSON.stringify(context)}. O nome deve identificar produto, marca/modelo quando informados e aplicação sem excesso. A descrição curta deve ter até 300 caracteres. A descrição completa deve incluir apresentação, características fornecidas, aplicação informada e uma orientação para conferir compatibilidade antes da compra. SEO natural, sem repetição de palavras.` },
    ],
  });
  if (!content) throw Object.assign(new Error("O Ollama não respondeu. Verifique se o serviço e o modelo estão ativos."), { status: 503 });
  let parsed;
  try { parsed = JSON.parse(content); }
  catch { throw Object.assign(new Error("O Ollama retornou um formato inválido. Tente gerar novamente."), { status: 502 }); }
  const suggestion = sanitizeTrayProductSuggestion(parsed);
  if (!suggestion.name || !suggestion.description) throw Object.assign(new Error("A sugestão ficou incompleta. Informe mais características e tente novamente."), { status: 422 });
  return suggestion;
}
