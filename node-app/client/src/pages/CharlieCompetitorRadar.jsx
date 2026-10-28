import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function moeda(valor) {
  return valor == null ? "—" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const VAZIO = { productId: "", fonte: "", url: "", nome: "", marca: "", codigo: "", modelo: "", modeloNosso: "", caracteristicas: "", quantidade: "", condicoes: "", em: "", preco: "", disponibilidade: "", frete: "", promocao: "" };

export default function CharlieCompetitorRadar() {
  const [painel, setPainel] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [consulta, setConsulta] = useState({ id: "", em: "", preco: "", disponibilidade: "", frete: "", promocao: "" });
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setPainel(await api.get("/tray/radar"));
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  function campo(nome, valor) { setForm((atual) => ({ ...atual, [nome]: valor })); }

  async function cadastrar(event) {
    event.preventDefault();
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      await api.post("/tray/radar", {
        productId: form.productId,
        modeloNosso: form.modeloNosso || null,
        fonte: { nome: form.fonte, url: form.url || null },
        concorrente: { nome: form.nome, marca: form.marca, codigo: form.codigo, modelo: form.modelo, caracteristicas: form.caracteristicas, quantidade: form.quantidade, condicoes: form.condicoes },
        consulta: { em: form.em, preco: form.preco === "" ? null : Number(form.preco), disponibilidade: form.disponibilidade || null, frete: form.frete === "" ? null : Number(form.frete), promocao: form.promocao || null },
      });
      setForm(VAZIO);
      setAviso("Referência cadastrada. Nenhuma página foi consultada.");
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado(false);
    }
  }

  async function novaConsulta(event) {
    event.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      await api.post(`/tray/radar/${encodeURIComponent(consulta.id)}/consulta`, {
        em: consulta.em,
        preco: consulta.preco === "" ? null : Number(consulta.preco),
        disponibilidade: consulta.disponibilidade || null,
        frete: consulta.frete === "" ? null : Number(consulta.frete),
        promocao: consulta.promocao || null,
      });
      setConsulta({ id: "", em: "", preco: "", disponibilidade: "", frete: "", promocao: "" });
      setAviso("Consulta registrada com a data informada.");
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado(false);
    }
  }

  const referencias = painel?.referencias || [];
  const produtos = painel?.produtos || [];

  return <CharlieSalesPage
    titulo="Concorrentes"
    resumo={`${painel?.aviso || "Carregando."} Alerta só sai quando marca e código coincidem e o nosso preço está acima do preço cadastrado.`}
    metricas={[{ rotulo: "Referências", valor: painel ? String(referencias.length) : "…" }]}
    erro={erro}
    aviso={aviso}
  >
    {(painel?.alertas || []).map((alerta) => <section className="panel charlie-sales-alerta" key={alerta.id}>
      <strong>{alerta.texto}</strong>
      <p>Fonte: {alerta.fonte || "não informada"}. Data: {alerta.consultadoEm || "não informada"}. Confiança: {alerta.confianca}.</p>
    </section>)}
    <section className="panel">
      <header><h3>Nova referência</h3></header>
      <form className="charlie-sales-filters" onSubmit={cadastrar}>
        <label>Produto nosso
          <select value={form.productId} onChange={(event) => campo("productId", event.target.value)} required>
            <option value="">Selecione</option>
            {produtos.map((item) => <option key={item.id} value={item.id}>{item.nome}{item.codigo ? ` (${item.codigo})` : ""}</option>)}
          </select>
        </label>
        <label>Fonte<input value={form.fonte} onChange={(event) => campo("fonte", event.target.value)} required /></label>
        <label>Endereço da fonte<input value={form.url} onChange={(event) => campo("url", event.target.value)} /></label>
        <label>Anúncio<input value={form.nome} onChange={(event) => campo("nome", event.target.value)} required /></label>
        <label>Marca do anúncio<input value={form.marca} onChange={(event) => campo("marca", event.target.value)} /></label>
        <label>Código do anúncio<input value={form.codigo} onChange={(event) => campo("codigo", event.target.value)} /></label>
        <label>Modelo do anúncio<input value={form.modelo} onChange={(event) => campo("modelo", event.target.value)} /></label>
        <label>Modelo nosso, se souber<input value={form.modeloNosso} onChange={(event) => campo("modeloNosso", event.target.value)} /></label>
        <label>Características<input value={form.caracteristicas} onChange={(event) => campo("caracteristicas", event.target.value)} /></label>
        <label>Quantidade<input value={form.quantidade} onChange={(event) => campo("quantidade", event.target.value)} /></label>
        <label>Condições<input value={form.condicoes} onChange={(event) => campo("condicoes", event.target.value)} /></label>
        <label>Data da consulta<input type="date" value={form.em} onChange={(event) => campo("em", event.target.value)} required /></label>
        <label>Preço anunciado<input type="number" min="0" step="0.01" value={form.preco} onChange={(event) => campo("preco", event.target.value)} /></label>
        <label>Disponibilidade<input value={form.disponibilidade} onChange={(event) => campo("disponibilidade", event.target.value)} /></label>
        <label>Frete informado<input type="number" min="0" step="0.01" value={form.frete} onChange={(event) => campo("frete", event.target.value)} /></label>
        <label>Promoção<input value={form.promocao} onChange={(event) => campo("promocao", event.target.value)} /></label>
        <button type="submit" disabled={ocupado}>{ocupado ? "Gravando..." : "Cadastrar"}</button>
      </form>
      <p className="charlie-sales-note">Marca e código nossos vêm do produto sincronizado. O modelo nosso só entra se for digitado aqui. Campo vazio permanece indisponível.</p>
    </section>
    <section className="panel ecommerce-table">
      <header><h3>Referências</h3><small>{referencias.length ? `${referencias.length} referência(s)` : "Nenhuma referência cadastrada."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Produto</th><th>Anúncio</th><th>Confiança</th><th>Preço nosso</th><th>Preço anunciado</th><th>Frete</th><th>Fonte</th><th>Data</th><th>Alerta</th>
      </tr></thead><tbody>
        {referencias.length ? referencias.map((item) => <tr key={item.id}>
          <td><b>{item.nosso.nome}</b><br /><small>{item.nosso.marca || "marca indisponível"} · {item.nosso.codigo || "código indisponível"}{item.modeloOrigem ? ` · modelo ${item.modeloOrigem}` : ""}</small></td>
          <td>{item.concorrente.nome}<br /><small>{item.concorrente.marca || "—"} · {item.concorrente.codigo || "sem código"} · {item.concorrente.modelo || "sem modelo"}</small></td>
          <td>{item.comparacao.confianca}</td>
          <td>{moeda(item.comparacao.precoNosso)}</td>
          <td>{moeda(item.comparacao.precoReferencia)}</td>
          <td>{moeda(item.comparacao.frete)}</td>
          <td>{item.comparacao.fonte || "—"}</td>
          <td>{item.comparacao.consultadoEm || "—"}</td>
          <td>{item.comparacao.alerta || item.comparacao.motivo}{item.comparacao.alteracao ? ` Preço anunciado foi de ${moeda(item.comparacao.alteracao.de)} para ${moeda(item.comparacao.alteracao.para)}.` : ""}</td>
        </tr>) : <tr><td colSpan="9">Cadastre uma observação para comparar.</td></tr>}
      </tbody></table></div>
    </section>
    {referencias.length > 0 && <section className="panel">
      <header><h3>Nova consulta da mesma referência</h3></header>
      <form className="charlie-sales-filters" onSubmit={novaConsulta}>
        <label>Referência
          <select value={consulta.id} onChange={(event) => setConsulta((atual) => ({ ...atual, id: event.target.value }))} required>
            <option value="">Selecione</option>
            {referencias.map((item) => <option key={item.id} value={item.id}>{item.nosso.nome} · {item.concorrente.nome}</option>)}
          </select>
        </label>
        <label>Data<input type="date" value={consulta.em} onChange={(event) => setConsulta((atual) => ({ ...atual, em: event.target.value }))} required /></label>
        <label>Preço<input type="number" min="0" step="0.01" value={consulta.preco} onChange={(event) => setConsulta((atual) => ({ ...atual, preco: event.target.value }))} /></label>
        <label>Disponibilidade<input value={consulta.disponibilidade} onChange={(event) => setConsulta((atual) => ({ ...atual, disponibilidade: event.target.value }))} /></label>
        <label>Frete<input type="number" min="0" step="0.01" value={consulta.frete} onChange={(event) => setConsulta((atual) => ({ ...atual, frete: event.target.value }))} /></label>
        <label>Promoção<input value={consulta.promocao} onChange={(event) => setConsulta((atual) => ({ ...atual, promocao: event.target.value }))} /></label>
        <button type="submit" className="secondary" disabled={ocupado}>Registrar consulta</button>
      </form>
    </section>}
  </CharlieSalesPage>;
}
