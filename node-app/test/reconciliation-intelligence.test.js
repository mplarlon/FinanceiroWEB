import test from "node:test";
import assert from "node:assert/strict";
import {
  aceitarHipoteseCharlie,
  aceitarResumo,
  analisarLote,
  chaveIdempotencia,
  conciliarCartao,
  conciliarRepasse,
  descreverFontes,
  desfazerPermitido,
  detectarDuplicados,
  hipoteseDeterministica,
  investigar,
  loteSeguro,
  montarFatos,
  montarPreFechamento,
  parseCnabExtrato,
  parseCsvExtrato,
  podeAprovarEscolha,
  podeExecutarAutomaticamente,
  podeFecharDefinitivo,
  proximaFila,
  interpretarLancamentosApi,
  registrarAprendizado,
  selecionarIncrementais,
  separarJaImportados,
  sugerirPorAprendizado,
  tarifaForaDoPadrao,
} from "../server/lib/reconciliation-intelligence.js";
import {
  adquirirLock,
  aprovarExcecao,
  cicloDevido,
  desfazerConciliacao,
  executarCiclo,
  liberarLock,
  rejeitarExcecao,
} from "../server/lib/reconciliation-intelligence-service.js";
import { enviarAvisosConciliacao } from "../server/lib/reconciliation-intelligence-delivery.js";

const conta = { banco: "237", agencia: "1", conta: "99" };
const outraConta = { banco: "237", agencia: "1", conta: "88" };
const e2e = "E1234567890123456789012345678901";
const movimento = (extra) => ({ id: 1, empresa: 1, data: "2026-10-05", valor: 1500, historico: `PIX ${e2e}`, conta, conciliado: false, ...extra });
const titulo = (extra) => ({ tipo: "receber", controle: 10, idempresa: 1, empresa: 1, valor: 1500, dtvenc: "2026-10-05", pessoa: "Cliente Aurora Ltda", nrdoc: "10001", ...extra });

test("PIX com EndToEndId e valor idêntico concilia no nível 1", () => {
  const analise = analisarLote({ movimentos: [movimento({ endToEndId: e2e })], titulos: [titulo({ endToEndId: e2e })] });
  const decisao = analise.decisoes[0];
  assert.equal(decisao.automatica, true);
  assert.equal(decisao.nivel, 1);
  assert.equal(decisao.titulos[0].controle, 10);
  assert.equal(podeExecutarAutomaticamente(decisao), true);
});

test("valor, data e cliente únicos conciliam no nível 2", () => {
  const analise = analisarLote({
    movimentos: [movimento({ id: 2, valor: -2000, data: "2026-10-02", historico: "PAGAMENTO FORNECEDOR SILVA LTDA", endToEndId: null })],
    titulos: [titulo({ tipo: "pagar", controle: 20, valor: 2000, dtvenc: "2026-10-01", pessoa: "Fornecedor Silva Ltda", endToEndId: null })],
  });
  assert.equal(analise.decisoes[0].automatica, true);
  assert.equal(analise.decisoes[0].nivel, 2);
});

test("o mesmo valor sem cliente ou documento não concilia sozinho", () => {
  const analise = analisarLote({
    movimentos: [movimento({ historico: "CREDITO SEM IDENTIFICACAO", valor: 500, endToEndId: null })],
    titulos: [titulo({ valor: 500, pessoa: "Cliente Distante", nrdoc: "ZZ", endToEndId: null })],
  });
  assert.equal(analise.decisoes[0].automatica, false);
  assert.equal(analise.decisoes[0].motivo, "unico_valor_data");
  assert.equal(analise.decisoes[0].aprovavelEmLote, true);
  assert.equal(loteSeguro(analise.decisoes), true);
});

test("pagador ou CNPJ diferente do título não entra na aprovação em lote", () => {
  const porNome = analisarLote({
    movimentos: [movimento({ historico: "PIX QR CODE DINAMIC REM: LUCAS FELIX DE SOUZA 19/09", valor: 19.9, endToEndId: null, data: "2026-09-21" })],
    titulos: [titulo({ valor: 19.9, dtvenc: "2026-09-21", pessoa: "Marcelo Barros", nrdoc: "662716", endToEndId: null })],
  });
  assert.equal(porNome.decisoes[0].motivo, "unico_valor_data");
  assert.equal(porNome.decisoes[0].aprovavelEmLote, false);
  const porCnpj = analisarLote({
    movimentos: [movimento({ historico: "RECEBIMENTO PIX-PIX_CRED 13999181000153 OCEANAUTICA SERVICOS NAUTICOS LTDA", valor: 20000, endToEndId: null, data: "2026-09-21" })],
    titulos: [titulo({ valor: 20000, dtvenc: "2026-09-21", pessoa: "Julio de Oliveira Alves", cgc: "00000000000191", nrdoc: "A1", endToEndId: null })],
  });
  assert.equal(porCnpj.decisoes[0].aprovavelEmLote, false);
  assert.equal(loteSeguro(porCnpj.decisoes), false);
});

test("três títulos com o mesmo valor permanecem para confirmação", () => {
  const titulos = [1, 2, 3].map((controle) => titulo({ controle, valor: 2000, nrdoc: String(80000 + controle), endToEndId: null }));
  const analise = analisarLote({ movimentos: [movimento({ valor: 2000, historico: "CREDITO SEM IDENTIFICACAO", endToEndId: null })], titulos });
  assert.equal(analise.decisoes[0].automatica, false);
  assert.equal(analise.decisoes[0].ambigua, true);
  assert.equal(analise.decisoes[0].titulos.length, 3);
  assert.equal(loteSeguro(analise.decisoes), false);
  assert.equal(analise.proativas.some((item) => item.tipo === "varias_possibilidades"), true);
});

test("diferença de valor não gera baixa e não aceita desconto inventado", async () => {
  const origem = movimento({ valor: 1950, endToEndId: e2e });
  const aberto = titulo({ valor: 2000, endToEndId: e2e });
  const analise = analisarLote({ movimentos: [origem], titulos: [aberto] });
  assert.equal(analise.decisoes[0].automatica, false);
  assert.equal(analise.decisoes[0].alteraValor, true);
  const fatos = montarFatos(origem, [aberto]);
  assert.equal(hipoteseDeterministica(fatos).causa, "pagamento_parcial");
  const resposta = await investigar(fatos, async () => JSON.stringify({ causa: "desconto_concedido", evidencias: ["desconto-falso"], narracao: "Houve desconto comercial.", executar: true }));
  assert.equal(resposta.origem, "regras");
  assert.equal(resposta.recusaCharlie, "ia_nao_executa");
  assert.equal(resposta.automatica, false);
});

test("retenção cadastrada só vira hipótese, sem alteração automática", () => {
  const fatos = montarFatos(movimento({ valor: 1950, endToEndId: e2e }), [titulo({ valor: 2000, endToEndId: e2e, retencao: 50 })]);
  const hipotese = hipoteseDeterministica(fatos);
  assert.equal(hipotese.causa, "retencao");
  assert.equal(hipotese.automatica, false);
  assert.equal(aceitarHipoteseCharlie({ causa: "retencao", evidencias: [`retencao-10`], narracao: "A retenção cadastrada explica a diferença." }, fatos).aceita, true);
});

test("cartão líquido com contrato concilia e, sem contrato, para", () => {
  const base = { bruto: 1000, taxa: 30, credito: 970, valorTitulo: 970 };
  assert.equal(conciliarCartao({ ...base, contrato: { autorizado: true, demonstrativo: true, contaTaxa: 88 } }).automatica, true);
  assert.equal(conciliarCartao({ ...base, contrato: null }).automatica, false);
  const semContrato = analisarLote({
    movimentos: [movimento({ valor: 970, historico: "CARTAO CIELO", numdoc: "CARTAO12345", endToEndId: null })],
    titulos: [titulo({ valor: 970, nrdoc: "CARTAO12345", bruto: 1000, taxa: 30, liquido: 970, endToEndId: null })],
  });
  assert.equal(semContrato.decisoes[0].automatica, false);
  const autorizado = analisarLote({
    movimentos: [movimento({ valor: 970, historico: "CARTAO CIELO", numdoc: "CARTAO12345", endToEndId: null })],
    titulos: [titulo({ valor: 970, nrdoc: "CARTAO12345", bruto: 1000, taxa: 30, liquido: 970, endToEndId: null })],
    configuracao: { contratoCartao: { autorizado: true, demonstrativo: true, contaTaxa: 88 } },
  });
  assert.equal(autorizado.decisoes[0].automatica, true);
  assert.equal(autorizado.decisoes[0].taxa, 30);
  const brutoAberto = analisarLote({
    movimentos: [movimento({ valor: 970, historico: "CARTAO CIELO", numdoc: "CARTAO12345", endToEndId: null })],
    titulos: [titulo({ valor: 1000, nrdoc: "CARTAO12345", bruto: 1000, taxa: 30, endToEndId: null })],
    configuracao: { contratoCartao: { autorizado: true, demonstrativo: true, contaTaxa: 88 } },
  });
  assert.equal(brutoAberto.decisoes[0].automatica, true);
  assert.equal(brutoAberto.decisoes[0].acao, "cartao");
  assert.equal(brutoAberto.decisoes[0].taxa, 30);
  assert.equal(brutoAberto.decisoes[0].alteraValor, false);
  assert.equal(podeExecutarAutomaticamente(brutoAberto.decisoes[0]), true);
  const taxaErrada = analisarLote({
    movimentos: [movimento({ valor: 900, historico: "CARTAO CIELO", numdoc: "CARTAO12345", endToEndId: null })],
    titulos: [titulo({ valor: 1000, nrdoc: "CARTAO12345", bruto: 1000, taxa: 30, endToEndId: null })],
    configuracao: { contratoCartao: { autorizado: true, demonstrativo: true, contaTaxa: 88 } },
  });
  assert.equal(taxaErrada.decisoes[0].automatica, false);
  assert.equal(taxaErrada.decisoes[0].alteraValor, true);
});

test("repasse de marketplace soma pedidos do mesmo lote", () => {
  const pedidos = [
    titulo({ controle: 1, valor: 100, pedido: "10001", nrdoc: "10001", liquido: 100, comissao: 10 }),
    titulo({ controle: 2, valor: 200, pedido: "10002", nrdoc: "10002", liquido: 200, frete: 15 }),
  ];
  const repasse = conciliarRepasse(movimento({ valor: 300, lote: "L1" }), pedidos.map((pedido) => ({ ...pedido, lote: "L1" })));
  assert.equal(repasse.automatica, true);
  assert.equal(repasse.comissao, 10);
  const analise = analisarLote({
    movimentos: [movimento({ valor: 300, historico: "MERCADO LIVRE PEDIDO 10001 PEDIDO 10002", endToEndId: null })],
    titulos: pedidos,
  });
  assert.equal(analise.decisoes[0].acao, "conciliar_agrupado");
  assert.equal(analise.decisoes[0].titulos.length, 2);
});

test("duplicata, estorno e empresa diferente não conciliam", () => {
  const duplicados = detectarDuplicados([
    movimento({ id: 1, fitid: "FITID12345" }),
    movimento({ id: 2, fitid: "FITID12345" }),
  ]);
  assert.equal(duplicados.length, 1);
  const analise = analisarLote({
    movimentos: [movimento({ id: 1, fitid: "FITID12345" }), movimento({ id: 2, fitid: "FITID12345" })],
    titulos: [titulo({ endToEndId: e2e })],
  });
  assert.equal(analise.decisoes.every((item) => item.automatica === false && item.motivo === "duplicado"), true);
  const estorno = analisarLote({ movimentos: [movimento({ historico: `PIX DEVOLUCAO ${e2e}`, endToEndId: e2e })], titulos: [titulo({ endToEndId: e2e })] });
  assert.equal(estorno.decisoes[0].motivo, "estorno_ou_devolucao");
  const outraEmpresa = analisarLote({ movimentos: [movimento({ endToEndId: e2e })], titulos: [titulo({ endToEndId: e2e, idempresa: 2, empresa: 2 })] });
  assert.equal(outraEmpresa.decisoes[0].automatica, false);
});

test("transferência entre contas próprias é única e espelhada", () => {
  const analise = analisarLote({
    movimentos: [
      movimento({ id: 4, valor: -100, historico: "TRANSFERENCIA ENTRE CONTAS", endToEndId: null, conta }),
      movimento({ id: 5, valor: 100, historico: "TRANSFERENCIA ENTRE CONTAS", endToEndId: null, conta: outraConta }),
    ],
    titulos: [],
    contasProprias: [conta, outraConta],
  });
  assert.equal(analise.decisoes.filter((item) => item.automatica).length, 2);
  assert.equal(analise.decisoes[0].acao, "transferencia");
});

test("tarifa acima do histórico gera alerta e não baixa sozinha", () => {
  const comparacao = tarifaForaDoPadrao(40, [10, 10, 12]);
  assert.equal(comparacao.alerta, true);
  const analise = analisarLote({
    movimentos: [movimento({ valor: -40, historico: "TARIFA BANCARIA PACOTE", endToEndId: null })],
    tarifasHistoricas: [10, 10, 12],
  });
  assert.equal(analise.decisoes[0].automatica, false);
  assert.equal(analise.decisoes[0].motivo, "tarifa_acima_do_padrao");
});

test("aprendizado sugere e não autoriza sozinho", () => {
  const padroes = registrarAprendizado([], { empresa: 1, historico: "PGTO OFICINA CENTRO", pessoa: "Joao Oficina Ltda", tipo: "pagar" });
  assert.equal(padroes[0].autorizaSozinho, false);
  const sugerido = sugerirPorAprendizado(padroes, movimento({ valor: -80, historico: "PGTO OFICINA CENTRO", endToEndId: null }), [titulo({ tipo: "pagar", valor: 80, pessoa: "Joao Oficina Ltda" })]);
  assert.equal(sugerido.controle, 10);
  const analise = analisarLote({
    movimentos: [movimento({ valor: -80, historico: "PGTO OFICINA CENTRO", endToEndId: null })],
    titulos: [titulo({ tipo: "pagar", valor: 80, pessoa: "Joao Oficina Ltda", nrdoc: "1", endToEndId: null })],
    padroes,
  });
  assert.equal(analise.decisoes[0].automatica, false);
  assert.equal(analise.decisoes[0].motivo, "padrao_aprendido");
});

test("título vencido com identificador é conciliado e a meta ignora item sem evidência", () => {
  const analise = analisarLote({
    movimentos: [
      movimento({ id: 1, endToEndId: e2e, data: "2026-10-10" }),
      movimento({ id: 2, valor: 10, historico: "LANCAMENTO SEM ORIGEM", endToEndId: null }),
    ],
    titulos: [titulo({ endToEndId: e2e, dtvenc: "2026-10-01" })],
  });
  assert.equal(analise.metricas.elegiveis, 1);
  assert.equal(analise.metricas.percentualElegiveis, 100);
  assert.equal(analise.metricas.percentualGeral, 50);
  assert.equal(analise.proativas.some((item) => item.tipo === "titulo_vencido_pago_no_extrato"), true);
});

test("pré-fechamento aponta dia ausente e não fecha definitivo", () => {
  const fechamento = montarPreFechamento({
    data: "2026-10-05",
    movimentos: [movimento({ data: "2026-10-05" })],
    analise: { decisoes: [], metricas: { automaticas: 0 } },
    diasEsperados: ["2026-10-04", "2026-10-05"],
    saldos: [{ banco: "237", agencia: "1", conta: "99", saldoInicial: 1000, saldoFinal: 2500, soma: 1500 }],
  });
  assert.deepEqual(fechamento.diasAusentes, ["2026-10-04"]);
  assert.equal(fechamento.saldoConfere, true);
  assert.equal(fechamento.fechamentoDefinitivo, false);
  assert.equal(aceitarResumo("Havia uma diferença de 999,99.", { valores: [0] }), null);
});

test("CSV e CNAB separam duplicados e a sincronização não reprocessa o conciliado", () => {
  const csv = parseCsvExtrato("data;valor;historico;fitid\n05/10/2026;1.500,00;PIX CLIENTE;FITID12345\n");
  assert.equal(csv.itens[0].valor, 1500);
  assert.equal(csv.itens[0].data, "2026-10-05");
  const linha = `${" ".repeat(240)}`.split("");
  "237".split("").forEach((caractere, indice) => { linha[indice] = caractere; });
  linha[7] = "3";
  linha[13] = "E";
  "05102026".split("").forEach((caractere, indice) => { linha[142 + indice] = caractere; });
  "000000000000150000".split("").forEach((caractere, indice) => { linha[150 + indice] = caractere; });
  linha[168] = "D";
  const cnab = parseCnabExtrato(linha.join(""));
  assert.equal(cnab.itens[0].valor, -1500);
  assert.equal(cnab.itens[0].data, "2026-10-05");
  const separado = separarJaImportados(csv.itens, ["FITID12345"]);
  assert.equal(separado.novos.length, 0);
  assert.equal(separado.duplicados.length, 1);
  const incremental = selecionarIncrementais([
    movimento({ id: 3, conciliado: false }),
    movimento({ id: 5, conciliado: true }),
    movimento({ id: 8, conciliado: false }),
  ], { ultimoId: 5 });
  assert.deepEqual(incremental.novos.map((item) => item.id), [8]);
  assert.deepEqual(incremental.pendentes.map((item) => item.id), [3]);
});

test("Open Finance sem consentimento não finge integração", () => {
  const fontes = descreverFontes([{ banco: "001", conta: "123", extratoAutorizado: false, consentimento: false }]);
  assert.equal(fontes.dependeDeArquivo, true);
  assert.equal(fontes.contas[0].openFinance, "aguardando_consentimento");
  assert.deepEqual(fontes.arquivos, ["OFX", "CSV", "CNAB240"]);
});

test("aprovação exige usuário, valor igual e perfil permitido", () => {
  const decisao = analisarLote({
    movimentos: [movimento({ historico: "CREDITO SEM IDENTIFICACAO", valor: 500, endToEndId: null })],
    titulos: [titulo({ valor: 500, nrdoc: "1", endToEndId: null })],
  }).decisoes[0];
  assert.equal(podeAprovarEscolha(decisao, { confirmado: true, controle: 10, tipo: "receber" }, { idusuario: 4, perfil: "vendedor" }).motivo, "perfil_sem_permissao");
  assert.equal(podeAprovarEscolha(decisao, { confirmado: true, controle: 10, tipo: "receber" }, { idusuario: 4, perfil: "financeiro" }).ok, true);
  assert.equal(desfazerPermitido({ origem: "servico-conciliacao", movimentos: [1], movimentoId: 1, empresa: 1 }, { confirmado: false, idusuario: 4 }).ok, false);
});

test("ciclo grava só a decisão segura e não repete", async () => {
  let gravacoes = 0;
  let estado = null;
  const deps = {
    ler: (_nome, fallback) => estado || fallback,
    gravar: (_nome, valor) => { estado = structuredClone(valor); return valor; },
    manual: true,
    narrar: null,
    movimentos: [movimento({ endToEndId: e2e }), movimento({ id: 9, valor: 10, historico: "LANCAMENTO SEM ORIGEM", endToEndId: null })],
    titulos: [titulo({ endToEndId: e2e })],
    aplicar: async (decisao) => {
      gravacoes += 1;
      assert.equal(decisao.automatica, true);
      return { movimentos: [70] };
    },
  };
  const primeiro = await executarCiclo(deps);
  const segundo = await executarCiclo(deps);
  assert.equal(primeiro.aplicadas.length, 1);
  assert.equal(segundo.aplicadas.length, 0);
  assert.equal(gravacoes, 1);
  assert.equal(chaveIdempotencia(primeiro.aplicadas[0] ? { empresa: 1, movimentoId: 1, acao: "conciliar", titulos: [{ tipo: "receber", idempresa: 1, controle: 10 }] } : {}), chaveIdempotencia({ empresa: 1, movimentoId: 1, acao: "conciliar", titulos: [{ tipo: "receber", idempresa: 1, controle: 10 }] }));
});

test("aprovação humana aprende o padrão e rejeição não grava financeiro", async () => {
  let estado = null;
  let gravacoes = 0;
  const deps = {
    ler: (_nome, fallback) => estado || fallback,
    gravar: (_nome, valor) => { estado = structuredClone(valor); return valor; },
    manual: true,
    narrar: async () => JSON.stringify({ causa: "desconto_concedido", evidencias: ["inventada"], narracao: "Desconto inventado." }),
    movimentos: [movimento({ historico: "CREDITO SEM IDENTIFICACAO", valor: 500, endToEndId: null })],
    titulos: [titulo({ valor: 500, pessoa: "Cliente Distante Ltda", nrdoc: "1", endToEndId: null })],
    aplicar: async () => { gravacoes += 1; return { movimentos: [80] }; },
  };
  await executarCiclo(deps);
  const excecao = estado.excecoes[0];
  assert.notEqual(excecao.hipotese?.causa, "desconto_concedido");
  const negado = await aprovarExcecao(deps, excecao.id, { confirmado: true, controle: 10, tipo: "receber" }, { idusuario: 3, perfil: "vendedor" });
  assert.equal(negado.motivo, "perfil_sem_permissao");
  assert.equal(gravacoes, 0);
  const aprovado = await aprovarExcecao(deps, excecao.id, { confirmado: true, controle: 10, tipo: "receber" }, { idusuario: 3, perfil: "financeiro", nome: "Ana" });
  assert.equal(aprovado.ok, true);
  assert.equal(estado.padroes[0].autorizaSozinho, false);
  assert.equal(gravacoes, 1);
});

test("rejeição e desfazimento ficam na trilha", async () => {
  let estado = null;
  const deps = {
    ler: (_nome, fallback) => estado || fallback,
    gravar: (_nome, valor) => { estado = structuredClone(valor); return valor; },
    manual: true,
    narrar: null,
    movimentos: [movimento({ historico: "CREDITO SEM IDENTIFICACAO", valor: 500, endToEndId: null })],
    titulos: [titulo({ valor: 500, pessoa: "Cliente Distante Ltda", nrdoc: "1", endToEndId: null })],
    aplicar: async () => ({ movimentos: [81] }),
    desfazer: async () => {},
  };
  await executarCiclo(deps);
  const excecao = estado.excecoes[0];
  assert.equal(rejeitarExcecao(deps, excecao.id, { idusuario: 9, nome: "Ana" }).ok, true);
  assert.equal(estado.excecoes.length, 0);
  estado.auditoria.push({ id: "aud-1", origem: "servico-conciliacao", movimentos: [81], movimentoId: 1, empresa: 1, titulos: [], desfeito: false, acao: "conciliar" });
  deps.gravar("conciliacao-inteligente.json", estado);
  assert.equal((await desfazerConciliacao(deps, "aud-1", { confirmado: false, idusuario: 9 })).motivo, "confirmacao_ausente");
  assert.equal((await desfazerConciliacao(deps, "aud-1", { confirmado: true, idusuario: 9 })).ok, true);
  assert.equal(estado.auditoria.find((item) => item.id === "aud-1").desfeito, true);
});

test("lock impede execução duplicada e o ciclo respeita a pausa", () => {
  const estado = { lock: null, configuracao: { ativo: false }, execucoes: [], ultimoErro: null };
  assert.equal(cicloDevido(estado), false);
  estado.configuracao.ativo = true;
  assert.equal(cicloDevido(estado, 1_000), true);
  const dono = adquirirLock(estado, 1_000);
  assert.equal(adquirirLock(estado, 1_000), null);
  liberarLock(estado, dono);
  assert.ok(adquirirLock(estado, 1_000));
});

test("nome truncado do PIX concilia só o cliente único e o número curto do banco não vira conflito", () => {
  const unico = analisarLote({
    movimentos: [movimento({ valor: 329, historico: "PIX RECEBIDO REM: CAR CENTER MARICA LTD 27/10", endToEndId: null, data: "2026-10-27" })],
    titulos: [titulo({ valor: 329, pessoa: "CAR CENTER MARICA LTDA", dtvenc: "2026-10-27", nrdoc: "1", endToEndId: null })],
  });
  assert.equal(unico.decisoes[0].automatica, true);
  assert.equal(unico.decisoes[0].motivo, "regra_unica");
  const vencido = analisarLote({
    movimentos: [movimento({ valor: 329, historico: "PIX RECEBIDO REM: CAR CENTER MARICA LTD 27/10", endToEndId: null, data: "2026-10-27" })],
    titulos: [titulo({ valor: 329, pessoa: "CAR CENTER MARICA LTDA", dtvenc: "2026-08-01", nrdoc: "7", endToEndId: null })],
  });
  assert.equal(vencido.decisoes[0].automatica, true);
  assert.equal(vencido.proativas.some((item) => item.tipo === "titulo_vencido_pago_no_extrato"), true);
  const fantasia = analisarLote({
    movimentos: [movimento({ valor: 329, historico: "PIX RECEBIDO REM: ULTRA FORTE CARLOS 27/10", endToEndId: null, data: "2026-10-27" })],
    titulos: [titulo({ valor: 329, pessoa: "ULTRA FORTE", nomes: ["ULTRA FORTE", "ULTRA FORTE (CARLOS)"], dtvenc: "2026-10-27", nrdoc: "9", endToEndId: null })],
  });
  assert.equal(fantasia.decisoes[0].automatica, true);
  const cgc = analisarLote({
    movimentos: [movimento({ valor: 880, historico: "PIX CNPJ 02913347000150", endToEndId: null, data: "2026-10-05" })],
    titulos: [titulo({ valor: 880, pessoa: "GSP CONSERVACAO", cgc: "02.913.347/0001-50", nrdoc: "8", endToEndId: null })],
  });
  assert.equal(cgc.decisoes[0].automatica, true);
  const repetido = analisarLote({
    movimentos: [movimento({ valor: 329, historico: "PIX RECEBIDO REM: CARLOS FERNANDO DOS S 27/10", endToEndId: null, data: "2026-10-27" })],
    titulos: [
      titulo({ controle: 1, valor: 329, pessoa: "CARLOS FERNANDO DOS SANTOS", dtvenc: "2026-10-27", nrdoc: "1", endToEndId: null }),
      titulo({ controle: 2, valor: 329, pessoa: "CARLOS FERNANDO DOS SANTOS FILHO", dtvenc: "2026-10-27", nrdoc: "2", endToEndId: null }),
    ],
  });
  assert.equal(repetido.decisoes[0].automatica, false);
  const curto = analisarLote({
    movimentos: [movimento({ valor: 329, historico: "PIX RECEBIDO", numdoc: "1218214", fitid: "1218214", endToEndId: null })],
    titulos: [titulo({ valor: 500, nrdoc: "1218214", endToEndId: null })],
  });
  assert.notEqual(curto.decisoes[0].motivo, "valor_divergente");
});

test("fila percorre o estoque e o fechamento definitivo exige permissão e ausência de risco alto", async () => {
  assert.deepEqual(proximaFila([1, 2, 3, 4], 3, 2).ids, [4, 1]);
  assert.equal(proximaFila([1, 2, 3, 4], 3, 2).proximo, 0);
  assert.equal(podeFecharDefinitivo({ divergenciasAltas: 2, saldoConfere: true }, { idusuario: 1, confirmado: true, perfil: "financeiro" }).motivo, "divergencia_alta");
  assert.equal(podeFecharDefinitivo({ divergenciasAltas: 0, saldoConfere: false }, { idusuario: 1, confirmado: true, perfil: "financeiro" }).motivo, "saldo_nao_confere");
  assert.equal(podeFecharDefinitivo({ divergenciasAltas: 0, saldoConfere: true }, { idusuario: 1, confirmado: true, perfil: "financeiro" }).ok, true);
  assert.equal(interpretarLancamentosApi({ lancamentos: [{ data: "2026-10-05", valor: 10.5, historico: "PIX", fitid: "ABCDE12345" }] })[0].valor, 10.5);
  const aviso = await enviarAvisosConciliacao([{ texto: "Conciliação concluída." }], { envioReal: false, email: true, whatsapp: true });
  assert.deepEqual(aviso.canais, []);
});
