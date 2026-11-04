import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { abrirPdfsAutorizados } from "../lib/fechamento-carteira-pdf.js";
import { htmlContasReceber } from "../lib/fechamento-carteira-print.js";
import { linhasRevisao, notasParaRetransmitir } from "../lib/fechamento-carteira-transmissao.js";

function hoje() { return new Date().toISOString().slice(0, 10); }
function inicioMes() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
function moeda(v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

const STATUS_LABEL = { pendente: "Pendente", transmitindo: "Transmitindo...", autorizada: "Autorizada", erro: "Erro" };

function StatusBadge({ status, motivo }) {
  return <span className={`badge badge-${status}`} title={motivo || ""}>{STATUS_LABEL[status] || status}</span>;
}

export default function FechamentoCarteira() {
  const [dataInicio, setDataInicio] = useState(inicioMes());
  const [dataFim, setDataFim] = useState(hoje());
  const [empresas, setEmpresas] = useState([]);
  const [idempresa, setIdempresa] = useState("");
  const [clienteBusca, setClienteBusca] = useState("");
  const [excluidos, setExcluidos] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showGerar, setShowGerar] = useState(false);
  const [formasPagamento, setFormasPagamento] = useState([]);
  const [gerarForm, setGerarForm] = useState({ cdrecebto: "", meioPagto: "01", dtvenc: "", bandeira: "" });
  const [gerando, setGerando] = useState(false);

  const [revisao, setRevisao] = useState(null);
  const [transmitindo, setTransmitindo] = useState(false);
  const [abrindoPdf, setAbrindoPdf] = useState(false);
  const [carregandoPendentes, setCarregandoPendentes] = useState(false);
  const envioRef = useRef(false);

  async function buscarPreview() {
    setLoading(true); setError("");
    try {
      const data = await api.get("/financeiro/fechamento-carteira/preview", {
        data_inicio: dataInicio, data_fim: dataFim, cliente: clienteBusca,
        idempresa: idempresa || undefined,
        excluir_cliente: excluidos.map(c => c.cdcliente)
      });
      setPreview(data);
    } catch (e) { setError(e.message); setPreview(null); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    api.get("/financeiro/fechamento-carteira/empresas")
      .then(data => setEmpresas(data.empresas || []))
      .catch(() => setEmpresas([]));
  }, []);

  useEffect(() => { buscarPreview(); }, [excluidos]); // eslint-disable-line react-hooks/exhaustive-deps

  function excluirCliente(cliente) {
    setExcluidos(prev => [...prev, { cdcliente: cliente.CDCLIENTE, cliente: cliente.CLIENTE }]);
  }
  function reincluirCliente(cdcliente) {
    setExcluidos(prev => prev.filter(c => c.cdcliente !== cdcliente));
  }

  async function abrirModalGerar() {
    setError("");
    try {
      const data = await api.get("/financeiro/formas-pagamento");
      setFormasPagamento(data.formas || []);
      setShowGerar(true);
    } catch (e) { setError(e.message); }
  }

  async function confirmarGerar(event) {
    event.preventDefault();
    setGerando(true); setError("");
    try {
      const result = await api.post("/financeiro/fechamento-carteira/gerar", {
        data_inicio: dataInicio, data_fim: dataFim, cliente: clienteBusca,
        idempresa: idempresa || null,
        excluir_clientes: excluidos.map(c => c.cdcliente),
        idusuario: 1, cdrecebto: gerarForm.cdrecebto || null,
        meio_pagto: gerarForm.meioPagto, dtvenc: gerarForm.dtvenc || null,
        bandeira: gerarForm.bandeira || null
      });
      setShowGerar(false);
      setRevisao({
        linhas: (result.geradas || []).map(nf => ({
          idnf: nf.IDNF, idempresa: nf.IDEMPRESA, nrdoc: nf.NRDOC, cliente: nf.CLIENTE,
          total: nf.TOTAL, status: "pendente", motivo: ""
        }))
      });
      setExcluidos([]);
      buscarPreview();
    } catch (e) { setError(e.message); }
    finally { setGerando(false); }
  }

  function atualizarLinha(prev, idnf, patch) {
    return { ...prev, linhas: prev.linhas.map(l => (l.idnf === idnf ? { ...l, ...patch } : l)) };
  }

  async function transmitirSelecionadas(linhas) {
    if (!linhas.length || envioRef.current) return;
    envioRef.current = true;
    setTransmitindo(true);
    setError("");
    try {
      for (const linha of linhas) {
        setRevisao(prev => atualizarLinha(prev, linha.idnf, { status: "transmitindo", motivo: "" }));
        try {
          await api.post(`/fiscal/nfe/${linha.idnf}/emitir`, { idempresa: linha.idempresa });
          setRevisao(prev => atualizarLinha(prev, linha.idnf, { status: "autorizada", motivo: "" }));
        } catch (e) {
          setRevisao(prev => atualizarLinha(prev, linha.idnf, { status: "erro", motivo: e.message }));
        }
      }
    } finally {
      envioRef.current = false;
      setTransmitindo(false);
    }
  }

  function transmitirTodas() {
    if (!revisao) return;
    return transmitirSelecionadas(revisao.linhas.filter(linha => linha.status !== "autorizada"));
  }

  function retransmitirPendentes() {
    if (!revisao) return;
    return transmitirSelecionadas(notasParaRetransmitir(revisao.linhas));
  }

  async function abrirPendentes() {
    if (carregandoPendentes || transmitindo) return;
    setCarregandoPendentes(true);
    setError("");
    try {
      const data = await api.get("/financeiro/fechamento-carteira/pendentes", {
        data_inicio: dataInicio,
        data_fim: dataFim,
        cliente: clienteBusca,
        idempresa: idempresa || undefined,
      });
      const linhas = linhasRevisao(data.notas);
      if (!linhas.length) {
        setError("Não há notas de fechamento pendentes de transmissão neste período.");
        return;
      }
      setRevisao({ linhas, origem: "pendentes" });
    } catch (e) { setError(e.message); }
    finally { setCarregandoPendentes(false); }
  }

  async function abrirPdfs() {
    if (!revisao || abrindoPdf) return;
    setError("");
    setRevisao(prev => prev ? {
      ...prev,
      linhas: prev.linhas.map(linha => linha.status === "autorizada" ? { ...linha, motivo: "" } : linha),
    } : prev);
    setAbrindoPdf(true);
    try {
      const resultado = await abrirPdfsAutorizados(revisao.linhas, {
        abrir: () => window.open("", "_blank"),
        buscar: (url) => fetch(url),
        criarUrl: (blob) => URL.createObjectURL(blob),
      });
      if (resultado.bloqueado) {
        setError("O navegador bloqueou a janela do PDF. Permita pop-ups deste site e clique de novo.");
        return;
      }
      for (const erro of resultado.erros) {
        setRevisao(prev => prev ? atualizarLinha(prev, erro.idnf, { motivo: erro.mensagem }) : prev);
      }
      if (resultado.erros.length === 1) setError(resultado.erros[0].mensagem);
      else if (resultado.erros.length > 1) setError("Não foi possível abrir alguns PDFs. O motivo está em cada nota.");
    } catch (e) {
      setError(e.message || "Não foi possível abrir o PDF.");
    } finally {
      setAbrindoPdf(false);
    }
  }

  function imprimirRelatorios() {
    const html = htmlContasReceber({
      clientes: preview?.clientes || [],
      cliente: clienteBusca,
      dataInicio,
      dataFim,
      emitidoEm: new Date(),
    });
    const janela = window.open("", "_blank");
    if (!janela) {
      setError("O navegador bloqueou a janela de impressão.");
      return;
    }
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
  }

  const podeGerar = preview && preview.clientes?.length > 0;

  return (
    <>
      <section className="panel">
        <h2>Fechamento de carteira</h2>
        <div className="filtros">
          <label>Empresa
            <select className="filtro-empresa" value={idempresa} onChange={e => setIdempresa(e.target.value)}>
              <option value="">Todas</option>
              {empresas.map(empresa => (
                <option key={empresa.IDEMPRESA} value={empresa.IDEMPRESA}>{empresa.NOMEEMPRESA}</option>
              ))}
            </select>
          </label>
          <label>De <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} /></label>
          <label>Até <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} /></label>
          <label>Cliente <input type="text" placeholder="Nome ou código" value={clienteBusca} onChange={e => setClienteBusca(e.target.value)} /></label>
          <button onClick={buscarPreview} disabled={loading}>{loading ? "Buscando..." : "Buscar"}</button>
          <button type="button" className="secondary" onClick={abrirPendentes} disabled={carregandoPendentes || transmitindo}>
            {carregandoPendentes ? "Buscando..." : "Retransmitir pendentes"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {excluidos.length > 0 && (
          <div className="chips">
            {excluidos.map(c => (
              <span key={c.cdcliente} className="chip">{c.cliente} <button onClick={() => reincluirCliente(c.cdcliente)}>×</button></span>
            ))}
          </div>
        )}
        {preview && (
          <>
            <table className="tabela">
              <thead><tr><th>Empresa</th><th>Cliente</th><th>Pedidos</th><th>Títulos</th><th className="money-cell">Desconto</th><th className="money-cell">Total</th><th></th></tr></thead>
              <tbody>
                {preview.clientes.map(c => (
                  <tr key={`${c.IDEMPRESA}-${c.CDCLIENTE}`}>
                    <td>{c.EMPRESA || c.IDEMPRESA}</td>
                    <td>{c.CLIENTE}</td>
                    <td>{c.PEDIDOS.length}</td>
                    <td>{c.QTDE_TITULOS}</td>
                    <td className="money-cell">{moeda(c.DESCONTO)}</td>
                    <td className="money-cell">{moeda(c.TOTAL)}</td>
                    <td><button className="link-btn" onClick={() => excluirCliente(c)}>Excluir</button></td>
                  </tr>
                ))}
                {!preview.clientes.length && <tr><td colSpan={7}>Nenhum título encontrado no período.</td></tr>}
              </tbody>
            </table>
            <div className="totais-linha">
              <span>{preview.totais.CLIENTES} clientes · {preview.totais.PEDIDOS} pedidos · {preview.totais.TITULOS} títulos</span>
              <strong>{moeda(preview.totais.TOTAL)}</strong>
            </div>
            <div className="fechamento-acoes">
              <button type="button" className="secondary" disabled={!podeGerar} onClick={imprimirRelatorios}>Imprimir</button>
              <button type="button" className="primary" disabled={!podeGerar} onClick={abrirModalGerar}>Gerar notas fiscais</button>
            </div>
          </>
        )}
      </section>

      {showGerar && (
        <div className="modal-overlay" onClick={() => setShowGerar(false)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={confirmarGerar}>
            <h2>Gerar notas fiscais</h2>
            <label>Forma de pagamento
              <select value={gerarForm.cdrecebto} onChange={e => setGerarForm(f => ({ ...f, cdrecebto: e.target.value }))}>
                <option value="">—</option>
                {formasPagamento.map(f => <option key={f.CDRECEBTO} value={f.CDRECEBTO}>{f.RECEBTO}</option>)}
              </select>
            </label>
            <label>Vencimento
              <input type="date" value={gerarForm.dtvenc} onChange={e => setGerarForm(f => ({ ...f, dtvenc: e.target.value }))} />
            </label>
            <label>Bandeira (opcional)
              <input type="text" value={gerarForm.bandeira} onChange={e => setGerarForm(f => ({ ...f, bandeira: e.target.value }))} />
            </label>
            <p>{preview?.clientes.length} clientes · {moeda(preview?.totais?.TOTAL)}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowGerar(false)}>Cancelar</button>
              <button type="submit" className="primary" disabled={gerando}>{gerando ? "Gerando..." : "Confirmar"}</button>
            </div>
          </form>
        </div>
      )}

      {revisao && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <h2>{revisao.origem === "pendentes" ? "Notas pendentes de transmissão" : "Revisão das notas geradas"}</h2>
            <table className="tabela">
              <thead><tr><th>NF</th><th>Cliente</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {revisao.linhas.map(l => (
                  <tr key={l.idnf}>
                    <td>{l.nrdoc}</td>
                    <td>{l.cliente}</td>
                    <td>{moeda(l.total)}</td>
                    <td>
                      <StatusBadge status={l.status} motivo={l.motivo} />
                      {l.motivo && <div className="error">{l.motivo}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error && <div className="error">{error}</div>}
            <div className="modal-actions">
              <button type="button" onClick={() => setRevisao(null)}>Fechar</button>
              <button type="button" onClick={abrirPdfs} disabled={abrindoPdf || !revisao.linhas.some(l => l.status === "autorizada")}>
                {abrindoPdf ? "Abrindo..." : "Abrir PDFs"}
              </button>
              <button
                type="button"
                onClick={retransmitirPendentes}
                disabled={transmitindo || notasParaRetransmitir(revisao.linhas).length === 0}
                title="Envia de novo as notas que ainda não foram autorizadas"
              >
                {transmitindo ? "Transmitindo..." : `Retransmitir pendentes (${notasParaRetransmitir(revisao.linhas).length})`}
              </button>
              <button className="primary" onClick={transmitirTodas} disabled={transmitindo}>
                {transmitindo ? "Transmitindo..." : "Transmitir todas"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
