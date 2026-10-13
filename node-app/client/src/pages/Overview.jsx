import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
const compactMoney = (value) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
const number = (value) =>
  Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const percent = (value) => `${number(value)}%`;

function Kpi({ label, value, detail, tone = "neutral", icon }) {
  return (
    <article className={`overview-kpi tone-${tone}`}>
      <div className="overview-kpi-top">
        <span>{label}</span>
        <i aria-hidden="true">{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function SalesTrend({ rows = [] }) {
  const points = useMemo(() => {
    if (!rows.length) return "";
    const values = rows.map((row) => Number(row.FATURAMENTO || 0));
    const max = Math.max(...values, 1);
    return values
      .map(
        (value, index) =>
          `${rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100},${92 - (value / max) * 78}`,
      )
      .join(" ");
  }, [rows]);
  const total = rows.reduce(
    (sum, row) => sum + Number(row.FATURAMENTO || 0),
    0,
  );
  const best = rows.reduce(
    (current, row) =>
      Number(row.FATURAMENTO || 0) > Number(current?.FATURAMENTO || 0)
        ? row
        : current,
    null,
  );
  const date = (value) =>
    value
      ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString(
          "pt-BR",
          { day: "2-digit", month: "short" },
        )
      : "";

  return (
    <article className="panel overview-chart-card">
      <div className="overview-card-heading">
        <div>
          <span className="section-kicker">DESEMPENHO</span>
          <h2>Evolução das vendas</h2>
        </div>
        <strong>{compactMoney(total)}</strong>
      </div>
      {rows.length ? (
        <>
          <div
            className="sales-trend"
            aria-label="Gráfico da evolução diária das vendas"
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
              <defs>
                <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#fb590a" stopOpacity=".28" />
                  <stop offset="1" stopColor="#fb590a" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1="92"
                x2="100"
                y2="92"
                className="chart-grid-line"
              />
              <polygon
                points={`0,92 ${points} 100,92`}
                fill="url(#salesFill)"
              />
              <polyline points={points} className="chart-line" />
            </svg>
          </div>
          <div className="chart-caption">
            <span>{date(rows[0]?.DIA)}</span>
            <span>Melhor dia: {compactMoney(best?.FATURAMENTO)}</span>
            <span>{date(rows.at(-1)?.DIA)}</span>
          </div>
        </>
      ) : (
        <div className="overview-empty">Sem vendas no período selecionado.</div>
      )}
    </article>
  );
}

function FinancialPosition({ finance = {} }) {
  const receive = finance.contas_receber || {},
    pay = finance.contas_pagar || {};
  const max = Math.max(
    receive.total_em_aberto || 0,
    pay.total_em_aberto || 0,
    1,
  );
  return (
    <article className="panel overview-finance-card">
      <div className="overview-card-heading">
        <div>
          <span className="section-kicker">POSIÇÃO FINANCEIRA</span>
          <h2>A receber × a pagar</h2>
        </div>
      </div>
      <div className="finance-comparison">
        <div>
          <span>
            <b>A receber</b>
            <strong>{money(receive.total_em_aberto)}</strong>
          </span>
          <div className="comparison-track">
            <i
              className="receive"
              style={{
                width: `${Math.max(3, (receive.total_em_aberto / max) * 100)}%`,
              }}
            />
          </div>
          <small>{receive.qtd_aberto || 0} títulos em aberto</small>
        </div>
        <div>
          <span>
            <b>A pagar</b>
            <strong>{money(pay.total_em_aberto)}</strong>
          </span>
          <div className="comparison-track">
            <i
              className="pay"
              style={{
                width: `${Math.max(3, (pay.total_em_aberto / max) * 100)}%`,
              }}
            />
          </div>
          <small>{pay.qtd_aberto || 0} títulos em aberto</small>
        </div>
      </div>
      <div className="cash-result">
        <span>Saldo do fluxo no período</span>
        <strong
          className={
            (finance.fluxo_caixa?.saldo_final || 0) >= 0
              ? "positive"
              : "negative"
          }
        >
          {money(finance.fluxo_caixa?.saldo_final)}
        </strong>
      </div>
    </article>
  );
}

export default function Overview({ status, onNavigate }) {
  const today = new Date(),
    monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [periodMode, setPeriodMode] = useState("custom");
  const [customPeriod, setCustomPeriod] = useState({
    data_inicio: monthStart.toISOString().slice(0, 10),
    data_fim: today.toISOString().slice(0, 10),
  });
  const [data, setData] = useState({ sales: {}, purchases: {}, finance: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState();

  async function load() {
    setLoading(true);
    setError("");
    const days =
      periodMode === "custom"
        ? Math.max(
            1,
            Math.round(
              (new Date(`${customPeriod.data_fim}T12:00:00`) -
                new Date(`${customPeriod.data_inicio}T12:00:00`)) /
                86400000,
            ) + 1,
          )
        : Number(periodMode);
    const periodParams =
      periodMode === "custom"
        ? { ...customPeriod, dias: days }
        : { dias: days };
    // O cliente nativo do Firebird não é seguro para várias conexões abertas
    // ao mesmo tempo. Carregue os blocos em sequência para evitar que uma
    // desconexão invalide as demais consultas do resumo executivo.
    const sources = [
      [
        "sales",
        async () => {
          const summary = await api.get(
            "/dashboard-vendas/summary",
            periodParams,
          );
          const charts = await api.get("/dashboard-vendas/overview", {
            ...periodParams,
            limite: 5,
          });
          return { ...summary, ...charts };
        },
      ],
      ["purchases", () => api.get("/dashboard-compras/summary", periodParams)],
      ["finance", () => api.get("/dashboard-financeiro/summary", periodParams)],
    ];
    const next = {},
      failures = [];
    for (const [name, request] of sources) {
      try {
        next[name] = await request();
      } catch (requestError) {
        failures.push(requestError?.message || `Falha ao carregar ${name}`);
      }
    }
    setData((previous) => ({ ...previous, ...next }));
    if (failures.length === sources.length)
      setError(
        `Não foi possível carregar os indicadores gerenciais: ${failures.join("; ")}`,
      );
    else if (failures.length)
      setError(
        `Alguns indicadores não foram atualizados: ${failures.join("; ")}`,
      );
    setUpdatedAt(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [periodMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const sales = data.sales || {},
    purchases = data.purchases || {},
    finance = data.finance || {};
  const k = sales.kpis || {},
    pk = purchases.kpis || {},
    variation = k.variacao_periodo_pct;
  const managementAlerts = [
    ...(sales.alertas || []),
    ...(finance.alertas || []),
    ...(pk.estoque_abaixo_minimo > 0
      ? [
          {
            tipo: "estoque",
            nivel: "warning",
            titulo: "Itens abaixo do estoque mínimo",
            valor: pk.estoque_abaixo_minimo,
            format: "number",
          },
        ]
      : []),
  ].slice(0, 4);
  const alertValue = (alert) =>
    alert.format === "number"
      ? `${number(alert.valor)} itens`
      : ["margem", "queda_vendas"].includes(alert.tipo)
        ? percent(alert.valor)
        : money(alert.valor);

  return (
    <div className="overview-page">
      <section className="overview-toolbar">
        <div>
          <h2>Resumo executivo</h2>
          <p>
            Indicadores essenciais para acompanhar a operação e agir rápido.
          </p>
        </div>
        <div className="overview-toolbar-actions">
          {updatedAt && (
            <small>
              Atualizado às{" "}
              {updatedAt.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          )}
          <label>
            Período
            <select
              value={periodMode}
              onChange={(event) => setPeriodMode(event.target.value)}
            >
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="365">12 meses</option>
              <option value="custom">Período personalizado</option>
            </select>
          </label>
          {periodMode === "custom" && (
            <>
              <label>
                De
                <input
                  type="date"
                  value={customPeriod.data_inicio}
                  max={customPeriod.data_fim}
                  onChange={(event) =>
                    setCustomPeriod((period) => ({
                      ...period,
                      data_inicio: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  value={customPeriod.data_fim}
                  min={customPeriod.data_inicio}
                  onChange={(event) =>
                    setCustomPeriod((period) => ({
                      ...period,
                      data_fim: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          )}
          <button onClick={load} disabled={loading}>
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </section>
      {error && <div className="overview-notice">{error}</div>}
      <section className="overview-kpis" aria-busy={loading}>
        <Kpi
          label="Faturamento"
          value={money(k.faturamento_total)}
          detail={
            variation == null
              ? `${number(k.quantidade_vendas)} vendas no período`
              : `${variation >= 0 ? "↑" : "↓"} ${percent(Math.abs(variation))} vs. período anterior`
          }
          tone={
            variation == null
              ? "neutral"
              : variation >= 0
                ? "positive"
                : "danger"
          }
          icon="↗"
        />
        <Kpi
          label="Lucro bruto"
          value={money(k.lucro_bruto)}
          detail={`Margem de ${percent(k.margem_lucro)}`}
          tone={(k.margem_lucro || 0) >= 25 ? "positive" : "warning"}
          icon="◎"
        />
        <Kpi
          label="A receber vencido"
          value={money(finance.contas_receber?.total_vencido)}
          detail={`${finance.contas_receber?.qtd_vencido || 0} títulos exigem atenção`}
          tone={
            (finance.contas_receber?.total_vencido || 0) > 0
              ? "danger"
              : "positive"
          }
          icon="!"
        />
        <Kpi
          label="Estoque"
          value={money(pk.estoque_valor)}
          detail={`${number(pk.estoque_abaixo_minimo)} itens abaixo do mínimo`}
          tone={(pk.estoque_abaixo_minimo || 0) > 0 ? "warning" : "positive"}
          icon="▦"
        />
      </section>
      <section className="overview-main-grid">
        <SalesTrend rows={sales.diario || []} />
        <FinancialPosition finance={finance} />
      </section>
      <section className="overview-bottom-grid">
        <article className="panel overview-ranking-card">
          <div className="overview-card-heading">
            <div>
              <span className="section-kicker">VENDAS</span>
              <h2>Produtos em destaque</h2>
            </div>
          </div>
          <div className="product-ranking">
            {(sales.top_produtos || []).slice(0, 5).map((product, index) => (
              <div key={product.CODIGO || index}>
                <span className="rank">{index + 1}</span>
                <span>
                  <b>{product.PRODUTO || product.CODIGO}</b>
                  <small>{number(product.QTD)} unidades</small>
                </span>
                <strong>{compactMoney(product.TOTAL)}</strong>
              </div>
            ))}
            {!sales.top_produtos?.length && (
              <div className="overview-empty">Sem produtos no período.</div>
            )}
          </div>
        </article>
        <article className="panel overview-alert-card">
          <div className="overview-card-heading">
            <div>
              <span className="section-kicker">ATENÇÃO</span>
              <h2>Pontos de gestão</h2>
            </div>
            <span className="alert-count">{managementAlerts.length}</span>
          </div>
          <div className="management-alerts">
            {managementAlerts.map((alert, index) => (
              <div
                key={`${alert.tipo}-${index}`}
                className={`management-alert ${alert.nivel || "warning"}`}
              >
                <i aria-hidden="true">!</i>
                <span>
                  <b>{alert.titulo}</b>
                  <small>{alertValue(alert)}</small>
                </span>
              </div>
            ))}
            {!managementAlerts.length && (
              <div className="all-clear">
                <i>✓</i>
                <span>
                  <b>Nenhum alerta crítico</b>
                  <small>
                    Os principais indicadores estão dentro do esperado.
                  </small>
                </span>
              </div>
            )}
          </div>
          <button
            className="finance-shortcut"
            onClick={() => onNavigate?.("financeiro")}
          >
            Abrir gestão financeira
          </button>
        </article>
      </section>
      <footer className="overview-status">
        <span>
          <i className={status?.ok ? "online" : "offline"} />
          Dados do {status?.nome_banco || "Firebird"}
        </span>
        <span>
          Período analisado:{" "}
          {periodMode === "custom"
            ? `${customPeriod.data_inicio.split("-").reverse().join("/")} a ${customPeriod.data_fim.split("-").reverse().join("/")}`
            : periodMode === "365"
              ? "últimos 12 meses"
              : `últimos ${periodMode} dias`}
        </span>
      </footer>
    </div>
  );
}
