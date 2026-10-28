import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

function dataHora(valor) {
  const data = new Date(valor || "");
  return Number.isNaN(data.getTime()) ? "Não informada" : data.toLocaleString("pt-BR");
}

export default function CharlieAutomationCenter() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    api.get("/charlie-automations").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const termo = filtro.trim().toLocaleLowerCase("pt-BR");
  const itens = (painel?.itens || []).filter((item) => !termo || `${item.nome || ""} ${item.status || ""} ${item.acao || ""} ${item.modalidade || ""}`.toLocaleLowerCase("pt-BR").includes(termo));

  return <CharlieSalesPage
    titulo="Automações"
    resumo={painel?.aviso || "Carregando."}
    metricas={[
      { rotulo: "Lidas", valor: texto(painel?.lidas, painel ? "Não informado" : "…") },
      { rotulo: "Ativas", valor: texto(painel?.ativas, painel ? "Não informado" : "…") },
      { rotulo: "Aguardando", valor: texto(painel?.aguardando, painel ? "Não informado" : "…") },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => event.preventDefault()}>
      <label>Buscar nesta lista
        <input value={filtro} onChange={(event) => setFiltro(event.target.value)} placeholder="Nome, situação ou ação" />
      </label>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Motor já existente</h3><small>{itens.length ? `${itens.length} automação(ões)` : "Nenhuma automação nesta lista."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Automação</th><th>Situação</th><th>Modalidade</th><th>Ação</th><th>Agenda</th><th>Próxima execução</th><th>Confirmação</th></tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{texto(item.nome)}</b><br /><small>{texto(item.objetivo, "Sem objetivo gravado")}</small></td>
          <td>{texto(item.status)}</td>
          <td>{texto(item.modalidade)}</td>
          <td>{texto(item.acao)}</td>
          <td>{texto(item.agenda)}{item.horario ? ` ${item.horario}` : ""}</td>
          <td>{dataHora(item.proximaExecucao)}</td>
          <td>{texto(item.politica)}</td>
        </tr>) : <tr><td colSpan="7">Não há automação gravada nesta lista.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
