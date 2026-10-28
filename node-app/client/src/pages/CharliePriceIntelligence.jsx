import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const MODO = { analysis: "Somente análise", manual: "Sugestão com aprovação", automatic: "Automático só dentro dos limites" };

function moeda(valor) {
  return valor == null ? "—" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CharliePriceIntelligence() {
  const [painel, setPainel] = useState(null);
  const [aberto, setAberto] = useState("");
  const [desconto, setDesconto] = useState("");
  const [reajuste, setReajuste] = useState("");
  const [piso, setPiso] = useState("");
  const [canal, setCanal] = useState("");
  const [margemCanal, setMargemCanal] = useState("");
  const [simulacao, setSimulacao] = useState(null);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar() {
    const dados = await api.get("/tray/precos");
    setPainel(dados);
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  const produtos = painel?.produtos || [];
  const produto = produtos.find((item) => item.id === aberto);

  async function simular(event) {
    event.preventDefault();
    if (!produto) return;
    setOcupado("simular");
    setErro("");
    setAviso("");
    try {
      const dados = await api.post("/tray/precos/simular", {
        productId: produto.id,
        desconto: desconto === "" ? null : Number(desconto),
        reajuste: reajuste === "" ? null : Number(reajuste),
        canal: canal || null,
      });
      setSimulacao(dados);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function propor() {
    setOcupado("propor");
    setErro("");
    try {
      const dados = await api.post("/tray/precos/propor", {
        productId: produto.id,
        desconto: desconto === "" ? null : Number(desconto),
        reajuste: reajuste === "" ? null : Number(reajuste),
        canal: canal || null,
      });
      setAviso(dados.decisao?.motivo || "Proposta registrada.");
      setSimulacao(dados);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function salvarPiso(event) {
    event.preventDefault();
    setOcupado("piso");
    setErro("");
    try {
      await api.post("/tray/precos/piso", { productId: produto.id, preco: Number(piso) });
      setAviso("Preço mínimo gravado. Nenhuma alteração foi enviada à loja.");
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function salvarCanal(event) {
    event.preventDefault();
    setOcupado("canal");
    setErro("");
    try {
      await api.post("/tray/precos/canal", { canal, margem: Number(margemCanal) });
      setAviso("Margem do canal gravada. Taxa do marketplace não foi estimada.");
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const resultado = simulacao?.simulacao;

  return <CharlieSalesPage
    titulo="Preços"
    resumo={`A margem sai do preço e do custo sincronizados. Imposto, comissão, taxa e frete ficam de fora enquanto não estiverem conciliados. O modo atual é ${MODO[painel?.mode] || "carregando"}. Propor uma alteração não muda o preço: ela entra na central de ações.`}
    metricas={[{ rotulo: "Produtos", valor: painel ? String(produtos.length) : "…" }]}
    erro={erro}
    aviso={aviso}
  >
    <section className="panel ecommerce-table">
      <header><h3>Produtos sincronizados</h3><small>{produtos.length ? `${produtos.length} produto(s)` : "Nenhum produto sincronizado."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Produto</th><th>Preço</th><th>Custo</th><th>Margem</th><th>Mínimo pela margem</th><th>Piso</th><th></th>
      </tr></thead><tbody>
        {produtos.length ? produtos.map((item) => <tr key={item.id}>
          <td><span className="tray-product-cell">{item.imagem ? <img className="tray-product-photo" src={item.imagem} alt="" /> : <span className="tray-product-photo tray-product-photo-empty" aria-hidden="true" />}<span><b>{item.nome}</b>{item.bloqueado && <small> bloqueado</small>}</span></span></td>
          <td>{moeda(item.preco)}</td>
          <td>{item.custo == null ? "Indisponível" : moeda(item.custo)}</td>
          <td>{item.margem == null ? "Indisponível" : `${item.margem}%`}</td>
          <td>{moeda(item.precoMinimo)}</td>
          <td>{moeda(item.piso)}</td>
          <td><button type="button" className="secondary" onClick={() => { setAberto(item.id); setSimulacao(null); setPiso(item.piso ?? ""); setCanal(item.canais?.[0]?.canal || ""); }}>Simular</button></td>
        </tr>) : <tr><td colSpan="7">Sincronize a Tray para ler preço e custo.</td></tr>}
      </tbody></table></div>
    </section>
    {produto && <section className="panel charlie-booster-detail">
      <header><h3 className="tray-product-cell">{produto.imagem ? <img className="tray-product-photo" src={produto.imagem} alt="" /> : null}{produto.nome}</h3><span>{produto.bloqueado ? "Bloqueado" : "Liberado para simulação"}</span></header>
      <form className="charlie-sales-filters" onSubmit={simular}>
        <label>Desconto %<input type="number" min="0" max="99" step="0.1" value={desconto} onChange={(event) => { setDesconto(event.target.value); setReajuste(""); }} /></label>
        <label>Reajuste %<input type="number" min="-99" max="200" step="0.1" value={reajuste} onChange={(event) => { setReajuste(event.target.value); setDesconto(""); }} /></label>
        <label>Canal da regra
          <select value={canal} onChange={(event) => setCanal(event.target.value)}>
            <option value="">Margem geral</option>
            {produto.canais.map((item) => <option key={item.canal} value={item.canal}>{item.canal}</option>)}
          </select>
        </label>
        <button type="submit" disabled={Boolean(ocupado)}>{ocupado === "simular" ? "Calculando..." : "Calcular"}</button>
      </form>
      {resultado && <div className="charlie-booster-copy">
        <strong>{moeda(resultado.preco)} para {moeda(resultado.proposto)} ({resultado.variacao}%)</strong>
        <p>Margem atual: {resultado.margemAtual == null ? "indisponível" : `${resultado.margemAtual}%`}. Margem proposta: {resultado.margemProposta == null ? "indisponível" : `${resultado.margemProposta}%`}. Preço mínimo pela margem: {moeda(resultado.precoMinimo)}.</p>
        <p>{resultado.componentes.motivo}</p>
        <p>{simulacao.decisao?.motivo}</p>
        {resultado.excedeuTeto && <p>O reajuste passa do teto configurado.</p>}
        {resultado.abaixoDaMargem && <p>A margem proposta fica abaixo da mínima.</p>}
        {resultado.abaixoDoPiso && <p>O preço proposto fica abaixo do piso.</p>}
      </div>}
      {simulacao?.decisao?.gravar && <button type="button" onClick={propor} disabled={Boolean(ocupado)}>Propor na central de ações</button>}
      {produto.canais.length > 0 && <div className="table-scroll"><table className="tabela"><thead><tr><th>Canal</th><th>Quantidade</th><th>Receita</th><th>Custo</th><th>Contribuição</th><th>Taxa</th></tr></thead><tbody>
        {produto.canais.map((item) => <tr key={item.canal}><td>{item.canal}{item.observacao ? <><br /><small>{item.observacao}</small></> : null}</td><td>{item.quantidade == null ? "—" : item.quantidade}</td><td>{moeda(item.receita)}</td><td>{moeda(item.custoEstimado)}</td><td>{moeda(item.contribuicao)}</td><td>Não conciliada</td></tr>)}
      </tbody></table></div>}
      <p className="charlie-sales-note">{produto.canais[0]?.aviso || "Este produto não tem venda por canal no histórico sincronizado."}</p>
      <form className="charlie-sales-filters" onSubmit={salvarPiso}>
        <label>Preço mínimo<input type="number" min="0" step="0.01" value={piso} onChange={(event) => setPiso(event.target.value)} /></label>
        <button type="submit" className="secondary" disabled={Boolean(ocupado) || piso === ""}>Gravar piso</button>
      </form>
      {canal && <form className="charlie-sales-filters" onSubmit={salvarCanal}>
        <label>Margem mínima de {canal}<input type="number" min="0" max="99" step="0.1" value={margemCanal} onChange={(event) => setMargemCanal(event.target.value)} /></label>
        <button type="submit" className="secondary" disabled={Boolean(ocupado) || margemCanal === ""}>Gravar margem do canal</button>
      </form>}
    </section>}
  </CharlieSalesPage>;
}
