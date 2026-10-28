import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const ROTULO = {
  ruptura: "Ruptura na janela",
  parado: "Parado",
  excesso: "Acima do máximo",
  divergencia: "Divergência Tray",
  demanda_alta: "Demanda alta",
  sem_disponibilidade: "Venda sem saldo",
  saldo_negativo: "Saldo negativo",
};

function qtd(valor) {
  return valor == null ? "—" : Number(valor).toLocaleString("pt-BR");
}

export default function CharlieStockGuardian() {
  const [janela, setJanela] = useState("15");
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar(dias = janela) {
    setPainel(await api.get(`/charlie-stock?janelaDias=${encodeURIComponent(dias)}`));
  }

  useEffect(() => { carregar("15").catch((causa) => setErro(causa.message)); }, []);

  async function agir(item, tipo) {
    setOcupado(`${tipo}:${item.id}`);
    setErro("");
    setAviso("");
    try {
      const dados = await api.post(`/charlie-stock/${encodeURIComponent(item.id)}/acao?janelaDias=${encodeURIComponent(janela)}`, { tipo });
      setAviso(dados.aviso || "Registro gravado.");
      await carregar(janela);
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const itens = painel?.itens || [];

  return <CharlieSalesPage
    titulo="Estoque"
    resumo={`${painel?.aviso || "Carregando."} A demanda é a saída considerada dos últimos 90 dias. Reservado e prazo de fornecedor ficam em branco quando não vêm do cadastro.`}
    metricas={[
      { rotulo: "Em atenção", valor: painel ? String(itens.length) : "…" },
      { rotulo: "Analisados", valor: painel ? String(painel.analisados ?? "Não informado") : "…" },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
    aviso={aviso}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); carregar(janela).catch((causa) => setErro(causa.message)); }}>
      <label>Janela de cobertura
        <select value={janela} onChange={(event) => setJanela(event.target.value)}>
          <option value="7">7 dias</option>
          <option value="15">15 dias</option>
          <option value="30">30 dias</option>
          <option value="60">60 dias</option>
        </select>
      </label>
      <button type="submit">Atualizar</button>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Produtos em atenção</h3><small>{itens.length ? `${itens.length} de ${painel?.analisados || 0}` : "Nenhum produto nesta janela."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Produto</th><th>Saldo ERP</th><th>Saldo Tray</th><th>Saídas 90 dias</th><th>Cobertura</th><th>Situação</th><th></th>
      </tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{item.nome}</b><br /><small>{item.pendente == null ? "Pedido de compra indisponível" : `Em compra: ${qtd(item.pendente)}`}{item.canaisTray.length ? ` · ${item.canaisTray.map((canal) => `${canal.canal} ${qtd(canal.quantidade)}`).join(", ")}` : ""}</small></td>
          <td>{qtd(item.saldo)}</td>
          <td>{qtd(item.saldoTray)}</td>
          <td>{qtd(item.saidas90)}{item.demandaDia != null ? ` · ${qtd(item.demandaDia)}/dia` : ""}</td>
          <td>{item.cobertura == null ? "—" : `${item.cobertura} dias`}{item.coberturaComPedido != null ? ` · com pedido ${item.coberturaComPedido}` : ""}</td>
          <td>{item.situacoes.map((situacao) => ROTULO[situacao] || situacao).join(", ")}<br /><small>{item.prioridade.aviso}</small>{item.compra ? <small> Compra sugerida: {qtd(item.compra.quantidade)}. {item.compra.motivo}</small> : null}{item.redistribuicao ? <small> {item.redistribuicao.texto}</small> : null}</td>
          <td>
            <button type="button" disabled={Boolean(ocupado) || item.acoes?.some((acao) => acao.tipo === "alerta")} onClick={() => agir(item, "alerta")}>Alerta</button>
            <button type="button" className="secondary" disabled={Boolean(ocupado) || !item.compra || item.acoes?.some((acao) => acao.tipo === "compra")} onClick={() => agir(item, "compra")}>Recomendar compra</button>
            <button type="button" className="secondary" disabled={Boolean(ocupado) || !item.redistribuicao || item.acoes?.some((acao) => acao.tipo === "redistribuicao")} onClick={() => agir(item, "redistribuicao")}>Redistribuir</button>
            <button type="button" className="secondary" disabled={Boolean(ocupado) || !item.campanha || item.acoes?.some((acao) => acao.tipo === "campanha")} onClick={() => agir(item, "campanha")}>Campanha</button>
          </td>
        </tr>) : <tr><td colSpan="7">Nenhum produto cruzou ruptura, parado, excesso ou divergência.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
