export const SALES_LAYOUT_KEY = "charlie-sales-dashboard-layout";
export const SALES_SECTION_KEY = "charlie-sales-section";

const CLOSED_OPPORTUNITY = new Set(["converted", "dismissed"]);
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export const SALES_MENU = [
  {
    id: "visao",
    label: "Visão geral",
    items: [
      { id: "dashboard", label: "Painel", kind: "dashboard" },
      { id: "intelligence", label: "Vendas online", kind: "intelligence" },
      { id: "alertas", label: "Alertas", kind: "alerts" },
      { id: "autopilot", label: "Rotina automática", kind: "autopilot" },
      { id: "mission", label: "Tarefas do dia", kind: "mission" },
    ],
  },
  {
    id: "vendas",
    label: "Vendas",
    items: [
      { id: "whatsapp", label: "WhatsApp", kind: "whatsapp" },
      { id: "quotes", label: "Orçamentos", kind: "quotes" },
      { id: "recovery", label: "Clientes parados", kind: "recovery" },
      { id: "rebuy", label: "Comprar de novo", kind: "rebuy" },
      { id: "customer360", label: "Ficha do cliente", kind: "customer360" },
    ],
  },
  {
    id: "ecommerce",
    label: "Loja online",
    items: [
      { id: "loja", label: "Loja Tray", kind: "store" },
      { id: "booster", label: "Anúncios", kind: "booster" },
      { id: "precos", label: "Preços", kind: "prices" },
      { id: "radar", label: "Concorrentes", kind: "radar" },
      { id: "match", label: "Produtos iguais", kind: "match" },
      { id: "shopping", label: "Anúncios no Google", kind: "shopping" },
      { id: "seo", label: "Textos da loja", kind: "seo" },
      { id: "kits", label: "Montar kits", kind: "kits" },
    ],
  },
  {
    id: "prospeccao",
    label: "Novos clientes",
    items: [
      { id: "leads", label: "Contatos", kind: "leads" },
      { id: "hunter", label: "Buscar empresas", kind: "hunter" },
      { id: "signals", label: "Quem pode comprar", kind: "signals" },
    ],
  },
  {
    id: "gestao",
    label: "Gestão",
    items: [
      { id: "estoque", label: "Estoque", kind: "stock" },
      { id: "compras", label: "O que comprar", kind: "purchasing" },
      { id: "campanhas", label: "Promoções", kind: "campaigns" },
      { id: "lucro", label: "Lucro", kind: "lucro" },
      { id: "coach", label: "Dicas de venda", kind: "coach" },
    ],
  },
  {
    id: "admin",
    label: "Administração",
    items: [
      { id: "automacoes", label: "Automações", kind: "automations" },
      { id: "historico", label: "Histórico de Ações", kind: "intelligence", section: "actions", note: "Aprovação, execução e reversão das ações da loja já ficam registradas aqui." },
      { id: "configuracoes", label: "Configurações", kind: "intelligence", section: "settings" },
      { id: "permissoes", label: "Permissões", kind: "permissions" },
      { id: "auditoria", label: "Auditoria", kind: "audit" },
    ],
  },
];

export const DASHBOARD_WIDGETS = [
  { id: "revenue", label: "Faturamento online", format: "money", scope: "period" },
  { id: "orders", label: "Quantidade de pedidos", format: "integer", scope: "period" },
  { id: "averageTicket", label: "Ticket médio", format: "money", scope: "period" },
  { id: "contributionMargin", label: "Margem de contribuição", format: "percent", scope: "period" },
  { id: "opportunities", label: "Oportunidades comerciais", format: "integer", scope: "control" },
  { id: "recoveredCustomers", label: "Clientes recuperados", format: "integer", scope: "control" },
  { id: "marketplaces", label: "Pedidos por marketplace", format: "channels", scope: "period" },
  { id: "problemProducts", label: "Produtos com problemas", format: "integer", scope: "control" },
  { id: "criticalAlerts", label: "Alertas críticos", format: "integer", scope: "control" },
  { id: "executedActions", label: "Ações executadas pelo Charlie", format: "integer", scope: "control" },
];

export function salesMenuItems() {
  return SALES_MENU.flatMap((group) => group.items.map((item) => ({ ...item, groupId: group.id, group: group.label })));
}

export function findSalesMenuItem(id) {
  return salesMenuItems().find((item) => item.id === id) || null;
}

export function normalizeSalesSection(id) {
  return findSalesMenuItem(id) ? id : "dashboard";
}

export function defaultDashboardLayout() {
  return DASHBOARD_WIDGETS.map((item, order) => ({ id: item.id, visible: true, order }));
}

export function normalizeDashboardLayout(saved) {
  const base = defaultDashboardLayout();
  if (!Array.isArray(saved)) return base;
  const known = new Set(base.map((item) => item.id));
  const used = new Set();
  const ordered = [];
  for (const item of saved) {
    if (!item || !known.has(item.id) || used.has(item.id)) continue;
    used.add(item.id);
    ordered.push({ id: item.id, visible: item.visible !== false, order: ordered.length });
  }
  for (const item of base) {
    if (!used.has(item.id)) ordered.push({ ...item, order: ordered.length });
  }
  return ordered.map((item, order) => ({ id: item.id, visible: item.visible !== false, order }));
}

export function moveDashboardWidget(layout, id, direction) {
  const items = normalizeDashboardLayout(layout);
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = items.slice();
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next.map((item, order) => ({ ...item, order }));
}

export function toggleDashboardWidget(layout, id) {
  return normalizeDashboardLayout(layout).map((item) => (item.id === id ? { ...item, visible: !item.visible } : item));
}

function metricValue(metric, missingReason) {
  if (!metric || typeof metric !== "object" || metric.available === false || !Number.isFinite(Number(metric.value))) {
    return { available: false, value: null, reason: metric?.reason || missingReason };
  }
  return { available: true, value: Number(metric.value), reason: metric.reason || "" };
}

function controlCount(control, pick, missingReason) {
  if (!Array.isArray(control?.opportunities)) return { available: false, value: null, reason: missingReason };
  return { available: true, value: pick(control.opportunities).length, reason: "" };
}

export function summarizeSalesDashboard(dashboard, control) {
  const metrics = dashboard?.metrics || {};
  const open = (opportunities) => opportunities.filter((item) => item && !CLOSED_OPPORTUNITY.has(item.status));
  const executed = control?.results && Number.isFinite(Number(control.results.executedActions))
    ? { available: true, value: Number(control.results.executedActions), reason: "" }
    : { available: false, value: null, reason: "O histórico de ações do Charlie ainda não foi lido." };
  return {
    revenue: metricValue(metrics.revenue, "Faturamento do período indisponível."),
    orders: metricValue(metrics.orders, "Quantidade de pedidos indisponível."),
    averageTicket: metricValue(metrics.averageTicket, "Ticket médio indisponível."),
    contributionMargin: metricValue(metrics.contributionMargin, "Margem de contribuição indisponível."),
    opportunities: controlCount(control, open, "Oportunidades do Charlie ainda não foram lidas."),
    recoveredCustomers: controlCount(
      control,
      (opportunities) => opportunities.filter((item) => item?.type === "customer_recovery" && item.status === "converted"),
      "Recuperações convertidas ainda não foram lidas.",
    ),
    marketplaces: dashboard && Array.isArray(dashboard.channels)
      ? { available: true, value: dashboard.channels, reason: "" }
      : { available: false, value: null, reason: "Pedidos por marketplace ainda não foram lidos." },
    problemProducts: Array.isArray(control?.opportunities)
      ? { available: true, value: new Set(open(control.opportunities).map((item) => item.productId).filter(Boolean)).size, reason: "" }
      : { available: false, value: null, reason: "Produtos com oportunidade em aberto ainda não foram lidos." },
    criticalAlerts: controlCount(
      control,
      (opportunities) => open(opportunities).filter((item) => item.priority === "critical"),
      "Alertas críticos ainda não foram lidos.",
    ),
    executedActions: executed,
  };
}

export function listSalesAlerts(opportunities = []) {
  return opportunities
    .filter((item) => item && !CLOSED_OPPORTUNITY.has(item.status))
    .slice()
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function listSalesAudit(actions = []) {
  const rows = [];
  for (const action of actions || []) {
    if (!action) continue;
    const history = Array.isArray(action.history) ? action.history : [];
    if (!history.length) {
      rows.push({ at: action.createdAt || "", actionId: action.id || "", event: action.status || "registrada", actor: action.createdBy || "", description: action.description || "" });
      continue;
    }
    for (const entry of history) {
      rows.push({ at: entry?.at || "", actionId: action.id || "", event: entry?.event || "", actor: entry?.actor || "", description: action.description || "" });
    }
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function describeEcommercePermissions(permissions = {}) {
  const line = (ids) => {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter((id) => id > 0);
    return list.length ? list.join(", ") : "Qualquer usuário com permissão gerencial";
  };
  return {
    approve: line(permissions.approveUserIds),
    execute: line(permissions.executeUserIds),
    configure: line(permissions.configureUserIds),
  };
}

export function salesPriorityLabel(priority) {
  return { critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" }[priority] || "Não classificada";
}

export function salesStatusLabel(status) {
  return {
    identified: "Identificada",
    converted: "Convertida",
    dismissed: "Encerrada",
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Rejeitada",
    executed: "Executada",
    applied: "Aplicada",
    failed: "Falhou",
    reverted: "Revertida",
    draft: "Rascunho",
    open: "Em aberto",
    suggested: "Sugestão pronta",
    manual: "Execução manual",
    resolved: "Resolvida",
  }[status] || status || "Sem status";
}
