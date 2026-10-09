import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import SearchableSelect from "../components/SearchableSelect.jsx";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const number = (value) => Number(value || 0).toLocaleString("pt-BR");
const isMoneyColumn = (column) =>
  column.align === "money" ||
  /(^|_)(VALOR|TOTAL|ENTRADAS|SAIDAS|SALDO|FATURAMENTO)(_|$)|^m\d+$/i.test(
    column.key,
  );
const displayDate = (value) => {
  const normalized = String(value || "").slice(0, 10);
  if (!normalized || normalized <= "1899-12-30") return "—";
  return normalized.split("-").reverse().join("/");
};
const iso = (value) => value.toISOString().slice(0, 10);
const defaultPeriod = () => {
  const end = new Date(),
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { data_ini: iso(start), data_fim: iso(end) };
};
const titles = {
  stock: ["Estoque", "Posição, rupturas e itens que exigem reposição."],
  customers: [
    "Clientes",
    "Carteira, inadimplência, recompra e risco de perda.",
  ],
  cash: [
    "Controle de caixa",
    "Entradas, saídas e saldo operacional por caixa.",
  ],
  dre: ["DRE completo", "Resultado gerencial mensal por plano de contas."],
};

function Kpis({ items }) {
  return (
    <section className="finance-summary management-kpis">
      {items.map((item) => (
        <article key={item.label}>
          <small>{item.label}</small>
          <strong className={item.tone || ""}>{item.value}</strong>
          <span>{item.detail}</span>
        </article>
      ))}
    </section>
  );
}
function Table({
  columns,
  rows,
  empty = "Nenhum registro encontrado.",
  groupableColumns = [],
}) {
  const [sort, setSort] = useState({ key: null, direction: "asc" }),
    [groupKey, setGroupKey] = useState("");
  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const column = columns.find((item) => item.key === sort.key);
    return [...rows].sort((a, b) => {
      const left = column?.sortValue ? column.sortValue(a) : a[sort.key],
        right = column?.sortValue ? column.sortValue(b) : b[sort.key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      const leftNumber = Number(left),
        rightNumber = Number(right),
        comparison =
          Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
            ? leftNumber - rightNumber
            : String(left).localeCompare(String(right), "pt-BR", {
                numeric: true,
                sensitivity: "base",
              });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [columns, rows, sort]);
  const groupedRows = useMemo(() => {
    if (!groupKey) return [{ key: "all", label: "", rows: sortedRows }];
    const column = columns.find((item) => item.key === groupKey),
      groups = new Map();
    for (const row of sortedRows) {
      const value = row[groupKey],
        key = String(value ?? "Não informado");
      if (!groups.has(key))
        groups.set(key, {
          key,
          label: column?.render
            ? column.render(row)
            : (value ?? "Não informado"),
          rows: [],
        });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }, [columns, groupKey, sortedRows]);
  function orderBy(key) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }
  return (
    <div className="table-scroll">
      {!!groupableColumns.length && (
        <div className="table-group-control">
          <label htmlFor="table-group-select">Agrupar por</label>
          <select
            id="table-group-select"
            value={groupKey}
            onChange={(event) => setGroupKey(event.target.value)}
          >
            <option value="">Sem agrupamento</option>
            {groupableColumns.map((key) => {
              const column = columns.find((item) => item.key === key);
              return (
                <option key={key} value={key}>
                  {column?.label || key}
                </option>
              );
            })}
          </select>
        </div>
      )}
      <table className="tabela">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={isMoneyColumn(c) ? "money-cell" : ""}
                aria-sort={
                  sort.key === c.key
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="table-sort-button"
                  onClick={() => orderBy(c.key)}
                  title={`Ordenar por ${c.label}`}
                >
                  {c.label}
                  <span aria-hidden="true">
                    {sort.key === c.key
                      ? sort.direction === "asc"
                        ? "▲"
                        : "▼"
                      : "↕"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groupedRows.map((group) => (
            <React.Fragment key={group.key}>
              {groupKey && (
                <tr className="table-group-row">
                  <td colSpan={columns.length}>
                    <strong>{group.label}</strong>
                    <span>
                      {group.rows.length} registro(s)
                      {group.rows.some((row) => row.VALOR != null) &&
                        ` · ${money(group.rows.reduce((sum, row) => sum + Number(row.VALOR || 0), 0))}`}
                    </span>
                  </td>
                </tr>
              )}
              {group.rows.map((row, i) => (
                <tr
                  key={
                    row.id || row.CONTROLE || row.CODIGO || `${group.key}-${i}`
                  }
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`${c.className?.(row) || ""} ${isMoneyColumn(c) ? "money-cell" : ""}`.trim()}
                    >
                      {c.render ? c.render(row) : (row[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {!sortedRows.length && <div className="overview-empty">{empty}</div>}
    </div>
  );
}

function CashActionModal({ mode, row, filter, options, onClose, onDone }) {
  const [form, setForm] = useState({
    caixa_destino: "",
    valor: "",
    valor_contado: "",
    forma: "",
    historico: "",
  });
  const [assessment, setAssessment] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const set = (name, value) =>
    setForm((current) => ({ ...current, [name]: value }));
  useEffect(() => {
    if (mode !== "fechar") return;
    api
      .get("/financeiro/controle-caixa/apuracao", {
        empresa: filter.empresa,
        caixa: filter.caixa,
        data: filter.data,
      })
      .then((result) => setAssessment(result.apuracao))
      .catch((e) => setError(e.message));
  }, [filter.caixa, filter.data, filter.empresa, mode]);
  const destinationOptions = (options.caixas || [])
    .filter(
      (item) => String(item.CDCAIXA) !== String(row?.CDCAIXA || filter.caixa),
    )
    .map((item) => ({ value: item.CDCAIXA, label: item.CAIXA }));
  const difference =
    Number(form.valor_contado || 0) - Number(assessment?.SALDO || 0);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let result;
      if (mode === "abrir")
        result = await api.post("/financeiro/controle-caixa/abrir", {
          empresa: filter.empresa,
          caixa: filter.caixa,
          data: filter.data,
          valor_inicial: form.valor,
          observacao: form.historico,
        });
      else if (mode === "fechar")
        result = await api.post("/financeiro/controle-caixa/fechar", {
          empresa: filter.empresa,
          caixa: filter.caixa,
          data: filter.data,
          valor_contado: form.valor_contado,
          observacao: form.historico,
        });
      else if (mode === "valor")
        result = await api.post("/financeiro/controle-caixa/transferir-valor", {
          empresa: filter.empresa,
          caixa_origem: filter.caixa,
          caixa_destino: form.caixa_destino,
          data: filter.data,
          valor: form.valor,
          forma: form.forma,
          historico: form.historico,
        });
      else
        result = await api.post("/financeiro/controle-caixa/mover", {
          origem: row.ORIGEM,
          movimento: row.IDMOVIMENTO,
          empresa: row.IDEMPRESA,
          caixa_atual: row.CDCAIXA,
          caixa_destino: form.caixa_destino,
        });
      await onDone(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === "abrir"
      ? "Abertura de caixa"
      : mode === "fechar"
        ? "Fechamento de caixa"
      : mode === "valor"
        ? "Transferência de valor"
        : row?.ORIGEM === "PENDENTE"
          ? "Transferir parcela"
          : "Transferir movimento";
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>{title}</h2>
        {mode === "abrir" && (
          <>
            <p>
              Informe o valor disponível no início de {filter.data.split("-").reverse().join("/")}.
            </p>
            <label>
              Valor inicial
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.valor}
                onChange={(e) => set("valor", e.target.value)}
                required
              />
            </label>
          </>
        )}
        {mode === "fechar" && (
          <>
            <p>
              {filter.data.split("-").reverse().join("/")} · saldo apurado{" "}
              <strong>{money(assessment?.SALDO)}</strong>
            </p>
            <div className="finance-calc">
              <span>Entradas: {money(assessment?.ENTRADAS)}</span>
              <span>Saídas: {money(assessment?.SAIDAS)}</span>
              <span>{number(assessment?.QTD_MOVIMENTOS)} movimento(s)</span>
            </div>
            <label>
              Valor contado
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.valor_contado}
                onChange={(e) => set("valor_contado", e.target.value)}
                required
              />
            </label>
            <div className="finance-calc">
              <strong>Diferença: {money(difference)}</strong>
            </div>
          </>
        )}
        {mode === "valor" && (
          <>
            <p>
              O sistema criará uma saída no caixa atual e uma entrada de mesmo
              valor no destino.
            </p>
            <label>
              Valor
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.valor}
                onChange={(e) => set("valor", e.target.value)}
                required
              />
            </label>
            <label>
              Forma
              <select
                value={form.forma}
                onChange={(e) => set("forma", e.target.value)}
              >
                <option value="">Dinheiro/padrão</option>
                {options.formas?.map((item) => (
                  <option key={item.CDRECEBTO} value={item.CDRECEBTO}>
                    {item.FORMA}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {mode === "mover" && (
          <div className="finance-calc">
            <span>{row.DESCRICAO}</span>
            <span>
              {row.DOCUMENTO}
              {row.PARCELA ? ` · parcela ${row.PARCELA}` : ""}
            </span>
            <strong>{money(row.VALOR)}</strong>
          </div>
        )}
        {["valor", "mover"].includes(mode) && (
          <label>
            Caixa de destino
            <SearchableSelect
              value={form.caixa_destino}
              onChange={(value) => set("caixa_destino", value)}
              placeholder="Digite para buscar"
              options={destinationOptions}
            />
          </label>
        )}
        {mode !== "mover" && (
          <label>
            Observação
            <textarea
              rows="3"
              maxLength="180"
              value={form.historico}
              onChange={(e) => set("historico", e.target.value)}
            />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Processando..." : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ManagementDashboard({ type }) {
  const [period, setPeriod] = useState(defaultPeriod),
    [dreType, setDreType] = useState("competencia"),
    [data, setData] = useState({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(""),
    [cashAction, setCashAction] = useState(null),
    [cashRow, setCashRow] = useState(null);
  const [cashFilter, setCashFilter] = useState({
    empresa: "",
    caixa: "",
    data: iso(new Date()),
  });
  async function load() {
    setLoading(true);
    setError("");
    try {
      if (type === "stock") {
        const summary = await api.get("/estoque/resumo");
        const low = await api.get("/estoque/baixo", { limite: 100 });
        const negative = await api.get("/estoque/negativos");
        setData({
          summary: summary.dados?.[0] || summary,
          low: low.dados || [],
          negative: negative.dados || [],
        });
      }
      if (type === "customers") {
        const customerPeriod = {
          data_inicio: period.data_ini,
          data_fim: period.data_fim,
        };
        const kpis = await api.get("/clientes/kpis", customerPeriod);
        const ranking = await api.get("/clientes/ranking", customerPeriod);
        const late = await api.get("/clientes/inadimplencia", customerPeriod);
        setData({ kpis, ranking: ranking.dados || [], late: late.dados || [] });
      }
      if (type === "dre")
        setData(await api.get("/dre-completo", { ...period, tipo: dreType }));
      if (type === "cash") {
        const options =
          data.options || (await api.get("/financeiro/controle-caixa/opcoes"));
        const selected = {
          ...cashFilter,
          empresa: cashFilter.empresa || options.empresas?.[0]?.IDEMPRESA || "",
          caixa: cashFilter.caixa || options.caixas?.[0]?.CDCAIXA || "",
        };
        setCashFilter(selected);
        const [result, closingData, transferData] =
          selected.empresa && selected.caixa
            ? await Promise.all([
                api.get("/financeiro/controle-caixa", {
                  ...selected,
                  inicio: selected.data,
                  fim: selected.data,
                  limite: 200,
                }),
                api.get("/financeiro/controle-caixa/fechamentos", {
                  empresa: selected.empresa,
                  caixa: selected.caixa,
                  limite: 20,
                }),
                api.get("/financeiro/controle-caixa/transferencias", {
                  empresa: selected.empresa,
                  caixa: selected.caixa,
                  limite: 50,
                }),
              ])
            : [{}, {}, {}];
        setData({
          options,
          ...result,
          fechamentos: closingData.fechamentos || [],
          transferencias: transferData.transferencias || [],
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [type]);
  const customerKpis = data.kpis?.kpis || data.kpis?.dados?.[0] || {};
  const cashByHour = useMemo(() => {
    const hours = new Map();
    for (const row of data.movimentos || []) {
      const hour = Number(row.HORA);
      if (!Number.isInteger(hour)) continue;
      const current = hours.get(hour) || {
        HORA: hour,
        ATENDIMENTOS: 0,
        ENTRADAS: 0,
        SAIDAS: 0,
        SALDO: 0,
      };
      const value = Number(row.VALOR || 0);
      current.ATENDIMENTOS += 1;
      if (row.ORIGEM !== "PENDENTE") {
        current.ENTRADAS += value >= 0 ? value : 0;
        current.SAIDAS += value < 0 ? Math.abs(value) : 0;
        current.SALDO += value;
      }
      hours.set(hour, current);
    }
    const rows = [...hours.values()].sort((a, b) => a.HORA - b.HORA);
    const peak = Math.max(1, ...rows.map((row) => row.ATENDIMENTOS));
    return rows.map((row) => ({
      ...row,
      INTENSIDADE: (row.ATENDIMENTOS / peak) * 100,
    }));
  }, [data.movimentos]);

  return (
    <div className="management-page">
      <section className="panel management-toolbar">
        <div>
          <h2>{titles[type][0]}</h2>
          <p>{titles[type][1]}</p>
        </div>
        <div className="management-filters">
          {["customers", "dre"].includes(type) && (
            <>
              <label>
                De
                <input
                  type="date"
                  value={period.data_ini}
                  onChange={(e) =>
                    setPeriod((p) => ({ ...p, data_ini: e.target.value }))
                  }
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  value={period.data_fim}
                  onChange={(e) =>
                    setPeriod((p) => ({ ...p, data_fim: e.target.value }))
                  }
                />
              </label>
            </>
          )}
          {type === "cash" && (
            <>
              <label>
                Empresa
                <SearchableSelect
                  value={cashFilter.empresa}
                  onChange={(value) =>
                    setCashFilter((f) => ({ ...f, empresa: value }))
                  }
                  placeholder="Digite a empresa"
                  options={(data.options?.empresas || []).map((x) => ({
                    value: x.IDEMPRESA,
                    label: x.EMPRESA,
                  }))}
                />
              </label>
              <label>
                Caixa
                <SearchableSelect
                  value={cashFilter.caixa}
                  onChange={(value) =>
                    setCashFilter((f) => ({ ...f, caixa: value }))
                  }
                  placeholder="Digite o caixa"
                  options={(data.options?.caixas || []).map((x) => ({
                    value: x.CDCAIXA,
                    label: x.CAIXA,
                  }))}
                />
              </label>
              <label>
                Data
                <input
                  type="date"
                  value={cashFilter.data}
                  onChange={(e) =>
                    setCashFilter((f) => ({ ...f, data: e.target.value }))
                  }
                />
              </label>
            </>
          )}
          {type === "dre" && (
            <label>
              Visão
              <select
                value={dreType}
                onChange={(e) => setDreType(e.target.value)}
              >
                <option value="competencia">Competência</option>
                <option value="vencimento">Vencimento</option>
              </select>
            </label>
          )}
          <button onClick={load} disabled={loading}>
            {loading ? "Carregando..." : "Atualizar"}
          </button>
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      {notice && <div className="success">{notice}</div>}
      {type === "stock" && (
        <>
          <Kpis
            items={[
              {
                label: "Produtos",
                value: number(data.summary?.TOTAL_PRODUTOS),
              },
              {
                label: "Com estoque",
                value: number(data.summary?.COM_ESTOQUE),
                tone: "positive",
              },
              {
                label: "Sem estoque",
                value: number(data.summary?.SEM_ESTOQUE),
                tone: "negative",
              },
              {
                label: "Valor em estoque",
                value: money(data.summary?.VALOR_TOTAL),
              },
            ]}
          />
          <section className="management-columns">
            <article className="panel">
              <h2>Estoque baixo</h2>
              <Table
                rows={data.low || []}
                columns={[
                  { key: "CODIGO", label: "Código" },
                  { key: "DESCRICAO", label: "Produto" },
                  {
                    key: "ESTOQUE_ATUAL",
                    label: "Atual",
                    render: (x) => number(x.ESTOQUE_ATUAL),
                  },
                  {
                    key: "ESTOQUE_MINIMO",
                    label: "Mínimo",
                    render: (x) => number(x.ESTOQUE_MINIMO),
                  },
                ]}
              />
            </article>
            <article className="panel">
              <h2>Estoque negativo</h2>
              <Table
                rows={data.negative || []}
                columns={[
                  { key: "CODIGO", label: "Código" },
                  { key: "DESCRICAO", label: "Produto" },
                  {
                    key: "ESTOQUE",
                    label: "Saldo",
                    render: (x) => number(x.ESTOQUE),
                    className: () => "negative",
                  },
                ]}
              />
            </article>
          </section>
        </>
      )}
      {type === "customers" && (
        <>
          <Kpis
            items={[
              {
                label: "Clientes ativos",
                value: number(customerKpis.CLIENTES_ATIVOS),
              },
              {
                label: "Pedidos no período",
                value: number(customerKpis.PEDIDOS),
                tone: "positive",
              },
              {
                label: "Ticket médio",
                value: money(customerKpis.TICKET_MEDIO_PEDIDO),
              },
              { label: "Faturamento", value: money(customerKpis.FATURAMENTO) },
            ]}
          />
          <section className="management-columns">
            <article className="panel">
              <h2>Ranking de clientes</h2>
              <Table
                rows={data.ranking || []}
                columns={[
                  { key: "NOME", label: "Cliente" },
                  {
                    key: "PEDIDOS",
                    label: "Compras",
                    render: (x) => number(x.PEDIDOS),
                  },
                  {
                    key: "FATURAMENTO",
                    label: "Faturamento",
                    render: (x) => money(x.FATURAMENTO),
                  },
                ]}
              />
            </article>
            <article className="panel">
              <h2>Inadimplência</h2>
              <Table
                rows={data.late || []}
                columns={[
                  { key: "NOME", label: "Cliente" },
                  {
                    key: "TITULOS",
                    label: "Títulos",
                    render: (x) => number(x.TITULOS),
                  },
                  {
                    key: "VALOR_EM_ABERTO",
                    label: "Vencido",
                    render: (x) => money(x.VALOR_EM_ABERTO),
                    className: () => "negative",
                  },
                ]}
              />
            </article>
          </section>
        </>
      )}
      {type === "cash" && (
        <>
          <section className="panel cash-operation-bar">
            <div>
              <h2>Operações do caixa</h2>
              <p>Abra, feche ou transfira valores entre caixas.</p>
            </div>
            <div className="modal-actions">
              <button
                onClick={() => setCashAction("abrir")}
                disabled={!cashFilter.empresa || !cashFilter.caixa}
              >
                Abrir caixa
              </button>
              <button
                onClick={() => setCashAction("valor")}
                disabled={!cashFilter.empresa || !cashFilter.caixa}
              >
                Transferir valor
              </button>
              <button
                onClick={() => setCashAction("fechar")}
                disabled={!cashFilter.empresa || !cashFilter.caixa}
              >
                Fechar caixa
              </button>
            </div>
          </section>
          <Kpis
            items={[
              {
                label: "Movimentos",
                value: number(data.resumo?.QTD_MOVIMENTOS),
              },
              {
                label: "Total processado",
                value: money(data.resumo?.TOTAL_PROCESSADO),
                detail: "Recebido + pendente",
              },
              {
                label: "Entradas",
                value: money(data.resumo?.ENTRADAS),
                tone: "positive",
              },
              {
                label: "Saídas",
                value: money(data.resumo?.SAIDAS),
                tone: "negative",
              },
              {
                label: "Saldo",
                value: money(data.resumo?.SALDO),
                tone: Number(data.resumo?.SALDO) >= 0 ? "positive" : "negative",
              },
            ]}
          />
          <section className="panel">
            <h2>Horários de pico</h2>
            <p>
              Os maiores indicadores mostram os horários de maior movimento no
              período filtrado.
            </p>
            <Table
              rows={cashByHour}
              columns={[
                {
                  key: "HORA",
                  label: "Horário",
                  render: (x) =>
                    `${String(x.HORA).padStart(2, "0")}:00–${String(x.HORA + 1).padStart(2, "0")}:00`,
                },
                {
                  key: "ATENDIMENTOS",
                  label: "Atendimentos",
                  render: (x) => number(x.ATENDIMENTOS),
                },
                {
                  key: "INTENSIDADE",
                  label: "Intensidade",
                  render: (x) => (
                    <div
                      style={{
                        minWidth: 140,
                        height: 14,
                        background: "#e2e8f0",
                        borderRadius: 7,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(2, x.INTENSIDADE)}%`,
                          height: "100%",
                          background: "linear-gradient(90deg,#ff5a14,#ff8a3d)",
                          borderRadius: 7,
                        }}
                      />
                    </div>
                  ),
                },
                {
                  key: "ENTRADAS",
                  label: "Entradas",
                  render: (x) => money(x.ENTRADAS),
                  className: () => "positive",
                },
                {
                  key: "SAIDAS",
                  label: "Saídas",
                  render: (x) => money(x.SAIDAS),
                  className: () => "negative",
                },
                {
                  key: "SALDO",
                  label: "Saldo",
                  render: (x) => money(x.SALDO),
                  className: (x) =>
                    Number(x.SALDO) >= 0 ? "positive" : "negative",
                },
              ]}
            />
          </section>
          <section className="panel">
            <h2>Movimentação do caixa</h2>
            <Table
              rows={data.movimentos || []}
              groupableColumns={[
                "DATA_MOVIMENTO",
                "CAIXA",
                "FORMA",
                "STATUS_MOVIMENTO",
                "DESCRICAO",
              ]}
              columns={[
                {
                  key: "DATA_MOVIMENTO",
                  label: "Data",
                  render: (x) => displayDate(x.DATA_MOVIMENTO),
                },
                { key: "CAIXA", label: "Caixa" },
                { key: "FORMA", label: "Forma" },
                { key: "STATUS_MOVIMENTO", label: "Status" },
                { key: "DESCRICAO", label: "Descrição" },
                {
                  key: "VALOR",
                  label: "Valor",
                  render: (x) => money(x.VALOR),
                  className: (x) =>
                    Number(x.VALOR) >= 0 ? "positive" : "negative",
                },
                {
                  key: "ACOES",
                  label: "Ações",
                  render: (x) => (
                    <button
                      className="secondary"
                      onClick={() => {
                        setCashRow(x);
                        setCashAction("mover");
                      }}
                    >
                      {x.ORIGEM === "PENDENTE" ? "Mover parcela" : "Transferir"}
                    </button>
                  ),
                },
              ]}
            />
          </section>
          <section className="management-columns">
            <article className="panel">
              <h2>Fechamentos recentes</h2>
              <Table
                rows={data.fechamentos || []}
                columns={[
                  {
                    key: "DATA_CAIXA",
                    label: "Data",
                    render: (x) => displayDate(x.DATA_CAIXA),
                  },
                  { key: "CAIXA", label: "Caixa" },
                  {
                    key: "SALDO_SISTEMA",
                    label: "Saldo",
                    render: (x) => money(x.SALDO_SISTEMA),
                  },
                  {
                    key: "VALOR_CONTADO",
                    label: "Contado",
                    render: (x) => money(x.VALOR_CONTADO),
                  },
                  {
                    key: "DIFERENCA",
                    label: "Diferença",
                    render: (x) => money(x.DIFERENCA),
                  },
                ]}
              />
            </article>
            <article className="panel">
              <h2>Transferências recentes</h2>
              <Table
                rows={data.transferencias || []}
                columns={[
                  {
                    key: "DATA_MOVIMENTO",
                    label: "Data",
                    render: (x) => displayDate(x.DATA_MOVIMENTO),
                  },
                  { key: "CAIXA_ORIGEM", label: "Origem" },
                  { key: "CAIXA_DESTINO_NOME", label: "Destino" },
                  {
                    key: "VALOR",
                    label: "Valor",
                    render: (x) => money(x.VALOR),
                  },
                  { key: "ORIGEM", label: "Tipo" },
                ]}
              />
            </article>
          </section>
        </>
      )}
      {type === "dre" && (
        <>
          <Kpis
            items={[
              ...(data.resumo || []),
              { descricao: "Resultado do período", total: data.resultado },
            ].map((x) => ({
              label: x.descricao,
              value: money(x.total),
              tone: Number(x.total) < 0 ? "negative" : "positive",
            }))}
          />
          <section className="panel">
            <div className="finance-heading">
              <div>
                <h2>Demonstrativo mensal</h2>
                <p>Estrutura e classificações do DRE cadastradas no Automec.</p>
              </div>
              <button
                onClick={() =>
                  window.open(
                    `/api/dre-completo/export?data_ini=${encodeURIComponent(period.data_ini)}&data_fim=${encodeURIComponent(period.data_fim)}&tipo=${encodeURIComponent(dreType)}`,
                    "_blank",
                  )
                }
              >
                Exportar Excel
              </button>
            </div>
            <Table
              rows={data.dados || []}
              columns={[
                {
                  key: "descricao",
                  label: "Descrição",
                  render: (x) => (
                    <span
                      style={{
                        paddingLeft: `${Math.max(0, Number(x.nivel || 0)) * 18}px`,
                        fontWeight:
                          x.grupo || Number(x.nivel) === 1 ? 800 : 400,
                        textTransform: x.grupo ? "uppercase" : "none",
                      }}
                    >
                      {x.descricao}
                    </span>
                  ),
                },
                ...Array.from({ length: 12 }, (_, i) => ({
                  key: `m${i + 1}`,
                  label: new Date(2026, i, 1).toLocaleDateString("pt-BR", {
                    month: "short",
                  }),
                  render: (x) => money(x.meses?.[i + 1]),
                })),
                {
                  key: "total",
                  label: "Total",
                  render: (x) =>
                    money(
                      Object.values(x.meses || {}).reduce(
                        (s, v) => s + Number(v || 0),
                        0,
                      ),
                    ),
                },
              ]}
            />
          </section>
        </>
      )}
      {type === "cash" && cashAction && (
        <CashActionModal
          mode={cashAction}
          row={cashRow}
          filter={cashFilter}
          options={data.options || {}}
          onClose={() => {
            setCashAction(null);
            setCashRow(null);
          }}
          onDone={async (result) => {
            setCashAction(null);
            setCashRow(null);
            setNotice(result.mensagem);
            await load();
          }}
        />
      )}
    </div>
  );
}
