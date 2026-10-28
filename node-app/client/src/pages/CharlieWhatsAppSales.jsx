import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const STATUS = { aguardando: "Aguardando aprovação", enviado: "Enviado", rejeitado: "Rejeitado" };

export default function CharlieWhatsAppSales() {
  const [dados, setDados] = useState(null);
  const [aberto, setAberto] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");

  async function carregar() {
    setDados(await api.get("/whatsapp/vendas"));
  }

  useEffect(() => { carregar().catch((causa) => setErro(causa.message)); }, []);

  async function decidir(id, decisao) {
    setOcupado(id);
    setErro("");
    setAviso("");
    try {
      const resposta = await api.post(`/whatsapp/vendas/${id}/decisao`, { decisao });
      setAviso(decisao === "aprovar" ? "A mensagem aprovada foi enviada pelo WhatsApp já configurado." : "A consulta foi rejeitada e nada foi enviado.");
      setAberto(resposta.item?.id || "");
      await carregar();
    } catch (causa) {
      setErro(causa.message);
    } finally {
      setOcupado("");
    }
  }

  const itens = dados?.itens || [];
  const detalhe = itens.find((item) => item.id === aberto);
  const configurada = Boolean(dados?.whatsapp?.configured);

  return <div className="charlie-sales-main charlie-wa-page">
    <section className="panel charlie-wa">
      <div className="charlie-wa-topo">
        <div>
          <span className="tray-kicker">CHARLIE VENDAS</span>
          <h2>WhatsApp</h2>
          <p>Pergunta de preço, estoque, produto ou prazo recebida no WhatsApp da Meta fica como rascunho.</p>
        </div>
        <div className={configurada ? "charlie-wa-conta ok" : "charlie-wa-conta"}>
          <strong>{configurada ? "Conta da Meta configurada" : "Conta da Meta pendente"}</strong>
          <span>{configurada
            ? "O envio usa o access token e o phone number id já gravados."
            : "O rascunho pode ser preparado, mas o envio precisa do access token e do phone number id."}</span>
        </div>
      </div>
      <ul className="charlie-wa-regras">
        <li><strong>Rascunho</strong><span>O texto só sai depois da aprovação.</span></li>
        <li><strong>Dados do ERP</strong><span>A resposta só usa o que o ERP devolveu.</span></li>
        <li><strong>Prazo</strong><span>O prazo de entrega não é inventado.</span></li>
      </ul>
    </section>
    {erro && <p className="charlie-wa-aviso erro">{erro}</p>}
    {aviso && <p className="charlie-wa-aviso ok">{aviso}</p>}
    <section className="panel charlie-wa charlie-wa-lista">
      <div className="charlie-wa-lista-topo">
        <div>
          <h3>Consultas</h3>
          <p>{itens.length ? `${itens.length} registrada${itens.length === 1 ? "" : "s"}` : "Nenhuma consulta comercial recebida."}</p>
        </div>
      </div>
      {itens.length ? <div className="table-scroll"><table className="tabela"><thead><tr>
        <th>Quando</th><th>De</th><th>Pergunta</th><th>Situação</th><th></th>
      </tr></thead><tbody>
        {itens.map((item) => <tr key={item.id} className={aberto === item.id ? "selected-row" : undefined}>
          <td>{item.em ? new Date(item.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
          <td>{item.from || "—"}</td>
          <td>{item.texto}</td>
          <td><span className={`charlie-wa-pill ${item.status || ""}`}>{STATUS[item.status] || item.status}</span></td>
          <td><button type="button" className="secondary" onClick={() => setAberto(aberto === item.id ? "" : item.id)}>{aberto === item.id ? "Fechar" : "Ver rascunho"}</button></td>
        </tr>)}
      </tbody></table></div> : <p className="charlie-wa-vazio">Quando alguém perguntar preço ou estoque, a consulta aparece aqui.</p>}
    </section>
    {detalhe && <section className="panel charlie-booster-detail charlie-wa-detalhe">
      <header><h3>{detalhe.texto}</h3><span className={`charlie-wa-pill ${detalhe.status || ""}`}>{STATUS[detalhe.status]}</span></header>
      <div className="charlie-booster-copy"><strong>Texto que será enviado</strong><p>{detalhe.rascunho}</p></div>
      {detalhe.produtos?.length > 0 && <ul className="charlie-hunter-criterios">{detalhe.produtos.map((produto) => <li key={produto.codigo}>{produto.codigo} — {produto.nome}. Preço lido: {produto.preco == null ? "não cadastrado" : produto.preco}. Estoque lido: {produto.estoque == null ? "sem saldo" : produto.estoque}.</li>)}</ul>}
      {detalhe.status === "aguardando" && <div className="ecommerce-action-buttons">
        <button type="button" onClick={() => decidir(detalhe.id, "aprovar")} disabled={Boolean(ocupado) || !dados?.whatsapp?.configured}>{ocupado === detalhe.id ? "Enviando..." : "Aprovar e enviar"}</button>
        <button type="button" className="secondary" onClick={() => decidir(detalhe.id, "rejeitar")} disabled={Boolean(ocupado)}>Rejeitar</button>
      </div>}
    </section>}
  </div>;
}
