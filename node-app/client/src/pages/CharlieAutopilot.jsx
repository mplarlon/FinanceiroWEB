import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

const RISCO = { baixo: "Baixo", medio: "Médio", alto: "Alto" };

function Lista({ titulo, itens, vazio, acao }) {
  return <section className="panel ecommerce-table">
    <header><h3>{titulo}</h3><small>{itens.length ? `${itens.length}` : vazio}</small></header>
    <div className="table-scroll"><table className="tabela"><thead><tr><th>Registro</th><th>Risco</th><th>Etapa</th><th></th></tr></thead><tbody>
      {itens.length ? itens.map((item) => <tr key={item.id}>
        <td><b>{item.descricao || item.id}</b><br /><small>{item.motivo}</small>{item.resultado ? <small> {item.resultado}</small> : null}</td>
        <td>{RISCO[item.risco] || item.risco || "—"}</td>
        <td>{item.etapa}</td>
        <td>{acao ? acao(item) : null}</td>
      </tr>) : <tr><td colSpan="4">{vazio}</td></tr>}
    </tbody></table></div>
  </section>;
}

export default function CharlieAutopilot() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setPainel(await api.get("/charlie-autopilot"));
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  async function postar(caminho, corpo, texto) {
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const dados = await api.post(caminho, corpo);
      setPainel(dados.propostas ? dados : await api.get("/charlie-autopilot"));
      if (dados.propostas) setPainel(dados);
      setAviso(dados.aviso || texto);
      if (!dados.propostas) await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado(false);
    }
  }

  const propostas = painel?.propostas || [];
  const abertas = propostas.filter((item) => item.etapa === "recomendada" || item.etapa === "bloqueada");

  return <CharlieSalesPage
    titulo="Rotina automática"
    resumo={`${painel?.aviso || "Carregando."} A automação de baixo risco está ${painel?.baixoAutomatico ? "ligada" : "desligada"}. Resultado observado: ${painel?.resultados?.observado == null ? "sem venda atribuída" : painel.resultados.observado}. ${painel?.resultados?.aviso || ""}`}
    metricas={[
      { rotulo: "Problemas", valor: painel ? String((painel.problemas || []).length) : "…" },
      { rotulo: "Oportunidades", valor: painel ? String((painel.oportunidades || []).length) : "…" },
      { rotulo: "Propostas", valor: painel ? String(abertas.length) : "…" },
    ]}
    erro={erro}
    aviso={aviso}
    acoes={<>
      <button type="button" disabled={ocupado} onClick={() => postar("/charlie-autopilot/ciclo", {}, "Ciclo concluído.")}>Rodar ciclo</button>
      <button type="button" className="secondary" disabled={ocupado} onClick={() => postar("/charlie-autopilot/baixo-risco", { ligado: !painel?.baixoAutomatico }, "Autorização atualizada.")}>{painel?.baixoAutomatico ? "Desligar baixo risco" : "Autorizar baixo risco"}</button>
    </>}
  >
    <Lista titulo="Problemas" itens={painel?.problemas || []} vazio="Nenhum problema de alto risco nos registros atuais." />
    <Lista titulo="Oportunidades" itens={painel?.oportunidades || []} vazio="Nenhuma oportunidade registrada pelos módulos." />
    <Lista titulo="Ações propostas" itens={abertas} vazio="Nenhuma ação proposta." acao={(item) => <>
      <button type="button" disabled={ocupado || item.risco !== "baixo"} onClick={() => postar(`/charlie-autopilot/${encodeURIComponent(item.id)}/decisao`, { decisao: "executar" }, "Registro interno.")}>Registrar</button>
      <button type="button" className="secondary" disabled={ocupado || item.etapa === "bloqueada"} onClick={() => postar(`/charlie-autopilot/${encodeURIComponent(item.id)}/decisao`, { decisao: "rejeitar" }, "Ação rejeitada.")}>Rejeitar</button>
    </>} />
    <Lista titulo="Executadas" itens={painel?.executadas || []} vazio="Nenhuma ação interna executada." />
    <Lista titulo="Rejeitadas" itens={painel?.rejeitadas || []} vazio="Nenhuma ação rejeitada." />
    <section className="panel">
      <header><h3>Histórico</h3></header>
      {(painel?.historico || []).length ? <ul className="charlie-sales-historico">{painel.historico.slice().reverse().map((item) => <li key={`${item.em}-${item.tipo || item.propostas || ""}`}>{item.em} · {item.tipo || `${item.propostas ?? 0} proposta(s)`}{item.executadas != null ? ` · ${item.executadas} interna(s)` : ""}{item.bloqueadas != null ? ` · ${item.bloqueadas} bloqueada(s)` : ""}</li>)}</ul> : <p className="charlie-sales-note">Nenhum ciclo rodado.</p>}
    </section>
  </CharlieSalesPage>;
}
