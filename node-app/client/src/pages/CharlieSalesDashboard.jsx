import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import {
  DASHBOARD_WIDGETS,
  SALES_LAYOUT_KEY,
  defaultDashboardLayout,
  moveDashboardWidget,
  normalizeDashboardLayout,
  summarizeSalesDashboard,
  toggleDashboardWidget,
} from "../lib/charlie-sales-ecosystem.js";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dinheiroLido = (value) => value == null || !Number.isFinite(Number(value)) ? "Não informado" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const integer = (value) => Number(value || 0).toLocaleString("pt-BR");
const diaSp = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const percent = (value) => `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Não executada";

const widgetMeta = Object.fromEntries(DASHBOARD_WIDGETS.map((item) => [item.id, item]));

function readLayout() {
  try { return normalizeDashboardLayout(JSON.parse(localStorage.getItem(SALES_LAYOUT_KEY) || "null")); }
  catch { return defaultDashboardLayout(); }
}

function formatValue(widget, metric) {
  if (!metric?.available) return "Indisponível";
  if (widget.format === "money") return money(metric.value);
  if (widget.format === "percent") return percent(metric.value);
  return integer(metric.value);
}

function scopeText(widget, metric) {
  if (!metric?.available) return metric?.reason || "Sem leitura deste indicador.";
  if (metric.reason) return metric.reason;
  return widget.scope === "period"
    ? "Pedidos sincronizados no período."
    : "Registro do Charlie, sem recorte do período.";
}

export default function CharlieSalesDashboard({ connected, onSynchronized }) {
  const now = useMemo(() => new Date(), []);
  const hoje = diaSp(now);
  const [filters, setFilters] = useState({
    start: `${hoje.slice(0, 7)}-01`,
    end: hoje,
  });
  const [dashboard, setDashboard] = useState(null);
  const [control, setControl] = useState(null);
  const [oportunidades, setOportunidades] = useState(null);
  const [layout, setLayout] = useState(readLayout);
  const [customizing, setCustomizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function persist(next) {
    const normalized = normalizeDashboardLayout(next);
    setLayout(normalized);
    try { localStorage.setItem(SALES_LAYOUT_KEY, JSON.stringify(normalized)); } catch { /* o navegador pode bloquear o armazenamento local */ }
  }

  async function load(next = filters) {
    setBusy(true);
    setError("");
    const query = new URLSearchParams(Object.entries(next).filter(([, value]) => value)).toString();
    const [dashResult, controlResult, opportunityResult] = await Promise.allSettled([
      api.get(`/tray/intelligence/dashboard${query ? `?${query}` : ""}`),
      api.get("/tray/intelligence/control"),
      api.get("/charlie-sales-opportunities"),
    ]);
    setDashboard(dashResult.status === "fulfilled" ? dashResult.value.dashboard : null);
    setControl(controlResult.status === "fulfilled" ? controlResult.value : null);
    setOportunidades(opportunityResult.status === "fulfilled" ? opportunityResult.value : null);
    const failures = [dashResult, controlResult, opportunityResult].filter((item) => item.status === "rejected").map((item) => item.reason?.message || "Falha na leitura");
    setError(failures.join(" "));
    setBusy(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function synchronize() {
    setBusy(true);
    setError("");
    try {
      await api.post("/tray/sincronizar", { mode: dashboard?.sync?.lastSuccessAt ? "incremental" : "initial" });
      await load(filters);
      onSynchronized?.();
    } catch (cause) {
      setError(cause.message);
      setBusy(false);
    }
  }

  const summary = summarizeSalesDashboard(dashboard, control);
  const visible = layout.filter((item) => item.visible);
  const hidden = layout.filter((item) => !item.visible);

  return <div className="charlie-sales-dashboard">
    <section className="ecommerce-hero">
      <div>
        <span className="tray-kicker">VENDAS • PAINEL</span>
        <h2>Painel</h2>
        <p>Faturamento, pedidos e canais vêm dos pedidos sincronizados da Tray. Oportunidades, alertas e ações vêm do registro do Charlie.</p>
      </div>
      <div className="ecommerce-sync">
        <small>Última sincronização</small>
        <b>{dateTime(dashboard?.sync?.lastSuccessAt)}</b>
        <button type="button" disabled={busy || !connected} onClick={synchronize}>{busy ? "Processando..." : "Sincronizar agora"}</button>
      </div>
    </section>

    <form className="panel charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); load(filters); }}>
      <label>De<input type="date" value={filters.start} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} /></label>
      <label>Até<input type="date" value={filters.end} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} /></label>
      <button type="submit" disabled={busy}>{busy ? "Atualizando..." : "Aplicar período"}</button>
      <button type="button" className="secondary" onClick={() => setCustomizing((current) => !current)}>{customizing ? "Concluir personalização" : "Personalizar indicadores"}</button>
      {customizing && <button type="button" className="secondary" onClick={() => persist(defaultDashboardLayout())}>Restaurar disposição</button>}
    </form>
    {error && <div className="error">{error}</div>}

    <section className="charlie-sales-board" aria-label="Indicadores do dashboard">
      {visible.map((item) => {
        const widget = widgetMeta[item.id];
        const metric = summary[item.id];
        const index = layout.findIndex((entry) => entry.id === item.id);
        const controls = customizing && <div className="charlie-sales-layout-controls">
          <button type="button" onClick={() => persist(moveDashboardWidget(layout, item.id, -1))} disabled={index <= 0}>Subir</button>
          <button type="button" onClick={() => persist(moveDashboardWidget(layout, item.id, 1))} disabled={index < 0 || index >= layout.length - 1}>Descer</button>
          <button type="button" onClick={() => persist(toggleDashboardWidget(layout, item.id))}>Ocultar</button>
        </div>;
        if (widget.format === "channels") {
          const channels = metric?.available ? metric.value : [];
          return <section className="panel charlie-sales-wide" key={item.id}>
            <header><h3>{widget.label}</h3>{controls}</header>
            <div className="table-scroll"><table className="tabela"><thead><tr><th>Canal</th><th>Pedidos</th><th className="money-cell">Faturamento</th><th className="money-cell">Ticket médio</th></tr></thead><tbody>
              {metric?.available && channels.length ? channels.map((channel) => <tr key={channel.marketplace}><td><b>{channel.marketplace}</b>{channel.observacao ? <><br /><small>{channel.observacao}</small></> : null}</td><td>{integer(channel.orders)}</td><td className="money-cell">{dinheiroLido(channel.revenue)}</td><td className="money-cell">{dinheiroLido(channel.ticket)}</td></tr>) : <tr><td colSpan="4">{metric?.available ? "Nenhum pedido no período." : metric?.reason}</td></tr>}
            </tbody></table></div>
            <small>{scopeText(widget, metric)}</small>
          </section>;
        }
        return <article key={item.id} className={metric?.available ? "" : "unavailable"}>
          <header><span>{widget.label}</span>{controls}</header>
          <strong>{formatValue(widget, metric)}</strong>
          <small>{scopeText(widget, metric)}</small>
        </article>;
      })}
    </section>

    <section className="panel ecommerce-table">
      <header><h3>Oportunidades já gravadas</h3><small>{oportunidades?.aviso || "Lendo os registros."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Origem</th><th>Leitura</th><th>Em aberto</th><th>Encerradas</th></tr></thead><tbody>
        {(oportunidades?.fontes || []).length ? oportunidades.fontes.map((fonte) => <tr key={fonte.origem}><td>{fonte.origem}</td><td>{fonte.lida ? "Lida" : "Não lida"}</td><td>{fonte.abertas == null ? "Não lido" : fonte.abertas}</td><td>{fonte.encerradas == null ? "Não lido" : fonte.encerradas}</td></tr>) : <tr><td colSpan="4">{oportunidades ? "Nenhuma origem foi consultada." : "Aguardando os registros."}</td></tr>}
      </tbody></table></div>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Origem</th><th>Tipo em aberto</th><th>Quantidade</th></tr></thead><tbody>
        {(oportunidades?.grupos || []).length ? oportunidades.grupos.map((grupo) => <tr key={`${grupo.origem}-${grupo.tipo}`}><td>{grupo.origem}</td><td>{grupo.tipo}</td><td>{grupo.quantidade}</td></tr>) : <tr><td colSpan="3">{oportunidades ? "Não há oportunidade em aberto nestas origens." : "Aguardando os tipos."}</td></tr>}
      </tbody></table></div>
      {(oportunidades?.lacunas || []).length > 0 && <details className="charlie-sales-limites">
        <summary>Limites desta leitura</summary>
        <ul>{oportunidades.lacunas.map((lacuna) => <li key={lacuna}>{lacuna}</li>)}</ul>
      </details>}
    </section>

    {customizing && hidden.length > 0 && <section className="panel charlie-sales-hidden">
      <h3>Indicadores ocultos</h3>
      <div>{hidden.map((item) => <button type="button" key={item.id} onClick={() => persist(toggleDashboardWidget(layout, item.id))}>Mostrar {widgetMeta[item.id].label}</button>)}</div>
    </section>}
  </div>;
}
