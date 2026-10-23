import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const GRAVIDADE = {
  critico: { marca: "Crítico", classe: "critico" },
  atencao: { marca: "Atenção", classe: "atencao" },
  informativo: { marca: "Informativo", classe: "informativo" },
};
const SITUACAO = {
  novo: "Novo",
  visualizado: "Visualizado",
  em_analise: "Em análise",
  acao_preparada: "Ação preparada",
  aguardando_confirmacao: "Aguardando confirmação",
  em_tratamento: "Em tratamento",
  nao_resolvido: "Não resolvido",
  resolvido: "Resolvido",
  descartado: "Descartado",
};
const CATEGORIA = {
  financeiro: "Financeiro",
  comercial: "Comercial",
  estoque: "Estoque",
  precos: "Preços",
  auditoria: "Auditoria",
};
const CATEGORIA_ORDEM = Object.keys(CATEGORIA);
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const LIMITE_LABEL = {
  receberVencidoMinimo: "Alertar receber vencido acima de",
  receberVencidoCritico: "Receber vencido crítico a partir de",
  pagarVencidoMinimo: "Alertar pagar vencido acima de",
  pagarVencidoCritico: "Pagar vencido crítico a partir de",
  pagarHojeMinimo: "Alertar pagamentos de hoje acima de",
  pagarFuturoDias: "Dias de pagamentos futuros",
  pagarFuturoMinimo: "Pagamentos futuros acima de",
  concentracaoPercentual: "Concentração a partir de (%)",
  atrasoRecorrenteTitulos: "Títulos para atraso recorrente",
  aumentoAtrasoPercentual: "Aumento do atraso (%)",
  quedaVendasPercentual: "Queda de vendas (%)",
  quedaValorMinimo: "Valor mínimo do período anterior",
  periodoDias: "Dias de cada período comparado",
  descontoPercentual: "Desconto acima de (%)",
  margemMinima: "Margem de venda mínima (%)",
  clienteMultiploIntervalo: "Múltiplo do intervalo habitual",
  clienteIntervaloMinimoDias: "Mínimo de dias sem compra",
  semMovimentoDias: "Dias sem venda no estoque",
  coberturaRiscoDias: "Cobertura de risco (dias)",
  margemPrecoMinima: "Margem mínima da tabela (%)",
  aumentoCustoPercentual: "Aumento de custo (%)",
  caixaHorizonteDias: "Horizonte do caixa (dias)",
};
const ASSUNTO = {
  price_change: "Preços",
  discount: "Descontos",
  stock_movement: "Estoque",
  cancellation: "Cancelamentos",
  financial_reversal: "Financeiro",
  sale: "Vendas",
  bank_data_change: "Cadastro",
  payment_preparation: "Pagamentos",
  commercial_limit_change: "Comercial",
  sale_order: "Comercial",
  movement_cancellation: "Estoque",
};
const MONITOR_LABEL = {
  receber_vencidos: "Títulos vencidos a receber",
  receber_concentracao: "Concentração da inadimplência",
  receber_recorrentes: "Atrasos recorrentes",
  receber_aumento: "Aumento do valor vencido",
  receber_duplicidade: "Possível duplicidade a receber",
  pagar_vencidos: "Pagamentos vencidos",
  pagar_hoje: "Pagamentos que vencem hoje",
  pagar_futuros: "Pagamentos futuros",
  pagar_concentracao: "Concentração de pagamentos",
  pagar_duplicidade: "Possível duplicidade a pagar",
  fluxo_caixa: "Projeção de caixa",
  vendas_queda: "Queda de faturamento",
  vendedores_queda: "Queda por vendedor",
  clientes_sumidos: "Clientes fora do intervalo",
  produtos_queda: "Queda por produto",
  descontos: "Descontos acima do limite",
  margem_vendas: "Vendas com margem baixa",
  estoque_minimo: "Estoque abaixo do mínimo",
  estoque_negativo: "Estoque negativo",
  estoque_parado: "Estoque sem venda",
  ruptura: "Cobertura baixa",
  preco_abaixo_custo: "Preço abaixo do custo",
  margem_preco: "Margem de tabela baixa",
  aumento_custo: "Aumento de custo na entrada",
  vendas_crescimento: "Crescimento do faturamento",
};

function when(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function rotulo(row) {
  const name = String(row.NOME || "").replace(/\s+/g, " ").trim();
  const code = row.CODIGO == null ? "" : String(row.CODIGO).trim();
  const detail = String(row.DETALHE || "").trim();
  const composed = /^(Produto |produto )/.test(name) || name.includes(" · ") || name.includes("tabela ");
  const table = /^(CTARECEBER|CTAPAGAR|PRODUTOPRECO|MOVIMENTO)$/i.test(name);
  let label = "";
  if (composed) label = name;
  else if (table) label = code;
  else if (code && name && name !== code && !name.startsWith(`${code} - `) && !name.startsWith(`${code} – `)) label = `${code} - ${name}`;
  else label = name || String(row.DOCUMENTO || "") || code;
  if (detail && label && !label.includes(detail)) return `${label} · ${detail}`;
  return label || detail;
}
function medida(row) {
  if (row.QUANDO) return when(row.QUANDO);
  if (row.VALOR != null && row.VALOR !== "") return money(row.VALOR);
  if (row.VARIACAO != null && row.VARIACAO !== "") return `${Number(row.VARIACAO).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (row.PRECO != null && row.PRECO !== "") return money(row.PRECO);
  if (row.QTD != null && row.QTD !== "") return row.QTD;
  if (row.DOCUMENTO) return row.DOCUMENTO;
  return "";
}
function assunto(alert) {
  return alert.assunto || ASSUNTO[alert.evidencias?.events?.[0]?.type] || ASSUNTO[alert.evidencias?.baseline?.eventType] || CATEGORIA[alert.categoria] || "";
}
function highlight(alert) {
  const evidence = alert.evidencias || {};
  if (evidence.total !== undefined) return money(evidence.total);
  if (evidence.variacao !== undefined) return `${Number(evidence.variacao).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (evidence.saldoConfirmado !== undefined) return money(evidence.saldoConfirmado);
  if (evidence.produtos !== undefined) return `${Number(evidence.produtos).toLocaleString("pt-BR")} produtos`;
  if (evidence.clientes !== undefined) return `${Number(evidence.clientes).toLocaleString("pt-BR")} clientes`;
  if (evidence.vendedores !== undefined) return `${Number(evidence.vendedores).toLocaleString("pt-BR")} vendedores`;
  if (evidence.grupos !== undefined) return `${Number(evidence.grupos).toLocaleString("pt-BR")} grupos`;
  return "";
}

export function MonitorSettings() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/ia/monitoramento").then((result) => setConfig(result.configuracao)).catch((reason) => setError(reason.message));
  }, []);

  async function saveConfig(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const form = new FormData(event.currentTarget);
      const monitores = { ...config.monitores };
      for (const key of Object.keys(monitores)) monitores[key] = form.get(`m-${key}`) === "on";
      const categorias = ["financeiro", "comercial", "estoque", "precos"].filter((item) => form.get(`c-${item}`) === "on");
      const notificados = String(form.get("notificados") || "").split(/[,\s;]+/).map((item) => Number(item)).filter((item) => item > 0);
      const limites = { ...config.limites };
      for (const key of Object.keys(limites)) limites[key] = Number(form.get(`l-${key}`));
      const savedConfig = await api.post("/ia/monitoramento", {
        ativo: form.get("ativo") === "on",
        intervaloMinutos: Number(form.get("intervaloMinutos")),
        reabrirDescartados: form.get("reabrirDescartados") === "on",
        notificados,
        categorias,
        monitores,
        limites,
      });
      setConfig(savedConfig.configuracao || config);
      setSaved(true);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  if (!config) return <p className="muted">{error || "Carregando o monitoramento…"}</p>;
  return (
    <form className="charlie-config" onSubmit={saveConfig}>
      {error && <div className="error">{error}</div>}
      <label><input name="ativo" type="checkbox" defaultChecked={config.ativo} /> Monitoramento ativo</label>
      <label>Frequência (minutos)<input name="intervaloMinutos" type="number" min="15" max="1440" defaultValue={config.intervaloMinutos} /></label>
      <label><input name="reabrirDescartados" type="checkbox" defaultChecked={config.reabrirDescartados} /> Reabrir alerta descartado se o problema voltar</label>
      <label>Usuários notificados (IDs, vazio = todos do dashboard)<input name="notificados" defaultValue={(config.notificados || []).join(", ")} /></label>
      <fieldset>
        <legend>Categorias</legend>
        {[["financeiro", "Financeiro"], ["comercial", "Comercial"], ["estoque", "Estoque"], ["precos", "Preços"]].map(([item, label]) => (
          <label key={item}><input name={`c-${item}`} type="checkbox" defaultChecked={config.categorias.includes(item)} /> {label}</label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Limites</legend>
        {Object.entries(config.limites).map(([key, value]) => (
          <label key={key}>{LIMITE_LABEL[key] || key}<input name={`l-${key}`} type="number" step="0.01" defaultValue={value} /></label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Monitoramentos</legend>
        {Object.entries(config.monitores).map(([key, value]) => (
          <label key={key}><input name={`m-${key}`} type="checkbox" defaultChecked={value} /> {MONITOR_LABEL[key] || key}</label>
        ))}
      </fieldset>
      <button className="primary" disabled={busy}>{busy ? "Salvando…" : "Salvar alertas"}</button>
      {saved && <p>Configuração dos alertas salva.</p>}
    </form>
  );
}

export default function CharlieAlerts({ onClose, onInvestigate, onAction }) {
  const [alerts, setAlerts] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("abertos");

  async function load() {
    const [listResult, resumeResult, monitorResult] = await Promise.allSettled([
      api.get("/ia/alertas"),
      api.get("/ia/alertas/resumo"),
      api.get("/ia/monitoramento"),
    ]);
    if (listResult.status === "fulfilled") setAlerts(listResult.value.alertas || []);
    if (resumeResult.status === "fulfilled") {
      setSummary(resumeResult.value);
      if (monitorResult.status !== "fulfilled") setGaps(resumeResult.value.lacunas || []);
    }
    if (monitorResult.status === "fulfilled") setGaps(monitorResult.value.lacunas || []);
    if (listResult.status === "rejected") throw listResult.reason;
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function update(alert, patch) {
    setBusy(true);
    setError("");
    try {
      await api.patch(`/ia/alertas/${alert.id}`, patch);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = alerts.filter((item) => filter === "todos" || !["resolvido", "descartado"].includes(item.situacao));
  const counts = {
    critico: visible.filter((item) => item.gravidade === "critico").length,
    atencao: visible.filter((item) => item.gravidade === "atencao").length,
    informativo: visible.filter((item) => item.gravidade === "informativo").length,
  };
  const groups = [
    ...CATEGORIA_ORDEM.map((id) => ({
      id,
      label: CATEGORIA[id],
      items: visible
        .filter((item) => item.categoria === id)
        .sort((a, b) => (GRAVIDADE[a.gravidade] ? ["critico", "atencao", "informativo"].indexOf(a.gravidade) : 9) - (GRAVIDADE[b.gravidade] ? ["critico", "atencao", "informativo"].indexOf(b.gravidade) : 9)),
    })),
    {
      id: "outros",
      label: "Outros",
      items: visible.filter((item) => !CATEGORIA_ORDEM.includes(item.categoria)),
    },
  ].filter((group) => group.items.length);
  function renderAlert(alert) {
    const tone = GRAVIDADE[alert.gravidade] || GRAVIDADE.atencao;
    const metric = highlight(alert);
    const area = assunto(alert);
    const behavioral = alert.evidencias?.auditCategory === "riscos_comportamentais" || Boolean(alert.assunto);
    return (
      <article key={alert.id} className={`charlie-alert-card ${tone.classe}`}>
        <header>
          <strong className={`charlie-alert-badge ${tone.classe}`}>{tone.marca}</strong>
          {area ? <span>{area}</span> : null}
          <span>{SITUACAO[alert.situacao] || alert.situacao}</span>
          <time>{when(alert.atualizadoEm || alert.criadoEm)}</time>
        </header>
        <div className="charlie-alert-title">
          <h4>{alert.itens?.length === 1 ? alert.itens[0].objeto : alert.titulo}</h4>
          {alert.itens?.length === 1 && alert.itens[0].mudanca ? <b>{alert.itens[0].mudanca}</b> : metric ? <b>{metric}</b> : null}
        </div>
        {alert.itens?.length > 1 ? <ul className="risk-facts">{alert.itens.map((item, index) => <li key={`${item.objeto}-${index}`}><b>{item.objeto}</b><span>{item.mudanca}</span></li>)}</ul> : null}
        {alert.problema ? <p className="risk-problem">{alert.problema}</p> : null}
        {alert.contexto ? <p>{alert.contexto}</p> : <p>{alert.descricao}</p>}
        {alert.recomendacao && <p className="charlie-alert-recommendation"><strong>O que conferir: </strong>{alert.recomendacao}</p>}
        {alert.reincidencias > 0 && <small>Reincidências: {alert.reincidencias}</small>}
        {alert.registros?.length > 0 && (
          <details className="charlie-alert-records" open>
            <summary>{behavioral ? "O que mudou" : `${alert.registros.length} registro(s) de apoio`}</summary>
            <table>
              <tbody>
                {alert.registros.slice(0, 8).map((row, index) => (
                  <tr key={index}>
                    <td>{rotulo(row)}</td>
                    <td>{medida(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {alert.recomendacoes?.length > 0 && (
          <div className="charlie-alert-recommendations">
            <strong>O que o Charlie pode fazer?</strong>
            <div className="charlie-alert-actions">
              {alert.recomendacoes.map((recommendation) => (
                <button
                  type="button"
                  key={recommendation.id}
                  disabled={busy}
                  onClick={() => onAction(alert, recommendation)}
                  title={`Risco ${recommendation.risco} · prioridade ${recommendation.prioridade}`}
                >{recommendation.descricao}</button>
              ))}
            </div>
          </div>
        )}
        <div className="charlie-alert-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => onInvestigate(alert)}>Investigar com Charlie</button>
          {alert.situacao !== "em_analise" && alert.situacao !== "resolvido" && alert.situacao !== "descartado" && (
            <button type="button" disabled={busy} onClick={() => update(alert, { situacao: "em_analise" })}>Em análise</button>
          )}
          {alert.situacao !== "resolvido" && alert.situacao !== "descartado" && (
            <button type="button" disabled={busy} onClick={() => update(alert, { situacao: "resolvido" })}>Resolvido</button>
          )}
          {alert.situacao !== "descartado" && (
            <button type="button" disabled={busy} onClick={() => {
              const motivo = window.prompt("Motivo do descarte");
              if (motivo?.trim()) update(alert, { situacao: "descartado", motivo });
            }}>Descartar</button>
          )}
          <button type="button" disabled={busy} onClick={() => update(alert, { retorno: "util" })}>Útil</button>
          <button type="button" disabled={busy} onClick={() => update(alert, { retorno: "irrelevante" })}>Irrelevante</button>
        </div>
      </article>
    );
  }
  return (
    <section className="charlie-alerts">
      <header>
        <div>
          <h3>Alertas do Charlie</h3>
          <small>{summary?.analiseEm ? `Última análise: ${when(summary.analiseEm)}` : "Ainda sem análise concluída"}</small>
        </div>
        <div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {summary?.total > 0 ? (
        <p className="charlie-alert-intro">{summary.total} situação(ões) em aberto na análise de {when(summary.analiseEm)}.</p>
      ) : summary?.texto ? <p className="charlie-alert-intro">{summary.texto}</p> : null}
      <div className="charlie-alert-kpis">
        <article><span>Em aberto</span><strong>{visible.length}</strong></article>
        <article className="critico"><span>Críticos</span><strong>{counts.critico}</strong></article>
        <article className="atencao"><span>Atenção</span><strong>{counts.atencao}</strong></article>
        <article className="informativo"><span>Informativos</span><strong>{counts.informativo}</strong></article>
      </div>
      <div className="charlie-alert-filters">
        <button type="button" className={filter === "abertos" ? "active" : ""} onClick={() => setFilter("abertos")}>Em aberto</button>
        <button type="button" className={filter === "todos" ? "active" : ""} onClick={() => setFilter("todos")}>Histórico</button>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); api.post("/ia/monitoramento/executar").then(load).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>Analisar agora</button>
      </div>
      {gaps.length > 0 && (
        <div className="charlie-gaps">
          {gaps.map((item) => <p key={item.id}>{item.texto}</p>)}
        </div>
      )}
      {groups.map((group) => (
        <section key={group.id} className="charlie-alert-group">
          <h4>{group.label}<span>{group.items.length}</span></h4>
          {group.items.map(renderAlert)}
        </section>
      ))}
      {!visible.length && <p className="muted">Nenhum alerta nessa visão.</p>}
    </section>
  );
}
