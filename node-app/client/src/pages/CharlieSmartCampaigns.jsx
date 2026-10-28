import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const TIPO = { parado: "Parado", margem_alta: "Margem estimada", queda: "Queda", sazonal: "Mês recorrente", venda_cruzada: "Compra conjunta" };

function moeda(valor) {
  return valor == null ? "—" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CharlieSmartCampaigns() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar() {
    setPainel(await api.get("/charlie-campaigns"));
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  async function agir(caminho, corpo, texto) {
    setOcupado(caminho);
    setErro("");
    setAviso("");
    try {
      const dados = await api.post(caminho, corpo);
      setAviso(dados.aviso || dados.campanha?.avisoPublicacao || texto);
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const sugestoes = painel?.sugestoes || [];
  const campanhas = painel?.campanhas || [];

  return <CharlieSalesPage
    titulo="Promoções"
    resumo={`${painel?.aviso || "Carregando."} Preço sugerido, meta, período e público ficam em branco. A publicação automática está ${painel?.autorizada ? "autorizada, mas sem canal externo" : "desligada"}.`}
    metricas={[
      { rotulo: "Sugestões", valor: painel ? String(sugestoes.length) : "…" },
      { rotulo: "Campanhas", valor: painel ? String(campanhas.length) : "…" },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
    aviso={aviso}
    acoes={<button type="button" disabled={Boolean(ocupado)} onClick={() => agir("/charlie-campaigns/autorizacao", { autorizada: !painel?.autorizada }, "Autorização atualizada.")}>{painel?.autorizada ? "Revogar publicação" : "Autorizar publicação"}</button>}
  >
    <section className="panel ecommerce-table">
      <header><h3>Oportunidades</h3><small>{sugestoes.length ? `${sugestoes.length} sugestão(ões)` : "Nenhuma sugestão nova."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Campanha</th><th>Tipo</th><th>Preço atual</th><th>Preço sugerido</th><th>Meta</th><th></th></tr></thead><tbody>
        {sugestoes.length ? sugestoes.map((item) => <tr key={item.id}>
          <td><b>{item.nome}</b><br /><small>{item.descricao}</small></td>
          <td>{TIPO[item.tipo] || item.tipo}</td>
          <td>{moeda(item.precoAtual)}</td>
          <td>—<br /><small>{item.precoMotivo}</small></td>
          <td>—<br /><small>{item.metaMotivo}</small></td>
          <td><button type="button" disabled={Boolean(ocupado)} onClick={() => agir("/charlie-campaigns", { id: item.id }, "Rascunho criado.")}>Criar rascunho</button></td>
        </tr>) : <tr><td colSpan="6">O catálogo sincronizado não gerou oportunidade nova.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel ecommerce-table">
      <header><h3>Campanhas</h3><small>{campanhas.length ? `${campanhas.length} campanha(s)` : "Nenhum rascunho."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Nome</th><th>Status</th><th>Público</th><th>Período</th><th>Enviada</th><th></th></tr></thead><tbody>
        {campanhas.length ? campanhas.map((item) => <tr key={item.id}>
          <td><b>{item.nome}</b><br /><small>{item.mensagem}</small></td>
          <td>{item.status}{item.publicada ? " · marcada" : ""}</td>
          <td>{item.publicoMotivo}</td>
          <td>{item.inicio || "—"} a {item.fim || "—"}</td>
          <td>{item.enviada ? "Sim" : "Não"}</td>
          <td>
            <button type="button" disabled={Boolean(ocupado) || item.status !== "rascunho"} onClick={() => agir(`/charlie-campaigns/${encodeURIComponent(item.id)}/decisao`, { decisao: "aprovada" }, "Campanha aprovada.")}>Aprovar</button>
            <button type="button" className="secondary" disabled={Boolean(ocupado) || item.status !== "rascunho"} onClick={() => agir(`/charlie-campaigns/${encodeURIComponent(item.id)}/decisao`, { decisao: "rejeitada" }, "Campanha rejeitada.")}>Rejeitar</button>
            <button type="button" className="secondary" disabled={Boolean(ocupado) || item.status !== "aprovada" || item.publicada || !painel?.autorizada} onClick={() => agir(`/charlie-campaigns/${encodeURIComponent(item.id)}/publicar`, {}, "Campanha marcada sem envio.")}>Marcar publicação</button>
          </td>
        </tr>) : <tr><td colSpan="6">Crie um rascunho para revisar.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
