import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

function moeda(valor) {
  return valor == null ? "Não consultado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBr(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : "Não informado";
}

export default function CharlieSalesMission() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    api.get("/charlie-mission").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const termo = filtro.trim().toLocaleLowerCase("pt-BR");
  const itens = (painel?.itens || []).filter((item) => !termo || `${item.nome || ""} ${item.tipo || ""} ${item.origem || ""} ${item.situacao || ""}`.toLocaleLowerCase("pt-BR").includes(termo));

  const valor = (campo) => painel ? texto(painel[campo], "Não consultado") : "…";

  return <CharlieSalesPage
    titulo="Tarefas do dia"
    resumo={painel?.aviso || "Carregando."}
    metricas={[
      { rotulo: "Missões lidas", valor: valor("lidas") },
      { rotulo: "Alcançadas", valor: valor("alcancadas") },
      { rotulo: "Sem realizado", valor: valor("semRealizado") },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => event.preventDefault()}>
      <label>Buscar nesta lista
        <input value={filtro} onChange={(event) => setFiltro(event.target.value)} placeholder="Nome, tipo, origem ou situação" />
      </label>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Metas já gravadas</h3><small>{!painel ? "Carregando." : itens.length ? `${itens.length} missão(ões)` : "Nenhuma meta gravada nesta lista."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Missão</th><th>Origem</th><th>Meta</th><th>Realizado</th><th>Atingimento</th><th>Falta</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>
        {!painel ? <tr><td colSpan="8">Carregando.</td></tr> : itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{texto(item.nome, item.tipo)}</b><br /><small>{item.tipo}</small><br /><small>{item.plano}</small></td>
          <td>{texto(item.origem)}</td>
          <td>{moeda(item.meta)}</td>
          <td>{moeda(item.realizado)}</td>
          <td>{item.atingimento == null ? "Não consultado" : `${item.atingimento.toLocaleString("pt-BR")}%`}</td>
          <td>{moeda(item.falta)}</td>
          <td>{dataBr(item.prazo)}</td>
          <td>{item.situacao}</td>
        </tr>) : <tr><td colSpan="8">Não há meta gravada para acompanhar.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
