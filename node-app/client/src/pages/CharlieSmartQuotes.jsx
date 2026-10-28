import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const SITUACAO = {
  encontrado: "Código encontrado",
  escolhido: "Escolhido",
  revisar: "Confirmar nome",
  ambiguo: "Vários parecidos",
  nao_encontrado: "Não encontrado",
  erp_indisponivel: "ERP não consultado",
};

function moeda(valor) {
  return valor == null ? "—" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export default function CharlieSmartQuotes() {
  const [texto, setTexto] = useState("");
  const [atual, setAtual] = useState(null);
  const [lista, setLista] = useState([]);
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar() {
    const dados = await api.get("/charlie-quotes");
    setLista(dados.orcamentos || []);
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  function mostrar(orcamento, mensagem) {
    setAtual(orcamento);
    setAviso(mensagem || "");
    setLista((itens) => [orcamento, ...itens.filter((item) => item.id !== orcamento.id)]);
  }

  async function interpretar(event) {
    event.preventDefault();
    setOcupado("interpretar");
    setErro("");
    try {
      const dados = await api.post("/charlie-quotes/interpretar", { texto, origem: "texto" });
      if (!dados.orcamento) setAviso(dados.aviso || "Nenhum item identificado.");
      else mostrar(dados.orcamento, dados.aviso);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function arquivo(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setOcupado("arquivo");
    setErro("");
    try {
      const dados = await api.post("/charlie-quotes/interpretar", { nome: file.name, conteudo: await base64(file), origem: "arquivo" });
      if (!dados.orcamento) setAviso(dados.aviso || "Nenhum item identificado.");
      else mostrar(dados.orcamento, dados.aviso);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  async function quantidade(indice, valor) {
    if (!atual) return;
    setErro("");
    try {
      const dados = await api.post(`/charlie-quotes/${atual.id}/quantidade`, { indice, quantidade: valor });
      mostrar(dados.orcamento);
    } catch (causa) {
      setErro(causa.message);
    }
  }

  async function escolher(indice, codigo) {
    setErro("");
    try {
      const dados = await api.post(`/charlie-quotes/${atual.id}/escolher`, { indice, codigo });
      mostrar(dados.orcamento);
    } catch (causa) {
      setErro(causa.message);
    }
  }

  async function confirmar() {
    setOcupado("confirmar");
    setErro("");
    try {
      const dados = await api.post(`/charlie-quotes/${atual.id}/confirmar`, {});
      mostrar(dados.orcamento, dados.orcamento.motivo);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const itens = atual?.itens || [];

  return <CharlieSalesPage
    titulo="Orçamentos"
    resumo="Cole o texto do WhatsApp, do e-mail ou de uma lista. CSV, XLSX e PDF também são lidos. Imagem não é lida. O preço e o estoque saem do cadastro. Produto parecido só entra se alguém escolher. Confirmar não grava o orçamento no Automec."
    metricas={[{ rotulo: "Itens do rascunho", valor: atual ? String(itens.length) : "…" }]}
    erro={erro}
    aviso={aviso}
  >
    <form className="charlie-sales-filters" onSubmit={interpretar}>
        <label className="charlie-quotes-texto">Lista
          <textarea value={texto} onChange={(event) => setTexto(event.target.value)} rows={5} placeholder={"10 cabo flexível\nCABO123;4"} />
        </label>
        <button type="submit" disabled={Boolean(ocupado) || !texto.trim()}>{ocupado === "interpretar" ? "Lendo..." : "Montar rascunho"}</button>
        <label className="charlie-hunter-check">Arquivo
          <input type="file" accept=".csv,.txt,.tsv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp" onChange={arquivo} disabled={Boolean(ocupado)} />
        </label>
    </form>
    <section className="panel ecommerce-table">
      <header>
        <h3>{atual ? (atual.status === "confirmado" ? "Rascunho confirmado" : "Rascunho") : "Itens"}</h3>
        <small>{atual ? `Total dos itens resolvidos: ${moeda(atual.total)}${atual.totalParcial ? " · parcial, há preço ausente" : ""}` : `${lista.length} rascunho(s)`}</small>
      </header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Pedido</th><th>Quantidade</th><th>Produto</th><th>Preço</th><th>Estoque</th><th>Valor</th><th>Situação</th>
      </tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={`${atual.id}-${item.indice}`}>
          <td>{item.origem || item.descricao}</td>
          <td>{atual.status === "confirmado" ? (item.quantidade ?? "—") : <input type="number" min="0.001" step="0.001" defaultValue={item.quantidade ?? ""} onBlur={(event) => quantidade(item.indice, event.target.value)} />}</td>
          <td>
            {item.produto ? <b>{item.produto.codigo} — {item.produto.nome}</b> : "—"}
            {item.candidatos?.length > 0 && atual.status !== "confirmado" && <select value={item.produto?.codigo || ""} onChange={(event) => escolher(item.indice, event.target.value)}>
              <option value="">Escolher</option>
              {item.candidatos.map((candidato) => <option key={candidato.codigo} value={candidato.codigo}>{candidato.codigo} — {candidato.nome}</option>)}
            </select>}
          </td>
          <td>{moeda(item.produto?.preco)}</td>
          <td>{item.produto ? (item.produto.estoque == null ? "sem saldo" : item.produto.estoque) : "—"}</td>
          <td>{moeda(item.valor)}</td>
          <td>{SITUACAO[item.situacao] || item.situacao}<small> {item.aviso}</small></td>
        </tr>) : <tr><td colSpan="7">Nenhum rascunho aberto.</td></tr>}
      </tbody></table></div>
      {atual?.status === "rascunho" && <div className="ecommerce-action-buttons">
        <button type="button" onClick={confirmar} disabled={Boolean(ocupado)}>{ocupado === "confirmar" ? "Confirmando..." : "Confirmar rascunho"}</button>
      </div>}
      {atual?.motivo && <p className="charlie-sales-note">{atual.motivo}</p>}
    </section>
  </CharlieSalesPage>;
}
