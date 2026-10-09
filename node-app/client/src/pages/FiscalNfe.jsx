import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

function moeda(v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function dataBr(v) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
}
function statusNota(n) {
  if (Number(n.NFE_CANCELADA) !== 0) return "cancelada";
  if (Number(n.NFE_EMITIDA) !== 0) return "autorizada";
  return "pendente";
}
const STATUS_LABEL = { pendente: "Pendente", autorizada: "Autorizada", cancelada: "Cancelada" };

function NotasFiscais() {
  const [filtros, setFiltros] = useState({ busca: "", status: "", tipo_documento: "", data_inicio: "", data_fim: "" });
  const [notas, setNotas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acaoErro, setAcaoErro] = useState("");
  const [ocupado, setOcupado] = useState(null);

  const [cancelar, setCancelar] = useState(null);
  const [justificativa, setJustificativa] = useState("");
  const [correcao, setCorrecao] = useState(null);
  const [textoCorrecao, setTextoCorrecao] = useState("");
  const [inutilizar, setInutilizar] = useState(false);
  const [inutForm, setInutForm] = useState({
    idempresa: 1, ano: new Date().getFullYear(), serie: 1, modelo: 55,
    numero_inicial: "", numero_final: "", justificativa: ""
  });
  const [consulta, setConsulta] = useState(null);
  const [pendReforma, setPendReforma] = useState(null);
  const [mostrarPendReforma, setMostrarPendReforma] = useState(false);

  async function buscar() {
    setLoading(true); setError("");
    try {
      const data = await api.get("/fiscal/nfe/notas", filtros);
      setNotas(data.notas || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function buscarPendReforma() {
    try {
      const data = await api.get("/fiscal/nfe/reforma/pendencias");
      setPendReforma(data);
    } catch { /* aviso opcional; nao trava a tela se a rota falhar */ }
  }
  useEffect(() => { buscar(); buscarPendReforma(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function emitir(nota) {
    setOcupado(nota.IDNF); setAcaoErro("");
    try {
      await api.post(`/fiscal/nfe/${nota.IDNF}/emitir`, { idempresa: nota.IDEMPRESA });
      await buscar();
    } catch (e) { setAcaoErro(e.message); }
    finally { setOcupado(null); }
  }
  async function excluir(nota) {
    if (!window.confirm(`Excluir a nota ${nota.NRDOC}?`)) return;
    setOcupado(nota.IDNF); setAcaoErro("");
    try {
      await api.del(`/fiscal/nfe/${nota.IDNF}`, { idempresa: nota.IDEMPRESA });
      await buscar();
    } catch (e) { setAcaoErro(e.message); }
    finally { setOcupado(null); }
  }
  function abrirPdf(nota) {
    window.open(`/api/fiscal/nfe/${nota.IDNF}/pdf?idempresa=${nota.IDEMPRESA}&nrdoc=${encodeURIComponent(nota.NRDOC)}`, "_blank");
  }
  async function consultarSefaz(nota) {
    setOcupado(nota.IDNF); setAcaoErro("");
    try {
      const result = await api.get(`/fiscal/nfe/${nota.IDNF}/consultar`, { idempresa: nota.IDEMPRESA });
      setConsulta({ nota, result });
    } catch (e) { setAcaoErro(e.message); }
    finally { setOcupado(null); }
  }

  async function confirmarCancelar(event) {
    event.preventDefault();
    setOcupado(cancelar.IDNF); setAcaoErro("");
    try {
      await api.post(`/fiscal/nfe/${cancelar.IDNF}/cancelar`, { idempresa: cancelar.IDEMPRESA, justificativa });
      setCancelar(null); setJustificativa("");
      await buscar();
    } catch (e) { setAcaoErro(e.message); }
    finally { setOcupado(null); }
  }
  async function confirmarCorrecao(event) {
    event.preventDefault();
    setOcupado(correcao.IDNF); setAcaoErro("");
    try {
      await api.post(`/fiscal/nfe/${correcao.IDNF}/carta-correcao`, { idempresa: correcao.IDEMPRESA, correcao: textoCorrecao, sequencia: 1 });
      setCorrecao(null); setTextoCorrecao("");
      await buscar();
    } catch (e) { setAcaoErro(e.message); }
    finally { setOcupado(null); }
  }
  async function confirmarInutilizar(event) {
    event.preventDefault();
    setAcaoErro("");
    try {
      await api.post("/fiscal/nfe/inutilizar", inutForm);
      setInutilizar(false);
    } catch (e) { setAcaoErro(e.message); }
  }

  return (
    <>
      {pendReforma && pendReforma.total > 0 && (
        <section className="panel aviso-reforma">
          <p>
            <strong>Reforma tributária:</strong> {pendReforma.total} produto(s) ativo(s) sem CST_REFORMA/CCLASSTRIB
            cadastrados na tabela IMPOSTO. A partir de 03/08/2026 a NF-e com esses produtos é
            rejeitada pela SEFAZ sem os campos de IBS/CBS.{" "}
            <button className="link-btn" onClick={() => setMostrarPendReforma(v => !v)}>
              {mostrarPendReforma ? "Ocultar lista" : "Ver produtos"}
            </button>
          </p>
          {mostrarPendReforma && (
            <ul>
              {pendReforma.produtos.map(p => (
                <li key={p.CDPRODUTO}>{p.CDPRODUTO} - {p.PRODUTO}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Notas fiscais</h2>
        <div className="filtros">
          <input type="text" placeholder="Buscar por número, cliente ou chave" value={filtros.busca}
            onChange={e => setFiltros(f => ({ ...f, busca: e.target.value }))} />
          <select value={filtros.status} onChange={e => setFiltros(f => ({ ...f, status: e.target.value }))}>
            <option value="">Todos os status</option>
            <option value="pendente">Pendente</option>
            <option value="autorizada">Autorizada</option>
            <option value="cancelada">Cancelada</option>
          </select>
          <select value={filtros.tipo_documento} onChange={e => setFiltros(f => ({ ...f, tipo_documento: e.target.value }))}>
            <option value="">NF-e e NFC-e</option>
            <option value="nfe">Somente NF-e</option>
            <option value="nfce">Somente NFC-e</option>
          </select>
          <input type="date" value={filtros.data_inicio} onChange={e => setFiltros(f => ({ ...f, data_inicio: e.target.value }))} />
          <input type="date" value={filtros.data_fim} onChange={e => setFiltros(f => ({ ...f, data_fim: e.target.value }))} />
          <button onClick={buscar} disabled={loading}>{loading ? "Buscando..." : "Buscar"}</button>
          <button className="link-btn" onClick={() => setInutilizar(true)}>Inutilizar numeração</button>
        </div>
        {error && <div className="error">{error}</div>}
        {acaoErro && <div className="error">{acaoErro}</div>}
        <table className="tabela">
          <thead><tr><th>NF</th><th>Emissão</th><th>Cliente</th><th className="money-cell">Valor</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            {notas.map(n => {
              const status = statusNota(n);
              const disabled = ocupado === n.IDNF;
              return (
                <tr key={n.IDNF}>
                  <td>{n.NRDOC}{n.NFCE ? " (NFC-e)" : ""}</td>
                  <td>{dataBr(n.DTEMISS)}</td>
                  <td>{n.CLIENTE || "-"}</td>
                  <td className="money-cell">{moeda(n.VLTOTAL)}</td>
                  <td><span className={`badge badge-nf-${status}`}>{STATUS_LABEL[status]}</span></td>
                  <td className="acoes">
                    {status === "pendente" && <button disabled={disabled} onClick={() => emitir(n)}>Transmitir</button>}
                    {status === "pendente" && <button disabled={disabled} className="link-btn" onClick={() => excluir(n)}>Excluir</button>}
                    {status === "autorizada" && <button disabled={disabled} onClick={() => abrirPdf(n)}>PDF</button>}
                    {status === "autorizada" && <button disabled={disabled} onClick={() => setCancelar(n)}>Cancelar</button>}
                    {status === "autorizada" && <button disabled={disabled} onClick={() => setCorrecao(n)}>Carta CC-e</button>}
                    {n.CHAVE && <button disabled={disabled} className="link-btn" onClick={() => consultarSefaz(n)}>Consultar SEFAZ</button>}
                  </td>
                </tr>
              );
            })}
            {!notas.length && !loading && <tr><td colSpan={6}>Nenhuma nota encontrada.</td></tr>}
          </tbody>
        </table>
      </section>

      {cancelar && (
        <div className="modal-overlay" onClick={() => setCancelar(null)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={confirmarCancelar}>
            <h2>Cancelar nota {cancelar.NRDOC}</h2>
            <label>Justificativa (15 a 255 caracteres)
              <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} minLength={15} maxLength={255} required rows={4} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setCancelar(null)}>Voltar</button>
              <button type="submit" className="primary" disabled={ocupado === cancelar.IDNF}>Confirmar cancelamento</button>
            </div>
          </form>
        </div>
      )}

      {correcao && (
        <div className="modal-overlay" onClick={() => setCorrecao(null)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={confirmarCorrecao}>
            <h2>Carta de correção — {correcao.NRDOC}</h2>
            <label>Texto da correção (15 a 1000 caracteres)
              <textarea value={textoCorrecao} onChange={e => setTextoCorrecao(e.target.value)} minLength={15} maxLength={1000} required rows={5} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setCorrecao(null)}>Voltar</button>
              <button type="submit" className="primary" disabled={ocupado === correcao.IDNF}>Enviar</button>
            </div>
          </form>
        </div>
      )}

      {inutilizar && (
        <div className="modal-overlay" onClick={() => setInutilizar(false)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={confirmarInutilizar}>
            <h2>Inutilizar numeração</h2>
            <label>Empresa <input type="number" value={inutForm.idempresa} onChange={e => setInutForm(f => ({ ...f, idempresa: e.target.value }))} /></label>
            <label>Ano <input type="number" value={inutForm.ano} onChange={e => setInutForm(f => ({ ...f, ano: e.target.value }))} /></label>
            <label>Série <input type="number" value={inutForm.serie} onChange={e => setInutForm(f => ({ ...f, serie: e.target.value }))} /></label>
            <label>Modelo <input type="number" value={inutForm.modelo} onChange={e => setInutForm(f => ({ ...f, modelo: e.target.value }))} /></label>
            <label>Número inicial <input type="number" value={inutForm.numero_inicial} onChange={e => setInutForm(f => ({ ...f, numero_inicial: e.target.value }))} required /></label>
            <label>Número final <input type="number" value={inutForm.numero_final} onChange={e => setInutForm(f => ({ ...f, numero_final: e.target.value }))} required /></label>
            <label>Justificativa (15 a 255 caracteres)
              <textarea value={inutForm.justificativa} onChange={e => setInutForm(f => ({ ...f, justificativa: e.target.value }))} minLength={15} maxLength={255} required rows={3} />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setInutilizar(false)}>Voltar</button>
              <button type="submit" className="primary">Confirmar</button>
            </div>
          </form>
        </div>
      )}

      {consulta && (
        <div className="modal-overlay" onClick={() => setConsulta(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Consulta SEFAZ — {consulta.nota.NRDOC}</h2>
            <p><strong>cStat:</strong> {consulta.result.cStat}</p>
            <p><strong>Motivo:</strong> {consulta.result.motivo}</p>
            <p><strong>Protocolo:</strong> {consulta.result.protocolo || "-"}</p>
            <p><strong>Cancelada na SEFAZ:</strong> {consulta.result.cancelada_no_sefaz ? "Sim" : "Não"}</p>
            <div className="modal-actions"><button onClick={() => setConsulta(null)}>Fechar</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function FiscalReview({ mode }) {
  const today = new Date(), first = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (date) => date.toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ data_ini: iso(first), data_fim: iso(today), idempresa: "1", cfop: "" });
  const [options, setOptions] = useState({ empresas: [], cfops: [] });
  const [summary, setSummary] = useState({});
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [newCfop, setNewCfop] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [optionData, summaryData, itemData] = await Promise.all([
        api.get("/fiscal/options"),
        api.get("/fiscal/apuracao/resumo", filters),
        api.get("/fiscal/apuracao/itens", filters),
      ]);
      setOptions(optionData);
      setSummary(summaryData.resumo || {});
      setItems(itemData.itens || itemData.dados || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = Object.values(items.reduce((all, item) => {
    const key = String(item.CFOP || "Não informado");
    const row = all[key] || { CFOP: key, ITENS: 0, VALOR_PRODUTO: 0, ICMS_BASE: 0, ICMS_VALOR: 0, ICMS_ST: 0, PIS: 0, COFINS: 0, IPI: 0 };
    row.ITENS += 1;
    for (const field of ["VALOR_PRODUTO", "ICMS_BASE", "ICMS_VALOR", "ICMS_ST", "PIS", "COFINS", "IPI"])
      row[field] += Number(item[field] || 0);
    all[key] = row;
    return all;
  }, {})).sort((a, b) => a.CFOP.localeCompare(b.CFOP, "pt-BR", { numeric: true }));

  async function saveReview(event) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      await api.post("/fiscal/contabil-revisao", {
        CHAVE: editing.CHAVE, CFOP_CONTABIL: newCfop, IDEMPRESA: editing.IDEMPRESA,
        CFOP_ORIGINAL: editing.CFOP_ORIGINAL || editing.CFOP,
        ITENS: [{ ORIGEM: editing.ORIGEM || "NFE", POSIC: Number(editing.POSIC), CPROD: String(editing.CODIGO), IDEMPRESA: editing.IDEMPRESA, IDENTRADA: editing.IDENTRADA || null, CFOP_ORIGINAL: editing.CFOP_ORIGINAL || editing.CFOP }],
      });
      setEditing(null); setNotice("Revisão fiscal salva com sucesso."); await load();
    } catch (e) { setError(e.message); }
  }

  const exportUrl = (format) => `/api/fiscal/apuracao/exportar/${format}?${new URLSearchParams(filters).toString()}`;
  return <>
    <section className="panel">
      <div className="finance-heading"><div><h2>{mode === "review" ? "Revisão fiscal" : "Fechamento por CFOP"}</h2><p>{mode === "review" ? "Confira CFOP, CST e tributação dos itens fiscais." : "Consolidação dos valores fiscais agrupados por CFOP."}</p></div></div>
      <div className="filtros">
        <select value={filters.idempresa} onChange={e => setFilters(f => ({ ...f, idempresa: e.target.value }))}>{options.empresas?.map(x => <option key={x.ID} value={x.ID}>{x.NOME}</option>)}</select>
        <input type="date" value={filters.data_ini} onChange={e => setFilters(f => ({ ...f, data_ini: e.target.value }))} />
        <input type="date" value={filters.data_fim} onChange={e => setFilters(f => ({ ...f, data_fim: e.target.value }))} />
        <select value={filters.cfop} onChange={e => setFilters(f => ({ ...f, cfop: e.target.value }))}><option value="">Todas as CFOP</option>{options.cfops?.map(x => <option key={x.ID} value={x.ID}>{x.NOME}</option>)}</select>
        <button onClick={load} disabled={loading}>{loading ? "Carregando..." : "Atualizar"}</button>
        {mode === "cfop" && <><button className="link-btn" onClick={() => window.open(exportUrl("excel"), "_blank")}>Excel</button><button className="link-btn" onClick={() => window.open(exportUrl("pdf"), "_blank")}>PDF</button></>}
      </div>
      {error && <div className="error">{error}</div>}{notice && <div className="success">{notice}</div>}
    </section>
    <section className="finance-summary management-kpis">
      <article><small>Notas de entrada</small><strong>{Number(summary.notas_entrada || 0).toLocaleString("pt-BR")}</strong></article>
      <article><small>Notas de saída</small><strong>{Number(summary.notas_saida || 0).toLocaleString("pt-BR")}</strong></article>
      <article><small>ICMS a débito</small><strong>{moeda(summary.icms_debito)}</strong></article>
      <article><small>ICMS a crédito</small><strong>{moeda(summary.icms_credito)}</strong></article>
      <article><small>Itens para revisar</small><strong>{Number(summary.itens_revisar || 0).toLocaleString("pt-BR")}</strong></article>
    </section>
    <section className="panel table-scroll">
      {mode === "review" ? <table className="tabela"><thead><tr><th>Emissão</th><th>Chave</th><th>Produto</th><th>CFOP</th><th>CST</th><th>Status</th><th className="money-cell">Valor</th><th>Ação</th></tr></thead><tbody>
        {items.map((x, i) => <tr key={`${x.CHAVE}-${x.POSIC}-${i}`}><td>{dataBr(x.EMISSAO)}</td><td>{String(x.CHAVE || "").slice(-12)}</td><td>{x.CODIGO} - {x.DESCRICAO}</td><td>{x.CFOP}</td><td>{x.CST || "-"}</td><td>{x.STATUS_FISCAL}</td><td className="money-cell">{moeda(x.VALOR_PRODUTO)}</td><td><button onClick={() => { setEditing(x); setNewCfop(x.CFOP || ""); }}>Revisar</button></td></tr>)}
        {!items.length && <tr><td colSpan={8}>Nenhum item encontrado.</td></tr>}
      </tbody></table> : <table className="tabela"><thead><tr><th>CFOP</th><th>Itens</th><th className="money-cell">Valor contábil</th><th className="money-cell">Base ICMS</th><th className="money-cell">ICMS</th><th className="money-cell">ICMS-ST</th><th className="money-cell">PIS</th><th className="money-cell">COFINS</th><th className="money-cell">IPI</th></tr></thead><tbody>
        {grouped.map(x => <tr key={x.CFOP}><td>{x.CFOP}</td><td>{x.ITENS}</td>{["VALOR_PRODUTO","ICMS_BASE","ICMS_VALOR","ICMS_ST","PIS","COFINS","IPI"].map(k => <td className="money-cell" key={k}>{moeda(x[k])}</td>)}</tr>)}
        {!grouped.length && <tr><td colSpan={9}>Nenhum valor encontrado.</td></tr>}
      </tbody></table>}
    </section>
    {editing && <div className="modal-overlay" onClick={() => setEditing(null)}><form className="modal" onClick={e => e.stopPropagation()} onSubmit={saveReview}><h2>Revisar CFOP</h2><p>{editing.CODIGO} - {editing.DESCRICAO}</p><label>CFOP contábil<input value={newCfop} onChange={e => setNewCfop(e.target.value.replace(/\D/g, "").slice(0, 4))} required minLength={4} maxLength={4} /></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button><button type="submit">Salvar revisão</button></div></form></div>}
  </>;
}

export default function FiscalNfe() {
  const [section, setSection] = useState("notas");
  return <>
    <section className="panel"><div className="modal-actions fiscal-sections">
      <button className={section === "notas" ? "primary" : "secondary"} onClick={() => setSection("notas")}>Notas fiscais</button>
      <button className={section === "revisao" ? "primary" : "secondary"} onClick={() => setSection("revisao")}>Revisão fiscal</button>
      <button className={section === "cfop" ? "primary" : "secondary"} onClick={() => setSection("cfop")}>Fechamento por CFOP</button>
    </div></section>
    {section === "notas" && <NotasFiscais />}
    {section === "revisao" && <FiscalReview mode="review" />}
    {section === "cfop" && <FiscalReview mode="cfop" />}
  </>;
}
