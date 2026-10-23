import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const quality = (value) => ({ adequada: "Adequada", limitada: "Limitada", insuficiente: "Insuficiente" }[value] || value || "—");

function weekStart(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return date.toISOString().slice(0, 10);
}

function shortDate(iso) {
  const [, month, day] = String(iso).slice(0, 10).split("-");
  return `${day}/${month}`;
}

function compactMoney(value) {
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `R$ ${(amount / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1000) return `R$ ${(amount / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

const weekRate = (sum, days) => days ? sum / days * 7 : 0;

function weeklyBuckets(history, forecast) {
  const historyDays = Math.min(84, Math.max(56, forecast.length));
  const buckets = new Map();
  const bucketFor = (iso) => {
    const key = weekStart(iso);
    if (!key) return null;
    if (!buckets.has(key)) buckets.set(key, { key, history: 0, historyDays: 0, central: 0, lower: 0, upper: 0, forecastDays: 0 });
    return buckets.get(key);
  };
  for (const point of history.slice(-historyDays)) {
    const bucket = bucketFor(point.date);
    if (!bucket) continue;
    bucket.history += Number(point.value) || 0;
    bucket.historyDays += 1;
  }
  for (const point of forecast) {
    const bucket = bucketFor(point.date);
    if (!bucket) continue;
    bucket.central += Number(point.central) || 0;
    bucket.lower += Number(point.lower) || 0;
    bucket.upper += Number(point.upper) || 0;
    bucket.forecastDays += 1;
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map((week) => ({
    ...week,
    historyRate: weekRate(week.history, week.historyDays),
    centralRate: weekRate(week.central, week.forecastDays),
    lowerRate: weekRate(week.lower, week.forecastDays),
    upperRate: weekRate(week.upper, week.forecastDays),
  }));
}

function ForecastChart({ history = [], forecast = [] }) {
  const weeks = useMemo(() => weeklyBuckets(history, forecast), [history, forecast]);
  if (weeks.length < 2) return null;
  const maximum = Math.max(1, ...weeks.flatMap((week) => [week.historyRate, week.upperRate, week.centralRate]));
  const width = 760;
  const height = 286;
  const pad = { top: 18, right: 16, bottom: 36, left: 78 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / weeks.length;
  const barW = Math.min(26, slot * 0.42);
  const y = (value) => pad.top + innerH - (Number(value) || 0) / maximum * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maximum * ratio);
  const firstForecast = weeks.findIndex((week) => week.forecastDays > 0);
  const labelStep = Math.max(1, Math.ceil(46 / slot));
  return <div className="predictive-chart">
    <p className="predictive-chart-caption">Ritmo semanal do faturamento. A coluna é o realizado levado a 7 dias; a faixa é o intervalo da previsão e o traço azul é a estimativa. Passe o mouse para ver a soma dos dias.</p>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Faturamento semanal e faixa de previsão">
      {ticks.map((value) => <g key={value}>
        <line className="grid" x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} />
        <text x={pad.left - 8} y={y(value)} textAnchor="end" dominantBaseline="middle">{compactMoney(value)}</text>
      </g>)}
      {firstForecast > 0 && <line className="today" x1={pad.left + firstForecast * slot} x2={pad.left + firstForecast * slot} y1={pad.top} y2={pad.top + innerH} />}
      {weeks.map((week, index) => {
        const center = pad.left + index * slot + slot / 2;
        const dual = week.historyDays > 0 && week.forecastDays > 0;
        const historyX = dual ? center - barW - 2 : center - barW / 2;
        const forecastX = dual ? center + 2 : center - barW / 2;
        const partial = week.historyDays > 0 && week.historyDays < 7;
        return <g key={week.key}>
          {week.historyDays > 0 && <rect className={partial ? "history-bar partial" : "history-bar"} x={historyX} y={y(week.historyRate)} width={barW} height={Math.max(0, y(0) - y(week.historyRate))} rx="3">
            <title>{`Semana de ${shortDate(week.key)}: ${money(week.history)} em ${week.historyDays} dia(s). Ritmo de ${money(week.historyRate)} na semana.`}</title>
          </rect>}
          {week.forecastDays > 0 && <>
            <rect className="forecast-band" x={forecastX} y={y(week.upperRate)} width={barW} height={Math.max(2, y(week.lowerRate) - y(week.upperRate))} rx="3">
              <title>{`Semana de ${shortDate(week.key)}: estimativa ${money(week.centralRate)}, entre ${money(week.lowerRate)} e ${money(week.upperRate)} no ritmo de 7 dias.`}</title>
            </rect>
            <line className="forecast-mark" x1={forecastX - 2} x2={forecastX + barW + 2} y1={y(week.centralRate)} y2={y(week.centralRate)} />
          </>}
          {(index % labelStep === 0 || index === weeks.length - 1) && <text className="axis" x={center} y={height - 12} textAnchor="middle">{shortDate(week.key)}</text>}
        </g>;
      })}
    </svg>
    <div className="predictive-legend"><span className="history">Realizado</span><span className="forecast">Estimativa da semana</span><span className="band">Faixa provável</span></div>
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
      {data.ok ? <ForecastChart history={data.history} forecast={data.forecasts} /> : <p>{data.message}</p>}
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
