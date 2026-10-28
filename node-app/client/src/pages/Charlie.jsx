import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import CharlieAlerts from "./CharlieAlerts.jsx";
import CharlieTasks from "./CharlieTasks.jsx";
import CharlieAutomations, { AutomationCard } from "./CharlieAutomations.jsx";
import CharlieKnowledge from "./CharlieKnowledge.jsx";
import CharlieProfitability from "./CharlieProfitability.jsx";
import CharliePredictive from "./CharliePredictive.jsx";
import CharlieAuditCenter from "./CharlieAuditCenter.jsx";
import CharlieCommercial from "./CharlieCommercial.jsx";
import CharlieSupply from "./CharlieSupply.jsx";
import CharlieResults from "./CharlieResults.jsx";
import CharlieDirector from "./CharlieDirector.jsx";
import CafeManha from "./CafeManha.jsx";
import CharlieConfig from "./CharlieConfig.jsx";

const starterGroups = [
  {
    title: "Pagar e receber",
    items: [
      "O que tenho para pagar hoje?",
      "O que vence amanhã?",
      "Tem alguma conta atrasada?",
      "Quanto preciso pagar até sexta?",
      "Contas a receber vencidas",
      "Contas parcialmente pagas",
      "Saldo dos bancos",
    ],
  },
  {
    title: "Compras e estoque",
    items: [
      "O que preciso comprar hoje?",
      "Risco de ruptura em 15 dias",
      "Ordens de compra pendentes",
      "Top 10 produtos da curva ABC",
      "Quais produtos estão sem estoque?",
    ],
  },
  {
    title: "Resultado e rotina",
    items: [
      "Quanto a empresa poderá faturar nos próximos 30 dias?",
      "Existe risco de faltar dinheiro no próximo mês?",
      "Quanto vendemos neste mês?",
      "Como está minha empresa hoje?",
      "O que você olharia nos relatórios?",
      "Abrir o dia",
      "Clientes devendo há mais de 30 dias, prepare uma cobrança",
      "Faturamento dos últimos seis meses por vendedor em Excel",
      "Gere um Excel com os clientes inadimplentes",
    ],
  },
];
const greeting = {
  role: "assistant",
  text: "Olá! Sou o Charlie, seu assistente financeiro e de compras. Posso analisar contas, bancos e caixa, preparar cobranças, relatórios e simulações. No Modo Diretor, consolido a situação da empresa. Alterações de dados só acontecem depois da confirmação no botão da tarefa.",
  at: Date.now(),
};
const format = (value, column) => {
  if (["TOTAL_RECEBIDO", "SALDO", "VALOR_ORIGINAL", "VALOR_BAIXADO", "TOTAL", "PERIODO_ATUAL", "PERIODO_ANTERIOR", "VALOR_ESTOQUE", "CUSTO_MEDIO", "CUSTO_ESTIMADO"].includes(column)) {
    if (value == null || value === "" || !Number.isFinite(Number(value))) return "não informado";
    return Number(value).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }
  if (column === "QUANDO" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  if (["VENCIMENTO", "DATA_BAIXA", "DATA", "PREVISAO", "ULTIMA_ENTRADA", "DATA_NEGATIVOU"].includes(column) && value) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("pt-BR");
  }
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
const moneyColumns = new Set([
  "TOTAL_RECEBIDO",
  "SALDO",
  "VALOR_ORIGINAL",
  "VALOR_BAIXADO",
  "TOTAL",
  "PERIODO_ATUAL",
  "PERIODO_ANTERIOR",
  "VALOR_ESTOQUE",
  "CUSTO_MEDIO",
  "CUSTO_ESTIMADO",
  "PRECO",
  "PRECO_A",
  "PRECO_B",
  "PRECO_ATUAL",
  "PRECO_NOVO",
  "CUSTO",
  "CUSTO_ANTERIOR",
  "CUSTO_ATUAL",
  "DIFERENCA",
]);
const dateColumns = new Set([
  "VENCIMENTO",
  "DATA_BAIXA",
  "DATA",
  "PREVISAO",
  "ULTIMA_ENTRADA",
  "DATA_NEGATIVOU",
  "ULTIMA_COMPRA",
]);
const columnType = (column, rows) => {
  if (moneyColumns.has(column)) return "moeda";
  if (dateColumns.has(column)) return "data";
  if (rows.some((row) => typeof row?.[column] === "number")) return "numero";
  return "texto";
};
const exportTitle = (text) => {
  const line = String(text || "Dados").split(/[.\n]/)[0].trim();
  return (line || "Dados").slice(0, 80);
};
const fileSlug = (title) => {
  const slug = String(title || "dados")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "dados";
};

const ORIGIN_LABEL = {
  banco: "Valores consultados no banco.",
  calculo_no_banco: "Cálculo feito pelo banco sobre os registros encontrados.",
  calculo: "A soma foi calculada sobre as linhas retornadas, não sobre a base inteira.",
  consolidacao: "Consolidação das fontes já disponíveis do Charlie. Projeções e realizados estão identificados.",
};

function SqlView({ sql, validavel, question, unlocked, onUnlock }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [denied, setDenied] = useState(false);
  if (!sql) return null;
  async function validate(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const data = await api.post("/ia/conhecimento", {
        pergunta: question,
        sql: validavel || sql,
        explicacao: note,
      });
      setMessage(data.mensagem || "Consulta validada.");
    } catch (error) {
      setMessage(error.message || "Não foi possível validar a consulta.");
    } finally {
      setSaving(false);
    }
  }
  function reveal(event) {
    event.preventDefault();
    if (password === "115") {
      onUnlock();
      setDenied(false);
      setPassword("");
      return;
    }
    setDenied(true);
    setPassword("");
  }
  return (
    <div className="charlie-sql">
      <button type="button" className="charlie-sql-toggle" onClick={() => setOpen((current) => !current)}>
        {open ? "▼" : "▶"} Visualizar SQL
      </button>
      {open && !unlocked ? (
        <form className="charlie-sql-lock" onSubmit={reveal}>
          <input
            type="password"
            value={password}
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha"
          />
          <button type="submit">Ver</button>
        </form>
      ) : null}
      {open && denied && !unlocked ? <small className="charlie-sql-error">Senha incorreta.</small> : null}
      {open && unlocked ? (
        <>
          <pre>{sql}</pre>
          {validavel ? (
            <form onSubmit={validate}>
              <input
                value={note}
                maxLength={800}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Por que esta consulta está correta?"
              />
              <button type="submit" disabled={saving || !question}>
                {saving ? "Validando..." : "Validar para reutilizar"}
              </button>
            </form>
          ) : null}
          {message ? <small>{message}</small> : null}
        </>
      ) : null}
    </div>
  );
}

const STATUS_LABEL = {
  planejada: "Planejada",
  validando: "Validando",
  executando: "Executando",
  preparando: "Preparando",
  aguardando_informacoes: "Aguardando informações",
  aguardando_confirmacao: "Aguardando confirmação",
  em_execucao: "Em execução",
  concluida: "Concluída",
  concluida_parcial: "Concluída parcialmente",
  falhou: "Falhou",
  cancelada: "Cancelada",
};

const STEP_ICON = {
  concluida: "✅",
  concluida_parcial: "⚠️",
  executando: "🔄",
  planejada: "⏳",
  aguardando: "⏳",
  falhou: "❌",
  bloqueada: "⛔",
  cancelada: "🚫",
};

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR");
}

function TaskCard({ task, busy, onConfirm, onCancel, onRetry, onExport }) {
  const [open, setOpen] = useState(false);
  if (!task) return null;
  const rows = task.amostra || [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const report = task.relatorio;
  return (
    <div className={`charlie-task ${task.status || ""}`}>
      <strong>{report?.nome || task.titulo || "Tarefa do Charlie"}</strong>
      <p>{task.operacao}</p>
      <p>{task.resumo}</p>
      {report ? (
        <dl className="charlie-report-meta">
          <div><dt>Relatório</dt><dd>{report.nome}</dd></div>
          {report.periodo ? <div><dt>Período</dt><dd>{report.periodo}</dd></div> : null}
          <div><dt>Registros</dt><dd>{report.quantidade ?? task.quantidade ?? 0}</dd></div>
          <div><dt>Formato</dt><dd>{report.formato ? String(report.formato).toUpperCase() : "Consulta"}</dd></div>
          <div><dt>Gerado em</dt><dd>{formatWhen(report.geradoEm)}</dd></div>
          {task.exportacoes ? <div><dt>Exportações</dt><dd>{task.exportacoes}</dd></div> : null}
        </dl>
      ) : null}
      <small>
        Status: {STATUS_LABEL[task.status] || task.status}
        {task.quantidade ? ` · ${task.quantidade} registro(s)` : ""}
        {task.nivel ? ` · nível ${task.nivel}` : ""}
        {task.progresso ? ` · ${task.progresso.concluidas}/${task.progresso.total} etapas` : ""}
      </small>
      {task.status === "aguardando_confirmacao" && task.confirmacaoExpiraEm ? (
        <small>Confirmação válida até {formatWhen(task.confirmacaoExpiraEm)}. Se os dados mudarem, será necessária uma nova prévia.</small>
      ) : null}
      {task.etapas?.length ? (
        <ul>
          {task.etapas.map((step, index) => {
            const state = step.status || step.situacao;
            return (
              <li key={`${step.id || step.nome}-${index}`}>
                {STEP_ICON[state] || "•"} {step.nome}: {STATUS_LABEL[state] || state}
                {step.quantidade != null ? ` (${step.quantidade})` : ""}
                {step.erro ? ` — ${step.erro}` : ""}
              </li>
            );
          })}
        </ul>
      ) : null}
      {task.erros?.length ? <div className="charlie-export-error">{task.erros.slice(0, 5).join(" ")}</div> : null}
      {task.rascunhos?.length ? (
        <div className="charlie-drafts">
          {task.rascunhos.slice(0, 5).map((draft) => (
            <p key={`${draft.clienteId}-${draft.nome}`}>{draft.mensagem}</p>
          ))}
        </div>
      ) : null}
      <div className="charlie-export">
        {rows.length ? <button type="button" disabled={busy} onClick={() => setOpen((value) => !value)}>{open ? "Ocultar registros" : task.podeConfirmar ? "Visualizar alterações" : "Visualizar registros"}</button> : null}
        {task.temPlanilha ? (
          <>
            <button type="button" disabled={busy} onClick={() => onExport(task, report?.formato || "pdf", "abrir")}>Abrir</button>
            <button type="button" disabled={busy} onClick={() => onExport(task, report?.formato || "excel", "salvar")}>Salvar</button>
            <button type="button" disabled={busy} onClick={() => onExport(task, "excel", "salvar")}>Excel</button>
            <button type="button" disabled={busy} onClick={() => onExport(task, "pdf", "salvar")}>PDF</button>
            <button type="button" disabled={busy} onClick={() => onExport(task, "csv", "salvar")}>CSV</button>
          </>
        ) : null}
        {task.podeConfirmar ? <button type="button" className="primary" disabled={busy} onClick={() => onConfirm(task)}>Confirmar execução</button> : null}
        {task.podeRepetir ? <button type="button" className="primary" disabled={busy} onClick={() => onRetry(task)}>Repetir etapa com falha</button> : null}
        {task.podeCancelar ? <button type="button" disabled={busy} onClick={() => onCancel(task)}>Cancelar</button> : null}
      </div>
      {open && rows.length ? (
        <div className="table-scroll">
          <table className="tabela">
            <thead>
              <tr>{columns.map((column) => <th key={column}>{columnLabel(column)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>{columns.map((column) => <td key={column}>{format(row[column], column)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Evidence({ rows, columns, title }) {
  const [exporting, setExporting] = useState(null);
  const [exportError, setExportError] = useState("");
  if (!rows?.length) return null;
  const cols = columns?.length ? columns : Object.keys(rows[0]);
  async function download(formato) {
    if (exporting) return;
    setExporting(formato);
    setExportError("");
    try {
      const response = await fetch("/api/ia/exportar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formato,
          titulo: exportTitle(title),
          colunas: cols.map((col) => ({
            chave: col,
            rotulo: columnLabel(col),
            tipo: columnType(col, rows),
          })),
          linhas: rows.map((row) => {
            const item = {};
            for (const col of cols) item[col] = row?.[col] ?? null;
            return item;
          }),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && data.auth_required)
          window.dispatchEvent(new CustomEvent("dashboard:unauthorized"));
        throw new Error(data.erro || "Não foi possível exportar a planilha.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileSlug(exportTitle(title))}.${formato === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error.message || "Não foi possível exportar a planilha.");
    } finally {
      setExporting(null);
    }
  }
  return (
    <div className="charlie-evidence">
      <div className="charlie-evidence-head">
        <span>
          Planilha ({rows.length} registro{rows.length === 1 ? "" : "s"})
        </span>
        <div className="charlie-export">
          <button type="button" disabled={!!exporting} onClick={() => download("excel")}>
            {exporting === "excel" ? "Gerando..." : "Excel"}
          </button>
          <button type="button" disabled={!!exporting} onClick={() => download("pdf")}>
            {exporting === "pdf" ? "Gerando..." : "PDF"}
          </button>
        </div>
      </div>
      {exportError ? <div className="charlie-export-error">{exportError}</div> : null}
      <details>
        <summary>Ver dados da resposta</summary>
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
    </div>
  );
}

function CharlieMark() {
  return (
    <span className="charlie-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <rect width="48" height="48" rx="15" fill="#1b5cb8" />
        <rect x="10" y="28" width="7" height="9" rx="2.2" fill="#fff" />
        <rect x="20.5" y="21" width="7" height="16" rx="2.2" fill="#fff" />
        <rect x="31" y="13" width="7" height="24" rx="2.2" fill="#fff" />
        <path d="M35.2 3.4l1.55 3.55 3.55 1.55-3.55 1.55-1.55 3.55-1.55-3.55-3.55-1.55 3.55-1.55z" fill="#ffe08a" />
      </svg>
    </span>
  );
}

export default function Charlie({ alertLaunch = 0, dailyToken = "" }) {
  const [messages, setMessages] = useState([greeting]),
    [threads, setThreads] = useState([]),
    [activeId, setActiveId] = useState(null),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ollama, setOllama] = useState(null),
    [sqlUnlocked, setSqlUnlocked] = useState(false),
    [alertsOpen, setAlertsOpen] = useState(false),
    [alertCount, setAlertCount] = useState(0),
    [tasksOpen, setTasksOpen] = useState(false),
    [automationsOpen, setAutomationsOpen] = useState(false),
    [knowledgeOpen, setKnowledgeOpen] = useState(false),
    [profitabilityOpen, setProfitabilityOpen] = useState(false),
    [predictiveOpen, setPredictiveOpen] = useState(false),
    [auditOpen, setAuditOpen] = useState(false),
    [commercialOpen, setCommercialOpen] = useState(false),
    [supplyOpen, setSupplyOpen] = useState(false),
    [resultsOpen, setResultsOpen] = useState(false),
    [directorOpen, setDirectorOpen] = useState(false),
    [dailyOpen, setDailyOpen] = useState(Boolean(dailyToken)),
    [configOpen, setConfigOpen] = useState(false),
    [taskCount, setTaskCount] = useState(0),
    [notice, setNotice] = useState(null);
  const endRef = useRef(null),
    threadRef = useRef(null),
    inputRef = useRef(null),
    historyRef = useRef(null);
  const fresh = !activeId && messages.every((message) => message.role !== "user");
  function closeHistory() {
    if (historyRef.current) historyRef.current.open = false;
  }
  async function loadThreads() {
    try {
      const data = await api.get("/ia/conversas");
      setThreads(data.conversas || []);
    } catch {
      setThreads([]);
    }
  }
  function loadAlertCount() {
    api.get("/ia/alertas/contador").then((data) => setAlertCount(Number(data.total || 0))).catch(() => setAlertCount(0));
  }
  function loadTaskCount() {
    api.get("/ia/tarefas", { status: "aguardando_confirmacao", limite: 5 })
      .then((data) => setTaskCount(Number(data.paginacao?.total || 0))).catch(() => setTaskCount(0));
  }
  useEffect(() => {
    loadThreads();
    loadAlertCount();
    loadTaskCount();
    let stopStatus = false;
    const loadOllama = () => api.get("/ia/ollama/status").then((data) => { if (!stopStatus) setOllama(data); }).catch(() => { if (!stopStatus) setOllama({ online: false }); });
    loadOllama();
    const statusTimer = setInterval(loadOllama, 20000);
    const open = () => setAlertsOpen(true);
    const updated = (event) => {
      const task = event.detail;
      setNotice({ id: `${task.id}-${task.status}-${Date.now()}`, text: `${task.titulo}: ${STATUS_LABEL[task.status] || task.status}.`, status: task.status });
      loadTaskCount();
    };
    window.addEventListener("charlie:abrir-alertas", open);
    window.addEventListener("charlie:tarefa-atualizada", updated);
    return () => {
      stopStatus = true;
      clearInterval(statusTimer);
      window.removeEventListener("charlie:abrir-alertas", open);
      window.removeEventListener("charlie:tarefa-atualizada", updated);
    };
  }, []);
  useEffect(() => {
    if (alertLaunch > 0) setAlertsOpen(true);
  }, [alertLaunch]);
  useEffect(() => {
    const timer = setInterval(async () => {
      const active = messages.map((message) => message.tarefa).filter((task) => task?.id && ["planejada", "validando", "executando", "preparando", "em_execucao", "aguardando_confirmacao"].includes(task.status));
      if (!active.length) return;
      const refreshed = await Promise.all(active.map((task) => api.get(`/ia/tarefas/${task.id}`).catch(() => null)));
      const byId = new Map(refreshed.filter(Boolean).map((item) => [item.tarefa.id, item.tarefa]));
      setMessages((current) => current.map((message) => {
        if (!message.tarefa?.id || !byId.has(message.tarefa.id)) return message;
        const next = byId.get(message.tarefa.id);
        if (next.status !== message.tarefa.status && ["concluida", "concluida_parcial", "falhou", "cancelada", "aguardando_confirmacao"].includes(next.status))
          window.dispatchEvent(new CustomEvent("charlie:tarefa-atualizada", { detail: next }));
        return { ...message, tarefa: next };
      }));
    }, 5000);
    return () => clearInterval(timer);
  }, [messages]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (fresh) {
      if (threadRef.current) threadRef.current.scrollTop = 0;
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, fresh]);
  function newConversation() {
    closeHistory();
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
      closeHistory();
      setMessages(
        (data.messages || []).map((item) => ({
          role: item.role,
          text: item.text,
          data: item.data,
          columns: item.data?.[0] ? Object.keys(item.data[0]) : [],
          sql: item.sql,
          sqlValidavel: item.sqlValidavel,
          origem: item.origem,
          suggestions: item.suggestions,
          alerts: item.alerts,
          tarefa: item.tarefa,
          automacao: item.automacao,
          fontes: item.sources || item.fontes,
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
  async function ask(value = question, conversationId = activeId) {
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
        contexto: conversationId ? { conversaId: conversationId } : undefined,
      });
      setActiveId(Number(result.conversaId));
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: result.resposta,
          data: result.dados,
          columns: result.colunas,
          sql: result.sql,
          sqlValidavel: result.sqlValidavel,
          origem: result.origem,
          suggestions: result.sugestoes,
          alerts: result.alertas,
          tarefa: result.tarefa,
          automacao: result.automacao,
          fontes: result.fontes,
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
  function appendTaskResult(data, fallback) {
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: data.resposta || data.erro || fallback,
        data: data.dados,
        columns: data.colunas || (data.dados?.[0] ? Object.keys(data.dados[0]) : []),
        tarefa: data.tarefa,
        origem: data.origem,
        at: Date.now(),
      },
    ]);
  }
  async function postTask(task, path, fallback) {
    if (!task?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/ia/tarefas/${task.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(path === "confirmar" ? { confirmar: true } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && data.auth_required) window.dispatchEvent(new CustomEvent("dashboard:unauthorized"));
      appendTaskResult(data, data.erro || fallback);
      if (!response.ok && data.erro) setError(data.erro);
      loadThreads();
      loadTaskCount();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportTask(task, formato, destino = "salvar") {
    if (!task?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/ia/tarefas/${task.id}/exportar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formato }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.erro || "Não foi possível exportar a tarefa.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get("Content-Disposition") || "";
      const named = disposition.match(/filename="([^"]+)"/);
      const extension = formato === "pdf" ? "pdf" : formato === "csv" ? "csv" : "xlsx";
      if (destino === "abrir") {
        const tab = window.open(url, "_blank", "noopener");
        if (!tab) {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener";
          document.body.appendChild(link);
          link.click();
          link.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = named?.[1] || `charlie-tarefa-${task.id}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function feedback(message, kind) {
    try {
      await api.post("/ia/memoria/feedback", { kind, answer: message.text, sourceIds: (message.fontes || []).map((source) => source.id) });
      setNotice({ id: `feedback-${Date.now()}`, text: "Avaliação registrada para revisão.", status: "concluida" });
    } catch (e) { setError(e.message); }
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
            <CharlieMark />
            <div>
              <h2>Charlie</h2>
              <small className={busy || (ollama?.online && ollama?.modelAvailable !== false) ? "" : "offline"}>
                {busy
                  ? "analisando..."
                  : ollama?.online && ollama?.modelAvailable === false
                    ? `Ollama online · modelo ${ollama.model} ausente`
                    : ollama?.online
                      ? `Ollama online · ${ollama.model}`
                      : ollama?.reason === "not-installed"
                        ? "regras locais · Ollama não instalado"
                        : "regras locais · Ollama offline"}
              </small>
            </div>
          </div>
          <div className="charlie-header-actions">
            <button onClick={() => setDailyOpen(true)}>Charlie Daily</button>
            <button onClick={() => setConfigOpen(true)}>Configuração</button>
            <button onClick={() => setTasksOpen(true)}>
              Minhas tarefas{taskCount > 0 ? <span className="charlie-count warning">{taskCount}</span> : null}
            </button>
            <button onClick={() => setAlertsOpen(true)}>
              Alertas{alertCount > 0 ? <span className="charlie-count">{alertCount}</span> : null}
            </button>
            <details className="charlie-tools-menu charlie-history-menu" ref={historyRef}>
              <summary>
                Conversas
                {threads.length > 0 ? <span className="charlie-count neutral">{threads.length}</span> : null}
              </summary>
              <div>
                {threads.map((item) => (
                  <div
                    key={item.id}
                    className={`charlie-thread-item ${Number(activeId) === Number(item.id) ? "active" : ""}`}
                  >
                    <button type="button" className="charlie-thread-open" onClick={() => openConversation(item.id)}>
                      <strong>{item.title}</strong>
                      <small>{item.messages} mensagem(ns)</small>
                    </button>
                    <span>
                      <button type="button" title="Renomear" onClick={(event) => renameThread(item, event)}>✎</button>
                      <button type="button" title="Excluir" onClick={(event) => removeThread(item, event)}>×</button>
                    </span>
                  </div>
                ))}
                {!threads.length && <p className="charlie-history-empty">Nenhuma conversa gravada.</p>}
              </div>
            </details>
            <button className="charlie-new" onClick={newConversation}>Nova conversa</button>
            <details className="charlie-tools-menu">
              <summary>Recursos</summary>
              <div onClick={(event) => { if (event.target.closest("button")) event.currentTarget.parentElement.open = false; }}>
                <button onClick={() => setProfitabilityOpen(true)}>Rentabilidade</button>
                <button onClick={() => setPredictiveOpen(true)}>Previsões e simulações</button>
                <button onClick={() => setAuditOpen(true)}>Central de auditoria</button>
                <button onClick={() => setCommercialOpen(true)}>Inteligência comercial</button>
                <button onClick={() => setSupplyOpen(true)}>Compras e abastecimento</button>
                <button onClick={() => setResultsOpen(true)}>Resultados do Charlie</button>
                <button onClick={() => setDirectorOpen(true)}>Modo Diretor</button>
                <button onClick={() => setAutomationsOpen(true)}>Automações</button>
                <button onClick={() => setKnowledgeOpen(true)}>Conhecimento</button>
              </div>
            </details>
          </div>
        </div>
        {alertsOpen && (
          <CharlieAlerts
            onClose={() => { setAlertsOpen(false); loadAlertCount(); }}
            onInvestigate={async (alert) => {
              try {
                const data = await api.post(`/ia/alertas/${alert.id}/investigar`);
                setAlertsOpen(false);
                await openConversation(data.conversaId);
                loadThreads();
                loadAlertCount();
              } catch (e) {
                setError(e.message);
              }
            }}
            onAction={async (alert, recommendation) => {
              try {
                const data = await api.post(`/ia/alertas/${alert.id}/recomendacoes/${encodeURIComponent(recommendation.id)}/executar`, {
                  conversaId: conversationId || undefined,
                });
                setAlertsOpen(false);
                appendTaskResult(data, "Não foi possível preparar a ação sugerida.");
                loadThreads();
                loadTaskCount();
                loadAlertCount();
              } catch (e) {
                setError(e.message);
              }
            }}
          />
        )}
        <CharlieTasks
          open={tasksOpen}
          busy={busy}
          onClose={() => setTasksOpen(false)}
          onAction={postTask}
          onExport={exportTask}
          onChanged={loadTaskCount}
        />
        <CharlieAutomations open={automationsOpen} onClose={() => setAutomationsOpen(false)} />
        <CharlieKnowledge open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
        <CharlieProfitability open={profitabilityOpen} onClose={() => setProfitabilityOpen(false)} onInvestigate={(occurrence) => { setProfitabilityOpen(false); ask(`Charlie, por que a venda ${occurrence.sale} do produto ${occurrence.product} apresentou resultado de contribuição de ${Number(occurrence.contributionMargin || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}?`); }} />
        <CharliePredictive open={predictiveOpen} onClose={() => setPredictiveOpen(false)} />
        <CharlieAuditCenter open={auditOpen} onClose={() => setAuditOpen(false)} onInvestigate={async (alert) => { try { const result = await api.post(`/ia/alertas/${alert.id}/investigar`); setAuditOpen(false); await openConversation(result.conversaId); loadThreads(); } catch (e) { setError(e.message); } }} />
        <CharlieCommercial open={commercialOpen} onClose={() => setCommercialOpen(false)} onInvestigate={(item) => { setCommercialOpen(false); ask(`Charlie, investigue a oportunidade ${item.id} do cliente ${item.customer}. Use apenas as evidências registradas e não presuma a causa.`); }} />
        <CharlieSupply open={supplyOpen} onClose={() => setSupplyOpen(false)} onInvestigate={(item) => { setSupplyOpen(false); ask(`Charlie, explique por que recomendou comprar ${item.product}. Mostre estoque disponível, demanda, prazo, segurança, pedidos pendentes e cálculo, sem inventar dados ausentes.`); }} />
        <CharlieResults open={resultsOpen} onClose={() => setResultsOpen(false)} onInvestigate={async (item) => { try { const result = await api.get(`/ia/resultados/beneficios/${item.id}/investigar`); const detail = result.investigacao; setResultsOpen(false); setMessages((current) => [...current, { role: "user", text: `Charlie, de onde veio o indicador ${item.id}?`, at: Date.now() }, { role: "assistant", text: `${detail.explanation}${detail.limitations?.length ? ` Limitações: ${detail.limitations.join("; ")}.` : ""}`, data: (detail.evidence || []).map((evidence) => ({ TIPO: evidence.type, FONTE: evidence.source, REGISTRO: evidence.recordId, DESCRICAO: evidence.description, VERIFICADA: evidence.verified ? "Sim" : "Não" })), columns: ["TIPO", "FONTE", "REGISTRO", "DESCRICAO", "VERIFICADA"], origem: "Charlie Value Intelligence", at: Date.now() }]); } catch (e) { setError(e.message); } }} />
        <CharlieDirector open={directorOpen} onClose={() => setDirectorOpen(false)} onAsk={(text) => { setDirectorOpen(false); ask(text); }} />
        <CafeManha open={dailyOpen} token={dailyToken} onClose={() => setDailyOpen(false)} />
        <CharlieConfig open={configOpen} onClose={() => setConfigOpen(false)} />
        {notice ? <button type="button" className={`charlie-notice ${notice.status}`} onClick={() => { setTasksOpen(true); setNotice(null); }}>{notice.text}<span>Ver tarefa</span></button> : null}
        <div className={`charlie-thread${fresh ? " is-fresh" : ""}`} ref={threadRef}>
          {fresh ? (
            <div className="charlie-fresh">
              <div className="charlie-starter-groups">
                {starterGroups.map((group) => (
                  <section key={group.title} className="charlie-starter-group">
                    <h3>{group.title}</h3>
                    {group.items.map((item) => (
                      <button key={item} type="button" disabled={busy} onClick={() => ask(item)}>
                        {item}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </div>
          ) : null}
          {!fresh && messages.map((message, index) => (
            <article key={index} className={`charlie-message ${message.role}`}>
              <div>{message.text}</div>
              {message.origem && ORIGIN_LABEL[message.origem] ? (
                <small className="charlie-origem">{ORIGIN_LABEL[message.origem]}</small>
              ) : null}
              {message.alerts?.map((alert, i) => (
                <div className="charlie-alert" key={i}>
                  {alert.texto}
                </div>
              ))}
              <Evidence rows={message.data} columns={message.columns} title={message.text} />
              {message.fontes?.length ? <div className="charlie-sources"><strong>Fontes</strong>{message.fontes.map((source) => source.original ? <a key={`${source.id}-${source.version}`} href={`/api/ia/memoria/${source.id}/original`} target="_blank" rel="noreferrer">{source.title} · versão {source.version} · {source.section} · {new Date(source.updatedAt).toLocaleDateString("pt-BR")}</a> : <span key={`${source.id}-${source.version}`}>{source.title} · versão {source.version} · {source.section} · {new Date(source.updatedAt).toLocaleDateString("pt-BR")}</span>)}</div> : null}
              {message.role === "assistant" && message.fontes?.length ? <div className="charlie-feedback"><span>Esta resposta ajudou?</span><button onClick={() => feedback(message, "util")}>Útil</button><button onClick={() => feedback(message, "incorreta")}>Incorreta</button><button onClick={() => feedback(message, "desatualizada")}>Desatualizada</button></div> : null}
              <TaskCard
                task={message.tarefa}
                busy={busy}
                onConfirm={(task) => postTask(task, "confirmar", "Não foi possível confirmar a tarefa.")}
                onCancel={(task) => postTask(task, "cancelar", "Não foi possível cancelar a tarefa.")}
                onRetry={(task) => postTask(task, "repetir", "Não foi possível repetir a etapa.")}
                onExport={exportTask}
              />
              <AutomationCard automation={message.automacao} onChanged={(automacao) => setMessages((current) => current.map((entry) => entry.automacao?.id === automacao.id ? { ...entry, automacao } : entry))} />
              <SqlView
                sql={message.sql}
                validavel={message.sqlValidavel}
                question={messages[index - 1]?.role === "user" ? messages[index - 1].text : ""}
                unlocked={sqlUnlocked}
                onUnlock={() => setSqlUnlocked(true)}
              />
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
          {fresh ? null : <div ref={endRef} />}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="charlie-composer">
          <textarea
            ref={inputRef}
            data-charlie-control="charlie-composer"
            rows="1"
            maxLength="500"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={keyDown}
            placeholder="Ex.: O que preciso comprar hoje?"
            disabled={busy}
          />
          <button
            className="primary"
            data-charlie-control="charlie-send"
            disabled={busy || !question.trim()}
            onClick={() => ask()}
          >
            Enviar
          </button>
        </div>
      </div>
    </section>
  );
}
