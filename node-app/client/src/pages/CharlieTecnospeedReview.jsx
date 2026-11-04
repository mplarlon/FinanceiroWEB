import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { itemNeedsResearch, itemReadiness } from "../lib/charlie-item-readiness.js";
import { REVIEW_FILTERS, matchesReviewFilter, reviewFilterCount } from "../lib/charlie-review-queue.js";
import { salesPriorityLabel, salesStatusLabel } from "../lib/charlie-sales-ecosystem.js";
import {
  rememberReviewDuration,
  reviewTimeLabel,
  sanitizeDurations,
  typicalReviewMs,
} from "../../../server/lib/review-estimate.js";

const DURATION_KEY = "charlie-review-durations";

function readStoredDurations() {
  try { return sanitizeDurations(JSON.parse(localStorage.getItem(DURATION_KEY) || "[]")); }
  catch { return []; }
}

function storeDurations(durations) {
  try { localStorage.setItem(DURATION_KEY, JSON.stringify(durations)); }
  catch { /* o navegador pode bloquear o armazenamento local */ }
}

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const dateTime = (value) => value
  ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  : "Ainda não executada";

const confirmRemoval = (name) => `Remover ${name} da fila do hub? A característica tecnospeed será retirada do cadastro. Se o produto estiver na modulo_removido, o anúncio também será excluído.`;

const measure = (value) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function isReviewed(item = {}) {
  return ["suggested", "approved", "rejected", "uploaded"].includes(item.status) || Boolean(item.suggestion);
}

function ReviewProgress({ items, batch, blocked, onReview, onStop, samples, now }) {
  const reviewed = items.filter((item) => item.id !== batch?.currentId && isReviewed(item)).length;
  const current = batch?.running && batch.currentId ? 1 : 0;
  const pending = Math.max(0, items.length - reviewed - current);
  const total = items.length;
  const openWork = items.filter((item) => !isReviewed(item));
  const typical = typicalReviewMs(samples, openWork.some(itemNeedsResearch));
  const elapsed = current && batch.startedAt ? Math.max(0, now - batch.startedAt) : 0;
  const estimate = reviewTimeLabel({
    typicalMs: typical,
    elapsedMs: elapsed,
    running: Boolean(current),
    units: pending + current,
  });
  return <div className="charlie-review-progress">
    <div className="charlie-review-progress-top">
      <div>
        <b>Andamento da revisão</b>
        <small>{reviewed} de {total} já revisados{estimate ? ` · ${estimate}` : ""}</small>
      </div>
      {batch?.running ? (
        <button type="button" className="secondary" onClick={onStop} disabled={batch.stopping}>
          {batch.stopping ? "Parando após este item..." : "Parar revisão"}
        </button>
      ) : (
        <button type="button" onClick={onReview} disabled={blocked || pending === 0}>
          {pending ? `Revisar todos (${pending})` : "Todos revisados"}
        </button>
      )}
    </div>
    <div className="charlie-review-meter">
      <div
        className="charlie-review-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={reviewed}
        aria-label={`${reviewed} itens já revisados, ${pending} ainda faltam${estimate ? `. ${estimate}` : ""}`}
      >
        {reviewed > 0 && <span className="feito" style={{ flexGrow: reviewed }} />}
        {current > 0 && <span className="agora" style={{ flexGrow: 1 }} />}
        {pending > 0 && <span className="falta" style={{ flexGrow: pending }} />}
      </div>
      <b>{reviewed}/{total}</b>
    </div>
    <ul className="charlie-review-legend">
      <li className="feito"><i />{reviewed} já revisados</li>
      {current > 0 && <li className="agora"><i />1 em revisão</li>}
      <li className="falta"><i />{pending} faltam</li>
    </ul>
    {batch?.running && batch.currentName && (
      <p className="charlie-review-now">
        Revisando agora: <b>{batch.currentName}</b>
        {batch.total ? ` · ${Math.min((batch.attempted || 0) + 1, batch.total)} de ${batch.total} nesta passagem` : ""}
      </p>
    )}
    {batch?.stopping && <p className="charlie-review-now">A revisão atual termina e a fila para.</p>}
    {batch && !batch.running && batch.stopped && (
      <p className="charlie-review-now">Revisão interrompida. {batch.succeeded} concluídos nesta passagem.</p>
    )}
    {batch?.failed?.length > 0 && <ul className="charlie-review-fails">
      {batch.failed.map((entry) => <li key={entry.id}><b>{entry.name}</b>: {entry.message}</li>)}
    </ul>}
  </div>;
}

function ItemProgress({ item, researching, samples, startedAt, now }) {
  const readiness = itemReadiness(item, researching);
  const missing = readiness.checks.filter((check) => !check.ok && !check.searching);
  const pendingNames = readiness.checks.filter((check) => !check.ok).map((check) => check.label.toLowerCase());
  const typical = typicalReviewMs(samples, itemNeedsResearch(item));
  const elapsed = researching && startedAt ? Math.max(0, now - startedAt) : 0;
  const estimate = readiness.pending === 0 && !researching
    ? ""
    : reviewTimeLabel({ typicalMs: typical, elapsedMs: elapsed, running: researching, units: 1 });
  const summary = readiness.pending === 0
    ? "Nada falta neste item"
    : researching
      ? `Pesquisando ${readiness.searching} de ${readiness.total} que ainda faltam`
      : `Faltam ${readiness.pending} de ${readiness.total}`;
  const detail = readiness.pending === 0
    ? "Tudo pronto para criar na modulo_removido"
    : `Ainda faltam ${pendingNames.join(", ")}`;
  return <div className="charlie-item-progress">
    <div className="charlie-review-progress-top">
      <div>
        <b>Quanto falta deste item</b>
        <small>{summary}{estimate ? ` · ${estimate}` : ""}</small>
      </div>
    </div>
    <div className="charlie-review-meter">
      <div
        className="charlie-review-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={readiness.total}
        aria-valuenow={readiness.done}
        aria-label={estimate ? `${detail}. ${estimate}` : detail}
      >
        {readiness.done > 0 && <span className="feito" style={{ flexGrow: readiness.done }} />}
        {readiness.searching > 0 && <span className="agora" style={{ flexGrow: readiness.searching }} />}
        {missing.length > 0 && <span className="falta" style={{ flexGrow: missing.length }} />}
      </div>
      <b>{readiness.done}/{readiness.total}</b>
    </div>
    <ul className="charlie-review-legend charlie-item-checks">
      {readiness.checks.map((check) => (
        <li key={check.id} className={check.ok ? "feito" : check.searching ? "agora" : "falta"}>
          <i />{check.label}
        </li>
      ))}
    </ul>
  </div>;
}

function ProductSpecs({ product = {} }) {
  const lines = [];
  if (product.grupoWeb && product.tipoWeb) {
    lines.push(`Categoria: ${product.grupoWeb} > ${product.tipoWeb}${product.categoryFromProduct ? " (grupo do produto)" : ""}`);
  }
  if (product.weight > 0) lines.push(`Peso: ${(product.weight / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} kg`);
  if (product.length > 0) lines.push(`Comprimento: ${measure(product.length)} cm`);
  if (product.width > 0) lines.push(`Largura: ${measure(product.width)} cm`);
  if (product.height > 0) lines.push(`Altura: ${measure(product.height)} cm`);
  if (!lines.length) return null;
  return <div className="charlie-sales-note">{lines.map((line) => <div key={line}>{line}</div>)}</div>;
}

export default function CharlieTecnospeedReview({ connected }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [batch, setBatch] = useState(null);
  const [uploadRun, setUploadRun] = useState(null);
  const [queueFilter, setQueueFilter] = useState("pending");
  const [samples, setSamples] = useState(readStoredDurations);
  const [reviewStartedAt, setReviewStartedAt] = useState(0);
  const stopBatch = useRef(false);
  const stopUpload = useRef(false);
  const clockRunning = Boolean(batch?.running) || reviewStartedAt > 0;
  const now = useNow(clockRunning);

  function noteDuration(ms, payload) {
    const fromServer = sanitizeDurations(payload?.reviewDurations);
    setSamples((current) => {
      const next = fromServer.length ? fromServer : rememberReviewDuration(current, ms);
      storeDurations(next);
      return next;
    });
  }

  async function load() {
    const result = await api.get("/modulo_removido/revisao-hub");
    setData(result);
    if (Array.isArray(result?.reviewDurations) && result.reviewDurations.length) {
      const next = sanitizeDurations(result.reviewDurations);
      storeDurations(next);
      setSamples(next);
    }
    return result;
  }

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, []);

  async function run(action, id) {
    setBusy(["remove", "approve", "reject", "unapprove"].includes(action) ? `${action}:${id}` : (id || action));
    setError("");
    setNotice("");
    try {
      if (action === "analyze") {
        const result = await api.post("/modulo_removido/revisao-hub/analisar", {});
        setData(result);
        setNotice("Leitura gravada a partir da view PRODUTOS_TECNOSPEED.");
      } else if (action === "suggest") {
        const startedAt = Date.now();
        setReviewStartedAt(startedAt);
        try {
          const result = await api.post(`/modulo_removido/revisao-hub/${id}/sugerir`, {}, { timeoutMs: 720000 });
          noteDuration(Date.now() - startedAt, result);
          setNotice(result.aviso);
          await load();
        } catch (cause) {
          noteDuration(Date.now() - startedAt);
          throw cause;
        } finally {
          setReviewStartedAt(0);
        }
      } else if (action === "remove") {
        const result = await api.post(`/modulo_removido/revisao-hub/${id}/remover`, {});
        setNotice(result.aviso);
        if (openId === id) setOpenId("");
        await load();
      } else if (action === "approve" || action === "reject" || action === "unapprove") {
        await api.post(`/modulo_removido/revisao-hub/${id}/decisao`, { decision: action });
        setNotice(action === "approve" ? "Produto aprovado." : action === "reject" ? "Produto rejeitado." : "Aprovação retirada.");
        await load();
      } else if (action === "upload") {
        const result = await api.post(`/modulo_removido/revisao-hub/${id}/subir`, {});
        const base = result.modo === "create"
          ? `Produto criado na modulo_removido${result.modulo_removidoId ? ` (#${result.modulo_removidoId})` : ""}.`
          : `Texto atualizado na modulo_removido${result.modulo_removidoId ? ` (#${result.modulo_removidoId})` : ""}.`;
        setNotice(result.foto ? `${base} ${result.foto}` : base);
        await load();
      }
    } catch (cause) {
      setError(cause.message);
      if (action === "suggest") await load().catch(() => {});
    } finally {
      setBusy("");
    }
  }

  const items = data?.items || [];
  const selected = items.find((item) => item.id === openId);
  const visible = items.filter((item) => matchesReviewFilter(item, queueFilter));
  const approvedCount = reviewFilterCount(items, "approved");
  const filterLabel = REVIEW_FILTERS.find((entry) => entry.id === queueFilter)?.label || "Pendentes";

  useEffect(() => {
    if (!batch?.currentId || typeof document === "undefined") return;
    const row = document.querySelector(`[data-review-id="${CSS.escape(batch.currentId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [batch?.currentId]);

  async function reviewAll() {
    if (batch?.running || uploadRun?.running || busy) return;
    const queue = items.filter((item) => !isReviewed(item));
    if (!queue.length) return;
    const confirmText = queue.length === 1
      ? "Revisar o item que ainda falta?"
      : `Revisar os ${queue.length} itens que ainda faltam? O Charlie pesquisa um por vez. A barra mostra o que já foi feito e o que ainda falta.`;
    if (!window.confirm(confirmText)) return;
    stopBatch.current = false;
    setError("");
    setNotice("");
    const failed = [];
    let succeeded = 0;
    setBatch({
      running: true,
      stopping: false,
      stopped: false,
      currentId: "",
      currentName: "",
      attempted: 0,
      succeeded: 0,
      failed: [],
      total: queue.length,
    });
    for (let index = 0; index < queue.length; index += 1) {
      if (stopBatch.current) {
        setBusy("");
        setBatch((prev) => ({
          ...prev,
          running: false,
          stopping: false,
          stopped: true,
          currentId: "",
          currentName: "",
          succeeded,
          failed: [...failed],
        }));
        return;
      }
      const item = queue[index];
      const startedAt = Date.now();
      setOpenId(item.id);
      setBusy(item.id);
      setReviewStartedAt(startedAt);
      setBatch((prev) => ({
        ...prev,
        running: true,
        currentId: item.id,
        currentName: item.productName,
        startedAt,
        attempted: index,
        succeeded,
        failed: [...failed],
      }));
      let message = "";
      let posted = false;
      try {
        const result = await api.post(`/modulo_removido/revisao-hub/${item.id}/sugerir`, {}, { timeoutMs: 720000 });
        posted = true;
        noteDuration(Date.now() - startedAt, result);
        setNotice(result.aviso || "");
      } catch (cause) {
        message = cause.message;
        noteDuration(Date.now() - startedAt);
      }
      setReviewStartedAt(0);
      const latest = await load().catch(() => null);
      const updated = latest?.items?.find((entry) => entry.id === item.id);
      if (posted || (updated && isReviewed(updated))) succeeded += 1;
      else {
        failed.push({ id: item.id, name: item.productName, message: message || "A revisão não foi concluída." });
        setError(message || "A revisão não foi concluída.");
      }
      setBatch((prev) => ({
        ...prev,
        currentId: "",
        currentName: "",
        attempted: index + 1,
        succeeded,
        failed: [...failed],
      }));
    }
    setBusy("");
    setBatch((prev) => ({
      ...prev,
      running: false,
      stopping: false,
      stopped: false,
      currentId: "",
      currentName: "",
      attempted: queue.length,
      succeeded,
      failed: [...failed],
    }));
    setNotice(failed.length
      ? `Revisão em lote encerrada: ${succeeded} concluídas e ${failed.length} sem conclusão.`
      : `Revisão em lote encerrada: ${succeeded} ${succeeded === 1 ? "item revisado" : "itens revisados"}.`);
  }

  function requestStop() {
    stopBatch.current = true;
    setBatch((prev) => (prev?.running ? { ...prev, stopping: true } : prev));
  }

  function requestStopUpload() {
    stopUpload.current = true;
    setUploadRun((prev) => (prev?.running ? { ...prev, stopping: true } : prev));
  }

  async function uploadApproved() {
    if (batch?.running || uploadRun?.running || busy) return;
    const queue = items.filter((item) => item.status === "approved");
    if (!queue.length) return;
    const confirmText = queue.length === 1
      ? "Subir o produto aprovado para a modulo_removido?"
      : `Subir os ${queue.length} produtos aprovados para a modulo_removido?`;
    if (!window.confirm(confirmText)) return;
    stopUpload.current = false;
    setError("");
    setNotice("");
    const failed = [];
    let succeeded = 0;
    setUploadRun({ running: true, stopping: false, attempted: 0, succeeded: 0, failed: [], total: queue.length, currentName: "" });
    for (let index = 0; index < queue.length; index += 1) {
      if (stopUpload.current) break;
      const item = queue[index];
      setBusy(`upload:${item.id}`);
      setUploadRun((prev) => ({
        ...prev,
        running: true,
        currentId: item.id,
        currentName: item.productName,
        attempted: index,
        succeeded,
        failed: [...failed],
      }));
      try {
        const result = await api.post(`/modulo_removido/revisao-hub/${item.id}/subir`, {});
        succeeded += 1;
        const base = result.modo === "create"
          ? `${item.productName} criado na modulo_removido${result.modulo_removidoId ? ` (#${result.modulo_removidoId})` : ""}.`
          : `${item.productName} atualizado na modulo_removido${result.modulo_removidoId ? ` (#${result.modulo_removidoId})` : ""}.`;
        setNotice(result.foto ? `${base} ${result.foto}` : base);
      } catch (cause) {
        failed.push({ id: item.id, name: item.productName, message: cause.message });
        setError(cause.message);
      }
      await load().catch(() => null);
    }
    setBusy("");
    const stopped = stopUpload.current;
    setUploadRun({
      running: false,
      stopping: false,
      stopped,
      currentId: "",
      currentName: "",
      attempted: succeeded + failed.length,
      succeeded,
      failed: [...failed],
      total: queue.length,
    });
    const done = `${succeeded} ${succeeded === 1 ? "produto enviado" : "produtos enviados"}`;
    if (stopped) setNotice(`Envio interrompido. ${done}.`);
    else if (failed.length) setNotice(`Envio encerrado: ${done} e ${failed.length} sem conclusão.`);
    else setNotice(`Envio encerrado: ${done}.`);
  }

  return <div className="charlie-sales-dashboard">
    <section className="modulo_removido-hero">
      <div>
        <span className="modulo_removido-kicker">VENDAS • FILA HUB</span>
        <h2>Revisão hub</h2>
        <p>O Charlie lê a view PRODUTOS_TECNOSPEED, pesquisa peso e medidas na internet e usa o grupo e o subgrupo web como categoria. Se esses dois estiverem vazios, usa o grupo e o subgrupo do produto. Depois da aprovação o produto sobe à modulo_removido.</p>
      </div>
      <div className="modulo_removido-sync">
        <small>Última leitura</small>
        <b>{dateTime(data?.analyzedAt)}</b>
        <button type="button" disabled={Boolean(busy)} onClick={() => run("analyze")}>
          {busy === "analyze" ? "Lendo..." : "Ler fila do hub"}
        </button>
      </div>
    </section>
    {!selected && notice && <div className="modulo_removido-message success">{notice}</div>}
    {!selected && error && <div className="error">{error}</div>}
    {data?.limitations?.length > 0 && <details className="charlie-sales-limites">
      <summary>Limites desta leitura</summary>
      <ul>{data.limitations.map((limite) => <li key={limite}>{limite}</li>)}</ul>
    </details>}
    <section className="panel modulo_removido-table">
      <header>
        <h3>Produtos da view</h3>
        <small>{data ? `${visible.length} ${filterLabel.toLowerCase()} de ${items.length}` : "Aguardando leitura"}</small>
      </header>
      {items.length > 0 && <div className="charlie-review-toolbar">
        <div className="charlie-review-filters" role="tablist" aria-label="Organizar a fila">
          {REVIEW_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={queueFilter === entry.id}
              className={queueFilter === entry.id ? "ativo" : undefined}
              onClick={() => setQueueFilter(entry.id)}
            >
              {entry.label}<span>{reviewFilterCount(items, entry.id)}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="charlie-review-upload"
          onClick={uploadRun?.running ? requestStopUpload : uploadApproved}
          disabled={uploadRun?.running ? uploadRun.stopping : (!approvedCount || Boolean(busy) || Boolean(batch?.running) || !connected)}
          title={connected ? "Envia à modulo_removido os produtos já aprovados" : "A modulo_removido não está conectada"}
        >
          {uploadRun?.running
            ? (uploadRun.stopping ? "Parando após este produto..." : `Subindo ${Math.min((uploadRun.attempted || 0) + 1, uploadRun.total)} de ${uploadRun.total}`)
            : `Subir aprovados à modulo_removido${approvedCount ? ` (${approvedCount})` : ""}`}
        </button>
      </div>}
      {uploadRun?.running && uploadRun.currentName && (
        <p className="charlie-review-now">Subindo agora: <b>{uploadRun.currentName}</b></p>
      )}
      {uploadRun && !uploadRun.running && uploadRun.failed?.length > 0 && <ul className="charlie-review-fails">
        {uploadRun.failed.map((entry) => <li key={entry.id}><b>{entry.name}</b>: {entry.message}</li>)}
      </ul>}
      {items.length > 0 && <ReviewProgress
        items={items}
        batch={batch}
        blocked={Boolean(busy) || Boolean(uploadRun?.running)}
        onReview={reviewAll}
        onStop={requestStop}
        samples={samples}
        now={now}
      />}
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
            {visible.length ? visible.map((item) => <tr
              key={item.id}
              data-review-id={item.id}
              className={batch?.currentId === item.id || uploadRun?.currentId === item.id ? "charlie-review-row-active" : undefined}
            >
              <td>
                <span className="modulo_removido-product-cell">
                  {item.foto
                    ? <img className="modulo_removido-product-photo" src={item.foto} alt="" />
                    : <span className="modulo_removido-product-photo modulo_removido-product-photo-empty" aria-hidden="true" />}
                  <span>
                    <b>{item.productName}</b>
                    <small>{item.sku ? ` ${item.sku}` : ""}</small>
                  </span>
                </span>
              </td>
              <td>{item.product?.stock ?? "—"}</td>
              <td>{item.product?.price != null ? item.product.price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</td>
              <td>{(item.problems?.length ? item.problems : [item.problem]).map((problem) => <div key={problem}>{problem}</div>)}</td>
              <td><b>{salesPriorityLabel(item.priority)}</b></td>
              <td className="modulo_removido-action-buttons">
                {item.suggestion && ["open", "suggested"].includes(item.status) && (
                  <button
                    type="button"
                    onClick={() => run("approve", item.id)}
                    disabled={Boolean(busy)}
                  >
                    {busy === `approve:${item.id}` ? "Aprovando..." : "Aprovar"}
                  </button>
                )}
                {item.status === "approved" && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => run("unapprove", item.id)}
                    disabled={Boolean(busy)}
                  >
                    {busy === `unapprove:${item.id}` ? "Desaprovando..." : "Desaprovar"}
                  </button>
                )}
                <button
                  type="button"
                  className={item.suggestion && ["open", "suggested"].includes(item.status) ? "secondary" : undefined}
                  onClick={() => { setOpenId(item.id); run("suggest", item.id); }}
                  disabled={Boolean(busy) || item.status === "uploaded"}
                >
                  {busy === item.id ? "Pesquisando e revisando..." : "Revisar com Charlie"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm(confirmRemoval(item.productName))) return;
                    run("remove", item.id);
                  }}
                  disabled={Boolean(busy)}
                >
                  {busy === `remove:${item.id}` ? "Removendo..." : "Remover da lista"}
                </button>
                <small>{salesStatusLabel(item.status)}</small>
              </td>
            </tr>) : <tr>
              <td colSpan="6">
                {items.length
                  ? `Nenhum item em ${filterLabel.toLowerCase()}.`
                  : data?.analyzedAt
                    ? "Nenhum produto elegível na view nesta leitura."
                    : "Execute a leitura para carregar a fila PRODUTOS_TECNOSPEED."}
              </td>
            </tr>}
          </tbody>
        </table>
      </div>
    </section>
    {selected && <div
      className="charlie-review-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.stopPropagation();
      }}
    >
      <section
        className="panel charlie-booster-detail charlie-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="charlie-review-title"
      >
        <header>
          <span className="modulo_removido-product-cell">
            {selected.foto ? <img className="charlie-review-photo" src={selected.foto} alt="" /> : null}
            <h3 id="charlie-review-title">{selected.productName}</h3>
          </span>
          <span className="charlie-review-header-meta">
            <span>{selected.modulo_removidoId ? `modulo_removido #${selected.modulo_removidoId}` : "Ainda sem ID na modulo_removido"}</span>
            <button type="button" className="charlie-review-close" aria-label="Fechar" onClick={() => setOpenId("")}>×</button>
          </span>
        </header>
        <div className="charlie-review-body">
          <ItemProgress
            item={selected}
            researching={busy === selected.id}
            samples={samples}
            startedAt={reviewStartedAt}
            now={now}
          />
          {notice && <div className="modulo_removido-message success">{notice}</div>}
          {error && <div className="error">{error}</div>}
          <p>{selected.recommendation}</p>
          {selected.limitation && <p className="charlie-sales-note">{selected.limitation}</p>}
          <ProductSpecs product={selected.product} />
          {selected.specNote && <p className="charlie-sales-note">{selected.specNote}</p>}
          {selected.specSource && <p className="charlie-sales-note">Fonte da pesquisa: {selected.specSource}</p>}
          {selected.suggestion && <div className="charlie-booster-copy">
            <strong>Texto revisado pelo Charlie</strong>
            <p>{selected.suggestion.name}</p>
            <p>{selected.suggestion.description}</p>
          </div>}
          <div className="modulo_removido-action-buttons">
            {selected.suggestion && ["open", "suggested"].includes(selected.status) && (
              <button type="button" onClick={() => run("approve", selected.id)} disabled={Boolean(busy)}>
                {busy === `approve:${selected.id}` ? "Aprovando..." : "Aprovar"}
              </button>
            )}
            {["open", "suggested"].includes(selected.status) && (
              <button type="button" className="secondary" onClick={() => run("reject", selected.id)} disabled={Boolean(busy)}>Rejeitar</button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (!window.confirm(confirmRemoval(selected.productName))) return;
                run("remove", selected.id);
              }}
              disabled={Boolean(busy)}
            >
              {busy === `remove:${selected.id}` ? "Removendo..." : "Remover da lista"}
            </button>
            {selected.status === "approved" && (
              <button
                type="button"
                className="secondary"
                onClick={() => run("unapprove", selected.id)}
                disabled={Boolean(busy)}
              >
                {busy === `unapprove:${selected.id}` ? "Desaprovando..." : "Desaprovar"}
              </button>
            )}
            {selected.status === "approved" && (
              <button
                type="button"
                onClick={() => run("upload", selected.id)}
                disabled={Boolean(busy) || !connected}
              >
                {busy === selected.id ? "Subindo..." : "Subir à modulo_removido"}
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
        </div>
      </section>
    </div>}
  </div>;
}
