import { ollamaChat } from "./ollama.js";
import { enabledActionIds, getAction, validateActionParams } from "./charlie-task-catalog.js";
import { interpretarPedido } from "./charlie-leads-nl.js";

const NUMBER_WORDS = [
  ["noventa", "90"],
  ["sessenta", "60"],
  ["trinta", "30"],
  ["quinze", "15"],
  ["vinte", "20"],
  ["doze", "12"],
  ["onze", "11"],
  ["dez", "10"],
  ["nove", "9"],
  ["oito", "8"],
  ["sete", "7"],
  ["seis", "6"],
  ["cinco", "5"],
  ["quatro", "4"],
  ["tres", "3"],
  ["dois", "2"],
];

export function normalizeTaskText(value) {
  let text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  for (const [word, number] of NUMBER_WORDS) text = text.replace(new RegExp(`\\b${word}\\b`, "g"), number);
  return text.replace(/(\d+(?:[.,]\d+)?)\s+por\s+cento\b/g, "$1%");
}

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

function days(text, fallback = null) {
  const more = text.match(/(?:mais de|acima de|superior a)\s+(\d+)\s+dias?/);
  if (more) return { dias: Number(more[1]), comparacao: "maior" };
  const exact = text.match(/(?:ha|atras\w*|sem\s+\w+\s+ha)\s+(\d+)\s+dias?/);
  if (exact) return { dias: Number(exact[1]), comparacao: "maior_ou_igual" };
  const plain = text.match(/\b(\d+)\s+dias?\b/);
  if (plain) return { dias: Number(plain[1]), comparacao: "maior_ou_igual" };
  return fallback ? { dias: fallback, comparacao: "maior_ou_igual" } : {};
}

function months(text) {
  const match = text.match(/(\d+)\s+meses?/);
  return match ? Number(match[1]) : null;
}

function limitOf(text) {
  if (/\b5 maiores\b|\bcinco maiores\b/.test(text)) return 5;
  const top = text.match(/\btop\s+(\d+)|\b(\d+)\s+maiores\b/);
  return top ? Number(top[1] || top[2]) : null;
}

function wantsDeliverable(text) {
  return /\b(gere|gerar|gera|relatorio|planilha|excel|pdf|csv|exporte|exportar|faca)\b/.test(text);
}

function periodOf(text) {
  if (/\b(este mes|neste mes|nesse mes|deste mes|do mes)\b/.test(text)) return { periodo: "mes" };
  if (/\b(este ano|neste ano|nesse ano|deste ano)\b/.test(text)) return { periodo: "ano" };
  const value = months(text);
  if (value) return { periodo: "meses", meses: value };
  return {};
}

function formatOf(text, preference, fallback = null) {
  if (/\bcsv\b/.test(text)) return "csv";
  if (/\bpdf\b/.test(text)) return "pdf";
  if (/\b(excel|planilha|xlsx)\b/.test(text)) return "excel";
  if (/\brelatorio\b/.test(text) && preference?.formato) return preference.formato;
  if (/\brelatorio\b/.test(text)) return "excel";
  return fallback;
}

function percentOf(text) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function tableOf(text) {
  const match = text.match(/tabela(?:\s+de\s+precos)?\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

function marginOf(text) {
  const match = text.match(/margem(?:\s+inferior|\s+abaixo|\s+menor)?(?:\s+a|\s+de)?\s+(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function execute(acao, parametros, interpretador = "regras") {
  return { tipo: "executar", acao, parametros, interpretador };
}

function blocked(acao, motivo) {
  return { tipo: "bloqueada", bloqueada: true, acao, motivo, interpretador: "regras" };
}

export function looksLikeTask(question) {
  const text = normalizeTaskText(question);
  return /\b(preparar|prepare|gerar|gere|gera|cadastre|cadastrar|aplique|aplicar|reajuste|reajustar|simule|simular|planilha|excel|csv|exportar|exporte|cobranca|cobrancas)\b/.test(text)
    || (/\bpdf\b/.test(text) && /\b(relatorio|cliente|faturamento|titulo)\b/.test(text))
    || /\b(baixe|baixar|cancele|cancelar|exclua|excluir|transmita|transmitir|atualize|alterar|altere|crie)\b/.test(text);
}

function blockedPlan(text) {
  const titles = /\btitulos?\b|\bcontas?\b/;
  const documents = /\bnotas?\b|\bpedidos?\b|\bdocumentos?\b|\bnf-?e\b|\bfiscal\b/;
  if (/\b(baixe|baixar)\b/.test(text) && titles.test(text))
    return blocked("financeiro.baixar_titulos", "A baixa de títulos permanece bloqueada.");
  if (/\b(envie|enviar|mande|mandar|dispare|disparar)\b/.test(text) && /\bcobrancas?\b|\bmensagens?\b|\bemails?\b|\bwhatsapp\b/.test(text)
    && !/\b(prepar|encontre|devendo|atrasad|vencid)\b/.test(text))
    return blocked("financeiro.enviar_cobranca", "O envio de cobranças permanece bloqueado. Posso preparar os rascunhos, sem enviar.");
  if (/\b(cancele|cancelar)\b/.test(text) && documents.test(text))
    return blocked("fiscal.transmitir", "O cancelamento de documentos permanece bloqueado.");
  if (/\b(transmita|transmitir)\b/.test(text) && documents.test(text))
    return blocked("fiscal.transmitir", "A transmissão de documentos fiscais permanece bloqueada.");
  if (/\b(exclua|excluir|apague|apagar)\b/.test(text) && /\bclientes?\b|\bprodutos?\b|\btitulos?\b|\bregistros?\b|\bcadastros?\b/.test(text))
    return blocked("cadastro.excluir", "A exclusão de registros permanece bloqueada.");
  if (/\b(efetive|efetivar|quite|quitar)\b/.test(text) && /\bpagamentos?\b|\btitulos?\b|\bcontas?\b/.test(text))
    return blocked("financeiro.baixar_titulos", "A efetivação de pagamentos permanece bloqueada.");
  if (/\b(drop|delete|truncate|insert|update|alter table|grant )\b/.test(text))
    return blocked("cadastro.excluir", "Não executo comandos ou alterações pedidas fora do catálogo.");
  return null;
}

function introducesNewSubject(text) {
  return /\b(faturamento|produto|estoque|preco|tabela|pedido|cadastre|margem|fornecedor)\b/.test(text);
}

function pricePlan(text, preference) {
  const percentual = percentOf(text);
  const tabela = tableOf(text);
  const margem = marginOf(text);
  const apply = /\b(aplique|aplicar|atualize|atualizar|reajuste|reajustar)\b/.test(text) && /\b(preco|precos|tabela)\b/.test(text);
  const simulate = /\b(simule|simular|proposta de reajuste)\b/.test(text);
  if (!apply && !simulate && !(margem != null && tabela)) return null;
  if (apply) return execute("produtos.reajuste_precos", { tabela, percentual });
  if (simulate) return execute("produtos.simular_reajuste", { tabela, percentual, margem });
  return execute("produtos.margem_insuficiente", { tabela, margem, formato: formatOf(text, preference, "nenhum"), limite: limitOf(text) || undefined });
}

function reportPlan(text, preference) {
  const formato = formatOf(text, preference, null);
  const periodoMeses = months(text);
  const periodo = periodOf(text);
  const arquivo = formato || "excel";
  if (wantsDeliverable(text) && /\bestoque negativo\b/.test(text))
    return execute("estoque.negativo", { limite: limitOf(text) || undefined, formato: arquivo });
  if (wantsDeliverable(text) && /\bprodutos?\b/.test(text) && /\bsem moviment/.test(text))
    return execute("estoque.sem_movimentacao", { dias: days(text, 90).dias, limite: limitOf(text) || undefined, formato: arquivo });
  if (/\bprodutos?\b/.test(text) && /\bsem venda\b/.test(text))
    return execute("relatorios.produtos_sem_venda", { dias: days(text, 90).dias, formato: arquivo });
  if (wantsDeliverable(text) && /\b(mais vendid|campeoes de venda)/.test(text))
    return execute("relatorios.produtos_vendidos", { ordem: "mais", ...periodo, limite: limitOf(text) || 10, formato: arquivo });
  if (wantsDeliverable(text) && /\bmenos vendid/.test(text))
    return execute("relatorios.produtos_vendidos", { ordem: "menos", ...periodo, limite: limitOf(text) || 10, formato: arquivo });
  if (wantsDeliverable(text) && (/\bcomparativ\w*\s+de\s+precos\b/.test(text) || (/\bprecos\b/.test(text) && /\bcompar/.test(text))))
    return execute("produtos.comparativo_precos", {
      tabela: tableOf(text) || undefined,
      tabelaComparar: tablesOf(text)[1],
      limite: limitOf(text) || undefined,
      formato: arquivo,
    });
  if (wantsDeliverable(text) && ((/\balterac/.test(text) && /\bcusto/.test(text)) || /\baumento de custo\b/.test(text) || /\bcustos?\s+relevante/.test(text)))
    return execute("produtos.alteracao_custo", {
      percentual: percentOf(text) || undefined,
      dias: days(text, 30).dias,
      formato: arquivo,
    });
  if (wantsDeliverable(text) && /\bmargem\b/.test(text) && marginOf(text) != null && !tableOf(text))
    return execute("produtos.margem_insuficiente", { margem: marginOf(text), formato: arquivo, limite: limitOf(text) || undefined });
  if (wantsDeliverable(text) && /\brecebiment/.test(text))
    return execute("financeiro.recebimentos_periodo", { ...periodo, formato: arquivo, limite: limitOf(text) || undefined });
  if (wantsDeliverable(text) && /\bpagamentos?\b/.test(text) && !/\b(quite|quitar|baixe|baixar|efetive|efetivar)\b/.test(text))
    return execute("financeiro.pagamentos_periodo", { ...periodo, formato: arquivo, limite: limitOf(text) || undefined });
  const sales = /\b(faturamento|vendas)\b/.test(text);
  if (sales && /\b(mes a mes|mensal|compare|compara)\b/.test(text))
    return execute("relatorios.faturamento_mensal", { meses: periodoMeses || 6, ...periodo, formato: arquivo });
  if (sales && /\bvendedor/.test(text))
    return execute("relatorios.faturamento_vendedor", { meses: periodoMeses || 6, ...periodo, limite: limitOf(text) || undefined, formato: arquivo });
  if (sales && /\bclientes?\b/.test(text) && wantsDeliverable(text))
    return execute("relatorios.faturamento_cliente", { meses: periodoMeses || 6, ...periodo, limite: limitOf(text) || undefined, formato: arquivo });
  if (sales && wantsDeliverable(text))
    return execute("relatorios.faturamento_periodo", { meses: periodoMeses || 1, ...periodo, formato: arquivo });
  if (/\bclientes?\b/.test(text) && /\b(mais compr|ranking)\b/.test(text)) {
    const escolhido = periodo.periodo || (/\beste ano|neste ano|nesse ano\b/.test(text) ? "ano" : "meses");
    return execute("comercial.ranking_clientes", {
      periodo: escolhido,
      meses: periodoMeses || undefined,
      limite: limitOf(text) || undefined,
      formato: arquivo,
    });
  }
  return null;
}

function tablesOf(text) {
  return [...text.matchAll(/tabela(?:\s+de\s+precos)?\s+(\d+)/g)].map((match) => Number(match[1]));
}

function collectionPlan(text, preference) {
  const wantsCollection = /\bcobranc/.test(text);
  const overdue = /\b(devendo|atrasad|vencid|inadimpl)/.test(text);
  const upcoming = /\b(a vencer|vao vencer|vai vencer|vencem|proximos do vencimento|perto de vencer)\b/.test(text);
  if (!wantsCollection && !overdue && !(upcoming && wantsDeliverable(text))) return null;
  const timing = days(text, wantsCollection || overdue ? 1 : null);
  const formato = formatOf(text, preference, "nenhum");
  const shared = {
    ...timing,
    limite: limitOf(text) || undefined,
    agrupar: /\bvendedor/.test(text) ? "vendedor" : /\bfornecedor/.test(text) ? "fornecedor" : "cliente",
    formato,
    dominio: /\b(pagar|fornecedor)\b/.test(text) && !/\breceber\b/.test(text) ? "pagar" : "receber",
  };
  if (wantsCollection) return execute("financeiro.preparar_cobrancas", {
    ...shared,
    dominio: "receber",
    agrupar: shared.agrupar === "vendedor" ? "vendedor" : "cliente",
  });
  if (upcoming && !overdue)
    return execute("financeiro.titulos_a_vencer", { dominio: shared.dominio, dias: timing.dias || 7, formato: formato === "nenhum" ? "excel" : formato });
  if (/\binadimpl/.test(text) && wantsDeliverable(text) && !/\btitulos?\b/.test(text))
    return execute("financeiro.inadimplencia", {
      ...shared,
      agrupar: /\bvendedor/.test(text) ? "vendedor" : /\bfornecedor/.test(text) ? "fornecedor" : "cliente",
      formato: formato === "nenhum" ? "excel" : formato,
    });
  if (/\b(planilha|excel|pdf|csv|relatorio)\b/.test(text) || /\bvendedor/.test(text))
    return execute("financeiro.titulos_vencidos", shared);
  return null;
}

function freshPlan(text, preference) {
  const denied = blockedPlan(text);
  if (denied) return denied;
  const leads = interpretarPedido(text);
  if (leads && getAction(leads.acao)) {
    const criterios = leads.criterios || {};
    return execute(leads.acao, {
      uf: [].concat(criterios.uf || [])[0],
      municipio: [].concat(criterios.municipio || [])[0],
      cnae: [].concat(criterios.cnae || [])[0],
      limite: criterios.limite,
      pagina: criterios.pagina,
      ultimosDias: criterios.ultimosDias,
      quantidade: criterios.quantidade,
    });
  }
  const price = pricePlan(text, preference);
  if (price) return price;
  if (/\b(abaixo do estoque minimo|estoque minimo)\b/.test(text)) {
    if (/\b(sugestao de compra|compra)\b/.test(text))
      return execute("estoque.sugestao_compra", { formato: formatOf(text, preference, "nenhum") });
    return execute("estoque.abaixo_minimo", { formato: formatOf(text, preference, "nenhum") });
  }
  if (/\bclientes?\b/.test(text) && /\b(sem compras|nao compr)/.test(text))
    return execute("comercial.clientes_inativos", {
      ...days(text, 60),
      agrupar: /\bvendedor/.test(text) ? "vendedor" : "nenhum",
      formato: formatOf(text, preference, "nenhum"),
    });
  if (/\b(cadastre|cadastrar)\b/.test(text) && /\bcliente\b/.test(text)) {
    return execute("cadastro.criar_cliente", customerFields(text));
  }
  if (/\b(atualize|atualizar|altere|alterar)\b/.test(text) && /\bcliente\b/.test(text)) {
    const match = text.match(/\bcliente\s+(\d+|[^,.;]+?)(?=\s+(?:para|com|telefone|email|e-mail|endereco|observacao)\b|$)/);
    const fieldName = /\btelefone\b/.test(text) ? "telefone" : /\be-?mail\b/.test(text) ? "email" : /\bendereco\b/.test(text) ? "endereco" : /\bobservacao\b/.test(text) ? "observacao" : undefined;
    const value = field(text, ["telefone", "email", "e-mail", "endereco", "observacao", "novo valor"])
      || text.match(/\b(?:para|com)\s+(.+)$/)?.[1];
    return execute("cadastro.atualizar_cliente", { cliente: match?.[1]?.trim(), campo: fieldName, valor: value?.trim() });
  }
  if (/\b(crie|criar|prepare|preparar)\b/.test(text) && /\bpedido(?: de venda)?\b/.test(text)) {
    if (/\b(fature|faturar|nota fiscal|nf-?e)\b/.test(text))
      return blocked("fiscal.transmitir", "Faturamento e emissão fiscal automáticos permanecem bloqueados.");
    return execute("comercial.criar_pedido_rascunho", orderFields(text));
  }
  const report = reportPlan(text, preference);
  if (report) return report;
  const finance = collectionPlan(text, preference);
  if (finance) return finance;
  return null;
}

function field(text, labels) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:\\-]\\s*([^,;\\n]+)`);
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function customerFields(text) {
  return {
    nome: field(text, ["nome", "cliente"]) || text.match(/\bcliente(?: chamado)?\s+([^,.;]+?)(?=\s+com\b|$)/)?.[1]?.trim() || undefined,
    documento: field(text, ["cnpj", "cpf", "documento"]) || undefined,
    email: field(text, ["email", "e-mail"]) || undefined,
    telefone: field(text, ["telefone", "fone", "celular"]) || undefined,
    cidade: field(text, ["cidade"]) || undefined,
    endereco: field(text, ["endereco"]) || undefined,
    uf: field(text, ["uf", "estado"]) || undefined,
    cep: field(text, ["cep"]) || undefined,
  };
}

function orderFields(text) {
  const client = text.match(/\bcliente\s+([^,]+?)(?=\s+com\b|\s+produtos?\b|$)/);
  const items = text.match(/\bprodutos?\s+(.+)$/);
  return {
    cliente: client ? client[1].replace(/[?.!]+$/g, "").trim() : undefined,
    itens: items ? items[1].replace(/[?.!]+$/g, "").trim() : undefined,
  };
}

function sameParams(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

const SALES_GROUP = new Set([
  "relatorios.faturamento_periodo",
  "relatorios.faturamento_vendedor",
  "relatorios.faturamento_cliente",
  "relatorios.faturamento_mensal",
]);

const SALES_FILTER = new Set([
  ...SALES_GROUP,
  "relatorios.produtos_vendidos",
  "comercial.ranking_clientes",
  "relatorios.produtos_sem_venda",
  "estoque.sem_movimentacao",
  "financeiro.inadimplencia",
  "financeiro.recebimentos_periodo",
  "financeiro.pagamentos_periodo",
]);

function refineSales(text, previous) {
  if (!SALES_FILTER.has(previous?.acao)) return null;
  const next = { ...previous.parametros };
  let acao = previous.acao;
  if (SALES_GROUP.has(previous.acao)) {
    if (/\bpor vendedor\b|\bvendedores\b/.test(text)) acao = "relatorios.faturamento_vendedor";
    else if (/\bpor cliente\b/.test(text)) acao = "relatorios.faturamento_cliente";
    else if (/\b(mes a mes|mensal|compare|compara)\b/.test(text)) acao = "relatorios.faturamento_mensal";
  }
  if (/\bmais vendid/.test(text)) {
    acao = "relatorios.produtos_vendidos";
    next.ordem = "mais";
  } else if (/\bmenos vendid/.test(text)) {
    acao = "relatorios.produtos_vendidos";
    next.ordem = "menos";
  }
  const limit = limitOf(text);
  if (limit) next.limite = limit;
  const formato = formatOf(text, null, null);
  if (formato) next.formato = formato;
  const value = months(text);
  if (value) {
    next.meses = value;
    next.periodo = "meses";
  }
  if (/\b(este mes|neste mes|nesse mes|deste mes)\b/.test(text)) next.periodo = "mes";
  if (/\b(este ano|neste ano|nesse ano|deste ano)\b/.test(text)) next.periodo = "ano";
  if (acao === previous.acao && sameParams(next, previous.parametros)) return null;
  return execute(acao, next, "contexto");
}

function refine(text, previous, preference) {
  if (!previous?.acao || introducesNewSubject(text)) return null;
  const sales = refineSales(text, previous);
  if (sales) return sales;
  if (previous.acao === "cadastro.rascunho_cliente" || previous.acao === "comercial.rascunho_pedido") {
    const fields = previous.acao === "cadastro.rascunho_cliente" ? customerFields(text) : orderFields(text);
    const filled = Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
    if (Object.keys(filled).length)
      return execute(previous.acao, { ...previous.parametros, ...filled }, "contexto");
  }
  const follow = /^(somente|so\b|apenas|separe|separa|agora|prepare|gere|gera|os \d+|top \d+)/.test(text)
    || /(mais de \d+ dias|por vendedor|planilha|excel|pdf|csv|cobranca|maiores|%|tabela \d+)/.test(text);
  if (!follow) return null;
  const next = { ...previous.parametros };
  const timing = days(text, null);
  if (timing.dias != null) Object.assign(next, timing);
  const limit = limitOf(text);
  if (limit) next.limite = limit;
  if (/\bvendedor/.test(text)) next.agrupar = "vendedor";
  if (/\bpor cliente\b/.test(text)) next.agrupar = "cliente";
  if (/\bpor fornecedor\b/.test(text)) next.agrupar = "fornecedor";
  const formato = formatOf(text, null, null);
  if (formato) next.formato = formato;
  const percentual = percentOf(text);
  if (percentual != null) next.percentual = percentual;
  const tabela = tableOf(text);
  if (tabela) next.tabela = tabela;
  let acao = previous.acao;
  if (/\bcobranc/.test(text)) acao = "financeiro.preparar_cobrancas";
  if (/\b(planilha|excel|pdf|csv)\b/.test(text) && previous.acao === "financeiro.preparar_cobrancas")
    next.formato = formato || next.formato || preference?.formato || "excel";
  if (acao === previous.acao && sameParams(next, previous.parametros) && !formato) return null;
  return execute(acao, next, "contexto");
}

function fromAlert(text, context) {
  if (context.consulta?.type !== "alerta_monitor") return null;
  if (!/\bcobranc/.test(text)) return null;
  const clientes = (context.registros || [])
    .map((row) => Number(row.CODIGO ?? row.CDCLIENTE))
    .filter((value) => Number.isInteger(value) && value > 0);
  return execute("financeiro.preparar_cobrancas", {
    ...days(text, 1),
    dominio: "receber",
    clientes,
    alertaId: context.consulta.alertaId,
    agrupar: /\bvendedor/.test(text) ? "vendedor" : "cliente",
  }, "alerta");
}

function fromPriorQuery(text, context, preference) {
  const previous = context.consulta;
  if (!previous || previous.type === "alerta_monitor" || introducesNewSubject(text)) return null;
  const operational = /\b(cobranca|planilha|excel|pdf|csv|vendedor|relatorio)\b/.test(text);
  if (!operational) return null;
  if (previous.type === "financeiro_titulos" || previous.acao === "financeiro.titulos_vencidos") {
    const timing = days(text, previous.parametros?.dias || 1);
    const base = {
      dominio: previous.domain || previous.parametros?.dominio || "receber",
      ...timing,
      comparacao: timing.comparacao,
      pessoa: previous.person || previous.parametros?.pessoa,
      limite: limitOf(text) || previous.parametros?.limite,
      agrupar: /\bvendedor/.test(text) ? "vendedor" : previous.parametros?.agrupar,
      formato: formatOf(text, preference, "nenhum"),
    };
    if (/\bcobranc/.test(text)) return execute("financeiro.preparar_cobrancas", { ...base, dominio: "receber", agrupar: base.agrupar === "vendedor" ? "vendedor" : "cliente" }, "contexto");
    return execute("financeiro.titulos_vencidos", base, "contexto");
  }
  return null;
}

export function planCharlieTask(question, context = {}) {
  const text = normalizeTaskText(question);
  if (!text) return null;
  if (/^(sim|confirmo|pode executar|pode atualizar|autorizo|pode aplicar)\b/.test(text) && context.pendente?.id)
    return { tipo: "confirmacao_implicita", tarefaId: context.pendente.id, interpretador: "contexto" };
  const alertPlan = fromAlert(text, context);
  if (alertPlan) return alertPlan;
  const follow = /^(somente|so\b|apenas|separe|separa|agora|prepare|gere|gera)/.test(text)
    || /\b(esses clientes|tambem|maiores)\b/.test(text);
  if (follow && !introducesNewSubject(text)) {
    const inherited = fromPriorQuery(text, context, context.preferencia)
      || (context.tarefa ? refine(text, context.tarefa, context.preferencia) : null);
    if (inherited) return inherited;
  }
  const direct = freshPlan(text, context.preferencia);
  if (direct && /\b(envie|enviar|mande|mandar)\b/.test(text) && direct.acao === "financeiro.preparar_cobrancas")
    direct.aviso = "O envio permanece bloqueado. Os rascunhos não serão enviados.";
  if (direct) return direct;
  if (context.tarefa) return refine(text, context.tarefa, context.preferencia);
  return null;
}

export function acceptModelSelection(raw, context = {}) {
  const value = raw && typeof raw === "object" ? raw : safeJson(raw);
  if (!value || value.acao === "nenhuma" || !value.acao) return null;
  const action = getAction(value.acao);
  if (!action) return null;
  if (!action.habilitada || action.nivel >= 4)
    return blocked(action.id, "Essa operação não está disponível para o Charlie.");
  const source = value.parametros && typeof value.parametros === "object" ? value.parametros : {};
  const allowed = {};
  for (const key of Object.keys(action.parametros || {})) {
    if (key in source) allowed[key] = source[key];
  }
  const validated = validateActionParams(action, { ...actionDefaults(action), ...allowed });
  if (!validated.ok && action.nivel < 3) return null;
  return execute(action.id, validated.ok ? validated.params : allowed, "ollama");
}

function actionDefaults(action) {
  const defaults = {};
  for (const [key, spec] of Object.entries(action.parametros || {})) {
    if (spec.padrao !== undefined) defaults[key] = spec.padrao;
  }
  return defaults;
}

export async function selectTaskWithOllama(question) {
  const ids = ["nenhuma", ...enabledActionIds()];
  const content = await ollamaChat({
    maxTokens: 220,
    format: {
      type: "object",
      additionalProperties: false,
      required: ["acao"],
      properties: {
        acao: { type: "string", enum: ids },
        parametros: { type: "object" },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Você seleciona uma ação do catálogo do Charlie. Não gere SQL, não escolha nível de autonomia e não confirme execução. Se a frase for só uma pergunta comum, use acao nenhuma. Retorne somente JSON.",
      },
      { role: "user", content: JSON.stringify({ pergunta: String(question).slice(0, 500), acoes: ids }) },
    ],
  });
  return safeJson(content);
}
