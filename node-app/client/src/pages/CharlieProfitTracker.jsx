import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

function moeda(valor) {
  return valor == null ? "Não conciliado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CharlieProfitTracker({ onOpen }) {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/charlie-profit").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const itens = painel?.itens || [];

  return <CharlieSalesPage
    titulo="Lucro"
    resumo={painel?.aviso || "Carregando."}
    metricas={[
      { rotulo: "Linhas lidas", valor: texto(painel?.lidos, painel ? "Não informado" : "…") },
      { rotulo: "Conciliadas", valor: texto(painel?.conciliados, painel ? "Não informado" : "…") },
      { rotulo: "Sem taxa", valor: texto(painel?.semTaxa, painel ? "Não informado" : "…") },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
    acoes={onOpen ? <button type="button" onClick={() => onOpen("dashboard")}>Ver o painel</button> : null}
  >
    <section className="panel ecommerce-table">
      <header><h3>Produto e canal</h3><small>{itens.length ? `${itens.length} linha(s)` : "Nenhuma venda lida neste recorte."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Canal</th><th>Receita</th><th>Custo</th><th>Tributos</th><th>Comissão</th><th>Taxa</th><th>Margem</th></tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{texto(item.nome, item.produtoId)}</b><br /><small>{item.produtoId}</small></td>
          <td>{item.canal}</td>
          <td>{moeda(item.receita)}</td>
          <td>{moeda(item.custo)}</td>
          <td>{moeda(item.tributos)}</td>
          <td>{moeda(item.comissao)}</td>
          <td>{moeda(item.taxa)}</td>
          <td>{item.conciliado ? moeda(item.margem) : `Não conciliada${item.faltas?.length ? ` (${item.faltas.join(", ")})` : ""}`}</td>
        </tr>) : <tr><td colSpan="8">Não há venda com produto e canal neste recorte.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
