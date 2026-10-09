import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

const starters = [
  "Abrir o dia",
  "Vendas de hoje",
  "Top 10 produtos vendidos",
  "Estoque baixo",
  "Produtos com estoque negativo",
  "Contas a receber",
  "Contas a pagar",
  "Saldo dos bancos",
  "Resumo do caixa",
];
const greeting = {
  role: "assistant",
  text: "Olá! Sou o Charlie. Em que posso ajudar?",
  at: Date.now(),
};
const format = (value, column) => {
  if (column === "TOTAL_RECEBIDO")
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  return typeof value === "number"
    ? value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
    : String(value ?? "");
};
const columnLabels = {
  FORMA_PAGAMENTO: "Forma de pagamento",
  QTD_LANCAMENTOS: "Lançamentos",
  TOTAL_RECEBIDO: "Total recebido",
};
const columnLabel = (column) =>
  columnLabels[column] ||
  String(column)
    .replaceAll("_", " ")
    .toLocaleLowerCase("pt-BR")
    .replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR"));

function Evidence({ rows, columns }) {
  if (!rows?.length) return null;
  const cols = columns?.length ? columns : Object.keys(rows[0]);
  return (
    <details className="charlie-evidence">
      <summary>Ver dados da resposta ({rows.length})</summary>
      <div className="table-scroll">
        <table className="tabela">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col}>{columnLabel(col)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {cols.map((col) => (
                  <td key={col}>{format(row[col], col)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function Charlie() {
  const [messages, setMessages] = useState([greeting]),
    [threads, setThreads] = useState([]),
    [activeId, setActiveId] = useState(null),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ollama, setOllama] = useState(null);
  const endRef = useRef(null),
    inputRef = useRef(null);
  async function loadThreads() {
    try {
      const data = await api.get("/ia/conversas");
      setThreads(data.conversas || []);
    } catch {
      setThreads([]);
    }
  }
  useEffect(() => {
    loadThreads();
    api
      .get("/ia/ollama/status")
      .then(setOllama)
      .catch(() => setOllama({ online: false }));
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  function newConversation() {
    setActiveId(null);
    setMessages([greeting]);
    setQuestion("");
    setError("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  async function openConversation(id) {
    if (busy) return;
    try {
      const data = await api.get(`/ia/conversas/${id}`);
      setActiveId(Number(id));
      setMessages(
        (data.messages || []).map((item) => ({
          role: item.role,
          text: item.text,
          data: item.data,
          columns: item.data?.[0] ? Object.keys(item.data[0]) : [],
          suggestions: item.suggestions,
          alerts: item.alerts,
          at: item.at,
        })),
      );
    } catch (e) {
      setError(e.message);
    }
  }
  async function renameThread(item, event) {
    event.stopPropagation();
    const title = window.prompt("Novo nome da conversa", item.title);
    if (!title?.trim()) return;
    try {
      await api.patch(`/ia/conversas/${item.id}`, { titulo: title });
      loadThreads();
    } catch (e) {
      setError(e.message);
    }
  }
  async function removeThread(item, event) {
    event.stopPropagation();
    if (!window.confirm("Remover esta conversa da lista?")) return;
    try {
      await api.del(`/ia/conversas/${item.id}`);
      if (Number(activeId) === Number(item.id)) newConversation();
      loadThreads();
    } catch (e) {
      setError(e.message);
    }
  }
  async function ask(value = question) {
    const text = String(value || "").trim();
    if (!text || busy) return;
    setQuestion("");
    setBusy(true);
    setError("");
    setMessages((current) => [
      ...current,
      { role: "user", text, at: Date.now() },
    ]);
    try {
      const result = await api.post("/ia/perguntar", {
        pergunta: text,
        contexto: activeId ? { conversaId: activeId } : undefined,
      });
      setActiveId(Number(result.conversaId));
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: result.resposta,
          data: result.dados,
          columns: result.colunas,
          suggestions: result.sugestoes,
          alerts: result.alertas,
          at: Date.now(),
        },
      ]);
      loadThreads();
    } catch (e) {
      setError(e.message);
      setMessages((current) => [
        ...current,
        { role: "error", text: e.message, at: Date.now() },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }
  function keyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }
  return (
    <section className="charlie-layout">
      <div className="panel charlie-main">
        <div className="charlie-header">
          <div className="charlie-identity">
            <span className="charlie-avatar">C</span>
            <div>
              <h2>Charlie</h2>
              <small>
                {busy
                  ? "analisando..."
                  : ollama?.online
                    ? `Ollama online · ${ollama.model}`
                    : "regras locais · Ollama offline"}
              </small>
            </div>
          </div>
          <button onClick={newConversation}>Nova conversa</button>
        </div>
        <div className="charlie-thread">
          {messages.map((message, index) => (
            <article key={index} className={`charlie-message ${message.role}`}>
              <div>{message.text}</div>
              {message.alerts?.map((alert, i) => (
                <div className="charlie-alert" key={i}>
                  {alert.texto}
                </div>
              ))}
              <Evidence rows={message.data} columns={message.columns} />
              {message.suggestions?.length ? (
                <div className="charlie-chips">
                  {message.suggestions.map((item) => (
                    <button
                      key={item}
                      disabled={busy}
                      onClick={() => ask(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
              <time>
                {message.at
                  ? new Date(message.at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
              </time>
            </article>
          ))}
          {busy && (
            <article className="charlie-message assistant typing">
              <i />
              <i />
              <i />
            </article>
          )}
          <div ref={endRef} />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="charlie-composer">
          <textarea
            ref={inputRef}
            rows="1"
            maxLength="500"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={keyDown}
            placeholder="Pergunte sobre vendas, estoque, financeiro ou caixa"
            disabled={busy}
          />
          <button
            className="primary"
            disabled={busy || !question.trim()}
            onClick={() => ask()}
          >
            Enviar
          </button>
        </div>
      </div>
      <aside className="panel charlie-sidebar">
        <h2>Conversas</h2>
        <div className="charlie-starters">
          {starters.map((item) => (
            <button key={item} disabled={busy} onClick={() => ask(item)}>
              {item}
            </button>
          ))}
        </div>
        <h3>Histórico</h3>
        {threads.map((item) => (
          <div
            key={item.id}
            className={`charlie-thread-item ${Number(activeId) === Number(item.id) ? "active" : ""}`}
            onClick={() => openConversation(item.id)}
          >
            <div>
              <strong>{item.title}</strong>
              <small>{item.messages} mensagem(ns)</small>
            </div>
            <span>
              <button
                title="Renomear"
                onClick={(event) => renameThread(item, event)}
              >
                ✎
              </button>
              <button
                title="Excluir"
                onClick={(event) => removeThread(item, event)}
              >
                ×
              </button>
            </span>
          </div>
        ))}
        {!threads.length && <p className="muted">Nenhuma conversa gravada.</p>}
      </aside>
    </section>
  );
}
