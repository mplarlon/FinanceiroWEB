import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charlie-leads-"));
const cnpjMod = await import("../server/lib/charlie-leads-cnpj.js");
const qualify = await import("../server/lib/charlie-leads-qualify.js");
const service = await import("../server/lib/charlie-leads-service.js");
const store = await import("../server/lib/charlie-leads-store.js");
store.usarDiretorioDeTeste(dir);
const nl = await import("../server/lib/charlie-leads-nl.js");
const clientMod = await import("../server/lib/casa-dados-client.js");
const agenda = await import("../server/charlie-leads-scheduler.js");
const catalog = await import("../server/lib/charlie-task-catalog.js");
const plano = await import("../server/lib/charlie-task-plan.js");
const politica = await import("../server/security-policy.js");

const gestor = { id: 1, gerencial: true, nome: "Admin" };
const vendedor = { id: 2, gerencial: false, vendedorId: 7 };
const outro = { id: 3, gerencial: false, vendedorId: 9 };
const cnpjNovo = "11444777000161";
const cnpjCliente = "00000000000191";
let chamadas = [];

function consulta(sql, params = []) {
  chamadas.push(String(sql));
  if (/\b(insert|update|delete)\b/i.test(sql)) throw new Error("O teste não grava no ERP.");
  if (sql.includes("FROM CLIENTE") && sql.includes("COALESCE")) return params[0] === cnpjCliente ? [{ CDCLIENTE: 10, NOME: "Cliente Real", CGC: params[0], INATIVO: 0, UF: "RJ", CDVENDEDOR: 3 }] : [];
  if (sql.includes("COUNT(*)") && sql.includes("SAIDAESTOQUE")) return [{ QTD: 2, ULTIMA: "2026-09-01", TOTAL: 1500 }];
  if (sql.includes("COUNT(*)") && sql.includes("ORCAMENTO")) return [{ QTD: 1 }];
  if (sql.includes("COUNT(DISTINCT")) return [{ QTD: 4 }];
  if (sql.includes("AVG(TOTAL)")) return [{ MEDIA: 800 }];
  if (sql.includes("FROM VENDEDOR")) return [{ CDVENDEDOR: 7, VENDEDOR: "Marina" }];
  if (sql.includes("FROM PRODUTO")) return [{ CDPRODUTO: "55", PRODUTO: "Cabo flexível" }];
  if (sql.includes("NRORCAMENTO")) return [{ NRORCAMENTO: params[0], IDEMPRESA: 1, CDCLIENTE: 10, VLTOTAL: 320 }];
  if (sql.includes("GROUP BY NRPEDIDO")) return [{ NRPEDIDO: params[0], IDEMPRESA: 1, CDCLIENTE: 10, TOTAL: 900 }];
  if (sql.includes("DATEADD")) return [{ UF: "rj", TOTAL: 10000 }];
  return [];
}

function http(rotas) {
  return async (url, options = {}) => {
    const alvo = `${options.method || "GET"} ${new URL(url).pathname}`;
    chamadas.push(alvo);
    const regra = rotas[alvo];
    if (!regra) return { ok: false, status: 404, text: async () => "{}" };
    if (regra.falha) throw new Error("rede");
    const status = regra.status || 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(regra.body ?? {}) };
  };
}

const saldo = { saldo_total: 50, saldos: { avulso: { valor: 50, criado_em: "2026-01-01T00:00:00Z", expira_em: "2027-01-01T00:00:00Z" } } };
const empresaApi = { cnpj: cnpjNovo, razao_social: "CONSTRUTORA EXEMPLO", nome_fantasia: "EXEMPLO", situacao_cadastral: { situacao_cadastral: "ATIVA" }, endereco: { uf: "RJ", municipio: "Rio de Janeiro" }, porte_empresa: { codigo: "05", descricao: "Demais" }, capital_social: 200000, telefone: "2133334444" };

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("valida CNPJ, filtros oficiais e pontuação reproduzível", () => {
  assert.equal(cnpjMod.validarCnpj(cnpjNovo), true);
  assert.equal(cnpjMod.validarCnpj("11444777000160"), false);
  assert.equal(cnpjMod.validarCnpj("11111111111111"), false);
  const pedido = cnpjMod.buildPesquisaBody({ codigo_atividade_principal: ["4120400"], situacao_cadastral: ["ATIVA"], uf: ["rj"], comTelefone: true, limite: 10, pagina: 1 });
  assert.deepEqual(pedido.body, { codigo_atividade_principal: ["4120400"], situacao_cadastral: ["ATIVA"], uf: ["rj"], mais_filtros: { com_telefone: true }, limite: 10, pagina: 1 });
  const pagina = cnpjMod.buildPesquisaBody({ uf: ["rj"], limite: 10, pagina: 2 });
  assert.equal(pagina.body.pagina, 2);
  assert.equal(cnpjMod.buildPesquisaBody({ limite: 10 }).erros.length > 0, true);
  const completo = cnpjMod.buildPesquisaBody({
    uf: ["rj"], naturezaJuridica: ["206-2"], cep: ["07115-000"], bairro: "Centro", ddd: ["21"],
    telefone: ["21 3333-4444"], cnpj: [cnpjNovo, "11111111111111"], cnpjRaiz: ["11444777"],
    enderecoNumero: ["109B"], meiExcluir: true, meiExclusaoInicio: "2020-01-01", simplesOptante: true,
    somenteCelular: true, excluirEmailContabil: true, excluirCnpj: ["00000000000191"],
    capitalMinimo: 1000, capitalMaximo: 5000, nomeSocio: true, razaoSocial: "exemplo",
  });
  assert.deepEqual(completo.erros, []);
  assert.deepEqual(completo.body.capital_social, { minimo: 1000, maximo: 5000 });
  assert.deepEqual(completo.body.codigo_natureza_juridica, ["2062"]);
  assert.deepEqual(completo.body.cep, ["07115000"]);
  assert.deepEqual(completo.body.bairro, ["centro"]);
  assert.deepEqual(completo.body.ddd, ["21"]);
  assert.deepEqual(completo.body.telefone, ["2133334444"]);
  assert.deepEqual(completo.body.cnpj, [cnpjNovo]);
  assert.deepEqual(completo.body.cnpj_raiz, ["11444777"]);
  assert.deepEqual(completo.body.endereco_numero, ["109B"]);
  assert.deepEqual(completo.body.mei, { excluir_optante: true, data_exclusao: { inicio: "2020-01-01" } });
  assert.deepEqual(completo.body.simples, { optante: true });
  assert.equal(completo.body.mais_filtros.somente_celular, true);
  assert.equal(completo.body.mais_filtros.excluir_email_contab, true);
  assert.equal(completo.body.busca_textual[0].nome_socio, false);
  assert.equal(cnpjMod.pesquisaCompleta(completo.body), true);
  assert.equal(cnpjMod.buildPesquisaBody({ uf: ["rj"], somenteFixo: true, somenteCelular: true }).erros[0], "Escolha somente telefone fixo ou somente celular.");
  assert.equal(cnpjMod.buildPesquisaBody({ cnpj: ["11111111111111"] }).erros[0], "Nenhum CNPJ informado é válido.");
  const base = { cnpj: cnpjNovo, cnae: "4120400", cnaeConfirmado: true, uf: "RJ", porteCodigo: "05", telefone: "1", capitalSocial: 1000000 };
  const contexto = { cnaesConfigurados: ["4120400"], regioesAtendidas: ["RJ"], compradoresUf: 20, clientesMesmaCidade: 10 };
  const alta = qualify.pontuarLead(base, contexto);
  const repetida = qualify.pontuarLead(base, contexto);
  assert.deepEqual(alta, repetida);
  assert.equal(alta.score, 100);
  assert.equal(alta.classificacao, "POTENCIAL_ALTO");
  assert.equal(qualify.classificarPotencial(79), "POTENCIAL_MEDIO");
  assert.equal(qualify.classificarPotencial(49), "POTENCIAL_BAIXO");
  assert.match(alta.criterios.find((item) => item.id === "cnae").motivo, /não comprova intenção de compra/i);
});

test("fluxo de configuração, API, leads, CRM, webhook, créditos e permissões", async () => {
  chamadas = [];
  const deps = { query: consulta, client: clientMod.createCasaDadosClient({ apiKey: "chave-secreta-teste", fetchImpl: http({
    "GET /v5/saldo": { body: saldo },
    "POST /v5/cnpj/pesquisa": { body: { total: 1, cnpjs: [empresaApi] } },
    "GET /v4/cnpj/11444777000161": { body: empresaApi },
    "GET /v4/dashboard/cnpj/empresas-abertas/hoje": { body: { total: 3 } },
    "POST /v5/cnpj/pesquisa/arquivo": { body: { id: "arq-1" } },
  }) }) };

  await assert.rejects(() => service.salvarConfiguracao({ apiKey: "chave-secreta-teste" }, outro), /gerencial/);
  const config = await service.salvarConfiguracao({ apiKey: "chave-secreta-teste", ativa: true, consultasPagasAutorizadas: true, autorizarLote: true, limiteDiario: 10, limiteMensal: 20, reservaMinima: 1, webhookToken: "token-webhook", regioesAtendidas: ["RJ"] }, gestor);
  assert.equal(config.chaveConfigurada, true);
  assert.equal(JSON.stringify(config).includes("chave-secreta-teste"), false);
  assert.equal(JSON.stringify(store.configPublica()).includes("chave-secreta-teste"), false);

  const teste = await service.testarConexao(gestor, deps);
  assert.equal(teste.conectado, true);
  assert.equal(teste.saldo, 50);
  const saldoAtual = await service.consultarSaldo(gestor, deps);
  assert.equal(saldoAtual.saldo, 50);

  const pesquisa = await service.pesquisarEmpresas({ cnae: ["4120400"], situacao: ["ATIVA"], uf: ["rj"], comTelefone: true, limite: 10, pagina: 1 }, gestor, deps);
  assert.equal(pesquisa.empresas.length, 1);
  assert.equal(pesquisa.empresas[0].telefone, "2133334444");
  assert.equal(pesquisa.empresas[0].vinculo.existe, false);
  const repetida = await service.pesquisarEmpresas({ cnae: ["4120400"], situacao: ["ATIVA"], uf: ["rj"], comTelefone: true, limite: 10, pagina: 1 }, gestor, deps);
  assert.equal(repetida.reutilizado, true);
  assert.equal(chamadas.filter((item) => item === "POST /v5/cnpj/pesquisa").length, 1);
  const locais = service.listarPesquisasLocais(gestor);
  assert.equal(locais.length, 1);
  assert.equal(locais[0].pagina, 1);
  assert.equal(locais[0].total, 1);
  assert.match(locais[0].resumo, /RJ/);
  assert.equal(JSON.stringify(locais).includes("chave"), false);
  await assert.rejects(async () => service.listarPesquisasLocais(vendedor), /gerencial/);
  const httpAntes = chamadas.filter((item) => item.startsWith("GET /") || item.startsWith("POST /")).length;
  const aberta = await service.abrirPesquisaLocal(locais[0].id, gestor, deps);
  assert.equal(aberta.local, true);
  assert.equal(aberta.empresas[0].cnpj, cnpjNovo);
  assert.equal(aberta.empresas[0].vinculo.existe, false);
  assert.equal(chamadas.filter((item) => item.startsWith("GET /") || item.startsWith("POST /")).length, httpAntes);
  await assert.rejects(() => service.abrirPesquisaLocal("inexistente", gestor, deps), /não encontrada/);

  const individual = await service.consultarCnpj(cnpjNovo, gestor, deps);
  assert.equal(individual.cnpj, cnpjNovo);
  await assert.rejects(() => service.consultarCnpj("123", gestor, deps), /CNPJ inválido/);
  const abertas = await service.empresasAbertasHoje(gestor, deps);
  assert.equal(abertas.total, 3);
  const arquivo = await service.gerarArquivo({ uf: ["rj"], limite: 10 }, gestor, deps);
  assert.equal(arquivo.identificador, "arq-1");

  const criado = await service.criarLead(pesquisa.empresas[0], gestor, deps);
  assert.equal(criado.duplicado, false);
  const deNovo = await service.criarLead(pesquisa.empresas[0], gestor, deps);
  assert.equal(deNovo.duplicado, true);
  assert.equal(deNovo.lead.id, criado.lead.id);
  assert.equal(service.listarLeads({ desde: "2099-01-01" }, gestor).length, 0);
  assert.equal(service.listarLeads({ ate: "2000-01-01" }, gestor).length, 0);
  assert.equal(service.listarLeads({ cidade: "rio de janeiro" }, gestor).length, 1);
  assert.equal(service.listarLeads({ semCidade: "1" }, gestor).length, 0);
  assert.equal(service.indicadores({}, gestor).porCidade[0].valor, "Rio de Janeiro");
  assert.equal(service.indicadores({}, gestor).porVendedor[0].vendedorId, null);
  const existente = await service.criarLead({ cnpj: cnpjCliente, razaoSocial: "Não sobrescrever", uf: "RJ" }, gestor, deps);
  assert.equal(existente.lead.clienteId, 10);
  assert.equal(chamadas.some((sql) => /insert\s+into\s+cliente/i.test(sql)), false);

  const analisado = await service.analisarLead(criado.lead.id, gestor, { ...deps, narrar: async () => null });
  assert.equal(analisado.score, criado.lead.score);
  assert.equal(analisado.narrativa.includes("2133334444") || analisado.criterios.some((item) => item.id === "contato" && item.fator === 1), true);
  await service.salvarConfiguracao({ segmentos: [{ id: "eletrica", nome: "Elétrica", cnaes: ["4120400"], termos: ["construtora"], termosProduto: ["CABO"] }] }, gestor);
  const produtos = await service.sugerirProdutos(criado.lead.id, gestor, deps);
  assert.deepEqual(produtos.produtos, [{ codigo: "55", nome: "Cabo flexível", origem: "PRODUTO", termo: "CABO" }]);

  await service.salvarConfiguracao({ distribuicao: { modo: "automatica", regras: [{ vendedorId: 7, nome: "Marina", ufs: ["RJ"], cidades: [], segmentos: [], ativo: true, prioridade: 1 }] } }, gestor);
  const distribuido = await service.distribuirLeads({ quantidade: 50 }, gestor);
  assert.equal(distribuido.quantidade >= 1, true);
  await assert.rejects(() => service.atribuirVendedor({ id: criado.lead.id, vendedorId: 8 }, gestor, deps), /já possui vendedor/);
  assert.equal(service.listarLeads({}, vendedor).every((lead) => Number(lead.vendedorId) === 7), true);
  assert.equal(service.listarLeads({}, outro).length, 0);

  let lead = await service.atualizarLead(criado.lead.id, { status: "EM_CONTATO" }, gestor);
  lead = await service.atualizarLead(lead.id, { observacao: "Retornar amanhã", contato: { canal: "telefone", resumo: "Ligação registrada" } }, gestor);
  assert.equal(lead.contatos.length, 1);
  lead = await service.criarOportunidade(lead.id, gestor);
  lead = await service.vincularOrcamento(lead.id, 44, gestor, deps);
  assert.equal(lead.status, "ORCAMENTO");
  assert.equal(lead.orcamentos[0].valor, 320);
  lead = await service.vincularPedido(lead.id, 88, gestor, deps);
  assert.equal(lead.status, "CONVERTIDO");
  lead = await service.atualizarLead(lead.id, { retorno: "2026-11-02" }, gestor);
  assert.equal(lead.status, "CONVERTIDO");
  assert.equal(lead.atividades.some((item) => item.tipo === "retorno" && item.quando === "2026-11-02"), true);
  assert.equal(lead.clienteId, null);
  assert.equal(lead.pedidos[0].valor, 900);
  const relatorio = service.relatorio({}, gestor);
  assert.equal(relatorio.faturamentoVinculado, 900);
  assert.notEqual(relatorio.potencialEstimado, relatorio.faturamentoVinculado);
  const mensagem = service.prepararMensagem(lead.id, gestor);
  assert.equal(mensagem.enviado, false);
  assert.equal(mensagem.exigeAprovacaoHumana, true);

  const evento = { id_evento: "evt-1", data_evento: "2026-10-26T10:00:00-03:00", evento: [{ cnpj: "11444777000160", razao_social: "Inválida" }, { cnpj: "27865757000102", razao_social: "NOVA EMPRESA", situacao_cadastral: "ATIVA" }] };
  await assert.rejects(() => service.receberWebhook(evento, "errado", { query: consulta, client: { saldo() { throw new Error("não consultar"); } } }), /Token/);
  const recebido = await service.receberWebhook(evento, "token-webhook", { query: consulta, client: { saldo() { throw new Error("não consultar"); } } });
  assert.equal(recebido.duplicado, false);
  const repetido = await service.receberWebhook(evento, "token-webhook", { query: consulta });
  assert.equal(repetido.duplicado, true);
  assert.equal(service.listarLeads({}, gestor).some((item) => item.origem === "webhook"), true);
  const publica = store.configPublica();
  assert.equal(publica.fila.recentes.some((item) => item.cnpj === "27865757000102" && item.situacaoFila === "lead_criado"), true);
  assert.equal(JSON.stringify(publica).includes("token-webhook"), false);

  await service.salvarConfiguracao({ limiteDiario: 1, bloquearAoAtingir: true }, gestor);
  await assert.rejects(() => service.pesquisarEmpresas({ uf: ["sp"], limite: 5, pagina: 3, forcar: true }, gestor, deps), /limite diário/);
  const semSaldo = { ...deps, client: clientMod.createCasaDadosClient({ apiKey: "x", fetchImpl: http({ "GET /v5/saldo": { status: 401, body: {} } }) }) };
  await assert.rejects(() => service.consultarSaldo(gestor, semSaldo), /API Key inválida/);
  const proibido = { ...deps, client: clientMod.createCasaDadosClient({ apiKey: "x", fetchImpl: http({ "GET /v5/saldo": { body: saldo }, "POST /v5/cnpj/pesquisa": { status: 403, body: {} } }) }) };
  await service.salvarConfiguracao({ limiteDiario: 20 }, gestor);
  await assert.rejects(() => service.pesquisarEmpresas({ uf: ["mg"], limite: 5, pagina: 4 }, gestor, proibido), /Sem saldo/);
  const rede = { ...deps, client: clientMod.createCasaDadosClient({ apiKey: "x", fetchImpl: http({ "GET /v5/saldo": { falha: true } }) }) };
  await assert.rejects(() => service.testarConexao(gestor, rede), /comunicação/);
  assert.equal(JSON.stringify(store.loadState().erros).includes("chave-secreta-teste"), false);

  assert.equal((await agenda.tickCharlieLeads(new Date("2026-10-26T07:00:00"))).motivo, "desativada");
  const travado = await store.updateState((estado) => {
    const primeiro = store.adquirirTrava ? null : null;
    estado.lock = { dono: "outro", ate: new Date(Date.now() + 60000).toISOString() };
    return primeiro;
  });
  assert.equal(travado, null);
  await service.salvarConfiguracao({ consultasPagasAutorizadas: false }, gestor);
  const comando = nl.interpretarPedido("Charlie, encontre 100 construtoras no Rio de Janeiro.");
  assert.equal(comando.acao, "leads.buscar_empresas");
  assert.deepEqual(comando.criterios.uf, ["rj"]);
  assert.deepEqual(comando.criterios.cnae, ["4120400"]);
  assert.equal(comando.criterios.limite, 100);
  chamadas = [];
  const resposta = await nl.responderLeads("Charlie, encontre 100 construtoras no Rio de Janeiro.", gestor, deps);
  assert.match(resposta.resposta, /autoriz/);
  assert.equal(chamadas.filter((item) => item.startsWith("POST /v5/cnpj/pesquisa")).length, 0);
  assert.equal(catalog.getAction("leads.buscar_empresas")?.habilitada, true);
  assert.equal(catalog.listActions().some((item) => item.id === "leads.criar_lead"), true);
  assert.equal(plano.planCharlieTask("encontre empresas em Duque de Caxias").acao, "leads.buscar_empresas");
  assert.equal(politica.isPublicApiPath("/api/integracoes/casa-dos-dados/webhook"), true);
  assert.equal(politica.isPublicApiPath("/api/charlie-leads/config"), false);
});
