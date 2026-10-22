import {
  buildAlerts,
  cashflow,
  daily,
  executive,
  goals,
  inventory,
  margins,
  retention,
  sellers,
  stores,
  suppliers,
} from "../routes/management-reports.js";

const normalize = (value) =>
  String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 1) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const percent = (value) => `${number(value, 1)}%`;
const iso = (date) => {
  const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, "0"), day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function reportPeriod(question, now = new Date()) {
  const text = normalize(question);
  const query = {};
  const days = Number(text.match(/\b(?:ultimos?|ultimas?|nos ultimos?)\s+(\d{1,4})\s+dias?\b/)?.[1]);
  if (days) query.dias = Math.max(1, Math.min(1460, days));
  else if (/\bhoje\b/.test(text)) query.dias = 1;
  else if (/\b(?:este|nesse|no)\s+mes\b/.test(text)) {
    query.data_inicio = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    query.data_fim = iso(now);
  } else query.dias = 30;
  const store = text.match(/\b(?:loja|filial)\s+(\d+)\b/)?.[1];
  if (store) query.loja = Number(store);
  return query;
}

export function detectReportIntent(question, now = new Date()) {
  const text = normalize(question);
  const ruptureHorizon = /\brupturas?\b/.test(text) && /\b\d{1,3}\s+dias\b/.test(text);
  let section = null;
  if (/\b(relatorio|relatorios)\b/.test(text) && /\b(o que|quais|ajuda|olhar|olharia|consultar|perguntar|disponiveis)\b/.test(text)) section = "help";
  else if (/\b(alerta|alertas|atencao|prioridade|prioridades|preocupar|problemas?)\b/.test(text)) section = "alerts";
  else if (/\b(fluxo de caixa|caixa projetado|projecao de caixa|capital de giro|cenario de caixa)\b/.test(text)) section = "cashflow";
  else if (/\b(cliente|clientes)\b/.test(text) && /\b(risco|inativ|reativ|retencao|recorr|rfm|churn|pararam|sem comprar)\b/.test(text)) section = "retention";
  else if (/\b(fornecedor|fornecedores)\b/.test(text) && /\b(desempenho|atras\w*|dependencia|prazo|qualidade|rentabilidade|important|principais|mais compramos)\b/.test(text)) section = "suppliers";
  else if (/\b(vendedor|vendedores|equipe comercial)\b/.test(text)) section = "sellers";
  else if (/\b(margem|margens|rentabilidade|lucro por produto|baixa contribuicao)\b/.test(text)) section = "margins";
  else if (!ruptureHorizon && /\b(estoque sem giro|capital parado|ruptura|rupturas|transferencia entre lojas|cobertura de estoque|estoque gerencial|reposicao|repor|preciso comprar|comprar agora)\b/.test(text)) section = "inventory";
  else if (/\b(meta|metas|atingimento|realizado|projecao de fechamento)\b/.test(text)) section = "goals";
  else if (/\b(loja|lojas|filial|filiais)\b/.test(text) && /\b(compar|melhor|pior|resultado|faturamento|desempenho|vendeu|vendas|como estao)\b/.test(text)) section = "stores";
  else if (/\b(resumo diario|fotografia do dia|como foi o dia)\b/.test(text)) section = "daily";
  else if (/\b(painel executivo|visao executiva|resumo gerencial|como esta a empresa|como estamos)\b/.test(text)) section = "executive";
  if (!section) return null;
  return { type: "relatorios", section, query: reportPeriod(question, now) };
}

const periodText = (query) => query.data_inicio
  ? `de ${query.data_inicio.split("-").reverse().join("/")} a ${query.data_fim.split("-").reverse().join("/")}`
  : query.dias === 1 ? "de hoje" : `dos últimos ${query.dias} dias`;

export async function answerReportQuestion(db, intent) {
  const req = { query: intent.query || { dias: 30 } };
  const period = periodText(req.query);
  if (intent.section === "help") return {
    resposta: "Nos relatórios eu olharia: resultado e comparação das lojas; metas; margem e rentabilidade; estoque sem giro, rupturas e transferências; fluxo de caixa e capital de giro; desempenho de vendedores; clientes em risco ou inativos; dependência e atraso de fornecedores; além dos alertas prioritários. Você pode perguntar, por exemplo: “qual loja vendeu mais?”, “quais clientes estão em risco?” ou “vou precisar de capital de giro?”.",
    intencao: intent,
    dados: [],
    sugestoes: ["O que merece atenção?", "Como estão as lojas este mês?", "Quais clientes estão em risco?", "Vou precisar de capital de giro?"],
  };

  let result, data = [], response = "";
  if (intent.section === "alerts") {
    result = await buildAlerts(db, req); data = result.alerts || [];
    response = data.length ? `Encontrei ${data.length} alerta(s) gerencial(is): ${Number(result.counts?.danger || 0)} crítico(s) e ${Number(result.counts?.warning || 0)} de atenção. ${data.slice(0, 5).map((x) => x.title).join("; ")}.` : "Não encontrei alertas gerenciais com os limites configurados.";
  } else if (intent.section === "cashflow") {
    result = await cashflow(db); data = result.buckets || [];
    response = `O fluxo projetado parte de ${money(result.initial_balance)} nas contas selecionadas. A necessidade estimada de capital de giro é ${money(result.working_capital)}. ${data.map((x) => `Em ${x.days} dia(s): provável ${money(x.probable)}, pessimista ${money(x.pessimistic)}`).join("; ")}.`;
  } else if (intent.section === "stores") {
    result = await stores(db, req); data = result.rows || [];
    const validCosts = data.every((row) => Number(row.CUSTO) >= 0 && Number(row.CUSTO) <= Math.max(Number(row.FATURAMENTO) * 10, 1));
    const profit = data.reduce((sum, row) => sum + Number(row.LUCRO || 0), 0);
    response = data.length
      ? `No período ${period}, ${data.length} loja(s) movimentaram ${money(result.total)}. A maior em faturamento foi ${data[0].NOME}, com ${money(data[0].FATURAMENTO)}.${validCosts ? ` O lucro consolidado foi ${money(profit)} e a margem da líder, ${percent(data[0].MARGEM)}.` : " Lucro e margem não foram apresentados porque a base de custo contém valor inconsistente."}`
      : `Não encontrei movimento por loja no período ${period}.`;
  } else if (intent.section === "goals") {
    result = await goals(db, req);
    data = (result.stores || []).map((row) => ({ ...row, ATINGIMENTO: Number(row.META) ? Number(row.FATURAMENTO) / Number(row.META) * 100 : 0 }));
    const configured = data.filter((row) => Number(row.META) > 0);
    response = configured.length ? `No período ${period}, ${configured.filter((x) => x.ATINGIMENTO >= 100).length} de ${configured.length} loja(s) com meta configurada já atingiram 100%. ${configured.slice(0, 5).map((x) => `${x.NOME}: ${percent(x.ATINGIMENTO)}`).join("; ")}.` : "Ainda não há metas de loja configuradas para comparar com o realizado.";
  } else if (intent.section === "margins") {
    result = await margins(db, req); data = (result.below_minimum || []).slice(0, 50);
    response = data.length ? `Encontrei ${result.below_minimum.length} produto(s) abaixo da margem mínima configurada no período ${period}. Os primeiros são: ${data.slice(0, 5).map((x) => `${x.NOME}: ${percent(x.MARGEM)}`).join("; ")}.` : `Nenhum produto ficou abaixo da margem mínima no período ${period}.`;
  } else if (intent.section === "inventory") {
    result = await inventory(db, req); data = (result.idle || []).slice(0, 50);
    response = `O estoque soma ${money(result.summary?.value)}, com ${money(result.summary?.idle_value)} sem giro. Há ${Number(result.summary?.negative || 0)} item(ns) negativo(s), ${Number(result.summary?.rupture || 0)} ruptura(s) e ${result.transfers?.length || 0} sugestão(ões) de transferência entre lojas.`;
  } else if (intent.section === "sellers") {
    result = await sellers(db, req); data = (result.rows || []).slice(0, 50);
    response = data.length ? `No período ${period}, o maior faturamento foi de ${data[0].NOME}: ${money(data[0].FATURAMENTO)}, ${Number(data[0].PEDIDOS || 0)} pedido(s), ticket de ${money(data[0].TICKET)} e margem de ${percent(data[0].MARGEM)}.` : `Não encontrei vendas por vendedor no período ${period}.`;
  } else if (intent.section === "retention") {
    result = await retention(db, req); data = (result.reactivation || []).slice(0, 50);
    response = `A carteira tem ${Number(result.summary?.recurring || 0)} cliente(s) recorrente(s), ${Number(result.summary?.inactive || 0)} inativo(s) e ${money(result.summary?.overdue)} em inadimplência. Há ${result.reactivation?.length || 0} cliente(s) priorizado(s) para reativação.`;
  } else if (intent.section === "suppliers") {
    result = await suppliers(db, req); data = (result.rows || []).slice(0, 50);
    const late = data.filter((row) => Number(row.ATRASO_DIAS) > 0);
    response = data.length ? `No período ${period}, foram analisados ${result.rows.length} fornecedor(es). ${late.length} apresentam prazo real acima do prometido e ${result.rows.filter((x) => Number(x.DEPENDENCIA) > 30).length} representam mais de 30% das compras. Maior volume: ${data[0].NOME}, ${money(data[0].TOTAL)}.` : `Não encontrei compras de fornecedores no período ${period}.`;
  } else if (intent.section === "daily") {
    result = await daily(db); data = result.priority || [];
    const t = result.totals || {};
    response = `Resumo de hoje: ${money(t.sales)} em vendas, ${Number(t.orders || 0)} pedido(s), lucro bruto de ${money(t.profit)} e saldo bancário de ${money(t.bank_balance)}. A receber em 7 dias: ${money(t.receivable_7d)}; a pagar: ${money(t.payable_7d)}.`;
  } else {
    result = await executive(db, req); data = result.alerts || [];
    const rows = result.stores?.rows || [], validCosts = rows.every((row) => Number(row.CUSTO) >= 0 && Number(row.CUSTO) <= Math.max(Number(row.FATURAMENTO) * 10, 1));
    const profit = rows.reduce((sum, row) => sum + Number(row.LUCRO || 0), 0);
    response = `Visão executiva ${period}: faturamento de ${money(result.stores?.total)}${validCosts ? `, lucro de ${money(profit)}` : " (lucro omitido por inconsistência na base de custo)"}, ${Number(result.margins?.below || 0)} produto(s) abaixo da margem, ${money(result.inventory?.idle_value)} em estoque parado e necessidade de capital de giro de ${money(result.cashflow?.working_capital)}.`;
  }
  return { resposta: response, intencao: intent, dados: data, sugestoes: ["O que merece atenção?", "Como estão as lojas este mês?", "Quais clientes estão em risco?", "Como está o fluxo de caixa?"] };
}
