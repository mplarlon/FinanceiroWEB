import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "—" : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const date = (value) => value ? new Date(value).toLocaleDateString("pt-BR") : "Sem venda no período";
const typeLabel = {
  perda_verificada: "Perda verificada",
  margem_insuficiente: "Margem insuficiente",
  risco_financeiro: "Risco financeiro",
  capital_imobilizado: "Capital imobilizado",
  oportunidade_economia: "Oportunidade de economia",
};

export default function CharlieProfitability({ open, onClose, onInvestigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [idleDays, setIdleDays] = useState(90);
  const [minimumMargin, setMinimumMargin] = useState(15);
  const [selected, setSelected] = useState(null);
  async function load() {
    setLoading(true); setError(""); setSelected(null);
    try { setData(await api.get("/ia/rentabilidade", { dias: days, paradoDias: idleDays, margemMinima: minimumMargin })); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) load(); }, [open]);
  const products = useMemo(() => {
    const grouped = new Map();
    for (const item of data?.occurrences || []) grouped.set(item.product, (grouped.get(item.product) || 0) + Math.abs(Math.min(0, item.contributionMargin)));
    return [...grouped].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [data]);
  if (!open) return null;
  const indicators = data?.indicators || {};
  const maxProduct = Math.max(1, ...products.map((item) => item[1]));
  return (
    <div className="charlie-modal-backdrop" role="presentation">
      <section className="charlie-modal charlie-profitability" role="dialog" aria-modal="true" aria-label="Análise de Rentabilidade e Perdas">
        <header className="charlie-profitability-header">
          <div><h2>Análise de Rentabilidade e Perdas</h2><p>Regras determinísticas, valores rastreáveis e categorias sem dupla contagem.</p></div>
          <button type="button" onClick={onClose}>Fechar</button>
        </header>
        <form className="profitability-filters" onSubmit={(event) => { event.preventDefault(); load(); }}>
          <label><span>Vendas</span><select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="180">180 dias</option><option value="365">365 dias</option></select></label>
          <label><span>Estoque parado</span><select value={idleDays} onChange={(e) => setIdleDays(e.target.value)}><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="180">180 dias</option><option value="365">365 dias</option></select></label>
          <label><span>Margem mínima</span><span className="profitability-margin"><input type="number" min="-100" max="100" value={minimumMargin} onChange={(e) => setMinimumMargin(e.target.value)} /><span>%</span></span></label>
          <button className="primary" disabled={loading}>{loading ? "Analisando..." : "Atualizar análise"}</button>
        </form>
        {error ? <div className="error">{error}</div> : null}
        {data ? <>
          <div className="profitability-kpis">
            <article className="loss"><small>Resultado negativo identificado · {days} dias</small><strong>{money(indicators.verifiedNegativeResult)}</strong><span>{indicators.negativeSales || 0} ocorrência(s)</span></article>
            <article className="margin"><small>Margem insuficiente · abaixo de {minimumMargin}%</small><strong>{indicators.insufficientMarginSales || 0}</strong><span>vendas/itens</span></article>
            <article className="capital"><small>Capital imobilizado estimado · {idleDays} dias</small><strong>{money(indicators.tiedCapital)}</strong><span>{indicators.idleProducts || 0} produto(s)</span></article>
            <article className="critical"><small>Ocorrências críticas · {days} dias</small><strong>{indicators.criticalOccurrences || 0}</strong><span>requerem revisão</span></article>
          </div>
          {products.length ? <section className="profitability-chart"><h3>Principais produtos por contribuição negativa</h3>{products.map(([name, value]) => <div className="profitability-bar" key={name}><span>{name}</span><i style={{ width: `${Math.max(2, value / maxProduct * 100)}%` }} /><b>{money(value)}</b></div>)}</section> : null}
          <section className="profitability-list"><h3>Estoque parado — {data.idleStock?.length || 0} produto(s)</h3>
            {(data.idleStock || []).length ? <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Quantidade</th><th>Custo de avaliação</th><th>Capital estimado</th><th>Última venda</th></tr></thead><tbody>{data.idleStock.map((item) => <tr key={item.CDPRODUTO}><td>{item.PRODUTO}</td><td>{Number(item.QUANTIDADE || 0).toLocaleString("pt-BR")}</td><td>{money(item.CUSTO_AVALIACAO)}</td><td>{money(item.CAPITAL_IMOBILIZADO)}</td><td>{date(item.ULTIMA_VENDA)}</td></tr>)}</tbody></table></div> : <p>Nenhum produto encontrado ou estrutura de filial indisponível.</p>}
          </section>
          <section className="profitability-list"><h3>Ocorrências de venda — {data.occurrences?.length || 0}</h3>
            {(data.occurrences || []).length ? <div className="table-scroll"><table className="tabela"><thead><tr><th>Categoria</th><th>Venda/data</th><th>Produto</th><th>Cliente / vendedor</th><th>Receita líquida</th><th>Contribuição</th><th>Margem</th><th /></tr></thead><tbody>
              {data.occurrences.map((item) => <tr key={item.id}><td><span className={`impact-tag ${item.type}`}>{typeLabel[item.type]}</span></td><td>#{item.sale}<small>{date(item.date)}</small></td><td>{item.product}<small>Qtd. {item.quantity}</small></td><td>{item.customer}<small>{item.seller}</small></td><td>{money(item.netRevenue)}</td><td className={item.contributionMargin < 0 ? "negative-value" : ""}>{money(item.contributionMargin)}</td><td>{pct(item.marginPercent)}</td><td><button type="button" onClick={async () => { const result = await api.get(`/ia/rentabilidade/ocorrencias/${encodeURIComponent(item.id)}`, { dias: days, margemMinima: minimumMargin }); setSelected(result); }}>Investigar com Charlie</button></td></tr>)}
            </tbody></table></div> : <p>Nenhuma venda com resultado negativo ou margem abaixo do limite neste período.</p>}
          </section>
          <details className="profitability-limitations"><summary>Critérios e limitações</summary><ul>{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
        </> : null}
        {selected ? <aside className="profitability-investigation"><button className="close" onClick={() => setSelected(null)}>×</button><h3>{selected.investigation.title}</h3><p>{selected.investigation.explanation}</p><dl>{Object.entries(selected.investigation.composition).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd>{key === "percentual" ? pct(value) : money(value)}</dd></div>)}</dl><p><strong>Origem:</strong> {selected.investigation.evidence.join(", ")}.</p>{selected.investigation.missing.length ? <p><strong>Componentes indisponíveis:</strong> {selected.investigation.missing.join(", ")}.</p> : null}<small>{selected.investigation.disclaimer}</small><button className="primary" onClick={() => onInvestigate?.(selected.occurrence)}>Continuar na conversa</button></aside> : null}
      </section>
    </div>
  );
}
