import assert from "node:assert/strict";
import test from "node:test";
import { cifrar, decifrar, chaveDe, redigir } from "../server/lib/open-finance-crypto.js";
import { montarRelatorio, proximaTentativaSegundos, VERSAO_ESQUEMA } from "../server/lib/open-finance-engine.js";
import { TABELAS_OPEN_FINANCE, criarRepositorioFirebird } from "../server/lib/open-finance-firebird.js";
import { criarPluggy, normalizarClientIdPluggy, traduzirErroPluggy } from "../server/lib/open-finance-providers.js";
import { criarRepositorioMemoria } from "../server/lib/open-finance-repository.js";
import { criarServico } from "../server/lib/open-finance-service.js";

const E2E = "E1234567890123456789012345678901";

function resposta(status, corpo) {
  return { ok: status < 400, status, text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)) };
}

function pluggy(transacoes, extra = {}) {
  return async (url, opcoes = {}) => {
    extra.urls.push(String(url));
    extra.corpos.push(opcoes.body ? JSON.parse(opcoes.body) : null);
    if (String(url).endsWith("/auth")) return resposta(200, { apiKey: "chave-temporaria" });
    if (String(url).includes("/consents")) return resposta(200, { results: [{ id: "consent-1", expiresAt: null, revokedAt: null, products: ["ACCOUNTS", "TRANSACTIONS"] }] });
    if (String(url).includes("/accounts?")) return resposta(200, { results: [{ id: "acc-1", name: "Conta PJ", subtype: "CHECKING_ACCOUNT", balance: 278000, currencyCode: "BRL", bankData: { transferNumber: "341/1234/98765-4" } }] });
    if (String(url).includes("/transactions")) return resposta(200, { results: transacoes, page: 1, totalPages: 1 });
    if (String(url).includes("/items/")) return resposta(200, { id: "item-1", clientUserId: "erp-1", connector: { id: 201, name: "Itaú" } });
    if (String(url).includes("/connect_token")) return resposta(200, { accessToken: "widget-token" });
    if (String(url).includes("/webhooks")) return resposta(200, { id: "wh-1" });
    return resposta(500, { message: "clientSecret=segredo-nao-pode-aparecer" });
  };
}

function montar(opcoes = {}) {
  const repositorio = criarRepositorioMemoria();
  const segredos = { valor: {} };
  const chamadas = { aplicar: [], importar: [], desfazer: [] };
  const extrato = new Map();
  let seq = 1;
  const urls = [];
  const corpos = [];
  const servico = criarServico({
    repositorio,
    segredos: {
      ler: async () => segredos.valor,
      gravar: async (valor) => { segredos.valor = valor; },
    },
    chave: async () => chaveDe("chave-mestra-de-teste-123"),
    buscar: opcoes.buscar || pluggy(opcoes.transacoes || [], { urls, corpos }),
    carregar: opcoes.carregar || (async () => ({ titulos: opcoes.titulos || [], contasProprias: [], baixadosSemBanco: opcoes.baixados || [] })),
    importar: async (_tx, pedido) => {
      chamadas.importar.push(pedido);
      for (const item of pedido.itens) {
        if (!extrato.has(item.numdoc)) extrato.set(item.numdoc, { id: seq++, movBancario: null });
      }
    },
    localizar: async (_tx, numdoc) => extrato.get(numdoc) || null,
    aplicar: async (_tx, decisao) => {
      chamadas.aplicar.push(decisao);
      const movimento = 8000 + chamadas.aplicar.length;
      for (const item of extrato.values()) {
        if (item.id === decisao.movimentoId || item.id === decisao.espelhoId) item.movBancario = movimento;
      }
      return { movimentos: [movimento], titulos: decisao.titulos || [] };
    },
    desfazer: async (_tx, registro) => { chamadas.desfazer.push(registro); },
    transacao: opcoes.transacao || (async (fn) => fn({})),
    narrar: opcoes.narrar,
    notificar: async (itens) => { chamadas.avisos = itens; },
  });
  return { servico, repositorio, segredos, chamadas, urls, corpos };
}

async function preparar(base, { modo = "sugestao", empresa = 1 } = {}) {
  await base.servico.configurar({ provedor: "pluggy", ambiente: "sandbox", clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "segredo-real" }, { idusuario: 4 });
  const conexao = await base.repositorio.salvarConexao({ empresa, provedor: "pluggy", itemExterno: "item-1", instituicao: "Itaú", status: "ativa", consentimentoId: "consent-1" });
  const conta = await base.repositorio.salvarConta({ empresa, conexaoId: conexao.id, idExterno: "acc-1", nome: "Conta", banco: "341", agencia: "1234", numero: "98765-4", vinculada: true, cdbanco: "341", agenciaErp: "1234", numcontaErp: "98765-4", saldo: 278000 });
  if (modo !== "sugestao") await base.servico.salvarPolitica(empresa, { modo, confirmado: true }, { idusuario: 1, perfil: "admin" });
  return { conexao, conta };
}

test("a chave cifra o segredo e o texto de erro não leva senha nem token", () => {
  const chave = chaveDe("chave-mestra-de-teste-123");
  const cifrado = cifrar("segredo-real", chave);
  assert.equal(cifrado.includes("segredo-real"), false);
  assert.equal(decifrar(cifrado, chave), "segredo-real");
  assert.equal(redigir("clientSecret=abc bearer xyz").includes("abc"), false);
  assert.equal(chaveDe("curta"), null);
});

test("o esquema versionado não tem coluna de senha bancária", () => {
  assert.equal(VERSAO_ESQUEMA, 1);
  const sql = Object.values(TABELAS_OPEN_FINANCE).join(" ");
  assert.equal(/SENHA|PASSWORD/i.test(sql), false);
  assert.match(sql, /IDEMPRESA/);
});

test("a cola com rótulo guarda só o UUID e a Pluggy é consultada antes de substituir o segredo", async () => {
  const base = montar();
  await base.servico.configurar({
    provedor: "pluggy",
    ambiente: "sandbox",
    clientId: "Cc7b7d83-6403-471b-a18b-4b64671cbcb8 cliente secret: segredo-real",
    clientSecret: "cliente secret: segredo-real",
  }, { idusuario: 4 });
  const chave = chaveDe("chave-mestra-de-teste-123");
  assert.equal(decifrar(base.segredos.valor.clientId, chave), "cc7b7d83-6403-471b-a18b-4b64671cbcb8");
  assert.equal(decifrar(base.segredos.valor.clientSecret, chave), "segredo-real");
  assert.throws(() => normalizarClientIdPluggy("sem-uuid"), /UUID/);
});

test("credencial que não é UUID não apaga a configuração anterior", async () => {
  const base = montar();
  await base.servico.configurar({ provedor: "pluggy", ambiente: "sandbox", clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "segredo-real" }, { idusuario: 4 });
  const anterior = base.segredos.valor.clientId;
  await assert.rejects(() => base.servico.configurar({ provedor: "pluggy", ambiente: "producao", clientId: "api-key-colada", clientSecret: "outro" }, { idusuario: 4 }), /UUID/);
  assert.equal(base.segredos.valor.clientId, anterior);
  assert.equal(base.segredos.valor.ambiente, "sandbox");
});

test("item ainda em coleta no sandbox fica para nova leitura", async () => {
  const base = montar({
    buscar: async (url) => {
      if (String(url).endsWith("/auth")) return resposta(200, { apiKey: "k" });
      if (String(url).includes("/consents")) return resposta(200, { results: [{ id: "c1", products: ["ACCOUNTS", "TRANSACTIONS"] }] });
      if (String(url).includes("/accounts")) return resposta(200, { results: [] });
      if (String(url).includes("/items/")) return resposta(200, { id: "item-sandbox", status: "UPDATING", executionStatus: "LOGIN_IN_PROGRESS", clientUserId: "erp-1", connector: { id: 2, name: "Pluggy Bank" } });
      return resposta(500, { message: "inesperado" });
    },
  });
  await base.servico.configurar({ provedor: "pluggy", ambiente: "sandbox", clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "segredo-real" }, { idusuario: 4 });
  const resultado = await base.servico.confirmarConexao({ empresa: 1, itemId: "item-sandbox", idusuario: 4 });
  assert.equal(resultado.conexao.instituicao, "Pluggy Bank");
  assert.equal(resultado.contas.length, 0);
  assert.ok(Date.parse(resultado.conexao.proximaTentativa) > Date.now());
});

test("sandbox lista só banco de teste e o trial do Bradesco fica legível", async () => {
  const api = criarPluggy({ clientId: "id", clientSecret: "segredo", ambiente: "sandbox" }, async (url) => {
    if (String(url).endsWith("/auth")) return resposta(200, { apiKey: "k" });
    if (String(url).includes("/connectors")) return resposta(200, { results: [
      { id: 2, name: "Pluggy Bank", isSandbox: true, isOpenFinance: false, health: { status: "ONLINE" } },
      { id: 603, name: "Bradesco", isSandbox: false, isOpenFinance: true, health: { status: "ONLINE" } },
    ] });
    return resposta(500, { message: "inesperado" });
  });
  const lista = await api.instituicoes();
  assert.deepEqual(lista.map((item) => item.nome), ["Pluggy Bank"]);
  assert.equal(lista[0].sandbox, true);
  const texto = traduzirErroPluggy("TRIAL_CLIENT_ITEM_CREATE_NOT_ALLOWED", "Trial clients can only create Sandbox (Pluggy Bank) items");
  assert.match(texto, /plano trial/);
  assert.equal(/TRIAL_CLIENT/.test(texto), false);
});

test("a Pluggy recebe consentimento e não recebe senha bancária", async () => {
  const urls = [];
  const corpos = [];
  const api = criarPluggy({ clientId: "id", clientSecret: "segredo", ambiente: "sandbox" }, pluggy([], { urls, corpos }));
  const token = await api.iniciarConexao({ empresa: 7 });
  assert.equal(token.connectToken, "widget-token");
  assert.equal(corpos.at(-1).options.clientUserId, "erp-7");
  assert.equal(JSON.stringify(corpos).includes("senha"), false);
  const contas = await api.contas("item-1");
  assert.equal(contas[0].banco, "341");
  assert.equal(contas[0].saldo, 278000);
});

test("falha da API não cria lançamento e agenda nova tentativa", async () => {
  let vezes = 0;
  const base = montar({
    buscar: async (url) => {
      if (String(url).endsWith("/auth")) return resposta(200, { apiKey: "k" });
      vezes += 1;
      if (vezes === 1) return resposta(503, { message: "clientSecret=segredo-real indisponivel" });
      return pluggy([{ id: "tx-1", accountId: "acc-1", description: "PIX", amount: 10, type: "CREDIT", date: "2026-10-27" }], { urls: [], corpos: [] })(url);
    },
  });
  const { conexao } = await preparar(base);
  const falha = await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1 });
  assert.equal(falha.ok, false);
  assert.equal(falha.erro.includes("segredo-real"), false);
  assert.equal((await base.repositorio.listarMovimentos(1)).length, 0);
  const repetida = await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(repetida.novos, 1);
  assert.equal((await base.repositorio.listarMovimentos(1)).length, 1);
});

test("o mesmo extrato não gera segunda movimentação nem segunda baixa", async () => {
  const tx = { id: "tx-1", accountId: "acc-1", description: `PIX RECEBIDO ${E2E}`, amount: 2450, type: "CREDIT", date: "2026-10-27", paymentData: { paymentMethod: "PIX", referenceNumber: E2E, payer: { name: "ABC" } } };
  const base = montar({ transacoes: [tx, tx], titulos: [{ tipo: "receber", controle: 10, idempresa: 1, empresa: 1, valor: 2450, nrdoc: E2E, pessoa: "ABC", dtvenc: "2026-10-27" }] });
  const { conexao } = await preparar(base, { modo: "automatico" });
  const primeira = await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  const segunda = await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(primeira.novos, 1);
  assert.equal(segunda.novos, 0);
  assert.equal((await base.repositorio.listarMovimentos(1)).length, 1);
  assert.equal(base.chamadas.aplicar.length, 1);
});

test("sem homologação a correspondência segura fica só como sugestão", async () => {
  const base = montar({ transacoes: [{ id: "tx-1", accountId: "acc-1", description: `PIX RECEBIDO ${E2E}`, amount: 2450, type: "CREDIT", date: "2026-10-27", paymentData: { referenceNumber: E2E, payer: { name: "ABC" } } }], titulos: [{ tipo: "receber", controle: 10, idempresa: 1, empresa: 1, valor: 2450, nrdoc: E2E, pessoa: "ABC", dtvenc: "2026-10-27" }] });
  const { conexao } = await preparar(base);
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  const [movimento] = await base.repositorio.listarMovimentos(1);
  assert.equal(movimento.classe, "automatica");
  assert.equal(movimento.podeBaixar, false);
  assert.equal(movimento.status, "sugerido");
  assert.equal(base.chamadas.aplicar.length, 0);
  assert.match(movimento.charlie, /homologado|verificar/i);
});

test("valor igual sem identificador não baixa e o Charlie pede conferência", async () => {
  const base = montar({ transacoes: [{ id: "tx-2", accountId: "acc-1", description: "PIX RECEBIDO", amount: 2450, type: "CREDIT", date: "2026-10-27" }], titulos: [{ tipo: "receber", controle: 11, idempresa: 1, empresa: 1, valor: 2450, pessoa: "ABC", nrdoc: "NF-1", dtvenc: "2026-10-27" }] });
  const { conexao } = await preparar(base, { modo: "automatico" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 0);
  const [movimento] = await base.repositorio.listarMovimentos(1);
  assert.notEqual(movimento.classe, "automatica");
});

test("nome do cliente no Pix vira sugestão e a aprovação humana baixa uma vez", async () => {
  const base = montar({ transacoes: [{ id: "tx-3", accountId: "acc-1", description: "PIX RECEBIDO ABC COMERCIO", amount: 2450, type: "CREDIT", date: "2026-10-27" }], titulos: [{ tipo: "receber", controle: 12, idempresa: 1, empresa: 1, valor: 2450, pessoa: "ABC COMERCIO", nrdoc: "NF2450", dtvenc: "2026-10-27" }] });
  const { conexao } = await preparar(base);
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  const [movimento] = await base.repositorio.listarMovimentos(1);
  assert.match(movimento.charlie, /verificar|possivelmente|correspondência/i);
  assert.equal(base.chamadas.aplicar.length, 0);
  const aprovado = await base.servico.aprovar({ id: movimento.id, empresa: 1, confirmado: true, idusuario: 4, nome: "Maria", perfil: "financeiro" });
  assert.equal(aprovado.ok, true);
  assert.equal(base.chamadas.aplicar.length, 1);
  const deNovo = await base.servico.aprovar({ id: movimento.id, empresa: 1, confirmado: true, idusuario: 4, perfil: "financeiro" });
  assert.equal(deNovo.ok, false);
  assert.equal(base.chamadas.aplicar.length, 1);
});

test("pagamento parcial, estorno e duplicidade não baixam", async () => {
  const transacoes = [
    { id: "parcial", accountId: "acc-1", description: `PIX ${E2E}`, amount: 100, type: "CREDIT", date: "2026-10-27", paymentData: { referenceNumber: E2E } },
    { id: "estorno", accountId: "acc-1", description: "ESTORNO PIX", amount: 50, type: "CREDIT", date: "2026-10-27" },
    { id: "dup-1", accountId: "acc-1", description: "TED FORNECEDOR", amount: 80, type: "DEBIT", date: "2026-10-27" },
    { id: "dup-2", accountId: "acc-1", description: "TED FORNECEDOR", amount: 80, type: "DEBIT", date: "2026-10-27" },
  ];
  const base = montar({ transacoes, titulos: [{ tipo: "receber", controle: 20, idempresa: 1, empresa: 1, valor: 180, nrdoc: E2E, pessoa: "ABC", dtvenc: "2026-10-27" }] });
  const { conexao } = await preparar(base, { modo: "automatico" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 0);
  const divergencias = await base.repositorio.listarDivergencias(1);
  assert.equal(divergencias.some((item) => item.tipo === "pagamento_inferior"), true);
  assert.equal(divergencias.some((item) => item.tipo === "estorno"), true);
  assert.equal(divergencias.some((item) => item.tipo === "duplicidade"), true);
});

test("pagamento agrupado com documentos fecha e respeita o modo", async () => {
  const base = montar({
    transacoes: [{ id: "grupo", accountId: "acc-1", description: "PIX PEDIDO ABCDE PEDIDO FGHIJ", amount: 150, type: "CREDIT", date: "2026-10-27" }],
    titulos: [
      { tipo: "receber", controle: 31, idempresa: 1, empresa: 1, valor: 100, nrdoc: "ABCDE", pessoa: "Um", dtvenc: "2026-10-27" },
      { tipo: "receber", controle: 32, idempresa: 1, empresa: 1, valor: 50, nrdoc: "FGHIJ", pessoa: "Dois", dtvenc: "2026-10-27" },
    ],
  });
  const { conexao } = await preparar(base, { modo: "automatico" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 1);
  assert.equal(base.chamadas.aplicar[0].acao, "conciliar_agrupado");
  assert.equal(base.chamadas.aplicar[0].titulos.length, 2);
});

test("tarifa sem regra fica pendente e a regra da empresa não vaza", async () => {
  const base = montar({ transacoes: [{ id: "tar", accountId: "acc-1", description: "TARIFA PACOTE SERVICOS", amount: 39.9, type: "DEBIT", date: "2026-10-27" }] });
  const { conexao } = await preparar(base, { modo: "automatico" });
  await base.repositorio.salvarRegra({ empresa: 2, padrao: "tarifa pacote", categoria: "tarifa", criarLancamento: true, cdfornecedor: 9, cdconta: 4, ativa: true, origem: "usuario:1" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 0);
  const [movimento] = await base.repositorio.listarMovimentos(1);
  assert.match(movimento.charlie, /tarifa bancária/i);
  await base.repositorio.salvarRegra({ empresa: 1, padrao: "tarifa pacote", categoria: "tarifa", criarLancamento: true, cdfornecedor: 9, cdconta: 4, ativa: true, origem: "usuario:1" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 1);
  assert.equal(base.chamadas.aplicar[0].acao, "tarifa");
});

test("transferência interna entre contas da empresa não vira despesa", async () => {
  const base = montar({
    transacoes: [
      { id: "sai", accountId: "acc-1", description: "TED ENTRE CONTAS", amount: 10000, type: "DEBIT", date: "2026-10-27" },
      { id: "entra", accountId: "acc-2", description: "TED ENTRE CONTAS", amount: 10000, type: "CREDIT", date: "2026-10-27" },
    ],
    buscar: async (url, opcoes) => {
      if (String(url).includes("/accounts?")) return resposta(200, { results: [
        { id: "acc-1", name: "Itaú", balance: 1000, currencyCode: "BRL", bankData: { transferNumber: "341/1/111" } },
        { id: "acc-2", name: "Santander", balance: 2000, currencyCode: "BRL", bankData: { transferNumber: "033/2/222" } },
      ] });
      if (String(url).includes("accountId=acc-2")) return resposta(200, { results: [{ id: "entra", accountId: "acc-2", description: "TED ENTRE CONTAS", amount: 10000, type: "CREDIT", date: "2026-10-27" }], totalPages: 1 });
      if (String(url).includes("/transactions")) return resposta(200, { results: [{ id: "sai", accountId: "acc-1", description: "TED ENTRE CONTAS", amount: 10000, type: "DEBIT", date: "2026-10-27" }], totalPages: 1 });
      return pluggy([], { urls: [], corpos: [] })(url, opcoes);
    },
  });
  await preparar(base, { modo: "automatico" });
  const conexao = (await base.repositorio.listarConexoes(1))[0];
  await base.repositorio.salvarConta({ empresa: 1, conexaoId: conexao.id, idExterno: "acc-2", nome: "Santander", banco: "033", numero: "222", vinculada: true, cdbanco: "033", agenciaErp: "2", numcontaErp: "222" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 1);
  assert.equal(base.chamadas.aplicar[0].acao, "transferencia");
  const movimentos = await base.repositorio.listarMovimentos(1);
  assert.equal(movimentos.every((item) => item.status === "conciliado"), true);
});

test("duas aprovações simultâneas geram uma única baixa", async () => {
  let abertas = 0;
  let pico = 0;
  const base = montar({
    transacoes: [{ id: "tx-3", accountId: "acc-1", description: "PIX RECEBIDO ABC COMERCIO", amount: 2450, type: "CREDIT", date: "2026-10-27" }],
    titulos: [{ tipo: "receber", controle: 12, idempresa: 1, empresa: 1, valor: 2450, pessoa: "ABC COMERCIO", nrdoc: "NF2450", dtvenc: "2026-10-27" }],
    transacao: async (fn) => {
      abertas += 1;
      pico = Math.max(pico, abertas);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const resultado = await fn({});
      abertas -= 1;
      return resultado;
    },
  });
  const { conexao } = await preparar(base);
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  const [movimento] = await base.repositorio.listarMovimentos(1);
  const pedido = { id: movimento.id, empresa: 1, confirmado: true, idusuario: 4, perfil: "financeiro" };
  const [primeira, segunda] = await Promise.all([base.servico.aprovar(pedido), base.servico.aprovar(pedido)]);
  assert.equal([primeira.ok, segunda.ok].filter(Boolean).length, 1);
  assert.equal(base.chamadas.aplicar.length, 1);
  assert.equal(pico, 1);
});

test("o Charlie não executa baixa mesmo quando o modelo pede", async () => {
  const base = montar({
    narrar: async () => JSON.stringify({ executar: true, alterarValor: true, causa: "sem_evidencia", narracao: "Baixar agora o título 99.", evidencias: [] }),
    transacoes: [{ id: "tx-9", accountId: "acc-1", description: "LANCAMENTO ESTRANHO", amount: 10, type: "CREDIT", date: "2026-10-27" }],
    titulos: [{ tipo: "receber", controle: 99, idempresa: 1, empresa: 1, valor: 10, pessoa: "Z", nrdoc: "Z1", dtvenc: "2026-10-20" }],
  });
  const { conexao } = await preparar(base, { modo: "automatico" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  const [movimento] = await base.repositorio.listarMovimentos(1);
  assert.equal(movimento.podeBaixar, false);
  assert.equal(base.chamadas.aplicar.length, 0);
});

test("título de outra empresa e regra de outra empresa ficam isolados", async () => {
  const base = montar({
    transacoes: [{ id: "tx-1", accountId: "acc-1", description: `PIX ${E2E}`, amount: 2450, type: "CREDIT", date: "2026-10-27", paymentData: { referenceNumber: E2E } }],
    titulos: [{ tipo: "receber", controle: 10, idempresa: 2, empresa: 2, valor: 2450, nrdoc: E2E, pessoa: "OUTRA", dtvenc: "2026-10-27" }],
  });
  const { conexao } = await preparar(base, { modo: "automatico" });
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(base.chamadas.aplicar.length, 0);
  assert.equal((await base.repositorio.listarMovimentos(2)).length, 0);
});

test("estorno desfaz uma baixa e a repetição não desfaz de novo", async () => {
  const base = montar({ transacoes: [{ id: "tx-3", accountId: "acc-1", description: "PIX RECEBIDO ABC COMERCIO", amount: 2450, type: "CREDIT", date: "2026-10-27" }], titulos: [{ tipo: "receber", controle: 12, idempresa: 1, empresa: 1, valor: 2450, pessoa: "ABC COMERCIO", nrdoc: "NF2450", dtvenc: "2026-10-27" }] });
  const { conexao } = await preparar(base);
  await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  const [movimento] = await base.repositorio.listarMovimentos(1);
  await base.servico.aprovar({ id: movimento.id, empresa: 1, confirmado: true, idusuario: 4, perfil: "financeiro" });
  const estorno = await base.servico.estornar({ id: movimento.id, empresa: 1, confirmado: true, idusuario: 4 });
  assert.equal(estorno.ok, true);
  assert.equal(base.chamadas.desfazer.length, 1);
  const repetido = await base.servico.estornar({ id: movimento.id, empresa: 1, confirmado: true, idusuario: 4 });
  assert.equal(repetido.ok, false);
});

test("webhook sem segredo é recusado e o evento repetido não dispara duas vezes", async () => {
  const base = montar();
  const { conexao } = await preparar(base);
  const invalido = await base.servico.webhook({ token: "errado", eventoId: "ev-1", evento: "transactions/created", itemId: "item-1" });
  assert.equal(invalido.status, 401);
  const segredo = base.segredos.valor.webhookSecret;
  assert.equal(typeof segredo, "string");
  assert.equal(segredo.startsWith("v1:"), true);
  const token = decifrar(segredo, chaveDe("chave-mestra-de-teste-123"));
  const ok = await base.servico.webhook({ token, eventoId: "ev-1", evento: "transactions/created", itemId: "item-1" });
  const duplicado = await base.servico.webhook({ token, eventoId: "ev-1", evento: "transactions/created", itemId: "item-1" });
  assert.equal(ok.ok, true);
  assert.equal(duplicado.duplicado, true);
  const atual = await base.repositorio.obterConexao(conexao.id, 1);
  assert.ok(atual.proximaTentativa);
});

test("relatório usa somente os números persistidos", async () => {
  const base = montar();
  await base.repositorio.salvarMovimento({ empresa: 1, idExterno: "a", data: "2026-10-27", valor: 100, status: "conciliado", origemBaixa: "servico-conciliacao", classe: "automatica", descricao: "entrada" });
  await base.repositorio.salvarMovimento({ empresa: 1, idExterno: "b", data: "2026-10-27", valor: -40, status: "sugerido", classe: "sugerida", descricao: "saida" });
  await base.repositorio.salvarMovimento({ empresa: 1, idExterno: "c", data: "2026-10-27", valor: -5, status: "divergente", classe: "divergencia", descricao: "diferenca" });
  await base.repositorio.salvarConta({ empresa: 1, conexaoId: 1, idExterno: "acc", saldo: 278000, vinculada: true, cdbanco: "341", numcontaErp: "1" });
  const relatorio = await base.servico.relatorio({ empresa: 1, data: "2026-10-27", nomeEmpresa: "Empresa ABC" });
  assert.equal(relatorio.movimentacoes, 3);
  assert.equal(relatorio.conciliadasAutomaticamente, 1);
  assert.equal(relatorio.pendentes, 2);
  assert.equal(relatorio.divergencias, 1);
  assert.equal(relatorio.recebido, 100);
  assert.equal(relatorio.pago, 45);
  assert.equal(relatorio.saldoBancario, 278000);
  assert.equal(relatorio.percentual, 33.33);
  const manual = montarRelatorio({ empresa: 1, data: "2026-10-27", movimentos: [], contas: [] });
  assert.equal(manual.saldoBancario, null);
});

test("só administrador homologa a baixa automática e a retentativa tem teto", async () => {
  const base = montar();
  await assert.rejects(() => base.servico.salvarPolitica(1, { modo: "automatico", confirmado: true }, { idusuario: 4, perfil: "financeiro" }), /administrador/);
  await assert.rejects(() => base.servico.salvarPolitica(1, { intervaloMinutos: 5 }, { idusuario: 1, perfil: "admin" }), /60/);
  const salva = await base.servico.salvarPolitica(1, { modo: "automatico", confirmado: true }, { idusuario: 1, perfil: "admin" });
  assert.equal(salva.modo, "automatico");
  assert.equal(proximaTentativaSegundos(1), 30);
  assert.equal(proximaTentativaSegundos(10), 3600);
  await assert.rejects(() => base.servico.configurar({ provedor: "pluggy", ambiente: "sandbox", clientId: "a", clientSecret: "b", senha: "banco" }, {}), /Senha bancária/);
});

test("consentimento revogado interrompe a sincronização", async () => {
  const base = montar({
    buscar: async (url) => {
      if (String(url).endsWith("/auth")) return resposta(200, { apiKey: "k" });
      if (String(url).includes("/consents")) return resposta(200, { results: [{ id: "consent-1", revokedAt: "2026-10-27T00:00:00.000Z", products: [] }] });
      return resposta(500, { message: "nao deveria buscar transacao" });
    },
  });
  const { conexao } = await preparar(base);
  const resultado = await base.servico.sincronizar({ idConexao: conexao.id, empresa: 1, manual: true });
  assert.equal(resultado.motivo, "consentimento_revogado");
  assert.equal((await base.repositorio.listarMovimentos(1)).length, 0);
});

test("a versão do esquema só é lida depois que a criação das tabelas foi confirmada", async () => {
  const visivel = { relacoes: new Set(), geradores: new Set(), indices: new Set(), versoes: new Set() };
  const commits = [];
  function escrever(acao) {
    const pendente = { relacoes: new Set(), geradores: new Set(), indices: new Set(), versoes: new Set() };
    const tx = {
      async singleton(sql, params = []) {
        const nome = String(params[0] || "");
        if (sql.includes("RDB$GENERATORS")) return visivel.geradores.has(nome) ? { OK: 1 } : undefined;
        if (sql.includes("RDB$RELATIONS")) return visivel.relacoes.has(nome) ? { OK: 1 } : undefined;
        if (sql.includes("RDB$INDICES")) return visivel.indices.has("UX_DASH_OF_MOV_EXT") ? { OK: 1 } : undefined;
        if (sql.includes("GEN_ID")) return { ID: 1 };
        const tabela = sql.match(/DASH_OF_[A-Z0-9_]+/)?.[0];
        if (tabela && !visivel.relacoes.has(tabela)) throw new Error(`Dynamic SQL Error -SQL error code = -204 -Table unknown -${tabela} -At line 1, column 20`);
        if (tabela === "DASH_OF_VERSAO") return visivel.versoes.has(Number(params[0])) ? { VERSAO: params[0] } : undefined;
        return undefined;
      },
      async execute(sql, params = []) {
        const tabela = sql.match(/CREATE TABLE (DASH_OF_[A-Z0-9_]+)/)?.[1];
        const sequencia = sql.match(/CREATE SEQUENCE (GEN_DASH_OF_[A-Z0-9_]+)/)?.[1];
        if (tabela) pendente.relacoes.add(tabela);
        else if (sequencia) pendente.geradores.add(sequencia);
        else if (sql.includes("CREATE UNIQUE INDEX")) pendente.indices.add("UX_DASH_OF_MOV_EXT");
        else if (sql.includes("INSERT INTO DASH_OF_VERSAO")) {
          if (!visivel.relacoes.has("DASH_OF_VERSAO")) throw new Error("Dynamic SQL Error -SQL error code = -204 -Table unknown -DASH_OF_VERSAO -At line 1, column 20");
          pendente.versoes.add(Number(params[0]));
        } else if (sql.includes("INSERT INTO DASH_OF_AUDITORIA") && !visivel.relacoes.has("DASH_OF_AUDITORIA")) {
          throw new Error("Dynamic SQL Error -SQL error code = -204 -Table unknown -DASH_OF_AUDITORIA -At line 1, column 20");
        }
      },
    };
    return Promise.resolve(acao(tx)).then((resultado) => {
      for (const nome of pendente.relacoes) visivel.relacoes.add(nome);
      for (const nome of pendente.geradores) visivel.geradores.add(nome);
      for (const nome of pendente.indices) visivel.indices.add(nome);
      for (const versao of pendente.versoes) visivel.versoes.add(versao);
      commits.push("commit");
      return resultado;
    });
  }
  const repo = criarRepositorioFirebird({ escrever, ler: async () => [], consultar: async () => [] });
  const auditoria = await repo.auditar({ empresa: 1, operacao: "configurar", detalhe: "Provedor pluggy.", usuarioId: 1 });
  assert.equal(auditoria.id, 1);
  assert.equal(visivel.relacoes.has("DASH_OF_VERSAO"), true);
  assert.equal(visivel.versoes.has(VERSAO_ESQUEMA), true);
  assert.ok(commits.length >= 2);
});
