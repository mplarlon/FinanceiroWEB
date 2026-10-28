import { redigir } from "./open-finance-crypto.js";
import { contaDeTransferencia } from "./open-finance-engine.js";

const PLUGGY = "https://api.pluggy.ai";

const UUID_PLUGGY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function normalizarClientIdPluggy(valor) {
  const texto = String(valor || "").trim();
  const achado = texto.match(UUID_PLUGGY);
  if (!achado) {
    throw Object.assign(new Error("O CLIENT_ID da Pluggy é um UUID, com cinco blocos separados por hífen. Em Applications, copie só esse código, sem o rótulo Client Secret."), { status: 400 });
  }
  return achado[0].toLowerCase();
}

export function normalizarSegredoProvedor(valor) {
  return String(valor || "").trim().replace(/^(client secret|cliente secret|client_secret)\s*:\s*/i, "").trim();
}

export function traduzirErroPluggy(codigo, mensagem) {
  const texto = `${codigo || ""} ${mensagem || ""}`;
  if (/TRIAL_CLIENT_ITEM_CREATE_NOT_ALLOWED|only create Sandbox \(Pluggy Bank\)/i.test(texto)) {
    return "A aplicação da Pluggy está no plano trial e só conecta o banco de teste Pluggy Bank. Banco real, como o Bradesco, fica bloqueado até a Pluggy liberar conexões de produção.";
  }
  if (/clientId must be a UUID/i.test(texto)) {
    return "O CLIENT_ID da Pluggy precisa ser só o UUID, com cinco blocos separados por hífen. Não cole o rótulo Client Secret no mesmo campo.";
  }
  return String(mensagem || codigo || "falha");
}

function falha(mensagem, status = 502, retry = false) {
  return Object.assign(new Error(redigir(mensagem)), { status, retry });
}

async function lerJson(resposta) {
  const texto = await resposta.text();
  if (!texto) return {};
  try {
    return JSON.parse(texto);
  } catch {
    throw falha(`Resposta inválida do provedor (HTTP ${resposta.status}).`, resposta.status, resposta.status >= 500);
  }
}

async function chamar(buscar, url, opcoes, rotulo) {
  let resposta;
  try {
    resposta = await buscar(url, { ...opcoes, signal: opcoes.signal || AbortSignal.timeout(20000) });
  } catch (error) {
    throw falha(`${rotulo}: ${error.message}`, 503, true);
  }
  const corpo = await lerJson(resposta);
  if (!resposta.ok) {
    const detalhe = traduzirErroPluggy(corpo.codeDescription, corpo.message || corpo.error || corpo.code || resposta.statusText || "falha");
    throw falha(`${rotulo}: ${detalhe}`, resposta.status, resposta.status === 429 || resposta.status >= 500);
  }
  return corpo;
}

function cabecalho(apiKey) {
  return { "X-API-KEY": apiKey, Accept: "application/json", "Content-Type": "application/json" };
}

export function criarPluggy(credenciais, buscar) {
  const cache = { apiKey: "", expira: 0 };

  async function apiKey() {
    if (cache.apiKey && cache.expira > Date.now() + 60_000) return cache.apiKey;
    const corpo = await chamar(buscar, `${PLUGGY}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId: credenciais.clientId, clientSecret: credenciais.clientSecret }),
    }, "Pluggy autenticação");
    if (!corpo.apiKey) throw falha("A Pluggy não devolveu a chave de API.", 502, true);
    cache.apiKey = corpo.apiKey;
    cache.expira = Date.now() + 90 * 60 * 1000;
    return cache.apiKey;
  }

  async function autenticado(caminho, opcoes = {}) {
    const chave = await apiKey();
    return chamar(buscar, `${PLUGGY}${caminho}`, {
      method: opcoes.method || "GET",
      headers: cabecalho(chave),
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    }, "Pluggy");
  }

  return {
    nome: "pluggy",
    async verificar() {
      await apiKey();
      return { ok: true };
    },
    async instituicoes() {
      const sandbox = credenciais.ambiente === "sandbox";
      const corpo = await autenticado(`/connectors?countries=BR&sandbox=${sandbox ? "true" : "false"}`);
      const lista = corpo.results || corpo || [];
      return (Array.isArray(lista) ? lista : [])
        .filter((item) => sandbox ? item.isSandbox === true : item.isSandbox !== true)
        .map((item) => ({
          id: String(item.id),
          nome: item.name || item.institution || "Instituição",
          tipo: item.type || "",
          pessoaJuridica: /business|pj|juridica/i.test(`${item.type || ""} ${item.name || ""}`) || item.isOpenFinance === true,
          openFinance: item.isOpenFinance !== false,
          sandbox: item.isSandbox === true,
          saude: item.health?.status || item.status || "",
        }));
    },
    async iniciarConexao({ empresa, itemId, webhookUrl }) {
      const corpo = await autenticado("/connect_token", {
        method: "POST",
        body: {
          ...(itemId ? { itemId } : {}),
          options: {
            clientUserId: `erp-${empresa}`,
            products: ["ACCOUNTS", "TRANSACTIONS", "IDENTITY"],
            ...(webhookUrl ? { webhookUrl } : {}),
          },
        },
      });
      if (!corpo.accessToken) throw falha("A Pluggy não devolveu o token de conexão.", 502, true);
      return {
        provedor: "pluggy",
        connectToken: corpo.accessToken,
        includeSandbox: credenciais.ambiente === "sandbox",
        widgetScript: "https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js",
      };
    },
    async obterConexao(itemId) {
      return autenticado(`/items/${encodeURIComponent(itemId)}`);
    },
    async consentimento(itemId) {
      const corpo = await autenticado(`/consents?itemId=${encodeURIComponent(itemId)}`);
      const lista = corpo.results || (Array.isArray(corpo) ? corpo : []);
      const atual = lista[0] || null;
      return atual ? {
        id: atual.id || "",
        expiraEm: atual.expiresAt || null,
        revogadoEm: atual.revokedAt || null,
        produtos: atual.products || [],
      } : { id: "", expiraEm: null, revogadoEm: null, produtos: [] };
    },
    async contas(itemId) {
      const corpo = await autenticado(`/accounts?itemId=${encodeURIComponent(itemId)}`);
      const lista = corpo.results || [];
      return lista.map((conta) => {
        const transferencia = contaDeTransferencia(conta.bankData?.transferNumber);
        return {
          idExterno: String(conta.id),
          nome: String(conta.name || conta.marketingName || "Conta").slice(0, 120),
          tipo: String(conta.subtype || conta.type || "").slice(0, 30),
          banco: transferencia.banco,
          agencia: transferencia.agencia,
          numero: transferencia.numero || String(conta.number || "").slice(0, 30),
          moeda: conta.currencyCode || "BRL",
          saldo: conta.balance == null ? null : Number(conta.balance),
        };
      });
    },
    async transacoes(contaId, periodo) {
      const itens = [];
      let pagina = 1;
      let total = 1;
      do {
        const corpo = await autenticado(`/transactions?accountId=${encodeURIComponent(contaId)}&from=${periodo.de}&to=${periodo.ate}&pageSize=500&page=${pagina}`);
        itens.push(...(corpo.results || []));
        total = Number(corpo.totalPages || 1);
        pagina += 1;
      } while (pagina <= total && pagina <= 30);
      return { itens, truncado: pagina <= total };
    },
    async excluir(itemId) {
      await autenticado(`/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      return { ok: true };
    },
    async registrarWebhook({ url, segredo }) {
      return autenticado("/webhooks", {
        method: "POST",
        body: { url, event: "all", headers: { "X-Webhook-Token": segredo } },
      });
    },
  };
}

function basic(credenciais) {
  return `Basic ${Buffer.from(`${credenciais.clientId}:${credenciais.clientSecret}`).toString("base64")}`;
}

export function criarBelvo(credenciais, buscar) {
  const base = credenciais.ambiente === "sandbox" ? "https://sandbox.belvo.com" : "https://api.belvo.com";

  async function autenticado(caminho, opcoes = {}) {
    return chamar(buscar, `${base}${caminho}`, {
      method: opcoes.method || "GET",
      headers: {
        Authorization: basic(credenciais),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    }, "Belvo");
  }

  return {
    nome: "belvo",
    async instituicoes() {
      const corpo = await autenticado("/api/institutions/?country_code=BR&page_size=1000");
      const lista = corpo.results || corpo || [];
      return (Array.isArray(lista) ? lista : []).map((item) => ({
        id: String(item.id || item.name),
        nome: item.display_name || item.name || "Instituição",
        tipo: item.type || "",
        pessoaJuridica: true,
        openFinance: true,
        saude: item.status || "",
      }));
    },
    async iniciarConexao({ empresa, cpf, nome, cnpj, razao, termosUrl, callbackUrl }) {
      if (!cpf || !nome || !cnpj || !razao || !termosUrl || !callbackUrl) {
        throw falha("A Belvo exige CPF e nome do representante, CNPJ, razão social, URL dos termos e URL de retorno.", 400, false);
      }
      const corpo = await autenticado("/api/token/", {
        method: "POST",
        body: {
          id: credenciais.clientId,
          password: credenciais.clientSecret,
          scopes: "read_institutions,write_links,read_links,read_consents,write_consents",
          fetch_resources: ["ACCOUNTS", "TRANSACTIONS"],
          widget: {
            purpose: "Conciliação bancária do ERP e acompanhamento financeiro da empresa.",
            openfinance_feature: "consent_link_creation",
            callback_urls: { success: callbackUrl, exit: callbackUrl, event: callbackUrl },
            consent: {
              terms_and_conditions_url: termosUrl,
              permissions: ["REGISTER", "ACCOUNTS", "CREDIT_CARDS", "CREDIT_OPERATIONS"],
              identification_info: [
                { type: "CPF", number: String(cpf).replace(/\D/g, ""), name: nome },
                { type: "CNPJ", number: String(cnpj).replace(/\D/g, ""), name: razao },
              ],
            },
            branding: { company_name: razao },
            external_id: `erp-${empresa}`,
          },
        },
      });
      const token = corpo.access || corpo.refresh || "";
      if (!token) throw falha("A Belvo não devolveu o token do widget.", 502, true);
      return {
        provedor: "belvo",
        connectToken: token,
        widgetScript: "https://cdn.belvo.io/belvo-widget-1-stable.js",
      };
    },
    async obterConexao(linkId) {
      return autenticado(`/api/links/${encodeURIComponent(linkId)}/`);
    },
    async consentimento(consentId) {
      if (!consentId) return { id: "", expiraEm: null, revogadoEm: null, produtos: [] };
      const atual = await autenticado(`/api/consents/${encodeURIComponent(consentId)}/`);
      return {
        id: atual.id || consentId,
        expiraEm: atual.expiration_date || atual.expires_at || null,
        revogadoEm: atual.status === "REVOKED" ? (atual.revoked_at || new Date().toISOString()) : null,
        produtos: atual.permissions || [],
      };
    },
    async contas(linkId) {
      const corpo = await autenticado(`/api/accounts/?link=${encodeURIComponent(linkId)}`);
      return (corpo.results || []).map((conta) => ({
        idExterno: String(conta.id),
        nome: String(conta.name || conta.number || "Conta").slice(0, 120),
        tipo: String(conta.category || conta.type || "").slice(0, 30),
        banco: String(conta.institution?.name || "").slice(0, 10),
        agencia: String(conta.agency || "").slice(0, 20),
        numero: String(conta.number || "").slice(0, 30),
        moeda: conta.currency || "BRL",
        saldo: conta.balance?.current == null ? null : Number(conta.balance.current),
      }));
    },
    async saldos(linkId) {
      const corpo = await autenticado(`/api/br/balances/?link=${encodeURIComponent(linkId)}`);
      return corpo.results || [];
    },
    async transacoes(linkId, periodo) {
      const corpo = await autenticado(`/api/transactions/?link=${encodeURIComponent(linkId)}&value_date__range=${periodo.de},${periodo.ate}&page_size=1000`);
      return { itens: corpo.results || [], truncado: Boolean(corpo.next) };
    },
    async excluir(linkId) {
      await autenticado(`/api/links/${encodeURIComponent(linkId)}/`, { method: "DELETE" });
      return { ok: true };
    },
    async registrarWebhook() {
      return { ignorado: true, motivo: "O webhook da Belvo é configurado no painel da Belvo, apontando para /api/open-finance/webhook." };
    },
  };
}

export function criarProvedor(nome, credenciais, buscar) {
  if (!credenciais?.clientId || !credenciais?.clientSecret) {
    throw falha("Informe o identificador e o segredo do provedor. Nenhuma credencial fictícia foi gravada.", 409, false);
  }
  if (nome === "belvo") return criarBelvo(credenciais, buscar);
  if (nome === "pluggy") return criarPluggy(credenciais, buscar);
  throw falha("Provedor não suportado. Use pluggy ou belvo.", 400, false);
}
