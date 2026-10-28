import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

function moeda(valor) {
  return valor == null ? "Não informado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBr(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : "Não informada";
}

export default function CharlieCustomer360() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    api.get("/charlie-customer360").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const termo = filtro.trim().toLocaleLowerCase("pt-BR");
  const itens = (painel?.itens || []).filter((item) => !termo || `${item.nome || ""} ${item.clienteId} ${item.vendedor || ""} ${item.pendencia || ""}`.toLocaleLowerCase("pt-BR").includes(termo));

  return <CharlieSalesPage
    titulo="Ficha do cliente"
    resumo={painel?.aviso || "Carregando."}
    metricas={[
      { rotulo: "Fichas lidas", valor: texto(painel?.lidos, painel ? "Não informado" : "…") },
      { rotulo: "Com orçamento", valor: texto(painel?.comOrcamento, painel ? "Não informado" : "…") },
      { rotulo: "Sem pendência", valor: texto(painel?.semPendencia, painel ? "Não informado" : "…") },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => event.preventDefault()}>
      <label>Buscar nesta lista
        <input value={filtro} onChange={(event) => setFiltro(event.target.value)} placeholder="Cliente, vendedor ou pendência" />
      </label>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Clientes</h3><small>{itens.length ? `${itens.length} ficha(s)` : "Nenhuma ficha nesta lista."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Cliente</th><th>Vendedor</th><th>Última compra</th><th>Pedidos</th><th>Receita</th><th>Orçamentos abertos</th><th>Valor em aberto</th><th>Pendência</th></tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{texto(item.nome, String(item.clienteId))}</b><br /><small>{item.clienteId}</small></td>
          <td>{texto(item.vendedor)}</td>
          <td>{dataBr(item.ultimaCompra)}</td>
          <td>{texto(item.pedidos, "Não consultado")}</td>
          <td>{moeda(item.receita)}</td>
          <td>{texto(item.orcamentosAbertos, "Não consultado")}</td>
          <td>{moeda(item.valorOrcamentos)}</td>
          <td>{texto(item.pendencia, "Não consultada")}</td>
        </tr>) : <tr><td colSpan="8">Não há cliente com compra no período ou orçamento em aberto nesta lista.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
