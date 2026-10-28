import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

export default function CharlieSalesCoach() {
  const [equipe, setEquipe] = useState(false);
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");

  async function carregar(verEquipe = equipe) {
    setPainel(await api.get(`/charlie-sales-coach${verEquipe ? "?todos=1" : ""}`));
  }

  useEffect(() => { carregar(false).catch((causa) => setErro(causa.message)); }, []);

  const vendedores = painel?.vendedores || [];

  return <CharlieSalesPage
    titulo="Dicas de venda"
    resumo={`${painel?.aviso || "Carregando."} O tempo de resposta fica em branco. A meta da loja não é dividida entre os vendedores.`}
    lacunas={painel?.lacunas}
    erro={erro}
    aviso={painel?.loja ? `${painel.loja.aviso} Mês ${texto(painel.loja.metaMensal)}. Dia ${texto(painel.loja.metaDiaria)}.` : ""}
  >
    {painel?.podeVerEquipe && <form className="charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); carregar(equipe).catch((causa) => setErro(causa.message)); }}>
      <label><input type="checkbox" checked={equipe} onChange={(event) => setEquipe(event.target.checked)} /> Ver a equipe</label>
      <button type="submit">Atualizar</button>
    </form>}
    {vendedores.length ? vendedores.map((item) => <section key={item.id} className="panel">
      <header><h3>{item.nome}</h3><small>{painel?.escopo === "carteira" ? "Carteira vinculada" : "Equipe"}</small></header>
      <ul className="charlie-sales-metricas">
        <li><span>Orçamentos</span><strong>{texto(item.orcamentos)}</strong></li>
        <li><span>Convertidos</span><strong>{texto(item.convertidos)}</strong></li>
        <li><span>Taxa</span><strong>{texto(item.taxaConversao)}</strong></li>
        <li><span>Vendas do dia</span><strong>{texto(item.vendasDia)}</strong></li>
        <li><span>Vendas do mês</span><strong>{texto(item.vendasMes)}</strong></li>
        <li><span>Meta</span><strong>{texto(item.metaMensal?.valor)}</strong></li>
        <li><span>Falta</span><strong>{texto(item.metaMensal?.faltam)}</strong></li>
      </ul>
      {item.recomendacoes?.length ? <p className="charlie-sales-note">{item.recomendacoes.join(" ")}</p> : null}
      <p className="charlie-sales-note">Pares no mesmo pedido: {item.complementos == null ? "Não consultado" : item.complementos.length ? item.complementos.map((par) => `${par.produto}${par.junto ? ` com ${par.junto}` : ""} · ${par.suporte} pedidos`).join(" · ") : "Nenhum com 3 pedidos ou mais."}</p>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Oportunidades</th><th>Sem contato no cadastro</th><th>Clientes inativos</th><th>Tarefas</th></tr></thead><tbody><tr>
        <td>{item.oportunidades?.length ? item.oportunidades.map((oportunidade) => <div key={oportunidade.numero}>{oportunidade.cliente} · {texto(oportunidade.valor)}</div>) : "Nenhuma"}</td>
        <td>{item.semContato?.length ? item.semContato.map((contato) => <div key={contato.numero}>{contato.cliente}</div>) : "Nenhum"}</td>
        <td>{item.inativos == null ? "Não consultado" : item.inativos.length ? item.inativos.map((cliente) => <div key={cliente.clienteId}>{cliente.cliente} · {cliente.ultimaCompra}</div>) : "Nenhum"}</td>
        <td>{item.tarefas?.map((tarefa) => <div key={tarefa.texto}>{tarefa.texto}</div>)}</td>
      </tr></tbody></table></div>
    </section>) : <section className="panel"><p className="charlie-sales-note">Nenhum vendedor nesta visão. Quem tem carteira vinculada vê só a própria, até pedir a equipe.</p></section>}
  </CharlieSalesPage>;
}
