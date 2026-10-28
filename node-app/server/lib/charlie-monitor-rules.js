const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const pct = (value) =>
  `${num(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const count = (value) => num(value).toLocaleString("pt-BR");

export const MONITOR_IDS = [
  "receber_vencidos",
  "receber_concentracao",
  "receber_recorrentes",
  "receber_aumento",
  "receber_duplicidade",
  "pagar_vencidos",
  "pagar_hoje",
  "pagar_futuros",
  "pagar_concentracao",
  "pagar_duplicidade",
  "fluxo_caixa",
  "vendas_queda",
  "vendedores_queda",
  "clientes_sumidos",
  "produtos_queda",
  "descontos",
  "margem_vendas",
  "estoque_minimo",
  "estoque_negativo",
  "estoque_parado",
  "ruptura",
  "preco_abaixo_custo",
  "margem_preco",
  "aumento_custo",
  "vendas_crescimento",
];

export const DEFAULT_MONITOR_SETTINGS = {
  ativo: true,
  intervaloMinutos: 60,
  reabrirDescartados: false,
  notificados: [],
  categorias: ["financeiro", "comercial", "estoque", "precos", "auditoria"],
  monitores: Object.fromEntries(MONITOR_IDS.map((id) => [id, true])),
  limites: {
    receberVencidoMinimo: 0,
    receberVencidoCritico: 10000,
    pagarVencidoMinimo: 0,
    pagarVencidoCritico: 10000,
    pagarHojeMinimo: 0,
    pagarFuturoDias: 7,
    pagarFuturoMinimo: 0,
    concentracaoPercentual: 60,
    atrasoRecorrenteTitulos: 3,
    aumentoAtrasoPercentual: 10,
    quedaVendasPercentual: 15,
    quedaValorMinimo: 0,
    periodoDias: 30,
    descontoPercentual: 15,
    margemMinima: 25,
    clienteMultiploIntervalo: 2,
    clienteIntervaloMinimoDias: 7,
    semMovimentoDias: 90,
    coberturaRiscoDias: 7,
    margemPrecoMinima: 10,
    aumentoCustoPercentual: 15,
    caixaHorizonteDias: 30,
  },
};

const LIMIT_RANGES = {
  receberVencidoMinimo: [0, 1e12],
  receberVencidoCritico: [0, 1e12],
  pagarVencidoMinimo: [0, 1e12],
  pagarVencidoCritico: [0, 1e12],
  pagarHojeMinimo: [0, 1e12],
  pagarFuturoDias: [1, 180],
  pagarFuturoMinimo: [0, 1e12],
  concentracaoPercentual: [1, 100],
  atrasoRecorrenteTitulos: [2, 100],
  aumentoAtrasoPercentual: [1, 1000],
  quedaVendasPercentual: [1, 100],
  quedaValorMinimo: [0, 1e12],
  periodoDias: [7, 365],
  descontoPercentual: [1, 100],
  margemMinima: [0, 100],
  clienteMultiploIntervalo: [1, 10],
  clienteIntervaloMinimoDias: [1, 365],
  semMovimentoDias: [7, 730],
  coberturaRiscoDias: [1, 180],
  margemPrecoMinima: [0, 100],
  aumentoCustoPercentual: [1, 1000],
  caixaHorizonteDias: [1, 180],
};

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeMonitorSettings(input = {}) {
  const base = DEFAULT_MONITOR_SETTINGS;
  const monitores = { ...base.monitores };
  for (const id of MONITOR_IDS) {
    if (input.monitores && id in input.monitores) monitores[id] = Boolean(input.monitores[id]);
  }
  const limites = { ...base.limites };
  for (const [key, [min, max]] of Object.entries(LIMIT_RANGES)) {
    if (input.limites && key in input.limites)
      limites[key] = clamp(input.limites[key], min, max, base.limites[key]);
  }
  const categorias = ["financeiro", "comercial", "estoque", "precos", "auditoria"].filter(
    (item) => !Array.isArray(input.categorias) || input.categorias.includes(item),
  );
  const notificados = [...new Set((input.notificados || base.notificados)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0))].slice(0, 200);
  return {
    ativo: input.ativo === undefined ? base.ativo : Boolean(input.ativo),
    intervaloMinutos: clamp(input.intervaloMinutos ?? base.intervaloMinutos, 15, 1440, base.intervaloMinutos),
    reabrirDescartados: Boolean(input.reabrirDescartados),
    notificados,
    categorias: categorias.length ? categorias : [...base.categorias],
    monitores,
    limites,
  };
}

function variation(current, previous) {
  if (current == null || previous == null || !(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

function vendaNumero(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function people(rows) {
  return (rows || []).slice(0, 8).map((row) => ({
    CODIGO: row.CODIGO ?? row.ID ?? row.CDCLIENTE ?? row.CDFORNECEDOR ?? row.CDPRODUTO ?? null,
    NOME: row.NOME || "Não informado",
    VALOR: num(row.VALOR ?? row.TOTAL ?? row.ATUAL),
    QTD: num(row.QTD ?? row.TITULOS ?? row.PEDIDOS),
    DETALHE: row.DETALHE || "",
  }));
}

function push(list, enabled, finding) {
  if (enabled && finding) list.push(finding);
}

export function buildFindings(facts = {}, settings = DEFAULT_MONITOR_SETTINGS) {
  const on = settings.monitores || {};
  const lim = settings.limites || DEFAULT_MONITOR_SETTINGS.limites;
  const out = [];
  const receber = facts.receber || null;
  if (receber) {
    const total = num(receber.total);
    push(out, on.receber_vencidos && total > num(lim.receberVencidoMinimo), {
      regra: "receber_vencidos",
      categoria: "financeiro",
      gravidade: total >= num(lim.receberVencidoCritico) ? "critico" : "atencao",
      titulo: "Títulos vencidos a receber",
      descricao: `Existem ${money(total)} em títulos vencidos. Os valores estão distribuídos entre ${count(receber.clientes)} cliente(s), em ${count(receber.titulos)} título(s).`,
      recomendacao: "Priorizar a análise dos títulos mais antigos e de maior valor.",
      registros: people(receber.top),
      evidencias: { total, clientes: num(receber.clientes), titulos: num(receber.titulos) },
      dominio: "receber",
      status: "vencido",
    });
    const share = total > 0 ? (num(receber.top3) / total) * 100 : 0;
    push(out, on.receber_concentracao && share >= num(lim.concentracaoPercentual) && total > num(lim.receberVencidoMinimo), {
      regra: "receber_concentracao",
      categoria: "financeiro",
      gravidade: share >= 80 ? "critico" : "atencao",
      titulo: "Concentração da inadimplência",
      descricao: `Três clientes concentram ${pct(share)} dos ${money(total)} vencidos. A concentração foi calculada sobre os títulos em aberto já vencidos.`,
      recomendacao: "Começar a cobrança pelos clientes que concentram a maior parte da dívida.",
      registros: people(receber.top),
      evidencias: { total, participacao: share },
      dominio: "receber",
      status: "vencido",
    });
    push(out, on.receber_recorrentes && num(receber.recorrentes) > 0, {
      regra: "receber_recorrentes",
      categoria: "financeiro",
      gravidade: "atencao",
      titulo: "Clientes com atrasos recorrentes",
      descricao: `${count(receber.recorrentes)} cliente(s) possuem pelo menos ${count(lim.atrasoRecorrenteTitulos)} títulos vencidos em aberto. A regra conta títulos, sem concluir o motivo do atraso.`,
      recomendacao: "Revisar o histórico desses clientes antes de ampliar novas vendas a prazo.",
      registros: people(receber.recorrentesLista),
      evidencias: { clientes: num(receber.recorrentes), minimoTitulos: num(lim.atrasoRecorrenteTitulos) },
      dominio: "receber",
      status: "vencido",
    });
    const delta = variation(total, num(receber.anterior));
    push(out, on.receber_aumento && receber.anterior !== null && receber.anterior !== undefined && delta !== null && delta >= num(lim.aumentoAtrasoPercentual), {
      regra: "receber_aumento",
      categoria: "financeiro",
      gravidade: "atencao",
      titulo: "Aumento dos valores em atraso",
      descricao: `Os títulos vencidos a receber passaram de ${money(receber.anterior)} para ${money(total)}, uma variação de ${pct(delta)} em relação à análise anterior. A comparação usa somente os totais gravados nas análises do Charlie.`,
      recomendacao: "Verificar quais clientes entraram ou aumentaram o saldo vencido desde a última análise.",
      registros: people(receber.top),
      evidencias: { atual: total, anterior: num(receber.anterior), variacao: delta },
      dominio: "receber",
      status: "vencido",
    });
    push(out, on.receber_duplicidade && (receber.duplicidades || []).length > 0, {
      regra: "receber_duplicidade",
      categoria: "financeiro",
      gravidade: "atencao",
      titulo: "Possível duplicidade em contas a receber",
      descricao: `Encontrei ${count(receber.duplicidades.length)} grupo(s) de títulos em aberto com o mesmo cliente, documento, parcela e valor. A coincidência desses campos indica possível duplicidade e não confirma o erro sozinha.`,
      recomendacao: "Comparar os lançamentos coincidentes antes de qualquer baixa ou exclusão.",
      registros: (receber.duplicidades || []).slice(0, 15).map((row) => ({
        CODIGO: row.CODIGO,
        NOME: row.NOME || "Não informado",
        DOCUMENTO: row.DOCUMENTO || "",
        PARCELA: row.PARCELA,
        VALOR: num(row.VALOR),
        QTD: num(row.QTD),
      })),
      evidencias: { grupos: receber.duplicidades.length },
      dominio: "receber",
      status: "aberto",
    });
  }

  const pagar = facts.pagar || null;
  if (pagar) {
    const vencido = num(pagar.vencido);
    push(out, on.pagar_vencidos && vencido > num(lim.pagarVencidoMinimo), {
      regra: "pagar_vencidos",
      categoria: "financeiro",
      gravidade: vencido >= num(lim.pagarVencidoCritico) ? "critico" : "atencao",
      titulo: "Pagamentos vencidos",
      descricao: `Existem ${money(vencido)} em pagamentos vencidos, distribuídos entre ${count(pagar.fornecedoresVencidos)} fornecedor(es) e ${count(pagar.titulosVencidos)} título(s).`,
      recomendacao: "Conferir os vencimentos mais antigos e o saldo disponível antes de priorizar os pagamentos.",
      registros: people(pagar.topVencidos),
      evidencias: { total: vencido, fornecedores: num(pagar.fornecedoresVencidos) },
      dominio: "pagar",
      status: "vencido",
    });
    push(out, on.pagar_hoje && num(pagar.hoje) > num(lim.pagarHojeMinimo), {
      regra: "pagar_hoje",
      categoria: "financeiro",
      gravidade: "atencao",
      titulo: "Pagamentos que vencem hoje",
      descricao: `Há ${money(pagar.hoje)} em títulos a pagar com vencimento hoje, em ${count(pagar.titulosHoje)} título(s).`,
      recomendacao: "Separar esses compromissos do restante da carteira para decidir o que será pago hoje.",
      registros: people(pagar.topHoje),
      evidencias: { total: num(pagar.hoje), titulos: num(pagar.titulosHoje) },
      dominio: "pagar",
      status: "aberto",
    });
    push(out, on.pagar_futuros && num(pagar.futuro) > num(lim.pagarFuturoMinimo), {
      regra: "pagar_futuros",
      categoria: "financeiro",
      gravidade: "informativo",
      titulo: "Pagamentos futuros relevantes",
      descricao: `Nos próximos ${count(lim.pagarFuturoDias)} dias vencem ${money(pagar.futuro)} em títulos a pagar ainda em aberto. São compromissos com data, não pagamentos já realizados.`,
      recomendacao: "Reservar caixa para os vencimentos de maior valor desse período.",
      registros: people(pagar.topFuturos),
      evidencias: { total: num(pagar.futuro), dias: num(lim.pagarFuturoDias) },
      dominio: "pagar",
      status: "aberto",
    });
    const share = num(pagar.vencido) > 0 ? (num(pagar.top3) / num(pagar.vencido)) * 100 : 0;
    push(out, on.pagar_concentracao && share >= num(lim.concentracaoPercentual) && num(pagar.vencido) > num(lim.pagarVencidoMinimo), {
      regra: "pagar_concentracao",
      categoria: "financeiro",
      gravidade: "atencao",
      titulo: "Concentração de pagamentos vencidos",
      descricao: `Três fornecedores concentram ${pct(share)} dos ${money(pagar.vencido)} vencidos a pagar.`,
      recomendacao: "Negociar primeiro os fornecedores que concentram os vencimentos em atraso.",
      registros: people(pagar.topVencidos),
      evidencias: { total: num(pagar.vencido), participacao: share },
      dominio: "pagar",
      status: "vencido",
    });
    push(out, on.pagar_duplicidade && (pagar.duplicidades || []).length > 0, {
      regra: "pagar_duplicidade",
      categoria: "financeiro",
      gravidade: "atencao",
      titulo: "Possível duplicidade em contas a pagar",
      descricao: `Encontrei ${count(pagar.duplicidades.length)} grupo(s) de títulos em aberto com o mesmo fornecedor, nota, parcela e valor. A coincidência indica possível duplicidade e precisa de conferência.`,
      recomendacao: "Conferir os documentos coincidentes antes de pagar ou baixar.",
      registros: (pagar.duplicidades || []).slice(0, 15).map((row) => ({
        CODIGO: row.CODIGO,
        NOME: row.NOME || "Não informado",
        DOCUMENTO: row.DOCUMENTO || "",
        PARCELA: row.PARCELA,
        VALOR: num(row.VALOR),
        QTD: num(row.QTD),
      })),
      evidencias: { grupos: pagar.duplicidades.length },
      dominio: "pagar",
      status: "aberto",
    });
  }

  const caixa = facts.caixa || null;
  if (caixa && on.fluxo_caixa) {
    const saldo = num(caixa.saldo);
    const receber = num(caixa.receber);
    const pagarCaixa = num(caixa.pagar);
    const projetado = saldo + receber - pagarCaixa;
    push(out, projetado < 0, {
      regra: "fluxo_caixa",
      categoria: "financeiro",
      gravidade: "critico",
      titulo: "Possível insuficiência de caixa",
      descricao: `O saldo bancário confirmado é ${money(saldo)}. Há ${money(receber)} em títulos a receber e ${money(pagarCaixa)} em títulos a pagar com vencimento nos próximos ${count(lim.caixaHorizonteDias)} dias. A projeção pelos títulos em aberto fica em ${money(projetado)}. Os recebimentos são títulos em aberto, não valores já depositados.`,
      recomendacao: "Revisar os pagamentos do período e a expectativa real de recebimento antes de assumir novos compromissos.",
      registros: [],
      evidencias: { saldoConfirmado: saldo, titulosReceber: receber, titulosPagar: pagarCaixa, projetadoTitulos: projetado, dias: num(lim.caixaHorizonteDias) },
    });
  }

  const vendas = facts.vendas || null;
  if (vendas) {
    const atual = vendaNumero(vendas.atual);
    const anterior = vendaNumero(vendas.anterior);
    const delta = variation(atual, anterior);
    push(out, on.vendas_queda && delta !== null && delta <= -num(lim.quedaVendasPercentual) && num(vendas.anterior) > num(lim.quedaValorMinimo), {
      regra: "vendas_queda",
      categoria: "comercial",
      gravidade: delta <= -30 ? "critico" : "atencao",
      titulo: "Queda de faturamento",
      descricao: `O faturamento dos últimos ${count(lim.periodoDias)} dias foi ${money(vendas.atual)}, contra ${money(vendas.anterior)} no período anterior equivalente. A variação é ${pct(delta)}. A comparação não identifica a causa da queda.`,
      recomendacao: "Comparar vendedores, clientes e produtos do período antes de concluir o que mudou.",
      registros: [],
      evidencias: { atual: num(vendas.atual), anterior: num(vendas.anterior), variacao: delta },
    });
    push(out, on.vendas_crescimento && delta !== null && delta > 0 && num(vendas.atual) > 0, {
      regra: "vendas_crescimento",
      categoria: "comercial",
      gravidade: "informativo",
      titulo: "Faturamento em crescimento",
      descricao: `O faturamento dos últimos ${count(lim.periodoDias)} dias foi ${money(vendas.atual)}, ${pct(delta)} acima dos ${money(vendas.anterior)} do período anterior equivalente.`,
      recomendacao: "Acompanhar se o crescimento se mantém no próximo período.",
      registros: [],
      evidencias: { atual: num(vendas.atual), anterior: num(vendas.anterior), variacao: delta },
    });
    const vendedores = (vendas.vendedores || []).filter((row) => {
      const change = variation(vendaNumero(row.ATUAL), vendaNumero(row.ANTERIOR));
      return change !== null && change <= -num(lim.quedaVendasPercentual) && vendaNumero(row.ANTERIOR) > num(lim.quedaValorMinimo);
    });
    push(out, on.vendedores_queda && vendedores.length > 0, {
      regra: "vendedores_queda",
      categoria: "comercial",
      gravidade: "atencao",
      titulo: "Queda de vendas por vendedor",
      descricao: `${count(vendedores.length)} vendedor(es) reduziram o faturamento mais de ${pct(lim.quedaVendasPercentual)} na comparação entre períodos equivalentes. A regra não atribui a causa da redução.`,
      recomendacao: "Verificar a carteira e a meta de cada vendedor listado.",
      registros: vendedores.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Sem vendedor",
        ATUAL: vendaNumero(row.ATUAL),
        ANTERIOR: vendaNumero(row.ANTERIOR),
        VARIACAO: variation(vendaNumero(row.ATUAL), vendaNumero(row.ANTERIOR)),
      })),
      evidencias: { vendedores: vendedores.length },
    });
    const produtos = (vendas.produtos || []).filter((row) => {
      const change = variation(vendaNumero(row.ATUAL), vendaNumero(row.ANTERIOR));
      return change !== null && change <= -num(lim.quedaVendasPercentual) && vendaNumero(row.ANTERIOR) > num(lim.quedaValorMinimo);
    });
    push(out, on.produtos_queda && produtos.length > 0, {
      regra: "produtos_queda",
      categoria: "comercial",
      gravidade: "atencao",
      titulo: "Produtos com queda de vendas",
      descricao: `${count(produtos.length)} produto(s) venderam pelo menos ${pct(lim.quedaVendasPercentual)} a menos que no período anterior equivalente.`,
      recomendacao: "Conferir estoque, preço e demanda desses produtos antes de tratar a queda como perda de mercado.",
      registros: produtos.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Produto",
        ATUAL: vendaNumero(row.ATUAL),
        ANTERIOR: vendaNumero(row.ANTERIOR),
        VARIACAO: variation(vendaNumero(row.ATUAL), vendaNumero(row.ANTERIOR)),
      })),
      evidencias: { produtos: produtos.length },
    });
    const desconto = num(vendas.bruto) > 0 ? (num(vendas.desconto) / num(vendas.bruto)) * 100 : 0;
    push(out, on.descontos && num(vendas.bruto) > 0 && desconto >= num(lim.descontoPercentual), {
      regra: "descontos",
      categoria: "comercial",
      gravidade: "atencao",
      titulo: "Descontos acima do limite",
      descricao: `Os descontos dos últimos ${count(lim.periodoDias)} dias somam ${money(vendas.desconto)}, equivalentes a ${pct(desconto)} do valor antes do desconto. O limite configurado é ${pct(lim.descontoPercentual)}.`,
      recomendacao: "Revisar os pedidos com maior desconto e a política comercial vigente.",
      registros: people(vendas.descontosProdutos),
      evidencias: { desconto: num(vendas.desconto), bruto: num(vendas.bruto), percentual: desconto },
    });
    push(out, on.margem_vendas && (vendas.margemBaixa || []).length > 0, {
      regra: "margem_vendas",
      categoria: "comercial",
      gravidade: "atencao",
      titulo: "Vendas com margem abaixo do limite",
      descricao: `${count(vendas.margemBaixa.length)} produto(s) vendidos no período ficaram com margem abaixo de ${pct(lim.margemMinima)}. A margem usa o valor vendido menos o custo gravado no item ou, na falta dele, o custo médio do cadastro.`,
      recomendacao: "Conferir preço, desconto e custo desses produtos antes de repetir a condição comercial.",
      registros: vendas.margemBaixa.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Produto",
        FATURAMENTO: num(row.FATURAMENTO),
        CUSTO: num(row.CUSTO),
        MARGEM: num(row.MARGEM),
      })),
      evidencias: { produtos: vendas.margemBaixa.length, limite: num(lim.margemMinima) },
    });
    push(out, on.clientes_sumidos && (vendas.clientesSumidos || []).length > 0, {
      regra: "clientes_sumidos",
      categoria: "comercial",
      gravidade: "atencao",
      titulo: "Clientes fora do intervalo habitual de compra",
      descricao: `${count(vendas.clientesSumidos.length)} cliente(s) com pelo menos três pedidos no último ano estão sem comprar há mais tempo do que o intervalo médio recente, respeitando o mínimo de ${count(lim.clienteIntervaloMinimoDias)} dias. Isso mostra ausência de pedido, não o motivo.`,
      recomendacao: "Verificar se existe oportunidade de contato comercial com esses clientes.",
      registros: vendas.clientesSumidos.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Cliente",
        DIAS_SEM_COMPRA: num(row.DIAS_SEM),
        INTERVALO_MEDIO: num(row.INTERVALO),
        PEDIDOS: num(row.PEDIDOS),
      })),
      evidencias: { clientes: vendas.clientesSumidos.length },
    });
  }

  const estoque = facts.estoque || null;
  if (estoque) {
    push(out, on.estoque_negativo && num(estoque.negativos) > 0, {
      regra: "estoque_negativo",
      categoria: "estoque",
      gravidade: "critico",
      titulo: "Produtos com estoque negativo",
      descricao: `Encontrei ${count(estoque.negativos)} produto(s) com quantidade atual negativa no estoque.`,
      recomendacao: "Conferir movimentações e acertos desses produtos.",
      registros: people(estoque.negativosLista),
      evidencias: { produtos: num(estoque.negativos) },
    });
    push(out, on.estoque_minimo && num(estoque.abaixoMinimo) > 0, {
      regra: "estoque_minimo",
      categoria: "estoque",
      gravidade: "atencao",
      titulo: "Produtos abaixo do estoque mínimo",
      descricao: `Encontrei ${count(estoque.abaixoMinimo)} produto(s) ativos com estoque igual ou inferior ao mínimo cadastrado, quando esse mínimo é maior que zero.`,
      recomendacao: "Avaliar a reposição dos itens abaixo do mínimo que ainda têm saída.",
      registros: people(estoque.abaixoLista),
      evidencias: { produtos: num(estoque.abaixoMinimo) },
    });
    push(out, on.estoque_parado && num(estoque.parados) > 0, {
      regra: "estoque_parado",
      categoria: "estoque",
      gravidade: "atencao",
      titulo: "Produtos sem movimentação de venda",
      descricao: `${count(estoque.parados)} produto(s) ativos possuem estoque e não tiveram venda nos últimos ${count(lim.semMovimentoDias)} dias.`,
      recomendacao: "Revisar os itens parados de maior valor antes de novas compras.",
      registros: people(estoque.paradosLista),
      evidencias: { produtos: num(estoque.parados), dias: num(lim.semMovimentoDias) },
    });
    push(out, on.ruptura && (estoque.ruptura || []).length > 0, {
      regra: "ruptura",
      categoria: "estoque",
      gravidade: "critico",
      titulo: "Produtos com demanda e cobertura baixa",
      descricao: `${count(estoque.ruptura.length)} produto(s) tiveram saída nos últimos 90 dias e a cobertura do estoque atual ficou abaixo de ${count(lim.coberturaRiscoDias)} dias. A cobertura é estoque dividido pela média diária dessas vendas.`,
      recomendacao: "Priorizar a reposição dos itens com menor cobertura.",
      registros: estoque.ruptura.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Produto",
        ESTOQUE: num(row.ESTOQUE),
        VENDA_90D: num(row.VENDA90),
        COBERTURA_DIAS: num(row.COBERTURA),
      })),
      evidencias: { produtos: estoque.ruptura.length, dias: num(lim.coberturaRiscoDias) },
    });
  }

  const precos = facts.precos || null;
  if (precos) {
    push(out, on.preco_abaixo_custo && (precos.abaixoCusto || []).length > 0, {
      regra: "preco_abaixo_custo",
      categoria: "precos",
      gravidade: "critico",
      titulo: "Preço de venda inferior ao custo",
      descricao: `Encontrei ${count(precos.abaixoCusto.length)} produto(s) cujo preço de venda da tabela vinculada ao cadastro está menor que o custo informado nessa mesma tabela. Preço e custo médio do cadastro não foram misturados nessa comparação.`,
      recomendacao: "Revisar o preço e o custo desses produtos antes de novas vendas.",
      registros: precos.abaixoCusto.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Produto",
        PRECO: num(row.PRECO),
        CUSTO: num(row.CUSTO),
        TABELA: row.TABELA,
      })),
      evidencias: { produtos: precos.abaixoCusto.length },
    });
    push(out, on.margem_preco && (precos.margemBaixa || []).length > 0, {
      regra: "margem_preco",
      categoria: "precos",
      gravidade: "atencao",
      titulo: "Preços com margem abaixo do limite",
      descricao: `${count(precos.margemBaixa.length)} produto(s) estão com margem de tabela abaixo de ${pct(lim.margemPrecoMinima)}, calculada sobre o preço e o custo da tabela vinculada ao produto.`,
      recomendacao: "Conferir se a tabela usada na venda ainda cobre o custo informado.",
      registros: precos.margemBaixa.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Produto",
        PRECO: num(row.PRECO),
        CUSTO: num(row.CUSTO),
        MARGEM: num(row.MARGEM),
      })),
      evidencias: { produtos: precos.margemBaixa.length, limite: num(lim.margemPrecoMinima) },
    });
    push(out, on.aumento_custo && (precos.custos || []).length > 0, {
      regra: "aumento_custo",
      categoria: "precos",
      gravidade: "atencao",
      titulo: "Aumento relevante de custo na entrada",
      descricao: `${count(precos.custos.length)} produto(s) entraram nos últimos 30 dias com custo pelo menos ${pct(lim.aumentoCustoPercentual)} acima do custo médio anterior gravado na entrada. A variação não afirma que o preço de venda foi alterado.`,
      recomendacao: "Comparar o novo custo com o preço de venda antes de repor o item.",
      registros: precos.custos.slice(0, 15).map((row) => ({
        CODIGO: row.ID,
        NOME: row.NOME || "Produto",
        VARIACAO: num(row.VARIACAO),
      })),
      evidencias: { produtos: precos.custos.length, limite: num(lim.aumentoCustoPercentual) },
    });
  }
  return out;
}

const SEVERITY_ORDER = { critico: 0, atencao: 1, informativo: 2 };
const CATEGORY_LABEL = {
  financeiro: "Financeiro",
  comercial: "Comercial",
  estoque: "Estoque",
  precos: "Preços",
  auditoria: "Auditoria",
};
const SUMMARY_CATEGORIES = ["financeiro", "comercial", "estoque", "precos", "auditoria"];

export function buildCompanySummary(alerts, analyzedAt, now = new Date()) {
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const open = (alerts || []).filter((item) => !["resolvido", "descartado"].includes(item.situacao));
  const latest = open.map((item) => item.atualizadoEm || item.criadoEm).filter(Boolean).sort().at(-1);
  const stamp = analyzedAt || latest || null;
  const when = stamp ? new Date(stamp) : null;
  const whenLabel = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;
  if (!whenLabel && !open.length) {
    return {
      texto: `${greeting}! Sou o Charlie. Ainda não há uma análise concluída para resumir.`,
      analiseEm: null,
      grupos: [],
      total: 0,
    };
  }
  if (!open.length) {
    return {
      texto: `${greeting}! Sou o Charlie. Analisei as informações disponíveis em ${whenLabel} e não encontrei situações acima dos limites configurados.`,
      analiseEm: stamp,
      grupos: [],
      total: 0,
    };
  }
  const groups = SUMMARY_CATEGORIES
    .map((categoria) => ({
      categoria,
      rotulo: CATEGORY_LABEL[categoria],
      alertas: open
        .filter((item) => item.categoria === categoria)
        .sort((a, b) => SEVERITY_ORDER[a.gravidade] - SEVERITY_ORDER[b.gravidade]),
    }))
    .filter((group) => group.alertas.length);
  const lines = [
    whenLabel
      ? `${greeting}! Sou o Charlie. Analisei as informações disponíveis em ${whenLabel} e encontrei algumas situações importantes.`
      : `${greeting}! Sou o Charlie. Encontrei algumas situações importantes.`,
  ];
  for (const group of groups) {
    lines.push(group.rotulo);
    for (const item of group.alertas.slice(0, 3)) lines.push(`${item.titulo}. ${item.descricao}`);
  }
  const urgent = open.some((item) => item.gravidade === "critico" || item.gravidade === "atencao");
  if (urgent) lines.push("Deseja que eu apresente os problemas mais urgentes primeiro?");
  return { texto: lines.join("\n\n"), analiseEm: stamp, grupos: groups, total: open.length };
}

export function silentCustomers(rows, settings = DEFAULT_MONITOR_SETTINGS) {
  const multiple = num(settings.limites?.clienteMultiploIntervalo || 2);
  const minimum = num(settings.limites?.clienteIntervaloMinimoDias || 7);
  return (rows || []).filter((row) => {
    const orders = num(row.PEDIDOS);
    const span = num(row.SPAN);
    const silent = num(row.DIAS_SEM);
    if (orders < 3 || span <= 0) return false;
    const interval = span / (orders - 1);
    row.INTERVALO = Math.round(interval);
    return silent >= Math.max(minimum, interval * multiple);
  }).sort((a, b) => num(b.DIAS_SEM) - num(a.DIAS_SEM));
}
