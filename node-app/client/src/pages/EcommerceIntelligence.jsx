import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const integer = (value) => Number(value || 0).toLocaleString("pt-BR");
const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Não executada";

function Metric({ title, metric, format = integer }) {
  const available = metric?.available !== false;
  return <article className={!available ? "unavailable" : ""} title={metric?.reason || ""}>
    <span>{title}</span>
    <strong>{available ? format(metric?.value) : "Indisponível"}</strong>
    <small>{available ? "Dados sincronizados da Tray" : metric?.reason}</small>
  </article>;
}

export default function EcommerceIntelligence({ connected, onSynchronized }) {
  const now = useMemo(() => new Date(), []);
  const [filters, setFilters] = useState({
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10), marketplace: "", status: "", product: "", customer: "", category: "", brand: "",
  });
  const [data, setData] = useState(null);
  const [advanced, setAdvanced] = useState(null);
  const [control, setControl] = useState(null);
  const [section, setSection] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(next = filters) {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams(Object.entries(next).filter(([, value]) => value)).toString();
      const result = await api.get(`/tray/intelligence/dashboard${query ? `?${query}` : ""}`);
      setData(result.dashboard);
      const controlResult = await api.get("/tray/intelligence/control");
      setControl(controlResult);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function synchronize(mode = "incremental") {
    setBusy(true); setError("");
    try {
      await api.post("/tray/sincronizar", { mode });
      await load(filters);
      onSynchronized?.();
    } catch (cause) { setError(cause.message); setBusy(false); }
  }
  async function analyze() {
    setBusy(true); setError("");
    try { const result = await api.get("/tray/intelligence/analysis"); setAdvanced(result.analysis); const next = await api.get("/tray/intelligence/control"); setControl(next); setSection("opportunities"); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function decide(action, decision) {
    setBusy(true); setError("");
    try { await api.post(`/tray/intelligence/actions/${action.id}/decision`, { decision }); setControl(await api.get("/tray/intelligence/control")); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function execute(action, operation = "execute") {
    setBusy(true); setError("");
    try { await api.post(`/tray/intelligence/actions/${action.id}/${operation}`); setControl(await api.get("/tray/intelligence/control")); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function saveSettings(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api.put("/tray/intelligence/settings", control.settings); setControl((current) => ({ ...current, settings: result.settings })); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  const change = (field) => (event) => setFilters((current) => ({ ...current, [field]: event.target.value }));
  const metrics = data?.metrics || {};

  return <div className="ecommerce-intelligence">
    <section className="ecommerce-hero">
      <div><span className="tray-kicker">CHARLIE • E-COMMERCE INTELLIGENCE</span><h2>Visão consolidada de vendas online</h2><p>Indicadores determinísticos calculados sobre os pedidos reais sincronizados pela integração Tray.</p></div>
      <div className="ecommerce-sync"><small>Última sincronização</small><b>{dateTime(data?.sync?.lastSuccessAt)}</b><button type="button" disabled={busy || !connected} onClick={() => synchronize(data?.sync?.lastSuccessAt ? "incremental" : "initial")}>{busy ? "Processando..." : "Sincronizar agora"}</button></div>
    </section>

    <nav className="tray-sections ecommerce-nav" aria-label="Áreas do Charlie E-Commerce Intelligence">
      {[['dashboard','Dashboard'],['opportunities','Oportunidades'],['pricing','Preços e estoque'],['actions','Central de ações'],['campaigns','Campanhas'],['results','Resultados'],['settings','Configurações']].map(([key,label]) => <button type="button" key={key} className={section === key ? "ativo" : ""} onClick={() => setSection(key)}>{label}</button>)}
      <button type="button" onClick={analyze} disabled={busy || !connected}>{busy ? "Analisando..." : "Executar análise Charlie"}</button>
    </nav>

    {section === "dashboard" && <><form className="panel ecommerce-filters" onSubmit={(event) => { event.preventDefault(); load(filters); }}>
      <label>De<input type="date" value={filters.start} onChange={change("start")} /></label>
      <label>Até<input type="date" value={filters.end} onChange={change("end")} /></label>
      <label>Marketplace<select value={filters.marketplace} onChange={change("marketplace")}><option value="">Todos</option>{data?.filters?.marketplaces?.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Status<select value={filters.status} onChange={change("status")}><option value="">Todos</option>{data?.filters?.statuses?.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Produto<input value={filters.product} onChange={change("product")} placeholder="Nome ou referência" /></label>
      <label>Cliente<input value={filters.customer} onChange={change("customer")} placeholder="Nome ou código" /></label>
      <label>Categoria<select value={filters.category} onChange={change("category")}><option value="">Todas</option>{data?.filters?.categories?.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Marca<select value={filters.brand} onChange={change("brand")}><option value="">Todas</option>{data?.filters?.brands?.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button disabled={busy}>{busy ? "Atualizando..." : "Aplicar filtros"}</button>
    </form>
    {error && <div className="error">{error}</div>}

    <section className="ecommerce-kpis">
      <Metric title="Faturamento" metric={metrics.revenue} format={money} />
      <Metric title="Pedidos" metric={metrics.orders} />
      <Metric title="Ticket médio" metric={metrics.averageTicket} format={money} />
      <Metric title="Margem de contribuição" metric={metrics.contributionMargin} format={(value) => `${value}%`} />
      <Metric title="Lucro operacional" metric={metrics.operatingProfit} format={money} />
      <Metric title="Cancelados" metric={metrics.canceledOrders} />
      <Metric title="Pendentes" metric={metrics.pendingOrders} />
    </section>

    <div className="ecommerce-columns">
      <section className="panel ecommerce-table"><header><h3>Desempenho por marketplace</h3><small>Origem identificada nos dados do pedido</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>Canal</th><th>Pedidos</th><th className="money-cell">Faturamento</th><th className="money-cell">Ticket médio</th></tr></thead><tbody>{data?.channels?.length ? data.channels.map((item) => <tr key={item.marketplace}><td><b>{item.marketplace}</b></td><td>{integer(item.orders)}</td><td className="money-cell">{money(item.revenue)}</td><td className="money-cell">{money(item.orders ? item.revenue / item.orders : 0)}</td></tr>) : <tr><td colSpan="4">Nenhum pedido encontrado para os filtros.</td></tr>}</tbody></table></div></section>
      <section className="panel ecommerce-table"><header><h3>Produtos mais vendidos</h3><small>Ordenados pela quantidade</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Referência</th><th>Quantidade</th><th className="money-cell">Receita</th></tr></thead><tbody>{data?.topProducts?.length ? data.topProducts.map((item) => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.reference || "-"}</td><td>{integer(item.quantity)}</td><td className="money-cell">{money(item.revenue)}</td></tr>) : <tr><td colSpan="4">Itens de pedido ainda não sincronizados.</td></tr>}</tbody></table></div></section>
    </div>

    {data?.unavailable?.length > 0 && <section className="panel ecommerce-limits"><h3>Indicadores aguardando dados</h3><p>{data.unavailable.join(" • ")}</p><small>Esses valores não são estimados nem preenchidos artificialmente. Serão habilitados quando as fontes necessárias estiverem disponíveis.</small></section>}</>}

    {section === "opportunities" && <section className="panel ecommerce-table"><header><h3>Oportunidades identificadas</h3><small>{control?.opportunities?.length || 0} registros deduplicados</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>Prioridade</th><th>Tipo</th><th>Descrição</th><th>Evidências</th><th>Recomendação</th><th>Status</th></tr></thead><tbody>{control?.opportunities?.length ? control.opportunities.map((item) => <tr key={item.id}><td><b>{item.priority}</b></td><td>{item.type}</td><td>{item.description}</td><td><small>{JSON.stringify(item.evidence)}</small></td><td>{item.recommendation}</td><td>{item.status}</td></tr>) : <tr><td colSpan="6">Execute a análise para identificar oportunidades.</td></tr>}</tbody></table></div></section>}

    {section === "pricing" && <section className="panel ecommerce-table"><header><h3>Inteligência de preços e estoque</h3><small>Cálculos determinísticos; margens incompletas são estimativas</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Preço</th><th>Custo</th><th>Margem</th><th>Estoque</th><th>Cobertura</th><th>Risco</th></tr></thead><tbody>{advanced?.products?.length ? advanced.products.map((item) => <tr key={item.externalId}><td><b>{item.name}</b></td><td>{money(item.price)}</td><td>{item.cost === null ? "Indisponível" : money(item.cost)}</td><td>{item.contributionMargin === null ? "Indisponível" : `${item.contributionMargin.toFixed(1)}% estimada`}</td><td>{integer(item.stock)}</td><td>{item.coverageDays === null ? "Indisponível" : `${item.coverageDays.toFixed(1)} dias`}</td><td>{item.stockRisk}</td></tr>) : <tr><td colSpan="7">Execute a análise Charlie para calcular esta visão.</td></tr>}</tbody></table></div></section>}

    {section === "actions" && <section className="panel ecommerce-table"><header><h3>Central de ações</h3><small>Aprovação e execução validadas no backend</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>ID</th><th>Tipo</th><th>Prioridade</th><th>Descrição</th><th>Status</th><th>Resultado e histórico</th><th>Ações</th></tr></thead><tbody>{control?.actions?.length ? control.actions.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.type}</td><td>{item.priority}</td><td>{item.description}</td><td>{item.status}</td><td>{item.result?.error || item.result?.notice || (item.result?.ok ? "Sucesso" : "-")}<details><summary>Histórico</summary>{item.history?.map((entry,index) => <div key={`${entry.at}-${index}`}><small>{dateTime(entry.at)} — {entry.event} — {entry.actor}</small></div>)}</details></td><td className="ecommerce-action-buttons">{item.status === "pending" && <><button onClick={() => decide(item,"approve")}>Aprovar</button><button className="secondary" onClick={() => decide(item,"reject")}>Rejeitar</button></>}{item.status === "approved" && <button onClick={() => execute(item)}>Executar</button>}{item.status === "executed" && item.type === "price" && <button className="secondary" onClick={() => execute(item,"revert")}>Reverter</button>}</td></tr>) : <tr><td colSpan="7">Nenhuma ação preparada.</td></tr>}</tbody></table></div></section>}

    {section === "campaigns" && <section className="panel ecommerce-table"><header><h3>Campanhas inteligentes</h3><small>Somente rascunhos; nenhuma publicação ou mensagem automática</small></header><div className="table-scroll"><table className="tabela"><thead><tr><th>Campanha</th><th>Objetivo</th><th>Público</th><th>Status</th><th>Comunicação autorizada</th></tr></thead><tbody>{control?.campaigns?.length ? control.campaigns.map((item) => <tr key={item.id}><td><b>{item.name}</b></td><td>{item.objective}</td><td>{item.audience}</td><td>{item.status}</td><td>{item.externalCommunicationAuthorized ? "Sim" : "Não"}</td></tr>) : <tr><td colSpan="5">Nenhuma campanha preparada.</td></tr>}</tbody></table></div></section>}

    {section === "results" && <section className="ecommerce-kpis"><Metric title="Oportunidades" metric={{ value: control?.results?.opportunities || 0 }} /><Metric title="Convertidas" metric={{ value: control?.results?.convertedOpportunities || 0 }} /><Metric title="Ações executadas" metric={{ value: control?.results?.executedActions || 0 }} /><Metric title="Ações rejeitadas" metric={{ value: control?.results?.rejectedActions || 0 }} /><Metric title="Campanhas" metric={{ value: control?.results?.campaigns || 0 }} /><Metric title="Receita observada" metric={{ value: control?.results?.observedRevenue || 0 }} format={money} /><Metric title="Potencial estimado" metric={{ value: control?.results?.estimatedRevenue || 0 }} format={money} /></section>}

    {section === "settings" && control?.settings && <form className="panel ecommerce-settings" onSubmit={saveSettings}><h3>Configurações de automação</h3><label>Modo<select value={control.settings.mode} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,mode:e.target.value}}))}><option value="analysis">Apenas análise</option><option value="manual">Aprovação manual</option><option value="automatic">Automático dentro dos limites</option></select></label><label>Margem mínima (%)<input type="number" min="0" max="90" value={control.settings.minimumMargin} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,minimumMargin:e.target.value}}))} /></label><label>Alteração automática máxima (%)<input type="number" min="0" max="20" value={control.settings.maximumAutomaticChange} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,maximumAutomaticChange:e.target.value}}))} /></label><label>Cliente inativo após (dias)<input type="number" min="15" max="730" value={control.settings.inactiveCustomerDays} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,inactiveCustomerDays:e.target.value}}))} /></label><label>Relatório diário<input type="time" value={control.settings.dailyReportTime} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,dailyReportTime:e.target.value}}))} /></label><label>E-mails de notificação<input value={control.settings.notification?.emails || ""} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,notification:{...current.settings.notification,emails:e.target.value}}}))} placeholder="gestor@empresa.com" /></label><label className="tray-check"><input type="checkbox" checked={control.settings.autoAnalysis} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,autoAnalysis:e.target.checked}}))} /> Análises automáticas</label><label className="tray-check"><input type="checkbox" checked={control.settings.notifications} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,notifications:e.target.checked}}))} /> Notificações</label><label className="tray-check"><input type="checkbox" checked={control.settings.notification?.email || false} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,notification:{...current.settings.notification,email:e.target.checked}}}))} /> Canal e-mail</label><label className="tray-check"><input type="checkbox" checked={control.settings.notification?.sendReal || false} onChange={(e) => setControl((current) => ({...current,settings:{...current.settings,notification:{...current.settings.notification,sendReal:e.target.checked}}}))} /> Autorizar envio real configurado</label><button disabled={busy}>Salvar configurações</button></form>}
  </div>;
}
