import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const TIPOS = [
  ["licitacao", "Licitação"],
  ["edital", "Edital"],
  ["demanda", "Demanda publicada"],
  ["noticia", "Notícia"],
  ["unidade", "Abertura de unidade"],
  ["investimento", "Investimento"],
  ["projeto", "Projeto anunciado"],
];

const VAZIO = { tipo: "licitacao", fonte: "", url: "", data: "", empresa: "", cnpj: "", segmento: "", codigos: "", descricao: "" };

export default function CharlieBuyingSignals() {
  const [painel, setPainel] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setPainel(await api.get("/charlie-signals"));
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  function campo(nome, valor) { setForm((atual) => ({ ...atual, [nome]: valor })); }

  async function cadastrar(event) {
    event.preventDefault();
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      await api.post("/charlie-signals", {
        tipo: form.tipo,
        fonte: { nome: form.fonte, url: form.url || null },
        data: form.data,
        empresa: form.empresa,
        cnpj: form.cnpj || null,
        segmento: form.segmento || null,
        codigos: form.codigos.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
        descricao: form.descricao || null,
      });
      setForm(VAZIO);
      setAviso("Sinal registrado. Nenhuma fonte externa foi consultada.");
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado(false);
    }
  }

  async function oportunidade(id) {
    setOcupado(true);
    setErro("");
    try {
      const dados = await api.post(`/charlie-signals/${encodeURIComponent(id)}/oportunidade`, {});
      setAviso(dados.aviso);
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado(false);
    }
  }

  const sinais = painel?.sinais || [];

  return <CharlieSalesPage
    titulo="Quem pode comprar"
    resumo={`${painel?.aviso || "Carregando."} Sem código encontrado no ERP, a tela não afirma que a empresa precisa comprar um produto.`}
    metricas={[{ rotulo: "Sinais", valor: painel ? String(sinais.length) : "…" }]}
    erro={erro}
    aviso={aviso}
  >
    <section className="panel">
      <header><h3>Novo registro</h3></header>
      <form className="charlie-sales-filters" onSubmit={cadastrar}>
        <label>Tipo<select value={form.tipo} onChange={(event) => campo("tipo", event.target.value)}>{TIPOS.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
        <label>Fonte<input value={form.fonte} onChange={(event) => campo("fonte", event.target.value)} required /></label>
        <label>Endereço<input value={form.url} onChange={(event) => campo("url", event.target.value)} /></label>
        <label>Data<input type="date" value={form.data} onChange={(event) => campo("data", event.target.value)} required /></label>
        <label>Empresa<input value={form.empresa} onChange={(event) => campo("empresa", event.target.value)} required /></label>
        <label>CNPJ<input value={form.cnpj} onChange={(event) => campo("cnpj", event.target.value)} /></label>
        <label>Segmento<input value={form.segmento} onChange={(event) => campo("segmento", event.target.value)} /></label>
        <label>Códigos de produto<input value={form.codigos} onChange={(event) => campo("codigos", event.target.value)} /></label>
        <label>Descrição<input value={form.descricao} onChange={(event) => campo("descricao", event.target.value)} /></label>
        <button type="submit" disabled={ocupado}>{ocupado ? "Gravando..." : "Registrar"}</button>
      </form>
    </section>
    <section className="panel ecommerce-table">
      <header><h3>Sinais</h3><small>{sinais.length ? `${sinais.length} registro(s)` : "Nenhum sinal registrado."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Empresa</th><th>Fonte</th><th>Data</th><th>Segmento</th><th>Produtos</th><th>Relevância</th><th></th></tr></thead><tbody>
        {sinais.length ? sinais.map((item) => <tr key={item.id}>
          <td><b>{item.empresa}</b><br /><small>{item.abordagem?.texto}</small></td>
          <td>{item.fonte?.nome}</td>
          <td>{item.data}</td>
          <td>{item.segmentoNome || "Sem vínculo"}</td>
          <td>{item.produtos?.length ? item.produtos.map((produto) => produto.nome).join(", ") : "Nenhum"}<br /><small>{item.motivo}</small></td>
          <td>{item.relevancia?.rotulo}<br /><small>{item.relevancia?.aviso}</small></td>
          <td><button type="button" disabled={ocupado || item.oportunidadeId} onClick={() => oportunidade(item.id)}>{item.oportunidadeId ? "Oportunidade gravada" : "Criar oportunidade"}</button></td>
        </tr>) : <tr><td colSpan="7">Registre uma fonte pública já conferida.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
