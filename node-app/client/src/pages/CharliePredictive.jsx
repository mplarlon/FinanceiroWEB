import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const quality = (value) => ({ adequada: "Adequada", limitada: "Limitada", insuficiente: "Insuficiente" }[value] || value || "—");

function LineChart({ history = [], forecast = [] }) {
  const points = useMemo(() => [...history.slice(-60).map((x) => ({ value: x.value, kind: "history" })), ...forecast.map((x) => ({ value: x.central, lower: x.lower, upper: x.upper, kind: "forecast" }))], [history, forecast]);
  if (points.length < 2) return null;
  const maximum = Math.max(1, ...points.flatMap((point) => [point.value, point.upper || 0]));
  const xy = (items, field = "value", offset = 0) => items.map((point, index) => `${((index + offset) / (points.length - 1)) * 100},${100 - Number(point[field] || 0) / maximum * 90}`).join(" ");
  const historical = points.filter((point) => point.kind === "history");
  const predicted = points.filter((point) => point.kind === "forecast");
  const offset = Math.max(0, historical.length - 1);
  return <div className="predictive-chart">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Histórico e previsão">
      <polyline className="history" points={xy(historical)} />
      <polyline className="upper" points={xy(predicted, "upper", offset)} />
      <polyline className="forecast" points={xy(predicted, "value", offset)} />
      <polyline className="lower" points={xy(predicted, "lower", offset)} />
    </svg>
    <div className="predictive-legend"><span className="history">Histórico</span><span className="forecast">Previsão central</span><span className="upper">Otimista</span><span className="lower">Conservador</span></div>
  </div>;
}

function Assumptions({ items }) { return items?.length ? <ul className="predictive-assumptions">{items.map((item) => <li key={item}>{item}</li>)}</ul> : null; }

export default function CharliePredictive({ open, onClose }) {
  const [tab, setTab] = useState("revenue");
  const [horizon, setHorizon] = useState(30);
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adjustment, setAdjustment] = useState({ date: new Date().toISOString().slice(0, 10), value: -20000 });
  async function load(nextTab = tab) {
    setBusy(true); setError("");
    try {
      const paths = { revenue: `/ia/previsoes/faturamento?horizon=${horizon}`, cash: `/ia/previsoes/fluxo-caixa?horizon=${horizon}`, stock: "/ia/previsoes/estoque", customers: "/ia/previsoes/clientes" };
      setData(await api.get(paths[nextTab]));
    } catch (e) { setError(e.message); setData(null); } finally { setBusy(false); }
  }
  async function simulateFinancial() {
    setBusy(true); setError("");
    try { setData(await api.post("/ia/simulacoes/financeiras", { horizon, adjustments: [{ date: adjustment.date, value: Number(adjustment.value) }] })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { if (open) { load(tab); api.get("/ia/previsoes/historico?limite=30").then((x) => setHistory(x.predictions || [])).catch(() => {}); } }, [open]);
  if (!open) return null;
  const switchTab = (value) => { setTab(value); setData(null); setTimeout(() => load(value), 0); };
  return <div className="charlie-modal-backdrop"><section className="charlie-modal charlie-predictive">
    <header><div><h2>Previsões e Simulações</h2><p>Projeções verificáveis, cenários somente leitura e histórico de qualidade.</p></div><button onClick={onClose}>Fechar</button></header>
    <nav className="predictive-tabs">
      {[['revenue','Faturamento'],['cash','Fluxo de caixa'],['stock','Estoque e compras'],['customers','Clientes'],['history','Histórico']].map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => id === "history" ? setTab(id) : switchTab(id)}>{label}</button>)}
    </nav>
    {tab !== "history" && <div className="predictive-controls"><label>Horizonte <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="90">3 meses</option><option value="180">6 meses</option></select></label><button className="primary" disabled={busy} onClick={() => load()}>{busy ? "Calculando..." : "Recalcular"}</button></div>}
    {error && <div className="error">{error}</div>}
    {tab === "revenue" && data && <>
      <div className="predictive-kpis"><article><span>Estimativa central</span><strong>{money(data.total)}</strong></article><article><span>Faixa provável</span><strong>{money(data.interval?.lower)} – {money(data.interval?.upper)}</strong></article><article><span>Modelo</span><strong>{data.model || "Não selecionado"}</strong></article><article><span>Qualidade</span><strong>{quality(data.quality?.status)}</strong></article></div>
      {data.ok ? <LineChart history={data.history} forecast={data.forecasts} /> : <p>{data.message}</p>}
      <p className="predictive-disclaimer">{data.disclaimer}</p><Assumptions items={data.assumptions} />
    </>}
    {tab === "cash" && data?.scenarios && <>
      <div className="predictive-kpis">{Object.entries(data.scenarios).map(([key,item]) => <article key={key}><span>{({ optimistic: "Otimista", base: "Base", conservative: "Conservador" })[key]}</span><strong>{money(item.closingBalance)}</strong><small>{item.firstNegativeDate ? `Negativo em ${date(item.firstNegativeDate)}` : "Sem saldo negativo no horizonte"}</small></article>)}</div>
      <div className="scenario-form"><label>Data do ajuste<input type="date" value={adjustment.date} onChange={(e) => setAdjustment({ ...adjustment, date: e.target.value })} /></label><label>Valor (receita + / despesa -)<input type="number" value={adjustment.value} onChange={(e) => setAdjustment({ ...adjustment, value: e.target.value })} /></label><button onClick={simulateFinancial}>Simular sem lançar</button></div>
      <Assumptions items={data.assumptions} />
    </>}
    {tab === "cash" && data?.scenarioId && <><p><strong>Cenário {data.scenarioId}</strong> — nenhum lançamento foi alterado.</p><div className="table-scroll"><table className="tabela"><thead><tr><th>Data</th><th>Base</th><th>Ajuste</th><th>Simulado</th></tr></thead><tbody>{(data.scenarios?.base || []).slice(0,90).map((row) => <tr key={row.date}><td>{date(row.date)}</td><td>{money(row.baseBalance)}</td><td>{money(row.adjustment)}</td><td>{money(row.simulatedBalance)}</td></tr>)}</tbody></table></div></>}
    {tab === "stock" && data && <><div className="predictive-kpis"><article><span>Risco alto</span><strong>{data.items?.filter((x) => x.risk === "alto").length || 0}</strong></article><article><span>Qualidade</span><strong>{quality(data.quality?.status)}</strong></article></div><div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Disponível</th><th>Consumo/dia</th><th>Cobertura</th><th>Lead time</th><th>Risco</th><th>Compra sugerida</th></tr></thead><tbody>{data.items?.slice(0,100).map((row) => <tr key={row.productId}><td>{row.product}</td><td>{row.available}</td><td>{row.dailyDemand}</td><td>{row.coverageDays == null ? "Sem consumo" : `${row.coverageDays} dias`}</td><td>{row.leadTimeDays} dias</td><td><b className={`risk-${row.risk}`}>{row.risk}</b></td><td>{row.suggestedPurchase}</td></tr>)}</tbody></table></div><Assumptions items={data.assumptions} /></>}
    {tab === "customers" && data && <><div className="predictive-kpis"><article><span>Risco estimado</span><strong>{data.customers?.filter((x) => x.classification === "risco_inatividade").length || 0}</strong></article><article><span>Qualidade</span><strong>{quality(data.quality?.status)}</strong></article></div><div className="table-scroll"><table className="tabela"><thead><tr><th>Cliente</th><th>Última compra</th><th>Dias sem comprar</th><th>Intervalo típico</th><th>Classificação</th></tr></thead><tbody>{data.customers?.map((row) => <tr key={row.customerId}><td>{row.customer}</td><td>{date(row.lastPurchase)}</td><td>{row.daysSinceLastPurchase}</td><td>{row.meanIntervalDays}</td><td>{row.classification.replaceAll("_", " ")}</td></tr>)}</tbody></table></div><Assumptions items={data.assumptions} /></>}
    {tab === "history" && <div className="table-scroll"><table className="tabela"><thead><tr><th>Gerada em</th><th>Indicador</th><th>Modelo</th><th>Qualidade</th><th>Previsto</th><th>Realizado</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td>{new Date(row.generatedAt).toLocaleString("pt-BR")}</td><td>{row.indicator}</td><td>{row.model} v{row.modelVersion}</td><td>{quality(row.quality?.status)}</td><td>{row.result?.total != null ? money(row.result.total) : JSON.stringify(row.result)}</td><td>{row.actual == null ? "Pendente" : money(row.actual)}</td></tr>)}</tbody></table>{!history.length && <p>Nenhuma previsão registrada.</p>}</div>}
  </section></div>;
}
