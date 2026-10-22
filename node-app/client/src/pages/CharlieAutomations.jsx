import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const when = (value) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
const STATUS = { ativa: "Ativa", pausada: "Pausada", falhou: "Com falha", desativada: "Desativada", aguardando_confirmacao: "Aguardando confirmação" };

export function AutomationCard({ automation, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!automation) return null;
  async function confirm() {
    setBusy(true);
    try {
      const data = await api.post(`/ia/automacoes/${automation.id}/confirmar`, { confirmar: true });
      onChanged?.(data.automacao);
    } finally { setBusy(false); }
  }
  return (
    <div className="charlie-automation-preview">
      <strong>CHARLIE — NOVA AUTOMAÇÃO</strong>
      <dl><dt>Nome</dt><dd>{automation.nome}</dd><dt>Execução</dt><dd>{automation.modalidade}</dd><dt>Próxima execução</dt><dd>{when(automation.proximaExecucao)}</dd><dt>Ação</dt><dd>{automation.acao}</dd><dt>Fuso</dt><dd>{automation.fusoHorario}</dd><dt>Situação</dt><dd>{STATUS[automation.status] || automation.status}</dd></dl>
      {automation.status === "aguardando_confirmacao" ? <button className="primary" disabled={busy} onClick={confirm}>Confirmar automação</button> : null}
    </div>
  );
}

export default function CharlieAutomations({ open, onClose }) {
  const [items, setItems] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function load() { const data = await api.get("/ia/automacoes"); setItems(data.automacoes || []); }
  useEffect(() => { if (open) load().catch((e) => setError(e.message)); }, [open]);
  if (!open) return null;
  async function change(item, status) {
    setBusy(true); setError("");
    try { await api.patch(`/ia/automacoes/${item.id}`, { status }); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function run(item) {
    setBusy(true); setError("");
    try { await api.post(`/ia/automacoes/${item.id}/executar`, {}); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="charlie-automations">
    <header><div><h3>Automações do Charlie</h3><small>Rotinas programadas, recorrentes e condicionais</small></div><button onClick={onClose}>Fechar</button></header>
    {error ? <div className="error">{error}</div> : null}
    <div className="charlie-automation-grid"><div>{items.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelected(item)}><strong>{item.nome}</strong><small>{STATUS[item.status] || item.status} · próxima {when(item.proximaExecucao)}</small></button>)}{!items.length ? <p className="muted">Peça ao Charlie, por exemplo: “Toda segunda às 8h gere um relatório de inadimplência”.</p> : null}</div>
    <article>{selected ? <><h4>{selected.nome}</h4><p>{selected.objetivo}</p><dl><dt>Ação</dt><dd>{selected.acao}</dd><dt>Modalidade</dt><dd>{selected.modalidade}</dd><dt>Próxima execução</dt><dd>{when(selected.proximaExecucao)}</dd><dt>Última execução</dt><dd>{when(selected.ultimaExecucao)}</dd><dt>Versão</dt><dd>{selected.versao}</dd></dl><div className="charlie-alert-actions">{selected.status === "ativa" ? <button disabled={busy} onClick={() => change(selected, "pausada")}>Pausar</button> : selected.status === "pausada" ? <button disabled={busy} onClick={() => change(selected, "ativa")}>Reativar</button> : null}<button disabled={busy || selected.status !== "ativa"} onClick={() => run(selected)}>Executar agora</button><button disabled={busy} onClick={() => change(selected, "desativada")}>Desativar</button></div></> : <p className="muted">Selecione uma automação.</p>}</article></div>
  </section>;
}
