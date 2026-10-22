import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";

const LABELS = {
  planejada: "Planejada", validando: "Validando", executando: "Executando",
  preparando: "Preparando", aguardando_informacoes: "Aguardando informações",
  aguardando_confirmacao: "Aguardando confirmação", em_execucao: "Em execução",
  concluida: "Concluída", concluida_parcial: "Concluída parcialmente",
  falhou: "Falhou", cancelada: "Cancelada", bloqueada: "Bloqueada",
};
const ACTIVE = new Set(["planejada", "validando", "executando", "preparando", "em_execucao", "aguardando_confirmacao"]);
const ICON = { concluida: "✓", concluida_parcial: "!", falhou: "×", cancelada: "—", bloqueada: "!", executando: "↻", em_execucao: "↻" };

function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR");
}
function valueText(value) {
  if (value == null) return "";
  if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return String(value);
}

export default function CharlieTasks({ open, busy, onClose, onAction, onExport, onChanged }) {
  const [filters, setFilters] = useState({ busca: "", status: "", inicio: "", fim: "" });
  const [page, setPage] = useState(1);
  const [tasks, setTasks] = useState([]);
  const [pagination, setPagination] = useState({ pagina: 1, paginas: 1, total: 0 });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [recordSearch, setRecordSearch] = useState("");
  const [recordPage, setRecordPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const known = useRef(new Map());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!open) return;
    if (!quiet) setLoading(true);
    try {
      const data = await api.get("/ia/tarefas", { ...filters, pagina: page, limite: 10 });
      const next = data.tarefas || [];
      if (quiet) {
        for (const task of next) {
          const previous = known.current.get(task.id);
          if (previous && previous !== task.status && ["concluida", "concluida_parcial", "falhou", "cancelada", "aguardando_confirmacao"].includes(task.status)) {
            window.dispatchEvent(new CustomEvent("charlie:tarefa-atualizada", { detail: task }));
          }
        }
      }
      known.current = new Map(next.map((task) => [task.id, task.status]));
      setTasks(next);
      setPagination(data.paginacao || { pagina: 1, paginas: 1, total: next.length });
      setError("");
    } catch (e) {
      if (!quiet) setError(e.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [filters, open, page]);

  const loadDetail = useCallback(async (id = selected?.id) => {
    if (!id || !open) return;
    try {
      const data = await api.get(`/ia/tarefas/${id}`, { busca: recordSearch, pagina: recordPage, limite: 25 });
      setDetail(data);
      setSelected(data.tarefa);
    } catch (e) { setError(e.message); }
  }, [open, recordPage, recordSearch, selected?.id]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (open && selected?.id) loadDetail(selected.id); }, [open, recordPage, recordSearch]);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => {
      load({ quiet: true });
      if (selected?.id) loadDetail(selected.id);
    }, 5000);
    return () => clearInterval(timer);
  }, [load, loadDetail, open, selected?.id]);

  if (!open) return null;
  async function action(task, path, fallback) {
    await onAction(task, path, fallback);
    await load();
    if (selected?.id === task.id) await loadDetail(task.id);
    onChanged?.();
  }
  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  function select(task) {
    setSelected(task);
    setRecordSearch("");
    setRecordPage(1);
    setDetail(null);
    setTimeout(() => loadDetail(task.id), 0);
  }
  const rows = detail?.registros || [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <section className="charlie-tasks" aria-label="Minhas tarefas">
      <header>
        <div><h3>Minhas tarefas</h3><small>{pagination.total} tarefa(s) encontrada(s)</small></div>
        <button type="button" onClick={onClose} aria-label="Fechar tarefas">×</button>
      </header>
      <div className="charlie-task-filters">
        <input aria-label="Pesquisar tarefas" value={filters.busca} onChange={(e) => changeFilter("busca", e.target.value)} placeholder="Pesquisar por tarefa, operação ou código" />
        <select aria-label="Filtrar por situação" value={filters.status} onChange={(e) => changeFilter("status", e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label>De <input type="date" value={filters.inicio} onChange={(e) => changeFilter("inicio", e.target.value)} /></label>
        <label>Até <input type="date" value={filters.fim} onChange={(e) => changeFilter("fim", e.target.value)} /></label>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="charlie-task-panel-body">
        <div className="charlie-task-list">
          {loading ? <p className="muted">Carregando tarefas...</p> : null}
          {!loading && !tasks.length ? <p className="muted">Nenhuma tarefa corresponde aos filtros.</p> : null}
          {tasks.map((task) => (
            <button type="button" key={task.id} className={`charlie-task-list-item ${task.status} ${selected?.id === task.id ? "active" : ""}`} onClick={() => select(task)}>
              <span className="charlie-status-icon" aria-hidden="true">{ICON[task.status] || "•"}</span>
              <span><strong>{task.titulo || `Tarefa ${task.id}`}</strong><small>{LABELS[task.status] || task.status} · {when(task.atualizadaEm)}</small></span>
            </button>
          ))}
          <div className="charlie-pagination">
            <button disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Anterior</button>
            <span>{pagination.pagina} de {pagination.paginas}</span>
            <button disabled={page >= pagination.paginas} onClick={() => setPage((n) => n + 1)}>Próxima</button>
          </div>
        </div>
        <div className="charlie-task-detail">
          {!selected ? <p className="muted">Selecione uma tarefa para consultar etapas, resultados e arquivos.</p> : (
            <>
              <header><div><h4>{selected.titulo}</h4><span className={`charlie-status ${selected.status}`}>{LABELS[selected.status] || selected.status}</span></div><small>Criada em {when(selected.criadaEm)} · atualizada em {when(selected.atualizadaEm)}</small></header>
              <p>{selected.operacao}</p><p>{selected.resumo}</p>
              {selected.etapas?.length ? <ol className="charlie-steps">{selected.etapas.map((step, index) => { const state = step.status || step.situacao; return <li className={state} key={`${step.id || step.nome}-${index}`}><span>{ICON[state] || "○"}</span><div><strong>{step.nome}</strong><small>{LABELS[state] || state}{step.quantidade != null ? ` · ${step.quantidade} registro(s)` : ""}{step.erro ? ` · ${step.erro}` : ""}</small></div></li>; })}</ol> : null}
              {selected.erros?.length ? <div className="charlie-export-error">{selected.erros.join(" ")}</div> : null}
              <div className="charlie-export">
                {selected.podeConfirmar ? <button className="primary" disabled={busy} onClick={() => action(selected, "confirmar", "Não foi possível confirmar a tarefa.")}>Confirmar execução</button> : null}
                {selected.podeRepetir ? <button className="primary" disabled={busy} onClick={() => action(selected, "repetir", "Não foi possível repetir a etapa.")}>Retomar etapa</button> : null}
                {selected.podeCancelar ? <button disabled={busy} onClick={() => action(selected, "cancelar", "Não foi possível cancelar a tarefa.")}>Cancelar</button> : null}
                {selected.temPlanilha ? <><button disabled={busy} onClick={() => onExport(selected, selected.relatorio?.formato || "excel", "abrir")}>Abrir relatório</button><button disabled={busy} onClick={() => onExport(selected, "excel", "salvar")}>Excel</button><button disabled={busy} onClick={() => onExport(selected, "pdf", "salvar")}>PDF</button></> : null}
              </div>
              {selected.confirmacaoExpiraEm ? <small>A prévia pode ser confirmada até {when(selected.confirmacaoExpiraEm)}. Mudanças nos dados exigem nova confirmação.</small> : null}
              {selected.quantidade > 0 ? <div className="charlie-task-records">
                <div className="charlie-evidence-head"><strong>Registros relacionados ({detail?.paginacao?.total ?? selected.quantidade})</strong><input aria-label="Pesquisar registros" value={recordSearch} onChange={(e) => { setRecordSearch(e.target.value); setRecordPage(1); }} placeholder="Pesquisar nos registros" /></div>
                {rows.length ? <div className="table-scroll"><table className="tabela"><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{valueText(row[column])}</td>)}</tr>)}</tbody></table></div> : <p className="muted">Nenhum registro encontrado.</p>}
                <div className="charlie-pagination"><button disabled={recordPage <= 1} onClick={() => setRecordPage((n) => n - 1)}>Anterior</button><span>{detail?.paginacao?.pagina || 1} de {detail?.paginacao?.paginas || 1}</span><button disabled={recordPage >= (detail?.paginacao?.paginas || 1)} onClick={() => setRecordPage((n) => n + 1)}>Próxima</button></div>
              </div> : null}
              {ACTIVE.has(selected.status) ? <small className="charlie-live">Atualização automática ativa</small> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
