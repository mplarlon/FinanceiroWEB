import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { salesPriorityLabel, salesStatusLabel } from "../lib/charlie-sales-ecosystem.js";

const dateTime = (value) => value
  ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  : "Ainda não executada";

export default function CharlieTecnospeedReview({ connected }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const result = await api.get("/tray/revisao-hub");
    setData(result);
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, []);

  async function run(action, id) {
    setBusy(id || action);
    setError("");
    setNotice("");
    try {
      if (action === "analyze") {
        const result = await api.post("/tray/revisao-hub/analisar", {});
        setData(result);
        setNotice("Leitura gravada a partir da view PRODUTOS_TECNOSPEED.");
      } else if (action === "suggest") {
        const result = await api.post(`/tray/revisao-hub/${id}/sugerir`, {});
        setNotice(result.aviso);
        setOpenId(id);
        await load();
      } else if (action === "approve" || action === "reject") {
        await api.post(`/tray/revisao-hub/${id}/decisao`, {
          decision: action === "approve" ? "approve" : "reject",
        });
        await load();
      } else if (action === "upload") {
        const result = await api.post(`/tray/revisao-hub/${id}/subir`, {});
        setNotice(result.modo === "create"
          ? `Produto criado na Tray${result.trayId ? ` (#${result.trayId})` : ""}.`
          : `Texto atualizado na Tray${result.trayId ? ` (#${result.trayId})` : ""}.`);
        await load();
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy("");
    }
  }

  const items = data?.items || [];
  const selected = items.find((item) => item.id === openId);

  return <div className="charlie-sales-dashboard">
    <section className="ecommerce-hero">
      <div>
        <span className="tray-kicker">VENDAS • FILA HUB</span>
        <h2>Revisão hub</h2>
        <p>O Charlie lê a view PRODUTOS_TECNOSPEED; o Ollama revisa o texto; depois da aprovação o produto sobe à Tray.</p>
      </div>
      <div className="ecommerce-sync">
        <small>Última leitura</small>
        <b>{dateTime(data?.analyzedAt)}</b>
        <button type="button" disabled={Boolean(busy)} onClick={() => run("analyze")}>
          {busy === "analyze" ? "Lendo..." : "Ler fila do hub"}
        </button>
      </div>
    </section>
    {notice && <div className="tray-message success">{notice}</div>}
    {error && <div className="error">{error}</div>}
    {data?.limitations?.length > 0 && <details className="charlie-sales-limites">
      <summary>Limites desta leitura</summary>
      <ul>{data.limitations.map((limite) => <li key={limite}>{limite}</li>)}</ul>
    </details>}
    <section className="panel ecommerce-table">
      <header>
        <h3>Produtos da view</h3>
        <small>{data ? `${items.length} em aberto ou acompanhados` : "Aguardando leitura"}</small>
      </header>
      <div className="table-scroll">
        <table className="tabela">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Estoque</th>
              <th>Preço</th>
              <th>Problema</th>
              <th>Prioridade</th>
              <th>Ação</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((item) => <tr key={item.id}>
              <td>
                <b>{item.productName}</b>
                <small>{item.sku ? ` ${item.sku}` : ""}</small>
              </td>
              <td>{item.product?.stock ?? "—"}</td>
              <td>{item.product?.price != null ? item.product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</td>
              <td>{item.problem}</td>
              <td><b>{salesPriorityLabel(item.priority)}</b></td>
              <td className="ecommerce-action-buttons">
                <button
                  type="button"
                  onClick={() => { setOpenId(item.id); run("suggest", item.id); }}
                  disabled={Boolean(busy) || item.status === "uploaded"}
                >
                  {busy === item.id ? "Ollama revisando..." : "Revisar com Ollama"}
                </button>
                <small>{salesStatusLabel(item.status)}</small>
              </td>
            </tr>) : <tr>
              <td colSpan="6">
                {data?.analyzedAt
                  ? "Nenhum produto elegível na view nesta leitura."
                  : "Execute a leitura para carregar a fila PRODUTOS_TECNOSPEED."}
              </td>
            </tr>}
          </tbody>
        </table>
      </div>
    </section>
    {selected && <section className="panel charlie-booster-detail">
      <header>
        <h3>{selected.productName}</h3>
        <span>{selected.trayId ? `Tray #${selected.trayId}` : "Ainda sem ID na Tray"}</span>
      </header>
      <p>{selected.recommendation}</p>
      {selected.limitation && <p className="charlie-sales-note">{selected.limitation}</p>}
      {(selected.gaps || []).length > 0 && (
        <p className="charlie-sales-note">Pendências do ERP: {selected.gaps.join(", ")}</p>
      )}
      {selected.suggestion && <div className="charlie-booster-copy">
        <strong>Texto revisado pelo Ollama</strong>
        <p>{selected.suggestion.name}</p>
        <p>{selected.suggestion.description}</p>
      </div>}
      <div className="ecommerce-action-buttons">
        {selected.suggestion && ["open", "suggested"].includes(selected.status) && (
          <button type="button" onClick={() => run("approve", selected.id)} disabled={Boolean(busy)}>Aprovar</button>
        )}
        {["open", "suggested"].includes(selected.status) && (
          <button type="button" className="secondary" onClick={() => run("reject", selected.id)} disabled={Boolean(busy)}>Rejeitar</button>
        )}
        {selected.status === "approved" && (
          <button
            type="button"
            onClick={() => run("upload", selected.id)}
            disabled={Boolean(busy) || !connected}
          >
            {busy === selected.id ? "Subindo..." : "Subir à Tray"}
          </button>
        )}
      </div>
      {selected.history?.length > 0 && <details>
        <summary>Histórico</summary>
        {selected.history.map((entry, index) => (
          <div key={`${entry.at}-${index}`}>
            <small>{dateTime(entry.at)} — {salesStatusLabel(entry.event)} — {entry.actor || "Charlie"}</small>
          </div>
        ))}
      </details>}
    </section>}
  </div>;
}
