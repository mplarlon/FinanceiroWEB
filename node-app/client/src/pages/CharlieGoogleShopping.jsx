import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

export default function CharlieGoogleShopping() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/charlie-shopping").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);

  const itens = painel?.itens || [];

  return <CharlieSalesPage
    titulo="Anúncios no Google"
    resumo={`${painel?.aviso || "Carregando."} O Charlie não consulta o Google Merchant Center. Título e descrição não são regravados.`}
    metricas={[
      { rotulo: "Lidos", valor: texto(painel?.lidos, painel ? "Não informado" : "…") },
      { rotulo: "Incompletos", valor: texto(painel?.incompletos, painel ? "Não informado" : "…") },
      { rotulo: "Preços diferentes", valor: texto(painel?.divergentes, painel ? "Não informado" : "…") },
      { rotulo: "Recusas do Google", valor: painel ? String(painel.errosGoogle?.length || 0) : "…" },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <section className="panel ecommerce-table">
      <header><h3>Pendências do catálogo</h3><small>{itens.length ? `${itens.length} produto(s)` : "Nenhuma pendência com os dados sincronizados."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Faltas</th><th>Preço Tray</th><th>Preço ERP</th><th>Disponibilidade</th><th>Sugestão</th></tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{texto(item.nome, item.referencia || item.id)}</b><br /><small>{item.referencia || "Sem referência"}</small></td>
          <td>{item.faltas?.join(", ") || "Nenhuma"}</td>
          <td>{texto(item.preco)}</td>
          <td>{texto(item.precoErp)}</td>
          <td>{texto(item.disponibilidade)}</td>
          <td>{texto(item.sugestao, "Nenhuma")}</td>
        </tr>) : <tr><td colSpan="6">O catálogo sincronizado não mostrou falta nem diferença de preço.</td></tr>}
      </tbody></table></div>
      {(painel?.errosTray || []).map((erro) => <p key={`${erro.em}-${erro.mensagem}`} className="charlie-sales-note">Erro da sincronização Tray: {erro.mensagem}</p>)}
    </section>
  </CharlieSalesPage>;
}
