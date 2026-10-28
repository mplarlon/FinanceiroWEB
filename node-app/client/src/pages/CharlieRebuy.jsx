import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function moeda(valor) {
  return valor == null ? "Não informado" : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataBr(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : "—";
}

export default function CharlieRebuy() {
  const [janela, setJanela] = useState("7");
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar(dias = janela) {
    setPainel(await api.get(`/charlie-rebuy?janelaDias=${encodeURIComponent(dias)}`));
  }

  useEffect(() => { carregar("7").catch((causa) => setErro(causa.message)); }, []);

  async function agir(item, tipo) {
    setOcupado(`${tipo}:${item.id}`);
    setErro("");
    setAviso("");
    try {
      const dados = await api.post(`/charlie-rebuy/${encodeURIComponent(item.id)}/${tipo}?janelaDias=${encodeURIComponent(janela)}`);
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
    titulo="Comprar de novo"
    resumo={`${painel?.aviso || "Carregando."} Entram combinações com pelo menos três datas de compra do mesmo produto, quando a data pelo intervalo mediano está na janela ou já passou. A quantidade mostrada é a mediana observada.`}
    metricas={[{ rotulo: "Na janela", valor: painel ? String(itens.length) : "…" }]}
    lacunas={painel?.lacunas}
    erro={erro}
    aviso={aviso}
  >
    <form className="charlie-sales-filters" onSubmit={(event) => { event.preventDefault(); carregar(janela).catch((causa) => setErro(causa.message)); }}>
      <label>Janela em dias
        <select value={janela} onChange={(event) => setJanela(event.target.value)}>
          <option value="7">7</option>
          <option value="14">14</option>
          <option value="30">30</option>
        </select>
      </label>
      <button type="submit">Atualizar</button>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Clientes na janela</h3><small>{itens.length ? `${itens.length} combinação(ões)` : "Nenhuma recompra na janela."}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Cliente</th><th>Produto</th><th>Última</th><th>Intervalo</th><th>Data pelo intervalo</th><th>Quantidade mediana</th><th>Valor observado</th><th>Prioridade</th><th></th>
      </tr></thead><tbody>
        {itens.length ? itens.map((item) => <tr key={item.id}>
          <td><b>{item.cliente}</b><br /><small>{item.vendedor}</small></td>
          <td>{item.produto}<br /><small>{item.compras} datas · {item.situacao === "vencida" ? "intervalo vencido" : "dentro da janela"}</small></td>
          <td>{dataBr(item.ultima)}</td>
          <td>{item.intervalo} dias{item.amplitude ? ` · variação ${item.amplitude}` : ""}</td>
          <td>{dataBr(item.prevista)}<br /><small>{item.sazonalidade?.motivo}</small></td>
          <td>{item.quantidadeMediana == null ? "Não informada" : item.quantidadeMediana}</td>
          <td>{moeda(item.valor)}</td>
          <td>{item.prioridade.rotulo}<br /><small>{item.prioridade.aviso}</small></td>
          <td>
            <button type="button" disabled={Boolean(ocupado) || item.oportunidadeId} onClick={() => agir(item, "oportunidade")}>{item.oportunidadeId ? "Oportunidade gravada" : "Criar oportunidade"}</button>
            <button type="button" className="secondary" disabled={Boolean(ocupado) || item.tarefaId} onClick={() => agir(item, "tarefa")}>{item.tarefaId ? "Tarefa gravada" : "Criar tarefa"}</button>
          </td>
        </tr>) : <tr><td colSpan="9">O histórico consultado não tem cliente nessa janela.</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
