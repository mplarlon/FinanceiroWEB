import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function texto(valor, vazio = "Não informado") {
  return valor == null || valor === "" ? vazio : valor;
}

export default function CharlieSmartPurchasing() {
  const [janela, setJanela] = useState("15");
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function carregar(dias = janela) {
    setPainel(await api.get(`/charlie-purchasing?janelaDias=${encodeURIComponent(dias)}`));
  }

  useEffect(() => { carregar("15").catch((causa) => setErro(causa.message)); }, []);

  async function acao(caminho, corpo, sucesso) {
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const dados = await api.post(caminho, corpo || {});
      setAviso(sucesso(dados));
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado(false);
    }
  }

  const itens = painel?.itens || [];

  return <CharlieSalesPage
    titulo="O que comprar"
    resumo={`${painel?.aviso || "Carregando."} A demanda prevista repete a média dos últimos 90 dias. Custo, prazo e qualidade ficam em branco quando o cadastro não tem o dado.`}
    metricas={[{ rotulo: "Sugestões", valor: painel ? String(itens.length) : "…" }]}
    lacunas={painel?.lacunas}
    erro={erro}
    aviso={aviso}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); carregar(janela).catch((causa) => setErro(causa.message)); }}>
      <label>Janela de cobertura
        <select value={janela} onChange={(event) => setJanela(event.target.value)}>
          {["7", "15", "30", "60"].map((dias) => <option key={dias} value={dias}>{dias} dias</option>)}
        </select>
      </label>
      <button type="submit">Atualizar</button>
      <button type="button" className="secondary" disabled={ocupado} onClick={() => acao("/charlie-purchasing/autorizacao", { autorizada: !painel?.emissaoAutorizada }, (dados) => dados.emissaoAutorizada ? "Emissão de pedido autorizada. A solicitação continua separada." : "Emissão de pedido desligada.")}>{painel?.emissaoAutorizada ? "Desligar emissão" : "Autorizar emissão"}</button>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Sugestões</h3><small>{itens.length ? `${itens.length} produto(s)` : "Nenhuma compra sugerida com os dados lidos."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Produto</th><th>Quantidade</th><th>Fornecedor</th><th>Custo</th><th>Prazo</th><th>Qualidade</th><th></th></tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{item.nome}</b><br /><small>{item.justificativa}</small></td>
          <td>{item.quantidade}<br /><small>Saldo {texto(item.saldo)} · aberto {texto(item.pendente)}</small></td>
          <td>{texto(item.fornecedor)}</td>
          <td>{texto(item.custoEstimado)}</td>
          <td>{item.prazoDias == null ? "Não informado" : `${item.prazoDias} dia(s)`}</td>
          <td>{texto(item.qualidade)}<br /><small>{item.prioridade?.aviso}</small></td>
          <td>
            <button type="button" disabled={ocupado || item.solicitacaoId || item.custoUnitario == null || item.fornecedorId == null} onClick={() => acao(`/charlie-purchasing/${encodeURIComponent(item.id)}/solicitacao?janelaDias=${encodeURIComponent(janela)}`, {}, () => "Solicitação gravada no módulo de compras. Nenhum pedido definitivo foi emitido.")}>{item.solicitacaoId ? "Solicitação gravada" : "Criar solicitação"}</button>
            <button type="button" disabled={ocupado || !item.solicitacaoId || item.pedidoEmitido || !painel?.emissaoAutorizada} onClick={() => acao(`/charlie-purchasing/${encodeURIComponent(item.id)}/emitir`, {}, () => "O pedido definitivo foi emitido pelo módulo de compras.")}>{item.pedidoEmitido ? "Pedido emitido" : "Emitir pedido"}</button>
          </td>
        </tr>) : <tr><td colSpan="7">Sem saldo, demanda ou mínimo que peça compra.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
