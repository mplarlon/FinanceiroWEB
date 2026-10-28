import React, { useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const TIPO = {
  orcamento_parado: "Orçamento parado",
  cliente_inativo: "Cliente sem compra",
  reducao_compras: "Queda de compras",
  pedido_nao_finalizado: "Pedido fora da venda",
  negociacao_parada: "Negociação parada",
  carrinho_abandonado: "Carrinho",
};

const PRIORIDADE = { alta: "Alta", media: "Média", baixa: "Baixa" };

function moeda(valor) {
  return valor == null ? "—" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CharlieRecovery({ onOpen }) {
  const [diasOrcamento, setDiasOrcamento] = useState(15);
  const [diasCliente, setDiasCliente] = useState(60);
  const [painel, setPainel] = useState(null);
  const [aberto, setAberto] = useState("");
  const [quando, setQuando] = useState("");
  const [nota, setNota] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar(event) {
    event?.preventDefault();
    setOcupado("carregar");
    setErro("");
    try {
      const dados = await api.get("/charlie-recovery", { diasOrcamento, diasCliente });
      setPainel(dados);
      setAviso("");
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function acao(item, tipo, extra = {}) {
    setOcupado(tipo);
    setErro("");
    try {
      const dados = await api.post(`/charlie-recovery/${encodeURIComponent(item.id)}/acao`, {
        tipo,
        texto: extra.texto ?? (tipo === "mensagem" ? item.rascunho : nota),
        quando: extra.quando || null,
        resultado: extra.resultado || null,
      });
      setAviso(dados.aviso);
      setPainel((atual) => atual ? {
        ...atual,
        itens: atual.itens.map((linha) => linha.id === item.id ? { ...linha, acoes: dados.registro.acoes, resultado: dados.registro.resultado } : linha),
      } : atual);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const itens = painel?.itens || [];
  const detalhe = itens.find((item) => item.id === aberto);

  return <CharlieSalesPage
    titulo="Clientes parados"
    resumo="A lista usa orçamento aberto, cliente sem compra, queda entre dois períodos de 90 dias, saída com STATUS_ORC=0 e negociação dos contatos. A prioridade não é probabilidade. Carrinho abandonado não entra porque a Tray sincronizada não traz esse dado. Nenhuma mensagem sai daqui."
    metricas={[{ rotulo: "Encontrados", valor: painel ? String(itens.length) : "…" }]}
    lacunas={painel?.lacunas}
    erro={erro}
    aviso={aviso}
    acoes={<button type="button" onClick={() => onOpen?.("alertas")}>Abrir alertas</button>}
  >
    <form className="charlie-sales-filters" onSubmit={carregar}>
      <label>Orçamento parado há (dias)<input type="number" min="1" max="365" value={diasOrcamento} onChange={(event) => setDiasOrcamento(event.target.value)} /></label>
      <label>Cliente sem compra há (dias)<input type="number" min="1" max="730" value={diasCliente} onChange={(event) => setDiasCliente(event.target.value)} /></label>
      <button type="submit" disabled={Boolean(ocupado)}>{ocupado === "carregar" ? "Lendo..." : "Atualizar"}</button>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Oportunidades</h3><small>{painel ? `${itens.length} encontrada(s)` : "A leitura ainda não foi feita."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Tipo</th><th>Cliente</th><th>Referência</th><th>Idade</th><th>Prioridade</th><th>Responsável</th><th></th>
      </tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td>{TIPO[item.tipo] || item.tipo}</td>
          <td><b>{item.cliente || "—"}</b></td>
          <td>{moeda(item.valor)}<small> {item.valorRotulo}</small>{item.historico != null && <small> Histórico {moeda(item.historico)}</small>}</td>
          <td>{item.dias == null ? "—" : `${item.dias} dias`}{item.frequencia != null && <small> {item.frequencia} compra(s) em 365 dias</small>}</td>
          <td><b>{PRIORIDADE[item.prioridade?.rotulo] || item.prioridade?.rotulo}</b><small> {item.prioridade?.pontos}</small></td>
          <td>{item.responsavel || "—"}</td>
          <td><button type="button" className="secondary" onClick={() => setAberto(aberto === item.id ? "" : item.id)}>Acompanhar</button></td>
        </tr>) : <tr><td colSpan="7">{painel ? "Nada além do prazo informado." : "Atualize para ler o ERP."}</td></tr>}
      </tbody></table></div>
    </section>
    {detalhe && <section className="panel charlie-booster-detail">
      <header><h3>{detalhe.cliente}</h3><span>{TIPO[detalhe.tipo]}</span></header>
      <p>{detalhe.prioridade?.aviso}</p>
      <p className="charlie-sales-note">{detalhe.avisoContato}</p>
      <div className="charlie-booster-copy"><strong>Rascunho</strong><p>{detalhe.rascunho}</p></div>
      <div className="ecommerce-action-buttons">
        <button type="button" onClick={() => acao(detalhe, "tarefa", { texto: `Acompanhar ${detalhe.cliente}` })} disabled={Boolean(ocupado)}>Registrar tarefa</button>
        <button type="button" className="secondary" onClick={() => acao(detalhe, "mensagem")} disabled={Boolean(ocupado)}>Guardar mensagem</button>
        <button type="button" className="secondary" onClick={() => acao(detalhe, "alerta", { texto: `Alertar ${detalhe.responsavel}` })} disabled={Boolean(ocupado)}>Alerta interno</button>
        <button type="button" className="secondary" onClick={() => acao(detalhe, "campanha", { texto: detalhe.rascunho })} disabled={Boolean(ocupado)}>Campanha não publicada</button>
      </div>
      <form className="charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); acao(detalhe, "acompanhamento", { quando, texto: nota || "Acompanhamento agendado" }); }}>
        <label>Retorno<input type="date" value={quando} onChange={(event) => setQuando(event.target.value)} /></label>
        <label>Nota<input value={nota} onChange={(event) => setNota(event.target.value)} /></label>
        <button type="submit" disabled={Boolean(ocupado) || !quando}>Agendar</button>
        <button type="button" className="secondary" onClick={() => acao(detalhe, "resultado", { resultado: "em_contato", texto: nota })} disabled={Boolean(ocupado)}>Em contato</button>
        <button type="button" className="secondary" onClick={() => acao(detalhe, "resultado", { resultado: "recuperado", texto: nota })} disabled={Boolean(ocupado)}>Recuperado</button>
        <button type="button" className="secondary" onClick={() => acao(detalhe, "resultado", { resultado: "perdido", texto: nota })} disabled={Boolean(ocupado)}>Perdido</button>
      </form>
      {detalhe.acoes?.length > 0 && <ul className="charlie-hunter-criterios">{detalhe.acoes.map((acaoItem) => <li key={acaoItem.id}>{acaoItem.tipo} — {acaoItem.texto || acaoItem.resultado}{acaoItem.quando ? ` · ${acaoItem.quando}` : ""}{acaoItem.publicada === false ? " · não publicada" : ""}</li>)}</ul>}
    </section>}
  </CharlieSalesPage>;
}
