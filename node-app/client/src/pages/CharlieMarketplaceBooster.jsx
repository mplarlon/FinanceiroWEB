import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { salesPriorityLabel, salesStatusLabel } from "../lib/charlie-sales-ecosystem.js";

const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não executada";

function actionLabel(item) {
  if (item.execution === "tray_content") return item.suggestion ? "Revisar texto" : "Otimizar";
  if (item.type === "unlisted") return "Preparar";
  return "Analisar";
}

export default function CharlieMarketplaceBooster({ connected }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const result = await api.get("/tray/booster");
    setData(result);
  }
  useEffect(() => { load().catch((cause) => setError(cause.message)); }, []);

  async function run(action, id) {
    setBusy(id || action);
    setError("");
    setNotice("");
    try {
      if (action === "analyze") {
        const result = await api.post("/tray/booster/analisar", {});
        setData(result);
        setNotice("Análise gravada com os anúncios sincronizados e o estoque do ERP.");
      } else if (action === "suggest") {
        const result = await api.post(`/tray/booster/${id}/sugerir`, {});
        setNotice(result.aviso);
        setOpenId(id);
        await load();
      } else if (action === "approve" || action === "reject") {
        await api.post(`/tray/booster/${id}/decisao`, { decision: action === "approve" ? "approve" : "reject" });
        await load();
      } else if (action === "apply" || action === "revert") {
        await api.post(`/tray/booster/${id}/${action === "apply" ? "aplicar" : "reverter"}`, {});
        await load();
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(""); }
  }

  const findings = data?.findings || [];
  const selected = findings.find((item) => item.id === openId);

  return <div className="charlie-sales-dashboard">
    <section className="ecommerce-hero">
      <div>
        <span className="tray-kicker">VENDAS • ANÚNCIOS</span>
        <h2>Anúncios</h2>
        <p>A leitura usa o catálogo sincronizado da Tray e o estoque do ERP. Texto novo só entra na loja depois da aprovação.</p>
      </div>
      <div className="ecommerce-sync">
        <small>Última análise</small>
        <b>{dateTime(data?.analyzedAt)}</b>
        <button type="button" disabled={Boolean(busy)} onClick={() => run("analyze")}>{busy === "analyze" ? "Analisando..." : "Analisar anúncios"}</button>
      </div>
    </section>
    {notice && <div className="tray-message success">{notice}</div>}
    {error && <div className="error">{error}</div>}
    {data?.limitations?.length > 0 && <details className="charlie-sales-limites">
      <summary>Limites desta leitura</summary>
      <ul>{data.limitations.map((limite) => <li key={limite}>{limite}</li>)}</ul>
    </details>}
    <section className="panel ecommerce-table">
      <header><h3>Achados</h3><small>{data ? `${findings.length} em aberto ou acompanhados` : "Lendo análise"}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Marketplace</th><th>Problema</th><th>Prioridade</th><th>Ação</th></tr></thead><tbody>
        {findings.length ? findings.map((item) => <tr key={item.id}>
          <td><b>{item.productName}</b><small>{item.reference ? ` ${item.reference}` : ""}</small></td>
          <td>{item.marketplace}</td>
          <td>{item.problem}</td>
          <td><b>{salesPriorityLabel(item.priority)}</b></td>
          <td className="ecommerce-action-buttons">
            <button type="button" onClick={() => { setOpenId(item.id); if (item.execution === "tray_content" || item.type === "unlisted") run("suggest", item.id); }} disabled={Boolean(busy)}>{busy === item.id ? "Gerando..." : actionLabel(item)}</button>
            <small>{salesStatusLabel(item.status)}</small>
          </td>
        </tr>) : <tr><td colSpan="5">{data?.analyzedAt ? "Nenhum problema comprovado na última análise." : "Execute a análise para ler os anúncios já sincronizados."}</td></tr>}
      </tbody></table></div>
    </section>
    {selected && <section className="panel charlie-booster-detail">
      <header><h3>{selected.productName}</h3><span>{selected.marketplace}</span></header>
      <p>{selected.recommendation}</p>
      {selected.limitation && <p className="charlie-sales-note">{selected.limitation}</p>}
      <p className="charlie-sales-note">Evidência: {JSON.stringify(selected.evidence)}</p>
      {selected.suggestion && <div className="charlie-booster-copy">
        <strong>Texto proposto ({selected.suggestion.source === "ollama" ? "Ollama conferido" : "cadastro"})</strong>
        <p>{selected.suggestion.name}</p>
        <p>{selected.suggestion.description}</p>
      </div>}
      <div className="ecommerce-action-buttons">
        {selected.suggestion && ["open", "suggested"].includes(selected.status) && <button type="button" onClick={() => run("approve", selected.id)} disabled={Boolean(busy)}>Aprovar</button>}
        {["open", "suggested"].includes(selected.status) && <button type="button" className="secondary" onClick={() => run("reject", selected.id)} disabled={Boolean(busy)}>Rejeitar</button>}
        {selected.status === "approved" && selected.execution === "tray_content" && <button type="button" onClick={() => run("apply", selected.id)} disabled={Boolean(busy) || !connected}>Aplicar na Tray</button>}
        {selected.execution !== "tray_content" && !["manual", "rejected", "resolved"].includes(selected.status) && <button type="button" onClick={() => run("apply", selected.id)} disabled={Boolean(busy)}>Registrar execução manual</button>}
        {selected.status === "applied" && <button type="button" className="secondary" onClick={() => run("revert", selected.id)} disabled={Boolean(busy) || !connected}>Reverter</button>}
      </div>
      {selected.history?.length > 0 && <details><summary>Histórico</summary>{selected.history.map((entry, index) => <div key={`${entry.at}-${index}`}><small>{dateTime(entry.at)} — {salesStatusLabel(entry.event)} — {entry.actor || "Charlie"}</small></div>)}</details>}
    </section>}
  </div>;
}
