import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

function moeda(valor) {
  return valor == null ? "Não informado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Linha({ item, cadastrado }) {
  return <tr>
    <td><b>{texto(item.nomeA, item.a)}</b> + <b>{texto(item.nomeB, item.b)}</b><br /><small>{item.a} · {item.b}</small></td>
    <td>{item.pedidos}</td>
    <td>{moeda(item.preco)}</td>
    <td>{moeda(item.custo)}</td>
    <td>{moeda(item.margem)}</td>
    <td>{item.estoqueInsuficiente == null ? "Estoque não consultado nos dois itens" : item.estoqueInsuficiente ? `Insuficiente (${texto(item.saldoA, "—")} e ${texto(item.saldoB, "—")})` : `Disponível (${item.saldoA} e ${item.saldoB})`}</td>
    <td>{cadastrado ? `Já no kit ${item.kits.join(", ")}` : "Sugestão, sem gravação"}</td>
  </tr>;
}

export default function CharlieKitBuilder() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/charlie-kits").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const sugestoes = painel?.sugestoes || [];
  const cadastrados = painel?.jaCadastrados || [];

  return <CharlieSalesPage
    titulo="Montar kits"
    resumo={`${painel?.aviso || "Carregando."} Nenhum kit é criado no ERP nem na loja.`}
    metricas={[
      { rotulo: "Pares lidos", valor: texto(painel?.lidos, painel ? "Não informado" : "…") },
      { rotulo: "Sem margem", valor: texto(painel?.semMargem, painel ? "Não informado" : "…") },
      { rotulo: "Estoque insuficiente", valor: texto(painel?.estoqueIncompleto, painel ? "Não informado" : "…") },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <section className="panel ecommerce-table">
      <header><h3>Sugestões</h3><small>{sugestoes.length ? `${sugestoes.length} par(es)` : "Nenhum par novo com pelo menos 2 pedidos."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produtos</th><th>Pedidos juntos</th><th>Preço somado</th><th>Custo somado</th><th>Margem</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>
        {sugestoes.length ? sugestoes.map((item) => <Linha key={item.id} item={item} />) : <tr><td colSpan="7">Não há par comprado junto, fora dos kits já cadastrados, com a regra de dois pedidos.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel ecommerce-table">
      <header><h3>Pares que já estão em um kit</h3><small>{cadastrados.length ? `${cadastrados.length} par(es)` : "Nenhum par lido já faz parte de um kit."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produtos</th><th>Pedidos juntos</th><th>Preço somado</th><th>Custo somado</th><th>Margem</th><th>Estoque</th><th>Situação</th></tr></thead><tbody>
        {cadastrados.length ? cadastrados.map((item) => <Linha key={item.id} item={item} cadastrado />) : <tr><td colSpan="7">Os kits cadastrados não repetem um par desta leitura.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
