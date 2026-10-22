import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const toneOf = (tone) => ({ critico: "critico", atencao: "atencao", oportunidade: "positivo", informacao: "info" }[tone] || "info");
const when = (value) => value ? new Date(value).toLocaleString("pt-BR") : "não informada";

const emptyPrefs = { sectors: "", favoriteIndicators: "", summaryFrequency: "", format: "executivo", alertTypes: "" };

export function DirectorPreferences() {
  const [prefs, setPrefs] = useState(emptyPrefs);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/ia/executivo/painel").then((result) => {
      const savedPrefs = result.preferencias || {};
      setPrefs({
        sectors: (savedPrefs.sectors || []).join(", "),
        favoriteIndicators: (savedPrefs.favoriteIndicators || []).join(", "),
        summaryFrequency: savedPrefs.summaryFrequency || "",
        format: savedPrefs.format || "executivo",
        alertTypes: (savedPrefs.alertTypes || []).join(", "),
      });
    }).catch((reason) => setError(reason.message));
  }, []);

  async function savePreferences(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const split = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
      await api.put("/ia/executivo/preferencias", {
        sectors: split(prefs.sectors),
        favoriteIndicators: split(prefs.favoriteIndicators),
        alertTypes: split(prefs.alertTypes),
        summaryFrequency: prefs.summaryFrequency || null,
        format: prefs.format,
      });
      setSaved(true);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="director-prefs" onSubmit={savePreferences}>
      {error ? <div className="error">{error}</div> : null}
      <label>Indicadores favoritos<input value={prefs.favoriteIndicators} onChange={(event) => setPrefs({ ...prefs, favoriteIndicators: event.target.value })} placeholder="projecao:caixa, rentabilidade:negativa" /></label>
      <label>Setores acompanhados<input value={prefs.sectors} onChange={(event) => setPrefs({ ...prefs, sectors: event.target.value })} placeholder="financeiro, comercial" /></label>
      <label>Frequência do resumo
        <select value={prefs.summaryFrequency} onChange={(event) => setPrefs({ ...prefs, summaryFrequency: event.target.value })}>
          <option value="">Não alterar automações</option>
          <option value="diaria">Diária</option>
          <option value="semanal">Semanal</option>
          <option value="mensal">Mensal</option>
        </select>
      </label>
      <label>Tipos de alerta informativo<input value={prefs.alertTypes} onChange={(event) => setPrefs({ ...prefs, alertTypes: event.target.value })} placeholder="informacao, oportunidade" /></label>
      <label>Formato
        <select value={prefs.format} onChange={(event) => setPrefs({ ...prefs, format: event.target.value })}>
          <option value="executivo">Executivo</option>
          <option value="compacto">Compacto</option>
        </select>
      </label>
      <p>Estas preferências não alteram regras empresariais, permissões nem dados do ERP. A frequência só guarda a preferência; a automação continua no agendador existente.</p>
      <button className="primary" disabled={busy} type="submit">{busy ? "Salvando…" : "Salvar preferências"}</button>
      {saved ? <p>Preferências do Modo Diretor salvas.</p> : null}
    </form>
  );
}

export default function CharlieDirector({ open, onClose, onAsk }) {
  const [tab, setTab] = useState("visao");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await api.get("/ia/executivo/painel");
      setData(result);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (open) load(); }, [open]);
  if (!open) return null;
  const briefing = data?.briefing;
  const indicators = briefing?.indicators || [];
  const max = Math.max(1, ...indicators.map((item) => Math.abs(Number(item.value) || 0)));

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const result = await api.post("/ia/executivo/resumo", { escopo: "empresa", atualizar: true });
      setData((current) => ({ ...current, briefing: result.briefing }));
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setBusy(false);
    }
  }

  async function createPlan() {
    setBusy(true);
    setError("");
    try {
      await api.post("/ia/executivo/planos", { escopo: "empresa" });
      await load();
      setTab("planos");
    } catch (planError) {
      setError(planError.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(plan, action) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/ia/executivo/planos/${plan.id}/aprovar`, { confirmado: true, acoes: [action.id] });
      await load();
    } catch (approveError) {
      setError(approveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(plan, action) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/ia/executivo/planos/${plan.id}/verificar`, { acaoId: action.id });
      await load();
      setTab("resultados");
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="charlie-modal-backdrop">
      <section className="charlie-modal charlie-director" role="dialog" aria-modal="true" aria-label="Modo Diretor">
        <header>
          <div>
            <small>CHARLIE — MODO DIRETOR</small>
            <h2>Modo Diretor</h2>
            <p>Visão consolidada das fontes já existentes. Números sem fonte não são exibidos.</p>
          </div>
          <div>
            <button type="button" disabled={busy} onClick={refresh}>{busy ? "Atualizando…" : "Atualizar indicadores"}</button>
            <button type="button" onClick={onClose}>Fechar</button>
          </div>
        </header>
        {error ? <div className="error">{error}</div> : null}
        <div className="director-tabs" role="tablist">
          {[["visao", "Visão geral"], ["prioridades", "Minhas prioridades"], ["planos", "Planos de ação"], ["reuniao", "Reunião com Charlie"], ["resultados", "Resultados"]].map(([id, label]) => (
            <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === "visao" ? (
          <div>
            <p className="director-meta">Período: {briefing?.period || "não informado"}. Última atualização: {when(briefing?.updatedAt)}.</p>
            <div className="director-cards">
              {(briefing?.critical || []).slice(0, 3).map((item) => <article key={item.id} className="tone-critico"><span>Crítico</span><strong>{item.title}</strong><small>{item.source?.service} · {when(item.source?.updatedAt)}</small></article>)}
              {(briefing?.opportunities || []).slice(0, 2).map((item) => <article key={item.id} className="tone-positivo"><span>Oportunidade</span><strong>{item.title}</strong><small>{item.source?.service}</small></article>)}
              {!briefing?.critical?.length && !briefing?.opportunities?.length ? <article className="tone-info"><strong>Nenhum indicador crítico carregado.</strong><small>Use Atualizar para consultar os serviços existentes.</small></article> : null}
            </div>
            <div className="director-chart" aria-label="Indicadores">
              {indicators.slice(0, 6).map((item, index) => (
                <div key={item.id} className={`director-bar serie-${index % 6}`}>
                  <span>{item.label}</span>
                  <i style={{ width: `${Math.max(8, (Math.abs(Number(item.value) || 0) / max) * 100)}%` }} />
                  <b>{item.valueLabel} · {item.kind === "projecao" ? "projeção" : item.kind === "estimado" ? "estimativa" : "realizado"}</b>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {tab === "prioridades" ? (
          <div className="table-scroll">
            <table className="tabela">
              <thead><tr><th>Prioridade</th><th>Situação</th><th>Urgência</th><th>Impacto</th><th>Ação disponível</th></tr></thead>
              <tbody>
                {(briefing?.priorities || []).map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td><span className={`director-pill tone-${toneOf(item.severity)}`}>{item.severity}</span> {item.title}<small>{item.reasons?.join(". ")}</small></td>
                    <td>{Number.isFinite(item.deadlineDays) ? `${item.deadlineDays} dia(s)` : "não datada"}</td>
                    <td>{item.financialImpact == null ? "não quantificado" : money(item.financialImpact)}</td>
                    <td>{item.actionKey ? "consulta ou preparação no catálogo" : "sem ação validada"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" disabled={busy} onClick={createPlan}>Preparar plano de ação</button>
          </div>
        ) : null}
        {tab === "planos" ? (
          <div className="director-plans">
            {(data?.planos || []).map((plan) => (
              <article key={plan.id}>
                <header><strong>{plan.objective}</strong><span>{plan.status}</span></header>
                <p>Criado em {when(plan.createdAt)}. Responsável do plano: não atribuído.</p>
                <ul>
                  {(plan.actions || []).map((action) => (
                    <li key={action.id}>
                      <b>{action.id}</b> {action.objective}. Prazo: {action.dueNote}. Situação: {action.status}. Responsável: não atribuído.
                      <span>
                        <button type="button" disabled={busy || !action.executable} onClick={() => approve(plan, action)}>Preparar ação</button>
                        <button type="button" disabled={busy} onClick={() => verify(plan, action)}>Reavaliar indicador</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {!data?.planos?.length ? <p>Nenhum plano neste escopo.</p> : null}
          </div>
        ) : null}
        {tab === "reuniao" ? (
          <div className="director-meeting">
            <p>A reunião usa o Charlie que já está aberto. O contexto fica na conversa.</p>
            <button type="button" onClick={() => onAsk("Charlie, faça uma reunião sobre os resultados deste mês.")}>Iniciar reunião</button>
            <button type="button" onClick={() => onAsk("O que mais preocupa?")}>Perguntar as prioridades</button>
            <button type="button" onClick={() => onAsk("Comece pelo financeiro.")}>Interromper pelo financeiro</button>
          </div>
        ) : null}
        {tab === "resultados" ? (
          <div>
            <p>Melhoria só aparece depois de uma nova leitura do indicador. Economia não é declarada sem evidência validada.</p>
            <ul>{(data?.decisoes || []).map((item) => <li key={item.id}>{when(item.createdAt)} — {item.context}. Política oficial: não.</li>)}</ul>
            {(briefing?.indicators || []).filter((item) => item.kind === "realizado").map((item) => <p key={item.id}>{item.label}: {item.valueLabel}. Atualização {when(item.updatedAt)}.</p>)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
