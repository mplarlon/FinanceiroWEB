import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const date = value => value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—";
const money = value => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const FILTERS = [
  ["unico", "Sugestão única"],
  ["multiplos", "Vários títulos"],
  ["nao_encontrado", "Sem título"],
  ["conciliado", "Conciliados"],
  ["todos", "Todos"],
];

function PeriodReview({ detail, confirming, onBack, onConfirm }) {
  const [filter, setFilter] = useState("todos");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState({});
  const itens = detail.itens || [];
  const periodo = detail.periodo || {};
  const counts = Object.fromEntries(FILTERS.map(([id]) => [id, id === "todos" ? itens.length : itens.filter(item => item.sugestao?.status === id).length]));
  const needle = text.trim().toLowerCase();
  const rank = { unico: 0, multiplos: 1, nao_encontrado: 2, conciliado: 3 };
  const visible = itens.filter(item => (filter === "todos" || item.sugestao?.status === filter) && (!needle || String(item.historico || "").toLowerCase().includes(needle))).slice().sort((a, b) => (rank[a.sugestao?.status] ?? 9) - (rank[b.sugestao?.status] ?? 9));
  return <section className="panel reconciliation-review">
    <div className="reconciliation-title">
      <div>
        <span className="section-kicker">CONFERÊNCIA</span>
        <h2>{periodo.banco} · {periodo.agencia}/{periodo.numconta}</h2>
        <p>{date(periodo.dtinicial)} a {date(periodo.dtfinal)} · {periodo.conciliados || 0} de {periodo.total_itens || 0} conciliados · {periodo.sugestoes_unicas || 0} sugestões únicas</p>
      </div>
      <button type="button" onClick={onBack}>Voltar aos períodos</button>
    </div>
    <div className="reconciliation-filters">
      {FILTERS.map(([id, label]) => <button type="button" key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label} ({counts[id] || 0})</button>)}
      <input value={text} onChange={event => setText(event.target.value)} placeholder="Buscar no histórico" />
    </div>
    <div className="table-scroll reconciliation-review-table"><table className="tabela"><thead><tr><th>Data</th><th>Histórico</th><th className="money-cell">Valor</th><th>Sugestão de título</th><th></th></tr></thead><tbody>
      {visible.map(item => {
        const suggestion = item.sugestao || {};
        const titles = suggestion.titulos || [];
        const selected = titles.find(title => String(title.controle) === String(picked[item.extrato_item])) || titles[0];
        return <tr key={item.extrato_item}>
          <td>{date(item.data)}</td>
          <td>{item.historico || "—"}</td>
          <td className={`money-cell ${item.valor >= 0 ? "positive" : "negative"}`}>{money(item.valor)}</td>
          <td>{suggestion.status === "conciliado" ? "Já conciliado" : suggestion.status === "nao_encontrado" ? "Nenhum título em aberto com este valor" : <span className="suggestion-line"><b>{selected?.pessoa || "Sem nome"}</b><small>{selected?.nrdoc || "Sem documento"} · venc. {date(selected?.dtvenc)} · {money(selected?.valor)}{suggestion.status === "multiplos" ? ` · ${suggestion.total} títulos` : ""}</small></span>}</td>
          <td className="acoes">{suggestion.status === "unico" || suggestion.status === "multiplos" ? <span className="suggestion-action">{suggestion.status === "multiplos" && <select value={selected?.controle || ""} onChange={event => setPicked(current => ({ ...current, [item.extrato_item]: event.target.value }))}>{titles.map(title => <option key={title.controle} value={title.controle}>{title.pessoa || "Sem nome"} · {title.nrdoc || "s/ doc"} · {date(title.dtvenc)}</option>)}</select>}<button type="button" disabled={confirming === item.extrato_item || !selected} onClick={() => onConfirm(item, selected)}>{confirming === item.extrato_item ? "Conciliando..." : "Conciliar"}</button></span> : null}</td>
        </tr>;
      })}
    </tbody></table>{!visible.length && <div className="overview-empty">{filter === "unico" ? "Nenhuma sugestão única neste período. Veja “Vários títulos” ou “Sem título”." : "Nenhum lançamento neste filtro."}</div>}</div>
  </section>;
}

function Status({ cor, texto }) {
  return <span className={`conciliacao-status ${cor || "analise"}`}><i />{texto}</span>;
}

function IntelligencePanel({ onNotice, onError, accounts }) {
  const [painel, setPainel] = useState(null);
  const [fechamento, setFechamento] = useState(null);
  const [arquivo, setArquivo] = useState(null);
  const [conteudoArquivo, setConteudoArquivo] = useState("");
  const [formatoArquivo, setFormatoArquivo] = useState("csv");
  const [contaArquivo, setContaArquivo] = useState("");
  const [empresaArquivo, setEmpresaArquivo] = useState("1");
  const [visiveis, setVisiveis] = useState(40);
  const [verSemOrigem, setVerSemOrigem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [escolha, setEscolha] = useState({});
  const rotulo = { auto: "Conciliado automaticamente", analise: "Aguardando análise", divergencia: "Divergência", processando: "Em processamento" };

  async function load() {
    try { setPainel(await api.get("/conciliacao/inteligencia/painel")); }
    catch (error) { onError(error.message); }
  }
  useEffect(() => { load(); }, []);

  async function run() {
    setBusy(true); onError("");
    try {
      const result = await api.post("/conciliacao/inteligencia/executar", {});
      setPainel(result.painel);
      onNotice(`Ciclo concluído. ${result.aplicadas?.length || 0} conciliações seguras foram gravadas. ${result.excecoes || 0} seguem para análise.`);
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  async function decidir(id, acao, titulo) {
    setBusy(true); onError("");
    try {
      if (acao === "aprovar") await api.post(`/conciliacao/inteligencia/excecoes/${id}/aprovar`, { confirmado: true, controle: titulo.controle, tipo: titulo.tipo });
      else await api.post(`/conciliacao/inteligencia/excecoes/${id}/rejeitar`, {});
      onNotice(acao === "aprovar" ? "Exceção aprovada e conciliada." : "Exceção rejeitada. Nenhum valor foi alterado.");
      await load();
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  async function aprovarLote() {
    const ids = (painel?.excecoes || []).filter((item) => item.aprovavelEmLote).map((item) => item.id);
    if (!ids.length || !window.confirm(`Aprovar ${ids.length} exceções com correspondência única e sem alteração de valor?`)) return;
    setBusy(true); onError("");
    try {
      const result = await api.post("/conciliacao/inteligencia/excecoes/lote", { ids });
      onNotice(`${result.aprovadas} exceções aprovadas.`);
      await load();
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  async function fechar() {
    setBusy(true); onError("");
    try { setFechamento((await api.get("/conciliacao/inteligencia/fechamento")).fechamento); }
    catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  async function confirmarFechamento() {
    if (!fechamento || !window.confirm("Confirmar o fechamento do dia? Ele fica bloqueado se houver divergência de alto risco ou saldo que não fecha.")) return;
    setBusy(true); onError("");
    try {
      const result = await api.post("/conciliacao/inteligencia/fechamento", { confirmado: true, data: fechamento.data });
      setFechamento(result.fechamento);
      onNotice("Fechamento do dia registrado. Nenhum lançamento histórico foi alterado.");
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  async function previewArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); onError("");
    try {
      const conteudo = await file.text();
      const formato = file.name.toLowerCase().endsWith(".csv") ? "csv" : "cnab";
      setConteudoArquivo(conteudo);
      setFormatoArquivo(formato);
      setArquivo(await api.post("/conciliacao/inteligencia/arquivo/preview", { conteudo, formato }));
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  async function gravarArquivo() {
    const conta = accounts?.[Number(contaArquivo)];
    if (!conta || !conteudoArquivo) return;
    if (!window.confirm("Gravar no ERP somente os lançamentos que ainda não existem nesta conta?")) return;
    setBusy(true); onError("");
    try {
      const result = await api.post("/conciliacao/inteligencia/arquivo/importar", { confirmado: true, conteudo: conteudoArquivo, formato: formatoArquivo, cdbanco: conta.CDBANCO, agencia: conta.AGENCIA, numconta: conta.NUMCONTA, empresa: Number(empresaArquivo), nomeArquivo: formatoArquivo });
      onNotice(`${result.inseridos || 0} lançamentos gravados. ${result.duplicados || 0} duplicados ficaram de fora.`);
      setArquivo(null); setConteudoArquivo("");
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }

  const indicadores = painel?.indicadores;
  const todas = [...(painel?.excecoes || [])].sort((a, b) => Number(Boolean(b.movimentoId && b.titulos?.length)) - Number(Boolean(a.movimentoId && a.titulos?.length)) || Number(Boolean(b.aprovavelEmLote)) - Number(Boolean(a.aprovavelEmLote)));
  const semOrigemLista = todas.filter((item) => item.motivo === "sem_origem" || item.motivo === "baixado_sem_banco");
  const excecoes = verSemOrigem ? todas : todas.filter((item) => item.motivo !== "sem_origem" && item.motivo !== "baixado_sem_banco");
  const pagina = excecoes.slice(0, visiveis);
  const lote = todas.filter((item) => item.aprovavelEmLote).length;
  const resumo = painel?.resumoExcecoes;
  const qtdSemOrigem = resumo?.semOrigem || semOrigemLista.filter((item) => item.motivo === "sem_origem").length;
  return <section className="panel">
    <div className="reconciliation-title">
      <div>
        <span className="section-kicker">CHARLIE</span>
        <h2>Conciliação automática</h2>
        <p>O ciclo roda em segundo plano. Esta tela mostra o resultado e só pede decisão quando a correspondência não é segura.</p>
      </div>
      <span className="suggestion-action">
        <button type="button" onClick={run} disabled={busy}>{busy ? "Processando..." : "Executar agora"}</button>
        <button type="button" onClick={fechar} disabled={busy}>Pré-fechamento</button>
        {fechamento && !fechamento.fechamentoDefinitivo && <button type="button" onClick={confirmarFechamento} disabled={busy}>Fechar o dia</button>}
      </span>
    </div>
    {painel?.processando && <p><Status cor="processando" texto="Em processamento" /></p>}
    <div className="finance-summary reconciliation-summary">
      <article><small>Elegíveis conciliadas</small><strong>{indicadores ? `${indicadores.automaticas || 0} de ${indicadores.elegiveis || 0}` : "—"}</strong></article>
      <article><small>Automação das elegíveis</small><strong>{indicadores?.percentualElegiveis == null ? "—" : `${indicadores.percentualElegiveis}%`}</strong></article>
      <article><small>Valor pendente</small><strong>{money(indicadores?.valorPendente)}</strong></article>
      <article><small>Divergências</small><strong>{painel?.divergencias || 0}</strong></article>
      <article><small>Aguardando análise</small><strong>{painel?.aguardando || 0}</strong></article>
      <article><small>Charlie</small><strong>{painel?.charlie || 0}</strong></article>
      <article><small>Tempo médio</small><strong>{indicadores?.tempoMedioHoras == null ? "—" : `${indicadores.tempoMedioHoras} h`}</strong></article>
    </div>
    <p className="reconciliation-title"><small>Meta de 95% vale só para movimentações com evidência suficiente. Última sincronização: {date(painel?.ultimaSincronizacao)} {painel?.fontes?.aviso ? `· ${painel.fontes.aviso}` : ""}</small></p>
    {!!painel?.serie?.length && <div className="conciliacao-bars">{painel.serie.slice(-8).map((item) => <div key={item.em}><small>{date(item.em)}</small><span><b style={{ width: `${Math.max(0, Math.min(100, Number(item.percentual) || 0))}%` }} /></span><small>{item.percentual == null ? "—" : `${item.percentual}%`}</small></div>)}</div>}
    {!!painel?.porConta?.length && <div className="account-list">{painel.porConta.map((conta) => <div key={conta.conta}><span><b>{conta.conta || "Conta"}</b><small>{conta.automaticas} automáticas de {conta.total}</small></span><strong>{conta.total ? Math.round((conta.automaticas / conta.total) * 100) : 0}%</strong></div>)}</div>}
    <div className="reconciliation-title"><div><h2>Central de exceções</h2><p>{excecoes.length} decisões nesta tela. {qtdSemOrigem ? `${qtdSemOrigem} lançamentos seguem sem título comprovado${resumo?.valorSemOrigem ? ` (${money(resumo.valorSemOrigem)})` : ""}.` : "Aprovação em lote só entra quando cada item tem um único título e o valor fecha."} {resumo?.baixadosSemBanco ? ` ${resumo.baixadosSemBanco} títulos baixados sem banco.` : ""}</p></div><span className="suggestion-action">{qtdSemOrigem > 0 && <button type="button" onClick={() => setVerSemOrigem((atual) => !atual)}>{verSemOrigem ? "Ocultar sem origem" : "Ver sem origem"}</button>}{lote > 0 && <button type="button" onClick={aprovarLote} disabled={busy}>Aprovar {lote} {lote === 1 ? "segura" : "seguras"}</button>}</span></div>
    <div className="table-scroll"><table className="tabela"><thead><tr><th>Situação</th><th>Extrato</th><th>Possível título</th><th>Análise</th><th></th></tr></thead><tbody>
      {pagina.map((item) => {
        const titulos = item.titulos || [];
        const selecionado = titulos.find((titulo) => String(titulo.controle) === String(escolha[item.id])) || titulos[0];
        return <tr key={item.id}>
          <td><Status cor={item.cor} texto={rotulo[item.cor] || rotulo.analise} /><small className="table-sub">{money(item.valor)} · {item.motivo}</small></td>
          <td>{date(item.data)}<small className="table-sub">{item.historico || "—"}</small></td>
          <td>{!titulos.length ? "Nenhum título comprovado" : <span className="suggestion-line"><b>{selecionado?.pessoa || "Sem nome"}</b><small>{selecionado?.nrdoc || "Sem documento"} · {money(selecionado?.valor)}{item.ambigua ? ` · ${titulos.length} possibilidades` : ""}</small></span>}</td>
          <td>{item.hipotese?.narracao || "Sem hipótese documentada."}</td>
          <td className="acoes">{item.movimentoId && titulos.length ? <span className="suggestion-action">{item.ambigua && <select value={selecionado?.controle || ""} onChange={(event) => setEscolha((atual) => ({ ...atual, [item.id]: event.target.value }))}>{titulos.map((titulo) => <option key={titulo.controle} value={titulo.controle}>{titulo.pessoa || titulo.controle}</option>)}</select>}<button type="button" disabled={busy || !selecionado || item.alteraValor} onClick={() => decidir(item.id, "aprovar", selecionado)}>Aprovar</button><button type="button" disabled={busy} onClick={() => decidir(item.id, "rejeitar")}>Rejeitar</button></span> : <button type="button" disabled={busy} onClick={() => decidir(item.id, "rejeitar")}>Dispensar</button>}</td>
        </tr>;
      })}
    </tbody></table>{!excecoes.length && <div className="overview-empty">Nenhuma exceção em aberto. O próximo ciclo continua sozinho.</div>}{excecoes.length > pagina.length && <button type="button" onClick={() => setVisiveis((atual) => atual + 40)}>Mostrar mais</button>}</div>
    {fechamento && <div className="overview-notice"><b>{fechamento.fechamentoDefinitivo ? "Fechamento" : "Pré-fechamento"} de {date(fechamento.data)}.</b> {fechamento.resumo} {fechamento.fechamentoDefinitivo ? `Registrado por ${fechamento.fechadoPor}.` : "O fechamento definitivo ainda não foi confirmado."}</div>}
    <form className="import-form" onSubmit={(event) => event.preventDefault()}><label>CSV ou CNAB para conferir<input type="file" accept=".csv,.txt,.rem,.ret" onChange={previewArquivo} /></label>{arquivo && <><label>Conta<select value={contaArquivo} onChange={(event) => setContaArquivo(event.target.value)}><option value="">Selecione</option>{(accounts || []).map((item, indice) => <option value={indice} key={`${item.CDBANCO}-${item.NUMCONTA}-${indice}`}>{item.BANCO} · {item.AGENCIA}/{item.NUMCONTA}</option>)}</select></label><label>Empresa<input type="number" min="1" value={empresaArquivo} onChange={(event) => setEmpresaArquivo(event.target.value)} /></label><button type="button" disabled={busy || contaArquivo === ""} onClick={gravarArquivo}>Gravar novos</button></>}</form>
    {arquivo && <p>{arquivo.novos?.length || 0} lançamentos novos e {arquivo.duplicados?.length || 0} duplicados. A gravação só ocorre depois da confirmação.</p>}
  </section>;
}

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
  const now = new Date(), firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const [ofxForm, setOfxForm] = useState({ account: "", data_ini: firstDay.toISOString().slice(0, 10), data_fim: now.toISOString().slice(0, 10) });
  const [preview, setPreview] = useState(null);
  const [cardFile, setCardFile] = useState(null);
  const [cardPreview, setCardPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [periodId, setPeriodId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [confirming, setConfirming] = useState(null);

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

  async function openPeriod(controle) {
    setPeriodId(controle); setDetail(null); setTab("painel"); setError(""); setBusy(true);
    try { setDetail(await api.get(`/conciliacao/periodo/${controle}`)); }
    catch (e) { setPeriodId(null); setError(e.message); }
    finally { setBusy(false); }
  }

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
    setBusy(true); setError(""); setNotice(""); setPreview(null);
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
      setPreview(null); await load(); await openPeriod(result.conciliacao);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function confirmSuggestion(item, title) {
    setConfirming(item.extrato_item); setError("");
    try {
      await api.post("/conciliacao/associar", {
        extrato_item: item.extrato_item,
        tipo: item.sugestao.tipo,
        titulos: [{ controle: title.controle, idempresa: title.idempresa, valor: title.valor }],
      });
      setNotice(`Lançamento de ${money(item.valor)} conciliado com ${title.pessoa || "o título " + title.controle}.`);
      await load(); await openPeriod(periodId);
    } catch (e) { setError(e.message); }
    finally { setConfirming(null); }
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
        <button className={tab === "excecoes" ? "active" : ""} onClick={() => setTab("excecoes")}>Exceções</button>
        <button className={tab === "ofx" ? "active" : ""} onClick={() => setTab("ofx")}>Importar OFX</button>
        <button className={tab === "cartao" ? "active" : ""} onClick={() => setTab("cartao")}>Cartão</button>
      </div>
    </section>
    {error && <div className="error reconciliation-message">{error}</div>}
    {notice && <div className="success reconciliation-message">{notice}</div>}
    {tab === "painel" && periodId && (detail ? <PeriodReview detail={detail} confirming={confirming} onBack={() => { setPeriodId(null); setDetail(null); }} onConfirm={confirmSuggestion} /> : <section className="panel"><p>Carregando lançamentos e sugestões de título...</p></section>)}
    {tab === "painel" && !periodId && <>
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
        <article className="panel"><div className="reconciliation-title"><div><span className="section-kicker">HISTÓRICO</span><h2>Períodos</h2><p>Clique no período para ver os lançamentos e as sugestões de título.</p></div><select value={status} onChange={e => setStatus(e.target.value)}><option value="abertos">Pendentes</option><option value="finalizados">Finalizados</option><option value="todos">Todos</option></select></div>
          <div className="table-scroll"><table className="tabela reconciliation-periods"><thead><tr><th>Banco/conta</th><th>Período</th><th>Progresso</th></tr></thead><tbody>{periods.map(item => <tr key={item.CONTROLE} className="reconciliation-period-row" tabIndex={0} onClick={() => openPeriod(item.CONTROLE)} onKeyDown={event => { if (event.key === "Enter") openPeriod(item.CONTROLE); }}><td>{item.NOME_BANCO || item.CDBANCO}<small className="table-sub">{item.AGENCIA}/{item.NUMCONTA}</small></td><td>{date(item.DTINICIAL)} a {date(item.DTFINAL)}</td><td>{item.ITENS_CONCILIADOS || 0}/{item.TOTAL_ITENS || 0}</td></tr>)}</tbody></table>{!periods.length && !loading && <div className="overview-empty">Nenhum período neste status.</div>}</div>
        </article>
      </section>
      <section className="panel reconciliation-pending"><div className="reconciliation-title"><div><span className="section-kicker">EXTRATO</span><h2>Itens não conciliados</h2></div><small>100 mais recentes</small></div>
        <div className="table-scroll"><table className="tabela"><thead><tr><th>Data</th><th>Banco/conta</th><th>Histórico</th><th>Tipo</th><th className="money-cell">Valor</th></tr></thead><tbody>{pending.map(item => <tr key={item.EXTRATO_ITEM}><td>{date(item.DATA)}</td><td>{item.CDBANCO} · {item.NUMCONTA}</td><td>{item.HISTORICO || "—"}</td><td>{item.EH_TRANSFERENCIA ? "Transferência" : Number(item.VALOR) >= 0 ? "Entrada" : "Saída"}</td><td className={`money-cell ${Number(item.VALOR) >= 0 ? "positive" : "negative"}`}>{money(item.VALOR)}</td></tr>)}</tbody></table></div>
      </section>
    </>}
    {tab === "excecoes" && <IntelligencePanel onNotice={setNotice} onError={setError} accounts={accounts} />}
    {tab === "ofx" && <section className="panel import-panel"><div><span className="section-kicker">EXTRATO BANCÁRIO</span><h2>Importar arquivo OFX</h2><p>Faça primeiro a conferência. A gravação no banco só ocorre após sua confirmação.</p></div>
      <form className="import-form" onSubmit={previewOfx}><label>Arquivo OFX<input type="file" accept=".ofx,.OFX" onChange={e => setOfxFile(e.target.files[0])} required /></label><label>Conta bancária<select value={ofxForm.account} onChange={e => setOfxForm(f => ({ ...f, account: e.target.value }))} required><option value="">Selecione</option>{accounts.map((item, i) => <option value={i} key={`${item.CDBANCO}-${item.AGENCIA}-${item.NUMCONTA}-${i}`}>{item.BANCO} · {item.AGENCIA}/{item.NUMCONTA}</option>)}</select></label><label>Data inicial<input type="date" value={ofxForm.data_ini} onChange={e => setOfxForm(f => ({ ...f, data_ini: e.target.value }))} required /></label><label>Data final<input type="date" value={ofxForm.data_fim} onChange={e => setOfxForm(f => ({ ...f, data_fim: e.target.value }))} required /></label><button disabled={busy}>{busy ? "Processando..." : "Conferir arquivo"}</button></form>
      {preview && <div className="preview-result"><div className="finance-summary"><article><small>Lançamentos</small><strong>{preview.ofx?.total_itens_periodo}</strong></article><article><small>Saldo inicial</small><strong>{money(preview.ofx?.saldo_inicial)}</strong></article><article><small>Saldo final</small><strong>{money(preview.ofx?.saldo_final)}</strong></article><article><small>Sugestões únicas</small><strong>{preview.sugestoes?.filter(x => x.sugestao?.status === "unico").length || 0}</strong></article></div>{preview.periodo_alerta && <div className="overview-notice">Já existe conciliação para parte deste período. Revise antes de continuar.</div>}<button className="primary-action" onClick={importOfx} disabled={busy || Boolean(preview.periodo_alerta)}>Confirmar importação</button></div>}
    </section>}
    {tab === "cartao" && <section className="panel import-panel"><div><span className="section-kicker">PAGBANK</span><h2>Conciliação de cartão</h2><p>Confira o CSV da adquirente e as correspondências encontradas no contas a receber.</p></div><form className="import-form card-import" onSubmit={previewCard}><label>Arquivo CSV<input type="file" accept=".csv" onChange={e => setCardFile(e.target.files[0])} required /></label><button disabled={busy}>{busy ? "Processando..." : "Conferir arquivo"}</button></form>{cardPreview && <div className="finance-summary reconciliation-summary"><article><small>Transações</small><strong>{cardPreview.totais?.qtd}</strong></article><article><small>Correspondências</small><strong>{cardPreview.totais?.qtd_matched}</strong></article><article><small>Sem correspondência</small><strong>{cardPreview.totais?.qtd_sem_match}</strong></article><article><small>Total líquido</small><strong>{money(cardPreview.totais?.total_liquido)}</strong></article></div>}</section>}
  </div>;
}
