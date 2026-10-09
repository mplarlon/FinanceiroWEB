import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const date = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const money = value => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Reconciliation() {
  const [tab, setTab] = useState("painel");
  const [periods, setPeriods] = useState([]);
  const [pending, setPending] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [latest, setLatest] = useState([]);
  const [status, setStatus] = useState("abertos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ofxFile, setOfxFile] = useState(null);
  const [ofxForm, setOfxForm] = useState({ account: "", data_ini: "", data_fim: "" });
  const [preview, setPreview] = useState(null);
  const [cardFile, setCardFile] = useState(null);
  const [cardPreview, setCardPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const p = await api.get("/conciliacao/listar-periodos", { status });
      const q = await api.get("/conciliacao/itens-pendentes", { limite: 100 });
      const a = await api.get("/conciliacao/contas-bancarias");
      const l = await api.get("/conciliacao/ultima-data-por-banco");
      setPeriods(p.dados || []); setPending(q.dados || []); setAccounts(a.dados || []); setLatest(l.dados || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  const selectedAccount = useMemo(() => accounts[Number(ofxForm.account)] || null, [accounts, ofxForm.account]);
  const totalPending = pending.reduce((sum, item) => sum + Math.abs(Number(item.VALOR || 0)), 0);
  const reconciled = periods.reduce((sum, item) => sum + Number(item.ITENS_CONCILIADOS || 0), 0);
  const items = periods.reduce((sum, item) => sum + Number(item.TOTAL_ITENS || 0), 0);

  function formData(file, extra = {}) {
    const data = new FormData(); data.append("arquivo", file);
    Object.entries(extra).forEach(([key, value]) => value !== "" && value != null && data.append(key, value));
    return data;
  }
  async function previewOfx(event) {
    event.preventDefault(); if (!ofxFile) return;
    setBusy(true); setError(""); setNotice("");
    try {
      setPreview(await api.upload("/conciliacao/ofx/preview", formData(ofxFile, {
        cdbanco: selectedAccount?.CDBANCO, agencia: selectedAccount?.AGENCIA,
        numconta: selectedAccount?.NUMCONTA, data_ini: ofxForm.data_ini, data_fim: ofxForm.data_fim,
      })));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function importOfx() {
    if (!preview || !window.confirm(`Importar ${preview.ofx?.total_itens_periodo || 0} lançamentos deste OFX?`)) return;
    setBusy(true); setError("");
    try {
      const result = await api.upload("/conciliacao/ofx/importar", formData(ofxFile, {
        cdbanco: selectedAccount?.CDBANCO, agencia: selectedAccount?.AGENCIA,
        numconta: selectedAccount?.NUMCONTA, data_ini: ofxForm.data_ini, data_fim: ofxForm.data_fim,
      }));
      setNotice(`Conciliação #${result.conciliacao} importada com ${result.inseridos} lançamentos.`);
      setPreview(null); setTab("painel"); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function previewCard(event) {
    event.preventDefault(); if (!cardFile) return;
    setBusy(true); setError("");
    try { setCardPreview(await api.upload("/conciliacao/cartao/preview", formData(cardFile, { adquirente: "pagbank" }))); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return <div className="reconciliation-page">
    <section className="panel reconciliation-heading">
      <div><h2>Conciliação financeira</h2><p>Importe extratos, confira correspondências e acompanhe o que ainda precisa ser conciliado.</p></div>
      <div className="tabs">
        <button className={tab === "painel" ? "active" : ""} onClick={() => setTab("painel")}>Acompanhamento</button>
        <button className={tab === "ofx" ? "active" : ""} onClick={() => setTab("ofx")}>Importar OFX</button>
        <button className={tab === "cartao" ? "active" : ""} onClick={() => setTab("cartao")}>Cartão</button>
      </div>
    </section>
    {error && <div className="error reconciliation-message">{error}</div>}
    {notice && <div className="success reconciliation-message">{notice}</div>}
    {tab === "painel" && <>
      <section className="finance-summary reconciliation-summary">
        <article><small>Períodos em exibição</small><strong>{periods.length}</strong></article>
        <article><small>Itens conciliados</small><strong>{reconciled} de {items}</strong></article>
        <article><small>Pendências do extrato</small><strong>{pending.length}</strong></article>
        <article><small>Valor pendente</small><strong>{money(totalPending)}</strong></article>
      </section>
      <section className="reconciliation-grid">
        <article className="panel"><div className="reconciliation-title"><div><span className="section-kicker">CONTAS</span><h2>Última conciliação</h2></div><button onClick={load}>Atualizar</button></div>
          <div className="account-list">{latest.map((item, index) => <div key={`${item.CDBANCO}-${item.NUMCONTA}-${index}`}><span><b>{item.BANCO || `Banco ${item.CDBANCO}`}</b><small>{item.AGENCIA}/{item.NUMCONTA}</small></span><strong>{date(item.ULTIMA_DATA)}</strong></div>)}{!latest.length && !loading && <div className="overview-empty">Nenhuma conciliação encontrada.</div>}</div>
        </article>
        <article className="panel"><div className="reconciliation-title"><div><span className="section-kicker">HISTÓRICO</span><h2>Períodos</h2></div><select value={status} onChange={e => setStatus(e.target.value)}><option value="abertos">Pendentes</option><option value="finalizados">Finalizados</option><option value="todos">Todos</option></select></div>
          <div className="table-scroll"><table className="tabela"><thead><tr><th>Banco/conta</th><th>Período</th><th>Progresso</th></tr></thead><tbody>{periods.map(item => <tr key={item.CONTROLE}><td>{item.NOME_BANCO || item.CDBANCO}<small className="table-sub">{item.AGENCIA}/{item.NUMCONTA}</small></td><td>{date(item.DTINICIAL)} a {date(item.DTFINAL)}</td><td>{item.ITENS_CONCILIADOS || 0}/{item.TOTAL_ITENS || 0}</td></tr>)}</tbody></table>{!periods.length && !loading && <div className="overview-empty">Nenhum período neste status.</div>}</div>
        </article>
      </section>
      <section className="panel reconciliation-pending"><div className="reconciliation-title"><div><span className="section-kicker">EXTRATO</span><h2>Itens não conciliados</h2></div><small>100 mais recentes</small></div>
        <div className="table-scroll"><table className="tabela"><thead><tr><th>Data</th><th>Banco/conta</th><th>Histórico</th><th>Tipo</th><th className="money-cell">Valor</th></tr></thead><tbody>{pending.map(item => <tr key={item.EXTRATO_ITEM}><td>{date(item.DATA)}</td><td>{item.CDBANCO} · {item.NUMCONTA}</td><td>{item.HISTORICO || "—"}</td><td>{item.EH_TRANSFERENCIA ? "Transferência" : Number(item.VALOR) >= 0 ? "Entrada" : "Saída"}</td><td className={`money-cell ${Number(item.VALOR) >= 0 ? "positive" : "negative"}`}>{money(item.VALOR)}</td></tr>)}</tbody></table></div>
      </section>
    </>}
    {tab === "ofx" && <section className="panel import-panel"><div><span className="section-kicker">EXTRATO BANCÁRIO</span><h2>Importar arquivo OFX</h2><p>Faça primeiro a conferência. A gravação no banco só ocorre após sua confirmação.</p></div>
      <form className="import-form" onSubmit={previewOfx}><label>Arquivo OFX<input type="file" accept=".ofx,.OFX" onChange={e => setOfxFile(e.target.files[0])} required /></label><label>Conta bancária<select value={ofxForm.account} onChange={e => setOfxForm(f => ({ ...f, account: e.target.value }))} required><option value="">Selecione</option>{accounts.map((item, i) => <option value={i} key={`${item.CDBANCO}-${item.AGENCIA}-${item.NUMCONTA}-${i}`}>{item.BANCO} · {item.AGENCIA}/{item.NUMCONTA}</option>)}</select></label><label>Data inicial<input type="date" value={ofxForm.data_ini} onChange={e => setOfxForm(f => ({ ...f, data_ini: e.target.value }))} required /></label><label>Data final<input type="date" value={ofxForm.data_fim} onChange={e => setOfxForm(f => ({ ...f, data_fim: e.target.value }))} required /></label><button disabled={busy}>{busy ? "Processando..." : "Conferir arquivo"}</button></form>
      {preview && <div className="preview-result"><div className="finance-summary"><article><small>Lançamentos</small><strong>{preview.ofx?.total_itens_periodo}</strong></article><article><small>Saldo inicial</small><strong>{money(preview.ofx?.saldo_inicial)}</strong></article><article><small>Saldo final</small><strong>{money(preview.ofx?.saldo_final)}</strong></article><article><small>Sugestões únicas</small><strong>{preview.sugestoes?.filter(x => x.sugestao?.status === "unico").length || 0}</strong></article></div>{preview.periodo_alerta && <div className="overview-notice">Já existe conciliação para parte deste período. Revise antes de continuar.</div>}<button className="primary-action" onClick={importOfx} disabled={busy || Boolean(preview.periodo_alerta)}>Confirmar importação</button></div>}
    </section>}
    {tab === "cartao" && <section className="panel import-panel"><div><span className="section-kicker">PAGBANK</span><h2>Conciliação de cartão</h2><p>Confira o CSV da adquirente e as correspondências encontradas no contas a receber.</p></div><form className="import-form card-import" onSubmit={previewCard}><label>Arquivo CSV<input type="file" accept=".csv" onChange={e => setCardFile(e.target.files[0])} required /></label><button disabled={busy}>{busy ? "Processando..." : "Conferir arquivo"}</button></form>{cardPreview && <div className="finance-summary reconciliation-summary"><article><small>Transações</small><strong>{cardPreview.totais?.qtd}</strong></article><article><small>Correspondências</small><strong>{cardPreview.totais?.qtd_matched}</strong></article><article><small>Sem correspondência</small><strong>{cardPreview.totais?.qtd_sem_match}</strong></article><article><small>Total líquido</small><strong>{money(cardPreview.totais?.total_liquido)}</strong></article></div>}</section>}
  </div>;
}
