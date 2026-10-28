import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => value == null || value === "" || !Number.isFinite(Number(value))
  ? "não informado"
  : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = value => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function Metric({ label, value }) {
  return <article className="metric"><small>{label}</small><strong>{value}</strong></article>;
}

function Sales({ data }) {
  const k = data.kpis || {};
  return <>
    <section className="grid">
      <Metric label="Faturamento" value={money(k.faturamento_total)} />
      <Metric label="Lucro bruto" value={money(k.lucro_bruto)} />
      <Metric label="Margem" value={k.margem_lucro === null ? "não informado" : `${number(k.margem_lucro)}%`} />
      <Metric label="Pedidos" value={number(k.quantidade_vendas)} />
      <Metric label="Ticket médio" value={money(k.ticket_medio)} />
    </section>
    <section className="dashboard-columns">
      <article className="panel"><h2>Produtos mais vendidos</h2><table className="tabela"><thead><tr><th>Produto</th><th>Qtd.</th><th className="money-cell">Total</th></tr></thead><tbody>
        {[...(data.top_produtos || [])].sort((a, b) => (a.TOTAL == null) - (b.TOTAL == null) || Number(b.TOTAL) - Number(a.TOTAL)).map(p => <tr key={p.CODIGO}><td>{p.CODIGO} — {p.PRODUTO}</td><td>{number(p.QTD)}</td><td className="money-cell">{money(p.TOTAL)}</td></tr>)}
      </tbody></table></article>
      <article className="panel"><h2>Vendedores</h2><table className="tabela"><thead><tr><th>Vendedor</th><th>Pedidos</th><th className="money-cell">Total</th></tr></thead><tbody>
        {[...(data.por_vendedor || [])].sort((a, b) => (a.TOTAL == null) - (b.TOTAL == null) || Number(b.TOTAL) - Number(a.TOTAL)).map(v => <tr key={v.ID}><td>{v.NOME}</td><td>{number(v.QTD)}</td><td className="money-cell">{money(v.TOTAL)}</td></tr>)}
      </tbody></table></article>
    </section>
  </>;
}

function Purchases({ data }) {
  const k = data.kpis || {};
  return <>
    <section className="grid">
      <Metric label="Total comprado" value={money(k.total_comprado)} />
      <Metric label="Entradas" value={number(k.numero_entradas)} />
      <Metric label="Quantidade" value={number(k.quantidade_comprada)} />
      <Metric label="Estoque" value={money(k.estoque_valor)} />
      <Metric label="Abaixo do mínimo" value={number(k.estoque_abaixo_minimo)} />
    </section>
    <section className="dashboard-columns">
      <article className="panel"><h2>Fornecedores</h2><table className="tabela"><thead><tr><th>Fornecedor</th><th>Entradas</th><th className="money-cell">Total</th></tr></thead><tbody>
        {(data.fornecedores || []).map((f, i) => <tr key={f.ID || i}><td>{f.FORNECEDOR || f.NOME}</td><td>{number(f.ENTRADAS || f.QTD)}</td><td className="money-cell">{money(f.TOTAL)}</td></tr>)}
      </tbody></table></article>
      <article className="panel"><h2>Produtos comprados</h2><table className="tabela"><thead><tr><th>Produto</th><th>Qtd.</th><th className="money-cell">Total</th></tr></thead><tbody>
        {(data.produtos || []).map((p, i) => <tr key={p.CODIGO || i}><td>{p.CODIGO} — {p.PRODUTO}</td><td>{number(p.QTD)}</td><td className="money-cell">{money(p.TOTAL)}</td></tr>)}
      </tbody></table></article>
    </section>
  </>;
}

export default function BusinessDashboard({ type }) {
  const [days, setDays] = useState("custom");
  const today = new Date(), monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [customPeriod, setCustomPeriod] = useState({ data_inicio: monthStart.toISOString().slice(0, 10), data_fim: today.toISOString().slice(0, 10) });
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSales = type === "sales";

  async function load() {
    setLoading(true); setError("");
    try {
      const period = days === "custom" ? customPeriod : { dias: days };
      if (isSales) setData(await api.get("/dashboard-vendas/all", period));
      else {
        const [summary, charts] = await Promise.all([
          api.get("/dashboard-compras/summary", period),
          api.get("/dashboard-compras/charts", period)
        ]);
        setData({ ...summary, ...charts });
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <section className="panel dashboard-toolbar">
      <div><h2>{isSales ? "Desempenho de vendas" : "Desempenho de compras"}</h2><p>Indicadores do banco Firebird</p></div>
      <label>Período <select value={days} onChange={e => setDays(e.target.value === "custom" ? "custom" : Number(e.target.value))}>
        <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>12 meses</option><option value="custom">Personalizado</option>
      </select></label>
      {days === "custom" && <div className="custom-period-fields"><label>Data inicial<input type="date" value={customPeriod.data_inicio} max={customPeriod.data_fim} onChange={e => setCustomPeriod(p => ({ ...p, data_inicio: e.target.value }))} /></label><label>Data final<input type="date" value={customPeriod.data_fim} min={customPeriod.data_inicio} onChange={e => setCustomPeriod(p => ({ ...p, data_fim: e.target.value }))} /></label></div>}
      <button onClick={load} disabled={loading || (days === "custom" && (!customPeriod.data_inicio || !customPeriod.data_fim))}>{loading ? "Atualizando..." : "Atualizar"}</button>
    </section>
    {error && <div className="error">{error}</div>}
    {!error && (isSales ? <Sales data={data} /> : <Purchases data={data} />)}
  </>;
}
