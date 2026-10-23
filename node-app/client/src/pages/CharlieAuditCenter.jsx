import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const severity = { critico: "Crítica", atencao: "Atenção", informativo: "Informativa" };
const stateLabel = { novo: "Nova", visualizado: "Em triagem", em_analise: "Em investigação", nao_resolvido: "Aguardando informações", resolvido: "Resolvida", descartado: "Descartada" };
const subjectLabel = { price_change: "Preços", discount: "Descontos", stock_movement: "Estoque", cancellation: "Cancelamentos", financial_reversal: "Financeiro", sale: "Vendas", bank_data_change: "Cadastro", payment_preparation: "Pagamentos", commercial_limit_change: "Comercial", sale_order: "Comercial", movement_cancellation: "Estoque" };
const when = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
function riskSubject(risk) { return risk.subject || subjectLabel[risk.category] || "Auditoria"; }
const moneyBr = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
function ruleFact(alert) {
  const evidence = alert.evidencias || {};
  const row = (alert.registros || []).find((item) => item && (item.NOME || item.CODIGO != null)) || {};
  const code = row.CODIGO != null && row.CODIGO !== "" ? String(row.CODIGO) : String(evidence.recordId || "").split(":")[0];
  const rawName = String(row.NOME || evidence.next?.productName || "").replace(/\s+/g, " ").trim();
  const name = /^(CTARECEBER|CTAPAGAR|PRODUTOPRECO|MOVIMENTO)$/i.test(rawName) ? "" : rawName;
  const detail = String(row.DETALHE || "").trim();
  const label = name && code && name !== code && !name.startsWith(`${code} - `) ? `${code} - ${name}` : (name || code);
  const price = evidence.previous?.price != null || evidence.next?.price != null;
  const objeto = [label ? `${price ? "Produto " : ""}${label}` : "", detail && label && !label.includes(detail) ? detail : ""].filter(Boolean).join(", ");
  if (price) {
    const from = moneyBr(evidence.previous?.price), to = moneyBr(evidence.next?.price);
    const percent = Number(evidence.criteria?.variationPercent);
    const variation = Number.isFinite(percent) ? ` (${Math.abs(percent).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : "";
    return { objeto: objeto || "Preço", mudanca: from && to ? `${from} → ${to}${variation}` : "preço alterado" };
  }
  if (evidence.next?.discountPercent != null) return { objeto: objeto || "Desconto", mudanca: `desconto de ${Number(evidence.next.discountPercent).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` };
  if (evidence.next?.quantity != null) return { objeto: objeto || "Estoque", mudanca: `quantidade ${evidence.next.quantity}` };
  if (evidence.next?.amount != null) return { objeto: objeto || "Valor", mudanca: moneyBr(evidence.next.amount) };
  if (label && name) return { objeto: label, mudanca: row.VALOR != null && row.VALOR !== "" ? moneyBr(row.VALOR) : "" };
  return null;
}
function alertFacts(alert) {
  if (Array.isArray(alert.itens) && alert.itens.length) return alert.itens;
  const fact = ruleFact(alert);
  return fact ? [fact] : [];
}
function RiskBody({ risk }) {
  const facts = Array.isArray(risk.itens) ? risk.itens : [];
  const single = facts.length === 1 ? facts[0] : null;
  return <>
    <h4>{single ? single.objeto : risk.title}</h4>
    {single?.mudanca ? <p className="risk-change">{single.mudanca}</p> : null}
    {facts.length > 1 ? <ul className="risk-facts">{facts.map((item, index) => <li key={`${item.objeto}-${index}`}><b>{item.objeto}</b><span>{item.mudanca}</span></li>)}</ul> : null}
    {risk.problema ? <p className="risk-problem">{risk.problema}</p> : null}
    <p className="risk-context">{risk.contexto || (!risk.problema ? risk.explanation : "")}</p>
  </>;
}

export default function CharlieAuditCenter({ open, onClose, onInvestigate }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ severity: "", category: "", situation: "" });
  async function load() { setBusy(true); setError(""); try { setData(await api.get("/ia/auditoria-central")); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  useEffect(() => { if (open) load(); }, [open]);
  const alerts = useMemo(() => (data?.alerts || []).filter((item) => (!filters.severity || item.gravidade === filters.severity) && (!filters.category || item.evidencias?.auditCategory === filters.category) && (!filters.situation || item.situacao === filters.situation)), [data, filters]);
  const metrics = useMemo(() => ({ critical: (data?.alerts || []).filter((x) => x.gravidade === "critico" && !["resolvido","descartado"].includes(x.situacao)).length, attention: (data?.alerts || []).filter((x) => x.gravidade === "atencao" && !["resolvido","descartado"].includes(x.situacao)).length, investigating: (data?.alerts || []).filter((x) => x.situacao === "em_analise").length, resolved: (data?.alerts || []).filter((x) => x.situacao === "resolvido").length, recurrent: (data?.alerts || []).filter((x) => x.reincidencias > 0).length }), [data]);
  async function run() { setBusy(true); try { await api.post("/ia/auditoria-central/executar"); await load(); } catch (e) { setError(e.message); setBusy(false); } }
  async function investigate(alert, status, promptText) { let justification = ""; if (["resolvida", "descartada"].includes(status)) { justification = window.prompt(promptText || "Registre a conclusão e as evidências consideradas") || ""; if (!justification.trim()) return; } setBusy(true); try { await api.post(`/ia/auditoria-central/${alert.id}/investigacao`, { status, justification, evidenceId: alert.evidencias?.eventId }); await load(); } catch (e) { setError(e.message); setBusy(false); } }
  async function report() { const rows = alerts.map((x) => ({ DATA: x.criadoEm, GRAVIDADE: severity[x.gravidade], CATEGORIA: x.evidencias?.auditCategory, TITULO: x.titulo, ENTIDADE: x.evidencias?.entity, SITUACAO: stateLabel[x.situacao], RESUMO: x.descricao })); try { const response = await fetch("/api/ia/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formato: "excel", titulo: "Relatório de auditoria", colunas: Object.keys(rows[0] || {}).map((key) => ({ chave: key, rotulo: key })), linhas: rows }) }); if (!response.ok) throw new Error("Não foi possível gerar o relatório."); const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "auditoria-charlie.xlsx"; link.click(); URL.revokeObjectURL(url); } catch (e) { setError(e.message); } }
  async function feedback(risk, classification) { const justification = window.prompt("Registre a justificativa e o contexto verificado") || ""; if (!justification.trim()) return; setBusy(true); try { await api.post(`/ia/auditoria-central/riscos/${risk.id}/feedback`, { classification, justification, evidenceIds: risk.eventIds }); await load(); } catch (e) { setError(e.message); setBusy(false); } }
  if (!open) return null;
  return <div className="charlie-modal-backdrop"><section className="charlie-modal audit-center-modal">
    <header><div><h2>Central de Auditoria</h2><p>Ocorrências baseadas em regras verificáveis. Uma situação incomum não comprova fraude.</p></div><div><button disabled={busy} onClick={run}>Verificar agora</button><button onClick={onClose}>Fechar</button></div></header>
    {error && <div className="error">{error}</div>}
    <div className="audit-kpis"><article><span>Críticas</span><strong>{metrics.critical}</strong></article><article><span>Atenção</span><strong>{metrics.attention}</strong></article><article><span>Em investigação</span><strong>{metrics.investigating}</strong></article><article><span>Resolvidas</span><strong>{metrics.resolved}</strong></article><article><span>Reincidentes</span><strong>{metrics.recurrent}</strong></article><article><span>Última verificação</span><strong>{when(data?.status?.lastCheckedAt)}</strong><small>{data?.status?.mode === "periodic_incremental" ? "Verificação periódica incremental" : data?.status?.mode}</small></article></div>
    <div className="audit-integrity"><b>Integridade da trilha:</b> {data?.integrity?.valid ? `${data.integrity.checked} evento(s) encadeados` : `falha no evento ${data?.integrity?.brokenAt}`} <span>O encadeamento detecta alterações no arquivo, mas não equivale a armazenamento imutável.</span></div>
    <section className="behavioral-risk-section"><header><div><h3>Análise de Riscos e Anomalias</h3><p>Prioridade de investigação baseada em linhas de base comparáveis; não representa probabilidade ou prova de fraude.</p></div><small>Última análise: {when(data?.riskState?.lastRun?.at)}</small></header><div className="risk-analysis-grid">{(data?.risks || []).slice(0, 20).map((risk) => <article key={risk.id} className={`behavioral-risk ${risk.risk?.level}`}><header><b>{risk.risk?.level === "elevado" ? "Risco elevado" : risk.risk?.level === "moderado" ? "Risco moderado" : "Baixo risco"}</b><span>{riskSubject(risk)}</span></header><RiskBody risk={risk} /><small>{risk.eventIds?.length || 0} evento(s) relacionado(s) · modelo {risk.modelVersion}</small><details><summary>Critérios e linha de base</summary><pre>{JSON.stringify({ period: risk.period, criteria: risk.criteria, baseline: risk.baseline }, null, 2)}</pre></details><div className="audit-actions"><button onClick={() => feedback(risk, "operacao_legitima")}>Operação legítima</button><button onClick={() => feedback(risk, "falso_positivo")}>Falso positivo</button><button onClick={() => feedback(risk, "irregularidade_confirmada")}>Irregularidade confirmada</button><button onClick={() => feedback(risk, "dados_insuficientes")}>Dados insuficientes</button><button onClick={() => feedback(risk, "necessita_acompanhamento")}>Acompanhar</button></div>{risk.lastFeedback && <small>Última conclusão: {risk.lastFeedback.classification.replaceAll("_", " ")} — {risk.lastFeedback.justification}</small>}</article>)}</div>{!(data?.risks || []).length && <p className="muted">Ainda não há anomalias comportamentais com evidência suficiente.</p>}</section>
    <div className="audit-filters"><select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}><option value="">Todas as severidades</option><option value="critico">Crítica</option><option value="atencao">Atenção</option><option value="informativo">Informativa</option></select><select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option value="">Todas as categorias</option>{["precos","financeiro","comercial","estoque","cadastros","seguranca","fiscal"].map((x) => <option key={x}>{x}</option>)}</select><select value={filters.situation} onChange={(e) => setFilters({ ...filters, situation: e.target.value })}><option value="">Todas as situações</option>{Object.entries(stateLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><button onClick={report} disabled={!alerts.length}>Gerar relatório</button></div>
    <div className="audit-list">{alerts.map((alert) => { const facts = alertFacts(alert); const single = facts.length === 1 ? facts[0] : null; return <article key={alert.id} className={`audit-card ${alert.gravidade}`}><header><b>{severity[alert.gravidade]}</b><span>{alert.assunto || alert.evidencias?.auditCategory || "auditoria"}</span><span>{stateLabel[alert.situacao] || alert.situacao}</span><time>{when(alert.criadoEm)}</time></header><h3>{single ? single.objeto : alert.titulo}</h3>{single?.mudanca ? <p className="risk-change">{single.mudanca}</p> : null}{facts.length > 1 ? <ul className="risk-facts">{facts.map((item, index) => <li key={`${item.objeto}-${index}`}><b>{item.objeto}</b><span>{item.mudanca}</span></li>)}</ul> : null}{alert.problema ? <p className="risk-problem">{alert.problema}</p> : null}{alert.contexto ? <p className="risk-context">{alert.contexto}</p> : <p>{alert.descricao}</p>}<dl><div><dt>Entidade</dt><dd>{alert.evidencias?.entity || "—"}</dd></div><div><dt>Registro</dt><dd>{alert.evidencias?.recordId || "—"}</dd></div><div><dt>Responsável</dt><dd>{alert.evidencias?.actorIdentified ? "Identificado no evento" : "Não identificado de forma confiável"}</dd></div><div><dt>Regra</dt><dd>{alert.evidencias?.rule?.id} v{alert.evidencias?.rule?.version}</dd></div></dl><div className="audit-actions"><button className="primary" onClick={() => onInvestigate(alert)}>Investigar com Charlie</button><button onClick={() => setSelected(selected?.id === alert.id ? null : alert)}>Visualizar evidências</button><button onClick={() => investigate(alert, "investigacao")}>Iniciar investigação</button><button onClick={() => investigate(alert, "resolvida")}>Registrar conclusão</button><button onClick={() => investigate(alert, "descartada", "Justifique por que a ocorrência foi descartada")}>Descartar com justificativa</button></div>{selected?.id === alert.id && <pre className="audit-evidence">{JSON.stringify(alert.evidencias, null, 2)}</pre>}</article>; })}</div>
    {!alerts.length && <p className="muted">Nenhuma ocorrência corresponde aos filtros.</p>}
  </section></div>;
}
