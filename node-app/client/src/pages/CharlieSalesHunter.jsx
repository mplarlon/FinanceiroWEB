import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const DESTINO = {
  elegivel: "Pode virar lead",
  duplicado: "Já é lead",
  ja_cliente: "Já é cliente",
  abaixo_da_priorizacao: "Abaixo da prioridade",
  cadastro_nao_verificado: "Cliente não conferido",
};

const VAZIO = {
  segmentoId: "",
  cnae: "",
  atividade: "",
  uf: "",
  municipio: "",
  porte: "",
  situacao: "ATIVA",
  limite: 10,
  scoreMinimo: 50,
  somenteNovos: false,
};

export default function CharlieSalesHunter({ onOpen }) {
  const [filtros, setFiltros] = useState(VAZIO);
  const [segmentos, setSegmentos] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [marcados, setMarcados] = useState([]);
  const [aberto, setAberto] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");

  useEffect(() => {
    api.get("/charlie-leads/config")
      .then((dados) => setSegmentos(dados.config?.segmentos || []))
      .catch((causa) => setErro(causa.message));
  }, []);

  function alterar(campo, valor) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  async function pesquisar(event) {
    event.preventDefault();
    setOcupado("pesquisar");
    setErro("");
    setAviso("");
    try {
      const dados = await api.post("/charlie-leads/hunter", {
        ...filtros,
        limite: Number(filtros.limite) || 10,
        scoreMinimo: Number(filtros.scoreMinimo) || 0,
      });
      setResultado(dados);
      setMarcados((dados.empresas || []).filter((item) => item.destino === "elegivel").map((item) => item.cnpj));
      setAviso(dados.aviso || "");
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function gravar(distribuir) {
    const empresas = (resultado?.empresas || []).filter((item) => marcados.includes(item.cnpj));
    if (!empresas.length) {
      setErro("Marque ao menos uma empresa elegível.");
      return;
    }
    setOcupado(distribuir ? "distribuir" : "gravar");
    setErro("");
    try {
      const dados = await api.post("/charlie-leads/hunter/gravar", {
        empresas,
        distribuir,
        scoreMinimo: Number(filtros.scoreMinimo) || 0,
      });
      const gravados = (dados.resultados || []).filter((item) => item.gravado).length;
      const produtos = (dados.resultados || []).reduce((soma, item) => soma + (item.produtos || 0), 0);
      const partes = [`${gravados} contato(s) gravado(s) em Contatos.`];
      if (produtos) partes.push(`${produtos} produto(s) do ERP ligado(s) ao segmento.`);
      if (dados.distribuicaoErro) partes.push(dados.distribuicaoErro);
      else if (distribuir) partes.push("A distribuição usou as regras já cadastradas.");
      setAviso(partes.join(" "));
      setResultado((atual) => atual ? {
        ...atual,
        empresas: atual.empresas.map((item) => {
          const feito = (dados.resultados || []).find((linha) => linha.cnpj === item.cnpj && linha.gravado);
          return feito ? { ...item, destino: "duplicado", leadId: feito.leadId } : item;
        }),
      } : atual);
      setMarcados([]);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const empresas = resultado?.empresas || [];
  const detalhe = empresas.find((item) => item.cnpj === aberto);

  return <CharlieSalesPage
    titulo="Buscar empresas"
    resumo="A busca usa a Casa dos Dados de Contatos e consome crédito quando o resultado não está em cache. A pontuação é prioridade comercial, não probabilidade de compra."
    metricas={[{ rotulo: "Nesta página", valor: resultado ? String(empresas.length) : "…" }]}
    erro={erro}
    aviso={aviso}
  >
    <form className="charlie-sales-filters" onSubmit={pesquisar}>
        <label>Segmento
          <select value={filtros.segmentoId} onChange={(event) => alterar("segmentoId", event.target.value)}>
            <option value="">Escolher</option>
            {segmentos.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </select>
        </label>
        <label>CNAE<input value={filtros.cnae} onChange={(event) => alterar("cnae", event.target.value)} placeholder="4321500" /></label>
        <label>Atividade<input value={filtros.atividade} onChange={(event) => alterar("atividade", event.target.value)} placeholder="elétrica" /></label>
        <label>UF<input value={filtros.uf} maxLength={2} onChange={(event) => alterar("uf", event.target.value.toUpperCase())} /></label>
        <label>Município<input value={filtros.municipio} onChange={(event) => alterar("municipio", event.target.value)} /></label>
        <label>Porte
          <select value={filtros.porte} onChange={(event) => alterar("porte", event.target.value)}>
            <option value="">Todos</option>
            <option value="01">01 — microempresa</option>
            <option value="03">03 — pequeno porte</option>
            <option value="05">05 — demais</option>
          </select>
        </label>
        <label>Situação
          <select value={filtros.situacao} onChange={(event) => alterar("situacao", event.target.value)}>
            <option value="ATIVA">Ativa</option>
            <option value="BAIXADA">Baixada</option>
            <option value="INAPTA">Inapta</option>
            <option value="SUSPENSA">Suspensa</option>
            <option value="NULA">Nula</option>
          </select>
        </label>
        <label>Prioridade mínima<input type="number" min="0" max="100" value={filtros.scoreMinimo} onChange={(event) => alterar("scoreMinimo", event.target.value)} /></label>
        <label>Quantidade<input type="number" min="1" max="20" value={filtros.limite} onChange={(event) => alterar("limite", event.target.value)} /></label>
        <label className="charlie-hunter-check"><input type="checkbox" checked={filtros.somenteNovos} onChange={(event) => alterar("somenteNovos", event.target.checked)} /> Ocultar quem já é cliente</label>
        <button type="submit" disabled={Boolean(ocupado)}>{ocupado === "pesquisar" ? "Pesquisando..." : "Pesquisar empresas"}</button>
    </form>
    <section className="panel ecommerce-table">
      <header>
        <h3>{resultado?.segmento?.nome || "Empresas"}</h3>
        <small>{resultado ? `${empresas.length} nesta página${resultado.reutilizado ? " · resultado reutilizado" : ""}` : "A pesquisa ainda não foi feita."}</small>
      </header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th></th><th>Empresa</th><th>Cidade</th><th>Atividade</th><th>Prioridade</th><th>Situação</th><th></th>
      </tr></thead><tbody>
        {empresas.length ? empresas.map((item) => <tr key={item.cnpj}>
          <td><input type="checkbox" checked={marcados.includes(item.cnpj)} disabled={item.destino !== "elegivel"} onChange={(event) => setMarcados((atual) => event.target.checked ? [...atual, item.cnpj] : atual.filter((cnpj) => cnpj !== item.cnpj))} /></td>
          <td><b>{item.nomeFantasia || item.razaoSocial || item.cnpj}</b><small> {item.cnpj}</small></td>
          <td>{[item.municipio, item.uf].filter(Boolean).join("/") || "—"}</td>
          <td>{item.cnaeDescricao || item.cnae || "—"}</td>
          <td><b>{item.pontuacao ?? "—"}</b><small> {item.rotulo || ""}</small></td>
          <td>{DESTINO[item.destino] || item.destino}</td>
          <td><button type="button" className="secondary" onClick={() => setAberto(aberto === item.cnpj ? "" : item.cnpj)}>Abordagem</button></td>
        </tr>) : <tr><td colSpan="7">Nenhuma empresa nesta consulta.</td></tr>}
      </tbody></table></div>
      <div className="ecommerce-action-buttons">
        <button type="button" onClick={() => gravar(false)} disabled={Boolean(ocupado) || !marcados.length}>{ocupado === "gravar" ? "Gravando..." : "Gravar leads marcados"}</button>
        <button type="button" className="secondary" onClick={() => gravar(true)} disabled={Boolean(ocupado) || !marcados.length}>{ocupado === "distribuir" ? "Distribuindo..." : "Gravar e distribuir"}</button>
        <button type="button" className="secondary" onClick={() => onOpen?.("leads")}>Abrir contatos</button>
      </div>
    </section>
    {detalhe && <section className="panel charlie-booster-detail">
      <header><h3>{detalhe.nomeFantasia || detalhe.razaoSocial}</h3><span>{DESTINO[detalhe.destino]}</span></header>
      <p>{detalhe.aviso}</p>
      <div className="charlie-booster-copy"><strong>Rascunho para o vendedor</strong><p>{detalhe.abordagem}</p></div>
      {detalhe.criterios?.length > 0 && <ul className="charlie-hunter-criterios">{detalhe.criterios.map((item) => <li key={item.id}><b>{item.pontos}</b> {item.motivo}</li>)}</ul>}
    </section>}
  </CharlieSalesPage>;
}
