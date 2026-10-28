const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const QUOTE_STATUS = {
  0: "aberto",
  1: "finalizado",
  2: "cancelado",
  3: "remessa_aberta",
  4: "remessa_finalizada",
  5: "remessa_cancelada",
};

export const DEFAULT_SETTINGS = {
  nome: "Charlie Daily",
  enabled: false,
  time: "07:00",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timezone: "America/Sao_Paulo",
  emails: "",
  whatsapp: "",
  empresas: [],
  canais: { email: true, whatsapp: true },
  formato: "completo",
  enviarReal: false,
  templateWhatsapp: "",
  templateIdioma: "pt_BR",
  templateVariaveis: true,
  linkHoras: 48,
  tentativas: 3,
  indicadores: {
    vendas: true,
    orcamentos: true,
    ranking: true,
    metas: true,
    estoque: true,
    crm: true,
    financeiro: true,
    precos: false,
    vendaAgregada: true,
  },
  limites: {
    valorPrioridade: 5000,
    margemMinima: 15,
    semGiroDias: 90,
    coberturaRiscoDias: 7,
    acompanhamentoHoras: 48,
    quedaVendas: 10,
    baixaAtipica: 30,
    reposicaoDias: 7,
    variacaoMinima: 10,
    clienteInativoDias: 60,
  },
  metas: { mensal: null, diaria: null, semanal: null, equipe: null, vendedores: {}, equipes: {}, filiais: {} },
  notificacaoIndividual: { ativo: false, inicio: "08:00", fim: "18:00" },
  campanhas: { aprovada: false },
  baseUrl: "",
};

const n = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value, digits = 2) => {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};
export const money = (value) => value == null || !Number.isFinite(Number(value)) ? "não informado" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const percent = (value) => value == null ? "Dado indisponível para esta análise." : `${n(value).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const brDate = (iso) => {
  if (!iso) return "Dado indisponível para esta análise.";
  const [year, month, day] = String(iso).slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};

const MONTHS_EN = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const WEEKDAYS_PT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const MONTHS_PT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

export function isoDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const english = text.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2})(?: (\d{4}))?/);
  const month = MONTHS_EN[english?.[1]];
  if (!month) return "";
  const year = english[3] || String(new Date().getFullYear());
  return `${year}-${month}-${String(english[2]).padStart(2, "0")}`;
}

export function chartDateLabel(value) {
  const iso = isoDay(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return `${WEEKDAYS_PT[weekday]} ${match[3]} ${MONTHS_PT[Number(match[2]) - 1]}`;
}

export function monthlyGoalFrom(settings, legacyGoals, companyId, legacyGoal = null) {
  const filial = companyId ? n(settings?.metas?.filiais?.[companyId]) : 0;
  if (filial > 0) return { value: filial, origin: "configuracao do Charlie Daily" };
  if (n(settings?.metas?.mensal) > 0) return { value: n(settings.metas.mensal), origin: "configuracao do Charlie Daily" };
  const goals = legacyGoals && typeof legacyGoals === "object" ? legacyGoals : {};
  const fromStores = companyId
    ? n(goals[companyId] ?? goals[String(companyId)])
    : Object.values(goals).reduce((sum, value) => sum + n(value), 0);
  if (fromStores > 0) return { value: fromStores, origin: "meta ja cadastrada nos relatorios gerenciais" };
  if (n(legacyGoal) > 0) return { value: n(legacyGoal), origin: "meta ja cadastrada nos relatorios gerenciais" };
  return { value: 0, origin: null };
}

export function addDays(iso, days) {
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function saoPauloParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

export function referenceDay(now = new Date()) {
  return addDays(saoPauloParts(now).date, -1);
}

export function saoPauloInstant(iso) {
  return new Date(`${String(iso).slice(0, 10)}T03:00:00.000Z`);
}

export function rangeFor(startIso, endIsoInclusive) {
  return { start: saoPauloInstant(startIso), end: saoPauloInstant(addDays(endIsoInclusive, 1)) };
}

export function monthBounds(referenceIso) {
  const [year, month] = String(referenceIso).slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

function weekdayOf(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function businessDaysInclusive(startIso, endIso) {
  if (!startIso || !endIso || startIso > endIso) return 0;
  let count = 0;
  for (let cursor = startIso; cursor <= endIso; cursor = addDays(cursor, 1)) {
    const weekday = weekdayOf(cursor);
    if (weekday > 0 && weekday < 6) count += 1;
    if (cursor === endIso) break;
  }
  return count;
}

export function variation(current, previous) {
  if (current == null || previous == null || !(n(previous) > 0)) return { percentual: null, texto: "sem base comparável" };
  const percentual = round(((n(current) - n(previous)) / n(previous)) * 100, 1);
  const direction = percentual >= 0 ? "aumento" : "queda";
  return { percentual, texto: `${direction} de ${Math.abs(percentual).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` };
}

function sameCompany(row, companyId) {
  if (!companyId) return true;
  return Number(row.companyId || row.IDEMPRESA || 0) === Number(companyId);
}

export function rankSellers(rows, companyId = null) {
  const map = new Map();
  for (const row of rows || []) {
    if (!sameCompany(row, companyId)) continue;
    const id = Number(row.sellerId ?? row.ID ?? 0);
    const item = map.get(id) || {
      id,
      nome: String(row.seller || row.NOME || "Sem vendedor"),
      faturamento: 0,
      pedidos: 0,
      custo: 0,
      orcamentos: 0,
      valorOrcamentos: 0,
      convertidos: 0,
      valorAberto: 0,
    };
    const bruto = row.revenue != null ? row.revenue : row.FATURAMENTO;
    if (bruto == null) item.semValor = true;
    else item.faturamento += n(bruto);
    item.pedidos += n(row.orders ?? row.PEDIDOS);
    item.custo += n(row.cost ?? row.CUSTO);
    map.set(id, item);
  }
  for (const item of map.values()) if (item.semValor) item.faturamento = null;
  const list = [...map.values()].filter((item) => item.pedidos > 0 || item.faturamento != null);
  list.sort((a, b) => (a.faturamento == null) - (b.faturamento == null) || (b.faturamento ?? 0) - (a.faturamento ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  let last = null;
  let position = 0;
  list.forEach((item, index) => {
    if (item.faturamento == null) {
      item.posicao = null;
      item.ticket = null;
      return;
    }
    if (last == null || item.faturamento < last - 0.004) {
      position = index + 1;
      last = item.faturamento;
    }
    item.posicao = position;
    item.ticket = item.pedidos ? round(item.faturamento / item.pedidos) : 0;
    item.faturamento = round(item.faturamento);
    item.custo = round(item.custo);
  });
  const comValor = list.filter((item) => item.faturamento != null);
  const lowestValue = comValor.length ? comValor[comValor.length - 1].faturamento : null;
  const menores = comValor.filter((item) => item.faturamento === lowestValue);
  return { ranking: list, menor: menores.length === 1 ? menores[0] : menores.length ? { empate: true, vendedores: menores } : null };
}

export function attachQuotes(ranking, quotesBySeller = []) {
  const map = new Map((quotesBySeller || []).map((item) => [Number(item.sellerId ?? item.ID), item]));
  for (const seller of ranking) {
    const quote = map.get(Number(seller.id));
    if (!quote) continue;
    seller.orcamentos = n(quote.count ?? quote.QTD);
    const bruto = quote.value != null ? quote.value : quote.TOTAL;
    seller.valorOrcamentos = bruto == null ? null : round(n(bruto));
    seller.convertidos = n(quote.converted ?? quote.CONVERTIDOS);
    seller.valorAberto = round(n(quote.openValue ?? quote.ABERTO));
    seller.taxaConversao = seller.orcamentos ? round((seller.convertidos / seller.orcamentos) * 100, 1) : null;
  }
  return ranking;
}

function quoteBucket(rows) {
  const bucket = { novos: 0, valor: 0, convertidos: 0, valorConvertido: 0, remessa: 0, valorRemessa: 0, cancelados: 0 };
  let valorIncompleto = false;
  let convertidoIncompleto = false;
  for (const row of rows || []) {
    const status = Number(row.status ?? row.STATUS);
    const count = n(row.count ?? row.QTD);
    const bruto = row.value != null ? row.value : row.TOTAL;
    const value = bruto == null ? null : n(bruto);
    if (status === 2) { bucket.cancelados += count; continue; }
    if (status >= 3) {
      bucket.remessa += count;
      if (value == null) bucket.valorRemessa = null;
      else if (bucket.valorRemessa != null) bucket.valorRemessa += value;
      continue;
    }
    if (status === 0 || status === 1) {
      bucket.novos += count;
      if (value == null) valorIncompleto = true;
      else bucket.valor += value;
    }
    if (status === 1) {
      bucket.convertidos += count;
      if (value == null) convertidoIncompleto = true;
      else bucket.valorConvertido += value;
    }
  }
  bucket.valor = valorIncompleto ? null : round(bucket.valor);
  bucket.valorConvertido = convertidoIncompleto ? null : round(bucket.valorConvertido);
  bucket.taxa = bucket.novos ? round((bucket.convertidos / bucket.novos) * 100, 1) : null;
  return bucket;
}

export function mondayOf(iso) {
  const weekday = weekdayOf(iso);
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

export function assessWindow(goal, realized, label = "período") {
  if (!(n(goal) > 0)) {
    return { meta: null, realizado: realized == null ? null : round(n(realized)), atingimento: null, faltam: null, ritmoSuficiente: null, periodo: label, texto: "Meta não cadastrada." };
  }
  if (realized == null) {
    return { meta: round(n(goal)), realizado: null, atingimento: null, faltam: null, ritmoSuficiente: null, periodo: label, texto: "Há venda sem valor. O realizado não foi somado." };
  }
  const faltam = round(Math.max(0, n(goal) - n(realized)));
  const enough = n(realized) + 0.009 >= n(goal);
  return {
    meta: round(n(goal)),
    realizado: round(n(realized)),
    atingimento: round((n(realized) / n(goal)) * 100, 1),
    faltam,
    ritmoSuficiente: enough,
    periodo: label,
    texto: enough ? `O realizado do ${label} alcança a meta.` : `Faltam ${money(faltam)} para a meta do ${label}.`,
  };
}

export function quoteProbability(total, converted) {
  const quotes = n(total);
  if (quotes < 5) return { taxa: null, base: quotes, texto: "Dado indisponível para esta análise." };
  return { taxa: round((n(converted) / quotes) * 100, 1), base: quotes, texto: null };
}

export function classifyExpense(text) {
  const source = String(text || "").toLowerCase();
  const rules = [
    [/alugu/, "aluguel"],
    [/energia|luz|el[eé]tric/, "energia"],
    [/[aá]gua|saneamento/, "agua"],
    [/telefon|internet|vivo|claro|tim\b/, "comunicacao"],
    [/sal[aá]ri|folha|f[eé]rias|inss|fgts/, "pessoal"],
    [/imposto|darf|das\b|icms|iss\b|pis|cofins/, "impostos"],
    [/seguro/, "seguro"],
    [/combust|gasolina|diesel/, "combustivel"],
    [/frete|transport/, "frete"],
    [/licen[cç]|software|assinatura|mensalidade/, "assinatura"],
    [/manuten|conserto/, "manutencao"],
  ];
  for (const [pattern, classe] of rules) {
    if (pattern.test(source)) return { classe, origem: "regra", confirmada: false };
  }
  return { classe: null, origem: "regra", confirmada: false, texto: "Dado indisponível para esta análise." };
}

export function accountClassificationLabel(row = {}) {
  const text = (value) => String(value ?? "").trim();
  const levels = [
    text(row.CONTA) || text(row.CDCONTA),
    text(row.SUBCONTA) || text(row.CDSUBCONTA),
    text(row.SUBSUBCONTA) || text(row.CDSUBSUBCONTA),
    text(row.SUBSUBSUBCONTA) || text(row.CDSUBSUBSUBCONTA),
  ].filter(Boolean);
  if (!levels.length) return { classe: null, origem: "contabil", confirmada: false, texto: "Sem classificação contábil." };
  return { classe: levels.join(" · "), origem: "contabil", confirmada: true, texto: "" };
}

function labelHistoricos(items) {
  const names = items.map((item) => item || "Sem histórico");
  if (names.length <= 3) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} e mais ${names.length - 2}`;
}

export function groupExpensesByClassification(rows) {
  if (!Array.isArray(rows)) return rows;
  const groups = new Map();
  for (const row of rows) {
    const key = row?.classe || row?.texto || "Sem classificação contábil";
    const current = groups.get(key) || {
      classe: row?.classe || null,
      texto: row?.texto || "",
      confirmada: Boolean(row?.confirmada),
      origem: row?.origem || "",
      valor: 0,
      quantidade: 0,
      historicos: [],
    };
    current.valor += n(row?.valor);
    current.quantidade += n(row?.quantidade);
    const historico = String(row?.historico || "").trim();
    if (!current.historicos.includes(historico)) current.historicos.push(historico);
    groups.set(key, current);
  }
  return [...groups.values()].map((item) => ({
    classe: item.classe,
    texto: item.texto,
    confirmada: item.confirmada,
    origem: item.origem,
    valor: round(item.valor),
    quantidade: item.quantidade,
    historico: labelHistoricos(item.historicos),
  })).sort((a, b) => b.valor - a.valor);
}

export function applyView(report, filters = {}) {
  if (!report) return report;
  const seller = Number(filters.vendedor || 0) || null;
  const categoria = String(filters.categoria || "");
  const severidade = String(filters.severidade || "");
  const filial = Number(filters.filial || 0) || null;
  const next = {
    ...report,
    ranking: seller ? (report.ranking || []).filter((item) => Number(item.id) === seller) : report.ranking,
    rankingMes: seller ? (report.rankingMes || []).filter((item) => Number(item.id) === seller) : report.rankingMes,
    orcamentos: report.orcamentos ? {
      ...report.orcamentos,
      lista: (report.orcamentos.lista || []).filter((item) => !seller || Number(item.vendedorId) === seller),
      porVendedor: (report.orcamentos.porVendedor || []).filter((item) => !seller || Number(item.vendedorId) === seller),
    } : report.orcamentos,
    alertas: (report.alertas || []).filter((item) => {
      if (categoria && item.categoria !== categoria) return false;
      if (severidade && item.severidade !== severidade) return false;
      if (filial && item.filial && Number(item.filial) !== filial) return false;
      return true;
    }),
  };
  return next;
}

export function whatsappTemplateParameters(report) {
  return [
    brDate(report?.referencia),
    report?.vendas?.ontem == null ? "Dado indisponivel" : money(report.vendas.ontem),
    String(report?.link || "Abra o ERP no Charlie Daily").replace(/\s+/g, " ").slice(0, 900),
  ];
}

export function assessGoal(goal, realized, referenceIso, origin = null) {
  if (!(n(goal) > 0)) {
    return { meta: null, realizado: realized == null ? null : round(n(realized)), atingimento: null, faltam: null, diasUteisRestantes: null, ritmoNecessario: null, projecao: null, ritmoSuficiente: null, origem: null, texto: "Meta não cadastrada." };
  }
  if (realized == null) {
    return { meta: round(n(goal)), realizado: null, atingimento: null, faltam: null, diasUteisRestantes: null, ritmoNecessario: null, projecao: null, ritmoSuficiente: null, origem: origin, texto: "Há venda sem valor. O realizado não foi somado." };
  }
  const bounds = monthBounds(referenceIso);
  const decorridos = businessDaysInclusive(bounds.start, referenceIso);
  const restantes = businessDaysInclusive(addDays(referenceIso, 1), bounds.end);
  const noMes = businessDaysInclusive(bounds.start, bounds.end);
  const faltam = round(Math.max(0, n(goal) - n(realized)));
  const ritmo = restantes > 0 ? round(faltam / restantes) : null;
  const projecao = decorridos > 0 ? round((n(realized) / decorridos) * noMes) : null;
  const ritmoSuficiente = projecao == null ? null : projecao + 0.009 >= n(goal);
  return {
    meta: round(n(goal)),
    realizado: round(n(realized)),
    atingimento: round((n(realized) / n(goal)) * 100, 1),
    faltam,
    diasUteisRestantes: restantes,
    diasUteisDecorridos: decorridos,
    ritmoNecessario: ritmo,
    projecao,
    ritmoSuficiente,
    origem: origin,
    texto: ritmoSuficiente == null
      ? "Dado indisponível para esta análise."
      : ritmoSuficiente
        ? "O ritmo atual, projetado pelos dias úteis decorridos, alcança a meta."
        : "O ritmo atual, projetado pelos dias úteis decorridos, fica abaixo da meta.",
  };
}

export function prioritizeQuote(quote, settings, referenceIso) {
  const limites = { ...DEFAULT_SETTINGS.limites, ...settings?.limites };
  const bruto = quote.value != null ? quote.value : quote.VLTOTAL;
  const value = bruto == null ? null : n(bruto);
  const emitted = isoDay(quote.date || quote.DTORC);
  const ageDays = emitted
    ? Math.max(0, Math.floor((Date.parse(`${referenceIso}T12:00:00Z`) - Date.parse(`${emitted}T12:00:00Z`)) / 86400000))
    : 0;
  const profit = quote.profit ?? quote.TOTALLUCRO;
  const margin = profit == null || !(value > 0) ? null : round((n(profit) / value) * 100, 1);
  const reasons = [];
  let prioridade = "baixa";
  if (value >= n(limites.valorPrioridade)) {
    prioridade = "alta";
    reasons.push("valor acima do mínimo configurado");
  }
  const stale = ageDays * 24 >= n(limites.acompanhamentoHoras);
  if (stale && value >= n(limites.valorPrioridade) / 2) {
    prioridade = "alta";
    reasons.push(`em aberto há ${ageDays} dias, acima do prazo de acompanhamento`);
  } else if (stale) {
    if (prioridade !== "alta") prioridade = "media";
    reasons.push(`em aberto há ${ageDays} dias, acima do prazo de acompanhamento`);
  }
  if (margin != null && margin < n(limites.margemMinima)) {
    if (prioridade === "baixa") prioridade = "media";
    reasons.push("margem de contribuição estimada abaixo do mínimo");
  }
  const classe = margin == null
    ? (value >= n(limites.valorPrioridade) ? "estrategica" : "padrao")
    : margin < n(limites.margemMinima)
      ? "margem_reduzida"
      : value >= n(limites.valorPrioridade) ? "estrategica" : "padrao";
  if (margin == null) reasons.push("margem de contribuição indisponível neste orçamento");
  if (n(quote.semEstoque) > 0) {
    if (prioridade === "baixa") prioridade = "media";
    reasons.push("há item sem saldo disponível");
  }
  const chance = quoteProbability(quote.historicoOrcamentos, quote.historicoConvertidos);
  return {
    numero: quote.number ?? quote.NRORCAMENTO,
    cliente: quote.customer || quote.CLIENTE || "Cliente",
    vendedor: quote.seller || quote.VENDEDOR || "Sem vendedor",
    vendedorId: Number(quote.sellerId ?? quote.CDVENDEDOR ?? 0),
    valor: value == null ? null : round(value),
    emissao: emitted,
    ultimoContato: null,
    ultimoContatoTexto: "Dado indisponível para esta análise.",
    prioridade,
    motivo: reasons.join("; ") || "valor e prazo dentro da faixa padrão",
    proximaAcao: prioridade === "alta" ? "Contatar o cliente e confirmar as condições do orçamento." : "Registrar o próximo contato comercial.",
    classe,
    margem: margin,
    idadeDias: ageDays,
    empresa: quote.companyId ?? quote.IDEMPRESA ?? null,
    semEstoque: n(quote.semEstoque),
    probabilidade: chance.taxa,
    probabilidadeTexto: chance.taxa == null ? chance.texto : `${percent(chance.taxa)} com base em ${chance.base} orçamentos anteriores do cliente`,
  };
}

export function stockRisk(rows, settings = {}) {
  const limites = { ...DEFAULT_SETTINGS.limites, ...settings.limites };
  const riscos = [];
  for (const row of rows || []) {
    const stock = n(row.stock ?? row.ESTOQUE);
    const qty90 = n(row.qty90 ?? row.QTD90);
    const daily = qty90 > 0 ? qty90 / 90 : 0;
    const coverage = daily > 0 ? round(stock / daily, 1) : null;
    const minimum = n(row.minimum ?? row.MINIMO);
    const rupture = stock <= 0 || (coverage != null && coverage < n(limites.coberturaRiscoDias));
    const belowMinimum = minimum > 0 && stock <= minimum;
    if (!rupture && !belowMinimum) continue;
    const lead = n(limites.reposicaoDias) || 7;
    riscos.push({
      produto: row.product || row.PRODUTO || row.productId || row.CDPRODUTO,
      produtoId: row.productId || row.CDPRODUTO,
      estoque: round(stock, 3),
      mediaDiaria: daily ? round(daily, 3) : null,
      cobertura: coverage,
      sugestao: daily ? Math.max(0, Math.ceil(daily * lead - stock)) : null,
      prioridade: stock <= 0 || (coverage != null && coverage < 5) ? "alta" : "media",
      motivo: stock <= 0 ? "estoque zerado ou negativo" : coverage != null && coverage < n(limites.coberturaRiscoDias) ? "cobertura abaixo do limite" : "estoque no mínimo ou abaixo",
      filial: row.depositId || row.CDDEPOSITO || null,
    });
  }
  riscos.sort((a, b) => (a.cobertura ?? -1) - (b.cobertura ?? -1));
  return riscos;
}

export function movementReading(row, settings = {}) {
  const limites = { ...DEFAULT_SETTINGS.limites, ...settings.limites };
  const expected = n(row.initial) + n(row.entries) - n(row.sales) - n(row.manualOut) + n(row.returns) + n(row.transfersIn) - n(row.transfersOut);
  const delta = round(n(row.actual) - expected, 3);
  const manual = n(row.manualOut) > 0 || /ajuste|invent|baixa/i.test(String(row.history || ""));
  const atipica = n(row.manualOut) >= n(limites.baixaAtipica) && n(row.manualOut) > n(row.avgDaily) * 7;
  let texto = "Movimentação consistente com as quantidades informadas.";
  if (atipica) texto = "Baixa manual acima do padrão recente de saída. Conferir o lançamento antes de tratar como erro.";
  else if (manual) texto = "Baixa manual registrada. Não indica fraude por si só.";
  else if (delta != null && Math.abs(delta) > 0.001) texto = "A soma das movimentações informadas não fecha com o estoque atual.";
  return { produto: row.product, esperado: round(expected, 3), divergencia: Math.abs(delta || 0) > 0.001, baixaManual: manual, atipica, texto };
}

export function complements(lines, minimumSupport = 2) {
  const orders = new Map();
  const names = new Map();
  for (const line of lines || []) {
    const order = `${line.companyId || ""}:${line.orderId}`;
    const product = String(line.productId || "");
    if (!product || !line.orderId) continue;
    names.set(product, line.product || product);
    const set = orders.get(order) || new Set();
    set.add(product);
    orders.set(order, set);
  }
  const support = new Map();
  for (const set of orders.values()) {
    const ids = [...set].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        support.set(key, (support.get(key) || 0) + 1);
      }
    }
  }
  return [...support.entries()]
    .filter(([, count]) => count >= minimumSupport)
    .map(([key, count]) => {
      const [left, right] = key.split("|");
      return { produto: names.get(left), complemento: names.get(right), pedidos: count, compatibilidadeTecnica: "Dado indisponível para esta análise." };
    })
    .sort((a, b) => b.pedidos - a.pedidos)
    .slice(0, 8);
}

export function sellerMessage(seller, report, settings, parts) {
  const config = { ...DEFAULT_SETTINGS.notificacaoIndividual, ...settings?.notificacaoIndividual };
  if (!config.ativo) return { enviar: false, motivo: "Notificação individual desativada." };
  if (!seller?.consentimento) return { enviar: false, motivo: "Vendedor sem consentimento para mensagem." };
  if (!seller?.telefone) return { enviar: false, motivo: "Vendedor sem telefone autorizado." };
  const [startHour, startMinute] = String(config.inicio || "08:00").split(":").map(Number);
  const [endHour, endMinute] = String(config.fim || "18:00").split(":").map(Number);
  const minute = parts.hour * 60 + parts.minute;
  if (minute < startHour * 60 + startMinute || minute > endHour * 60 + endMinute) return { enviar: false, motivo: "Fora do horário comercial configurado." };
  const own = (report.orcamentos?.lista || []).filter((item) => Number(item.vendedorId) === Number(seller.id));
  const priority = own.filter((item) => item.prioridade === "alta");
  const quantidadeAberta = own.length;
  const goal = report.metasVendedores?.[seller.id] || null;
  const lines = [
    `${seller.nome || "Vendedor"}: ${own.length} orçamentos em aberto · ${money(own.reduce((sum, item) => sum + n(item.valor), 0))}`,
  ];
  if (priority.length) lines.push(`${priority.length} prioritários.`);
  if (goal?.atingimento != null) lines.push(`Meta ${percent(goal.atingimento)}.`);
  return {
    enviar: true,
    motivo: "autorizado",
    chave: `${seller.id}|${report.referencia}|${own.length}|${priority.length}`,
    texto: lines.join("\n"),
    vendedorId: seller.id,
    telefone: String(seller.telefone || "").replace(/\D/g, ""),
    nome: seller.nome || "vendedor",
    quantidadeAberta,
  };
}

export function prepareCampaign(customers, promotion) {
  const destinatarios = (customers || []).filter((item) => item.consentimento === true && item.descadastrado !== true && item.orcamentoAberto);
  return {
    status: "rascunho",
    produto: promotion?.produto || null,
    texto: promotion?.produto ? `Orçamento em aberto: ${promotion.produto}.` : "",
    destinatarios,
    disparar: false,
  };
}

export function dispatchAllowed(campaign, settings) {
  if (!settings?.campanhas?.aprovada) return { ok: false, motivo: "Campanha sem aprovação." };
  if (!campaign?.destinatarios?.length) return { ok: false, motivo: "Nenhum destinatário com consentimento." };
  if (campaign.destinatarios.some((item) => item.consentimento !== true || item.descadastrado === true)) return { ok: false, motivo: "Há destinatário sem autorização." };
  return { ok: true };
}

export function isDue(settings, now = new Date(), state = {}) {
  const config = { ...DEFAULT_SETTINGS, ...settings, weekdays: settings?.weekdays || DEFAULT_SETTINGS.weekdays };
  if (!config.enabled) return { due: false, reason: "desligado" };
  const parts = saoPauloParts(now);
  const time = String(config.time || "07:00").slice(0, 5);
  if (!config.weekdays.map(Number).includes(parts.weekday)) return { due: false, reason: "dia", parts };
  if (parts.hhmm !== time) return { due: false, reason: "horario", parts };
  const key = `${parts.date}|${time}`;
  if (state.lastSuccessKey === key) return { due: false, reason: "duplicado", key, parts };
  return { due: true, key, parts, reference: addDays(parts.date, -1) };
}

export function nextRetry(attempts, now = new Date()) {
  const wait = Math.max(1, n(attempts) || 1) * 5 * 60 * 1000;
  return new Date(now.getTime() + wait).toISOString();
}

function valorVenda(row) {
  if (row?.revenue != null) return Number(row.revenue);
  if (row?.FATURAMENTO != null) return Number(row.FATURAMENTO);
  return null;
}

function sumSales(rows, companyId) {
  const lista = (rows || []).filter((row) => sameCompany(row, companyId));
  if (lista.some((row) => valorVenda(row) == null)) return null;
  return round(lista.reduce((sum, row) => sum + valorVenda(row), 0));
}

function knownNumbers(report) {
  const found = new Set();
  const walk = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      found.add(value.toFixed(2));
      found.add(value.toFixed(1));
      found.add(String(Math.round(value)));
    } else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(report);
  return found;
}

export function narrativeAccepts(text, report) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  const allowed = knownNumbers(report);
  const matches = raw.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+/g) || [];
  return matches.every((token) => {
    const normalized = token.includes(",") ? token.replaceAll(".", "").replace(",", ".") : token.replaceAll(".", "");
    const value = Number(normalized);
    if (!Number.isFinite(value)) return false;
    return allowed.has(value.toFixed(2)) || allowed.has(value.toFixed(1)) || allowed.has(String(Math.round(value)));
  });
}

function severityRank(level) {
  return { alta: 3, critica: 3, media: 2, atencao: 2, baixa: 1, info: 0 }[level] || 0;
}

export function composeBreakfast(input = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input.settings,
    limites: { ...DEFAULT_SETTINGS.limites, ...input.settings?.limites },
    indicadores: { ...DEFAULT_SETTINGS.indicadores, ...input.settings?.indicadores },
    metas: { ...DEFAULT_SETTINGS.metas, ...input.settings?.metas },
  };
  const reference = input.reference || referenceDay(input.now || new Date());
  const companyId = input.companyId ? Number(input.companyId) : null;
  const day = rankSellers(input.salesDay, companyId);
  const previous = rankSellers(input.salesPrevious, companyId);
  const month = rankSellers(input.salesMonth, companyId);
  attachQuotes(day.ranking, (input.quotesBySeller || []).filter((row) => sameCompany(row, companyId)));
  attachQuotes(month.ranking, (input.quotesBySellerMonth || []).filter((row) => sameCompany(row, companyId)));
  const previousMap = new Map(previous.ranking.map((item) => [item.id, item]));
  for (const seller of day.ranking) {
    const before = previousMap.get(seller.id);
    seller.variacao = variation(seller.faturamento, before?.faturamento);
    if (seller.variacao.percentual != null && Math.abs(seller.variacao.percentual) < n(settings.limites.variacaoMinima)) seller.variacao.relevante = false;
    else seller.variacao.relevante = seller.variacao.percentual != null;
  }
  const quotes = quoteBucket((input.quotesPeriod || []).filter((row) => sameCompany(row, companyId)));
  const quotesMonth = quoteBucket((input.quotesMonth || []).filter((row) => sameCompany(row, companyId)));
  const conversao = quotes.taxa != null
    ? { taxa: quotes.taxa, periodo: "dia", texto: "No dia." }
    : quotesMonth.taxa != null
      ? { taxa: quotesMonth.taxa, periodo: "mes", texto: "No mês." }
      : { taxa: null, periodo: null, texto: "Sem orçamento." };
  const openList = (input.openQuotes || []).filter((row) => sameCompany(row, companyId)).map((row) => prioritizeQuote(row, settings, reference));
  const openCount = input.openTotal?.count != null ? n(input.openTotal.count) : openList.length;
  const openValue = input.openTotal ? (input.openTotal.value == null ? null : round(n(input.openTotal.value))) : round(openList.reduce((sum, item) => sum + n(item.valor), 0));
  const priorityCount = openList.filter((item) => item.prioridade === "alta").length;
  const strategic = openList.filter((item) => item.classe === "estrategica").length;
  const pickedGoal = monthlyGoalFrom(settings, input.legacyGoals, companyId, input.legacyGoal);
  const goalValue = pickedGoal.value;
  const goalOrigin = pickedGoal.origin;
  const monthSales = sumSales(input.salesMonth, companyId);
  const meta = assessGoal(goalValue, monthSales, reference, goalOrigin);
  const metaDiaria = assessWindow(settings.metas.diaria, sumSales(input.salesDay, companyId), "dia");
  const metaSemanal = assessWindow(settings.metas.semanal, sumSales(input.salesWeek, companyId), "semana");
  const teamGoal = n(settings.metas.equipes?.[companyId]) || n(settings.metas.equipe);
  const metaEquipe = assessWindow(teamGoal, monthSales, "equipe");
  const sellerGoals = {};
  for (const seller of month.ranking) {
    const individual = n(settings.metas.vendedores?.[seller.id]) || n(input.legacySellerGoals?.[seller.id]);
    if (individual > 0) sellerGoals[seller.id] = { ...assessGoal(individual, seller.faturamento, reference, "meta individual"), nome: seller.nome };
  }
  const riscos = stockRisk(input.stockCritical, settings);
  const manuais = (input.movements || []).map((row) => movementReading({
    product: row.product || row.PRODUTO,
    manualOut: n(row.exits ?? row.SAIDAS),
    history: row.history || row.HISTORICO,
    avgDaily: n(row.avgDaily),
    entries: n(row.entries ?? row.ENTRADAS),
  }, settings));
  const atipicas = manuais.filter((item) => item.atipica).length;
  const registradas = manuais.filter((item) => item.baixaManual).length;
  const finance = input.finance || {};
  const pares = settings.indicadores.vendaAgregada ? complements(input.baskets) : [];
  const variacoes = day.ranking.filter((item) => item.variacao?.relevante).slice(0, 3).map((item) => `${item.nome}: ${item.variacao.texto}.`);
  const observacoes = [];
  if (priorityCount) observacoes.push(`${priorityCount} orçamentos prioritários sem contato.`);
  if (riscos.length) observacoes.push(`${riscos.length} produtos com cobertura curta.`);
  if (meta.ritmoSuficiente === false) observacoes.push("Ritmo abaixo da meta do mês.");
  if (meta.ritmoSuficiente === true) observacoes.push("Ritmo alcança a meta do mês.");
  if (n(input.stockIdle?.value) > 0) observacoes.push(`${money(input.stockIdle.value)} parados há mais de ${settings.limites.semGiroDias} dias.`);
  if (input.stockAging?.["90"]?.quantidade) observacoes.push(`${input.stockAging["90"].quantidade} produtos sem venda há 90 dias.`);
  if (Array.isArray(input.purchasesIdle) && input.purchasesIdle.length) observacoes.push(`${input.purchasesIdle.length} compras recentes sem venda.`);
  if (n(input.inactiveCustomers) > 0) observacoes.push(`${input.inactiveCustomers} clientes sem compra no prazo.`);
  observacoes.push(...variacoes);
  const unicas = [...new Set(observacoes)].slice(0, 3);
  const prioridades = [];
  if (strategic || priorityCount) prioridades.push({ nivel: "alta", texto: "Ligar para os orçamentos prioritários." });
  if (riscos.some((item) => item.prioridade === "alta")) prioridades.push({ nivel: "media", texto: "Repor itens com cobertura curta." });
  if (n(input.stockIdle?.value) > 0) prioridades.push({ nivel: "baixa", texto: "Ver o estoque parado." });
  if (n(finance.receivableOverdue) > 0) prioridades.push({ nivel: "alta", texto: "Cobrar as contas vencidas." });
  if (!prioridades.length) prioridades.push({ nivel: "info", texto: "Nada crítico hoje." });
  const report = {
    titulo: "Charlie Daily",
    referencia: reference,
    geradoEm: new Date(input.now || Date.now()).toISOString(),
    empresaId: companyId,
    empresa: input.companyName || (companyId ? `Empresa ${companyId}` : "Todas as empresas autorizadas"),
    filialId: input.filialId || null,
    filial: input.filialName || null,
    formato: settings.formato,
    vendas: {
      ontem: sumSales(input.salesDay, companyId),
      mes: sumSales(input.salesMonth, companyId),
      pedidosOntem: day.ranking.reduce((sum, item) => sum + item.pedidos, 0),
    },
    meta,
    metaDiaria,
    metaSemanal,
    metaEquipe,
    metasVendedores: sellerGoals,
    ranking: day.ranking,
    rankingMes: month.ranking,
    menor: day.menor,
    orcamentos: {
      ...quotes,
      mes: quotesMonth,
      conversao,
      abertos: openCount,
      valorAberto: openValue,
      prioritarios: priorityCount,
      lista: openList,
      porVendedor: (input.openBySeller || []).filter((row) => sameCompany(row, companyId)).map((row) => ({
        vendedor: row.seller || row.NOME,
        vendedorId: Number(row.sellerId ?? row.ID ?? 0),
        quantidade: n(row.count ?? row.QTD),
        valor: row.value == null && row.TOTAL == null ? null : round(n(row.value ?? row.TOTAL)),
      })),
    },
    estoque: {
      ruptura: riscos,
      baixasManuais: registradas,
      baixasAtipicas: atipicas,
      leituras: manuais,
      baixoGiro: input.stockIdle?.count ?? null,
      capitalParado: input.stockIdle?.value != null ? round(n(input.stockIdle.value)) : null,
      semGiroDias: settings.limites.semGiroDias,
      faixas: input.stockAging && !input.stockAging.erro ? input.stockAging : null,
      movimento: input.movementSummary || null,
      comprasParadas: input.purchasesIdle || null,
      maisVendidos: input.stockTop || [],
      menosVendidos: input.stockBottom || [],
      negativo: input.stockNegative ?? null,
    },
    crm: {
      estrategicos: strategic,
      contato: openList.filter((item) => item.idadeDias * 24 >= n(settings.limites.acompanhamentoHoras)).length,
      valorPrioritario: round(openList.filter((item) => item.prioridade === "alta").reduce((sum, item) => sum + n(item.valor), 0)),
      inativos: input.inactiveCustomers ?? null,
      agregados: pares,
    },
    financeiro: {
      receberAVencer: finance.receivableOpen ?? null,
      receberVencido: finance.receivableOverdue ?? null,
      pagarAVencer: finance.payableOpen ?? null,
      pagarVencido: finance.payableOverdue ?? null,
      contratos: null,
      contratosTexto: "Dado indisponível para esta análise.",
      classificacaoDespesas: Array.isArray(input.expenses) ? groupExpensesByClassification(input.expenses) : null,
      classificacaoTexto: Array.isArray(input.expenses) ? "" : "Dado indisponível para esta análise.",
    },
    precos: {
      concorrencia: null,
      texto: "Dado indisponível para esta análise.",
    },
    evolucao: (input.series || []).map((item) => {
      const date = isoDay(item.date) || String(item.date || "");
      return { ...item, date, label: item.label || chartDateLabel(date) };
    }),
    observacoes: unicas,
    prioridades: prioridades.slice(0, 3),
    link: input.link || null,
    indicadores: settings.indicadores,
  };
  report.texto = renderMessage(report);
  report.alertas = buildAlerts(report);
  return report;
}

function joinBits(bits) {
  return bits.filter(Boolean).join(" · ");
}

function goalBit(label, goal) {
  if (goal?.atingimento == null) return "";
  return `${label} ${percent(goal.atingimento)}`;
}

function countLabel(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function sellerBits(rows) {
  return rows.map((item) => `${item.posicao}. ${item.nome} ${money(item.faturamento)}`).join(" · ");
}

export function renderMessage(report) {
  const lines = [`Charlie Daily · ${brDate(report.referencia)}`, report.empresa];
  const vendas = joinBits([
    report.vendas?.ontem != null ? `Ontem ${money(report.vendas.ontem)}` : "",
    report.vendas?.mes != null ? `Mês ${money(report.vendas.mes)}` : "",
  ]);
  const metas = joinBits([
    goalBit("Mês", report.meta),
    goalBit("Dia", report.metaDiaria),
    goalBit("Semana", report.metaSemanal),
    goalBit("Equipe", report.metaEquipe),
  ]);
  const comercial = [vendas, metas || (report.meta?.atingimento == null ? "Meta não cadastrada." : "")].filter(Boolean);
  if (comercial.length) lines.push("", ...comercial);

  const full = report.formato !== "resumido";
  const show = (key) => full && report.indicadores?.[key] !== false;
  const medals = (report.ranking || []).filter((item) => item.posicao != null && item.posicao <= 3).slice(0, 3);
  const monthMedals = (report.rankingMes || []).filter((item) => item.posicao != null && item.posicao <= 3).slice(0, 3);
  if (show("ranking")) {
    if (medals.length) {
      lines.push("", sellerBits(medals));
      const listed = new Set(medals.map((item) => item.nome));
      const menorFora = report.menor?.empate
        ? (report.menor.vendedores || []).some((item) => !listed.has(item.nome))
        : Boolean(report.menor?.nome) && !listed.has(report.menor.nome);
      if (menorFora) {
        const texto = report.menor.empate
          ? report.menor.vendedores.map((item) => `${item.nome} ${money(item.faturamento)}`).join(", ")
          : `${report.menor.nome} ${money(report.menor.faturamento)}`;
        lines.push(`Menor: ${texto}`);
      }
    } else if (monthMedals.length) {
      lines.push("", `Nenhuma venda em ${brDate(report.referencia)}. Ranking do mês: ${sellerBits(monthMedals)}`);
    } else if ((report.ranking || []).some((item) => item.pedidos > 0)) {
      lines.push("", `Há venda sem valor em ${brDate(report.referencia)}. O ranking não foi montado.`);
    } else {
      lines.push("", `Nenhuma venda em ${brDate(report.referencia)}.`);
    }
  } else if (medals[0]) {
    lines.push("", `${medals[0].nome} ${money(medals[0].faturamento)}`);
  }

  if (show("orcamentos") && report.orcamentos) {
    const conv = report.orcamentos.conversao;
    const taxa = conv?.taxa == null ? "" : ` · ${percent(conv.taxa)}${conv.periodo === "mes" ? " no mês" : ""}`;
    lines.push("", `Orçamentos: ${countLabel(report.orcamentos.novos)} novos · ${countLabel(report.orcamentos.convertidos)} pedidos${taxa}`);
    if (n(report.orcamentos.abertos) || n(report.orcamentos.prioritarios)) {
      lines.push(`${countLabel(report.orcamentos.abertos)} em aberto · ${money(report.orcamentos.valorAberto)} · ${countLabel(report.orcamentos.prioritarios)} prioritários`);
    }
  }

  if (show("estoque") && report.estoque) {
    const bits = [];
    if (report.estoque.ruptura?.length) bits.push(`${countLabel(report.estoque.ruptura.length)} em ruptura`);
    if (n(report.estoque.baixasAtipicas)) bits.push(`${countLabel(report.estoque.baixasAtipicas)} baixas atípicas`);
    if (n(report.estoque.baixoGiro)) bits.push(`${countLabel(report.estoque.baixoGiro)} com baixo giro`);
    if (n(report.estoque.capitalParado)) bits.push(`${money(report.estoque.capitalParado)} parados`);
    const faixa90 = report.estoque.faixas?.["90"];
    const outras = ["30", "60"].flatMap((days) => {
      const item = report.estoque.faixas?.[days];
      return item ? [`${days} dias ${countLabel(item.quantidade)}`] : [];
    });
    if (bits.length || faixa90 || outras.length) lines.push("");
    if (bits.length) lines.push(`Estoque: ${bits.join(" · ")}`);
    if (faixa90) lines.push(`Sem venda há 90 dias: ${countLabel(faixa90.quantidade)} · ${money(faixa90.capital)}`);
    if (outras.length) lines.push(outras.join(" · "));
  }

  if (show("crm") && report.crm) {
    const bits = [];
    if (n(report.crm.estrategicos)) bits.push(`${countLabel(report.crm.estrategicos)} estratégicos`);
    if (n(report.crm.contato)) bits.push(`${countLabel(report.crm.contato)} sem contato`);
    if (n(report.crm.valorPrioritario)) bits.push(money(report.crm.valorPrioritario));
    if (bits.length) lines.push("", `CRM: ${bits.join(" · ")}`);
  }

  if (show("financeiro") && report.financeiro) {
    const bits = [];
    if (n(report.financeiro.receberAVencer)) bits.push(`a vencer ${money(report.financeiro.receberAVencer)}`);
    if (n(report.financeiro.receberVencido)) bits.push(`vencidas ${money(report.financeiro.receberVencido)}`);
    if (bits.length) lines.push("", `Financeiro: ${bits.join(" · ")}`);
  }

  const acoes = (report.prioridades || []).map((item) => item.texto).filter(Boolean).slice(0, 3);
  if (acoes.length) lines.push("", ...acoes.map((texto, index) => `${index + 1}. ${texto}`));
  lines.push("", report.link || "Abra o Charlie Daily no ERP.");
  return lines.join("\n");
}

export function buildAlerts(report) {
  const alerts = [];
  const push = (partial) => alerts.push({
    chave: partial.chave,
    empresa: report.empresaId,
    filial: partial.filial ?? report.filialId ?? null,
    categoria: partial.categoria,
    severidade: partial.severidade,
    data: report.referencia,
    origem: "cafe-manha",
    titulo: partial.titulo || "",
    contexto: partial.contexto || "",
    descricao: partial.descricao,
    indicadores: partial.indicadores,
    acao: partial.acao,
    responsavel: "",
    status: "novo",
  });
  if (report.meta?.ritmoSuficiente === false) {
    push({ chave: `meta:${report.empresaId || 0}:${report.referencia.slice(0, 7)}`, categoria: "comercial", severidade: "alta", titulo: "Meta do mês em risco", descricao: "O ritmo atual não alcança a meta mensal.", indicadores: { atingimento: report.meta.atingimento, faltam: report.meta.faltam }, acao: "Revisar o ritmo e as oportunidades em aberto." });
  }
  if (report.crm?.contato) {
    push({ chave: `contato:${report.empresaId || 0}`, categoria: "crm", severidade: "media", titulo: "Orçamentos sem data de contato", descricao: `${report.crm.contato} orçamentos em aberto passaram do prazo configurado e não têm data de contato.`, indicadores: { quantidade: report.crm.contato }, acao: "Registrar contato ou justificar o acompanhamento." });
  }
  if (report.orcamentos?.prioritarios) {
    push({ chave: `oportunidade:${report.empresaId || 0}`, categoria: "comercial", severidade: "alta", titulo: "Oportunidades prioritárias", descricao: `${report.orcamentos.prioritarios} oportunidades prioritárias em aberto.`, indicadores: { valor: report.crm?.valorPrioritario }, acao: "Contatar os clientes de maior valor." });
  }
  for (const item of (report.estoque?.ruptura || []).filter((row) => row.prioridade === "alta").slice(0, 8)) {
    push({ chave: `ruptura:${report.empresaId || 0}:${item.filial || 0}:${item.produtoId || item.produto}`, categoria: "estoque", severidade: "alta", titulo: item.produto, contexto: String(item.motivo || "").includes("cobertura") ? "Cobertura baixa" : String(item.motivo || "").includes("mínimo") ? "Estoque no mínimo" : "Produto sem estoque", descricao: `${item.produto} com ${item.motivo}.`, indicadores: { estoque: item.estoque, cobertura: item.cobertura }, acao: "Avaliar reposição.", filial: item.filial || report.filialId || null });
  }
  if (n(report.estoque?.capitalParado) > 0) {
    push({ chave: `parado:${report.empresaId || 0}`, categoria: "estoque", severidade: "media", titulo: "Capital parado no estoque", descricao: `Capital estimado em estoque parado: ${money(report.estoque.capitalParado)}.`, indicadores: { valor: report.estoque.capitalParado, dias: report.estoque.semGiroDias }, acao: "Avaliar campanha dentro da margem mínima." });
  }
  if (n(report.financeiro?.receberVencido) > 0) {
    push({ chave: `receber:${report.empresaId || 0}`, categoria: "financeiro", severidade: "alta", titulo: "Contas a receber vencidas", descricao: `Contas a receber vencidas: ${money(report.financeiro.receberVencido)}.`, indicadores: { valor: report.financeiro.receberVencido }, acao: "Revisar a carteira vencida." });
  }
  if (report.estoque?.baixasAtipicas) {
    push({ chave: `baixa:${report.empresaId || 0}:${report.referencia}`, categoria: "estoque", severidade: "media", titulo: "Baixas manuais acima do padrão", descricao: `${report.estoque.baixasAtipicas} baixas manuais acima do padrão recente. Não tratadas como fraude.`, indicadores: { quantidade: report.estoque.baixasAtipicas }, acao: "Conferir o histórico do movimento." });
  }
  return alerts.sort((a, b) => severityRank(b.severidade) - severityRank(a.severidade));
}

export function assertBreakfastAccess(user, companyId, settings = {}) {
  if (!user?.permissao_gerencial) {
    const error = new Error("Sem permissão para o Charlie Daily.");
    error.status = 403;
    throw error;
  }
  const companies = (settings.empresas || []).map(Number).filter((item) => item > 0);
  if (companyId && companies.length && !companies.includes(Number(companyId))) {
    const error = new Error("Empresa fora do recorte autorizado.");
    error.status = 403;
    throw error;
  }
}
