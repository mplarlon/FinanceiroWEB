import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

export default function CharlieSeo() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/charlie-seo").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const itens = painel?.itens || [];

  return <CharlieSalesPage
    titulo="Textos da loja"
    resumo={`${painel?.aviso || "Carregando."} Título, descrição e URL não são gravados na loja.`}
    metricas={[
      { rotulo: "Lidos", valor: texto(painel?.lidos, painel ? "Não informado" : "…") },
      { rotulo: "Sem descrição", valor: texto(painel?.semDescricao, painel ? "Não informado" : "…") },
      { rotulo: "Caminhos repetidos", valor: texto(painel?.caminhosRepetidos, painel ? "Não informado" : "…") },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <section className="panel ecommerce-table">
      <header><h3>Sugestões do cadastro</h3><small>{itens.length ? `${itens.length} produto(s)` : "Nenhuma sugestão com os dados sincronizados."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Título sugerido</th><th>Descrição sugerida</th><th>Caminho sugerido</th><th>Faltas</th></tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{texto(item.nome, item.referencia || item.id)}</b><br /><small>{item.referencia || "Sem referência"}{item.nomeErp ? ` · ERP: ${item.nomeErp}` : ""}</small></td>
          <td>{texto(item.tituloSugerido)}{item.origemTitulo ? <><br /><small>Origem: {item.origemTitulo}</small></> : null}</td>
          <td>{texto(item.descricaoSugerida)}{item.descricaoCortada ? <><br /><small>Texto cortado em 300 caracteres.</small></> : null}</td>
          <td>{texto(item.caminhoSugerido)}{item.caminhoRepetido ? <><br /><small>Caminho repetido no catálogo.</small></> : null}<br /><small>URL publicada: não sincronizada</small></td>
          <td>{item.faltas?.length ? item.faltas.join(", ") : "Nenhuma"}</td>
        </tr>) : <tr><td colSpan="5">O catálogo sincronizado não pediu complemento de título, descrição ou caminho.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
