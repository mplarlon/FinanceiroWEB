import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

function highlight(selector) {
  document.querySelectorAll(".charlie-highlight").forEach((node) => node.classList.remove("charlie-highlight"));
  const target = selector ? document.querySelector(selector) : null;
  if (!target) return false;
  target.classList.add("charlie-highlight");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("charlie-highlight"), 7000);
  return true;
}

export default function CharlieTraining({ page, pageLabel, onNavigate }) {
  const [open, setOpen] = useState(false), [context, setContext] = useState(null), [items, setItems] = useState([]), [active, setActive] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [mode, setMode] = useState("aprender");
  const stepIndex = useMemo(() => active ? active.tutorial.steps.findIndex((step) => !active.progress.completedSteps.includes(step.id)) : -1, [active]);
  const step = stepIndex >= 0 ? active.tutorial.steps[stepIndex] : null;

  async function load() {
    setLoading(true); setError("");
    try {
      const [ctx, catalog] = await Promise.all([api.get(`/ia/treinamento/contexto/${page}`), api.get("/ia/treinamento/catalogo")]);
      setContext(ctx.contexto); setItems(catalog.treinamentos || []);
      const ongoing = (catalog.treinamentos || []).find((x) => x.progress?.status === "em_andamento");
      if (ongoing) setActive({ tutorial: ongoing, progress: ongoing.progress });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) load(); }, [open, page]);
  useEffect(() => {
    if (!active || !step) return undefined;
    if (step.criterion?.type === "screen" && step.criterion.value === page) completeStep(step.id);
    const listener = (event) => {
      const control = event.target.closest?.("[data-charlie-control]")?.dataset.charlieControl;
      if (step.criterion?.type === "click" && control === step.criterion.value) completeStep(step.id);
    };
    document.addEventListener("click", listener);
    return () => document.removeEventListener("click", listener);
  }, [active?.progress?.id, step?.id, page]);
  async function start(id) { try { setActive(await api.post(`/ia/treinamento/${id}/iniciar`)); } catch (e) { setError(e.message); } }
  async function completeStep(stepId) {
    if (!active?.progress?.id || active.progress.completedSteps.includes(stepId)) return;
    try { setActive(await api.patch(`/ia/treinamento/progresso/${active.progress.id}`, { stepId })); } catch (e) { setError(e.message); }
  }
  function showStep() {
    if (!step) return;
    if (step.criterion?.type === "screen" && step.criterion.value !== page) { onNavigate(step.criterion.value); return; }
    if (!highlight(step.selector)) setError("Este componente não está disponível no estado atual da tela.");
  }
  return <>
    <button type="button" className={`charlie-help-fab${page === "charlie" ? " above-composer" : ""}`} onClick={() => setOpen(true)} aria-label={`Me ajude nesta tela: ${pageLabel}`}>✦ <span>Me ajude nesta tela</span></button>
    {open ? <div className="charlie-training-backdrop" role="dialog" aria-modal="true" aria-label="Aprender com Charlie">
      <aside className="charlie-training-panel">
        <header><div><small>CHARLIE — INSTRUTOR</small><h2>Aprender com Charlie</h2></div><button onClick={() => setOpen(false)} aria-label="Fechar">×</button></header>
        <div className="training-mode" aria-label="Modo do Charlie"><button className={mode === "aprender" ? "active" : ""} onClick={() => setMode("aprender")}>Modo Aprender</button><button className={mode === "executar" ? "active" : ""} onClick={() => setMode("executar")}>Modo Executar</button></div>
        {mode === "executar" ? <div className="training-warning"><strong>Modo Executar</strong><p>Operações continuam sujeitas às permissões e confirmações do executor existente. Abra o Charlie para preparar uma tarefa.</p><button onClick={() => { onNavigate("charlie"); setOpen(false); }}>Ir para o Charlie</button></div> : null}
        {loading ? <p>Carregando orientação…</p> : null}{error ? <div className="error">{error}</div> : null}
        {mode === "aprender" && context ? <section className="training-context"><span>{context.module}</span><h3>{context.title}</h3><p>{context.description}</p>{context.controls.length ? <div className="training-controls"><strong>Componentes desta tela</strong>{context.controls.map((control) => <button key={control.id} onClick={() => highlight(control.selector)}><span>{control.label}</span><small>{control.purpose}</small></button>)}</div> : <p className="muted">Esta tela possui orientação geral; ainda não há campos internos registrados para destaque.</p>}{context.procedures?.length ? <details><summary>Procedimentos vigentes relacionados</summary>{context.procedures.map((source) => <p key={source.id}>{source.title} · versão {source.version}</p>)}</details> : null}</section> : null}
        {mode === "aprender" && active ? <section className="training-active"><div className="training-progress"><span style={{ width: `${Math.round(active.progress.completedSteps.length / active.tutorial.steps.length * 100)}%` }} /></div><small>{active.progress.completedSteps.length} de {active.tutorial.steps.length} etapas</small><h3>{active.tutorial.title}</h3>{step ? <article><b>{step.title}</b><p>{step.description}</p><p>{step.instruction}</p><button className="primary" onClick={showStep}>{step.criterion?.type === "screen" && step.criterion.value !== page ? "Abrir tela" : "Mostrar componente"}</button></article> : <div className="training-complete">✓ Treinamento concluído</div>}</section> : null}
        {mode === "aprender" ? <section className="training-catalog"><h3>Treinamentos disponíveis</h3>{items.map((item) => <button key={item.id} onClick={() => start(item.id)}><span><b>{item.title}</b><small>{item.module} · {item.level} · versão {item.version}</small></span><em>{item.progress?.status?.replaceAll("_", " ") || "não iniciado"}</em></button>)}</section> : null}
      </aside>
    </div> : null}
  </>;
}
