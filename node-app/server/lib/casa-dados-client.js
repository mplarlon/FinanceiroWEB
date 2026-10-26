const HOST = "https://api.casadosdados.com.br";

export class CasaDadosError extends Error {
  constructor(message, status = 502, detalhe = null) {
    super(message);
    this.name = "CasaDadosError";
    this.status = status;
    this.detalhe = detalhe;
  }
}

function mensagemHttp(status) {
  if (status === 401) return "API Key inválida ou ausente.";
  if (status === 403) return "Sem saldo ou sem permissão para esta operação na Casa dos Dados.";
  if (status === 400) return "A Casa dos Dados recusou os filtros enviados.";
  if (status === 404) return "A Casa dos Dados não encontrou o recurso pedido.";
  if (status === 429) return "A Casa dos Dados limitou o ritmo das consultas.";
  return `A Casa dos Dados respondeu HTTP ${status}.`;
}

export function createCasaDadosClient({
  apiKey = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  host = HOST,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  async function request(method, path, { body, query, retry = false } = {}) {
    if (!String(apiKey || "").trim()) throw new CasaDadosError("API Key não configurada.", 400);
    const url = new URL(path, host);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          "api-key": apiKey,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const timeout = error?.name === "AbortError";
      if (retry && method === "GET") return request(method, path, { query, retry: false });
      throw new CasaDadosError(
        timeout ? "A Casa dos Dados não respondeu no tempo limite." : "Falha de comunicação com a Casa dos Dados.",
        timeout ? 504 : 503,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = null; }
    }
    if (!response.ok) {
      if (retry && method === "GET" && [429, 502, 503, 504].includes(response.status)) {
        await sleep(400);
        return request(method, path, { query, retry: false });
      }
      throw new CasaDadosError(mensagemHttp(response.status), response.status, payload);
    }
    return payload;
  }

  return {
    saldo: () => request("GET", "/v5/saldo", { retry: true }),
    pesquisar: (body, tipoResultado = "simples") => request("POST", "/v5/cnpj/pesquisa", {
      body,
      query: { tipo_resultado: tipoResultado === "completo" ? "completo" : "simples" },
    }),
    consultarCnpj: (cnpj) => request("GET", `/v4/cnpj/${encodeURIComponent(cnpj)}`),
    gerarArquivo: (body) => request("POST", "/v5/cnpj/pesquisa/arquivo", { body }),
    empresasAbertasHoje: () => request("GET", "/v4/dashboard/cnpj/empresas-abertas/hoje"),
  };
}
