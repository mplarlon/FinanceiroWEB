import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import {
  describeEcommercePermissions,
  salesPriorityLabel,
  salesStatusLabel,
} from "../lib/charlie-sales-ecosystem.js";
import CharlieSalesPage from "./CharlieSalesPage.jsx";

function useControl() {
  const [control, setControl] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.get("/tray/intelligence/control")
      .then((result) => { if (active) setControl(result); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  return { control, error };
}

export function PlannedModule({ item, onOpen }) {
  return <CharlieSalesPage kicker={`ETAPA ${item.stage}`} titulo={item.label} resumo={item.summary}>
    <section className="panel charlie-sales-planned">
      <p>O lugar no menu já está reservado. Os cálculos e as ações deste módulo entram na etapa {item.stage}, sobre os serviços atuais do Charlie.</p>
      {item.reuse && <button type="button" onClick={() => onOpen(item.reuse)}>{item.reuseLabel || "Abrir o que já existe"}</button>}
    </section>
  </CharlieSalesPage>;
}

function ligado(valor) {
  return valor == null ? "Não gravado" : valor ? "Ligado" : "Desligado";
}

function classeEstado(valor) {
  if (valor === "Ligado") return "ligado";
  if (valor === "Desligado") return "desligado";
  return "ausente";
}

const TIPOS_ALERTA = {
  campaign: "Campanha",
  pricing: "Preço",
  inventory: "Estoque",
  customer_recovery: "Cliente sem compra",
  "sem tipo": "Sem tipo",
};

function nomeTipo(tipo) {
  if (!tipo) return "Sem tipo";
  return TIPOS_ALERTA[tipo] || tipo;
}

function tomPrioridade(prioridade) {
  if (prioridade === "critical") return "critica";
  if (prioridade === "high") return "alta";
  if (prioridade === "medium") return "media";
  if (prioridade === "low") return "baixa";
  return "neutra";
}

function totalAberto(painel) {
  if (!painel) return { valor: "…", rotulo: "Lendo registro" };
  if (painel.abertos == null) return { valor: "—", rotulo: "Não lido" };
  return { valor: String(painel.abertos), rotulo: "em aberto" };
}

export function SalesAlerts() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    api.get("/charlie-alerts").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);
  const preferencia = painel?.preferencia || {};
  const grupos = painel?.agrupamento || [];
  const alertas = painel?.itens || [];
  const aviso = painel?.aviso || "Carregando.";
  const lacunas = (painel?.lacunas || []).filter((lacuna) => !aviso.includes(lacuna));
  const maior = Math.max(1, ...grupos.map((grupo) => Number(grupo.quantidade) || 0));
  const total = totalAberto(painel);
  return <div className="charlie-alerts-page">
    <section className="charlie-alerts-hero">
      <div>
        <span className="tray-kicker">LEITURA DO CONTROLE</span>
        <h2>Alertas</h2>
        <p>{aviso}</p>
      </div>
      <div className="charlie-alerts-total" aria-live="polite">
        <strong>{total.valor}</strong>
        <span>{total.rotulo}</span>
      </div>
    </section>
    <ul className="charlie-alerts-prefs">
      <li className={classeEstado(ligado(preferencia.avisos))}><span>Avisos</span><strong>{ligado(preferencia.avisos)}</strong></li>
      <li className={preferencia.horario ? "informado" : "ausente"}><span>Relatório diário</span><strong>{preferencia.horario || "Não gravado"}</strong></li>
      <li className={classeEstado(ligado(preferencia.email))}><span>E-mail</span><strong>{ligado(preferencia.email)}</strong></li>
      <li className={classeEstado(ligado(preferencia.whatsapp))}><span>WhatsApp</span><strong>{ligado(preferencia.whatsapp)}</strong></li>
      <li className={classeEstado(ligado(preferencia.envioReal))}><span>Envio real</span><strong>{ligado(preferencia.envioReal)}</strong></li>
    </ul>
    {erro && <p className="charlie-alerts-erro">{erro}</p>}
    <div className="charlie-alerts-corpo">
      <section className="panel charlie-alerts-grupos">
        <header>
          <h3>Por tipo gravado</h3>
          <small>{grupos.length ? `${grupos.length} tipo(s)` : "Nenhum tipo em aberto"}</small>
        </header>
        {grupos.length ? <ul>
          {grupos.map((grupo) => {
            const nome = nomeTipo(grupo.tipo);
            return <li key={grupo.tipo}>
              <div>
                <strong>{nome}</strong>
                {nome !== grupo.tipo ? <small>{grupo.tipo}</small> : null}
              </div>
              <b>{grupo.quantidade}</b>
              <i aria-hidden="true"><span style={{ width: `${Math.max(8, Math.round((Number(grupo.quantidade) || 0) / maior * 100))}%` }} /></i>
            </li>;
          })}
        </ul> : <p className="charlie-alerts-vazio">Não há alerta em aberto para agrupar.</p>}
      </section>
      <section className="panel charlie-alerts-lista">
        <header>
          <h3>Alertas em aberto</h3>
          <small>{alertas.length ? `${alertas.length} nesta lista` : "Lista vazia"}</small>
        </header>
        {alertas.length ? <ul>
          {alertas.map((item) => {
            const tom = tomPrioridade(item.prioridade);
            const nome = nomeTipo(item.tipo);
            return <li key={item.id} className={tom}>
              <div className="charlie-alerts-meta">
                <span className={`charlie-alerts-badge ${tom}`}>{salesPriorityLabel(item.prioridade)}</span>
                <span className="charlie-alerts-tipo">{nome}</span>
                <span className="charlie-alerts-status">{salesStatusLabel(item.status)}</span>
              </div>
              <p>{item.descricao || "Sem descrição"}</p>
            </li>;
          })}
        </ul> : <p className="charlie-alerts-vazio">{painel ? "Nenhuma oportunidade em aberto." : "Aguardando o registro de oportunidades."}</p>}
      </section>
    </div>
    {lacunas.length > 0 && <details className="charlie-alerts-limites">
      <summary>Limites desta leitura</summary>
      <ul>{lacunas.map((lacuna) => <li key={lacuna}>{lacuna}</li>)}</ul>
    </details>}
  </div>;
}

export function SalesPermissions() {
  const { control, error } = useControl();
  const permissions = describeEcommercePermissions(control?.settings?.permissions || {});
  return <CharlieSalesPage
    kicker="ACESSO"
    titulo="Permissões"
    resumo="A área segue protegida pela sessão do ERP. Aprovar, executar e configurar exigem permissão gerencial."
    erro={error}
  >
    <section className="panel">
      <header><h3>Quem pode operar</h3></header>
      <ul className="charlie-sales-permissions">
        <li><b>Aprovar</b><span>{control ? permissions.approve : "Lendo configuração"}</span></li>
        <li><b>Executar</b><span>{control ? permissions.execute : "Lendo configuração"}</span></li>
        <li><b>Configurar</b><span>{control ? permissions.configure : "Lendo configuração"}</span></li>
      </ul>
      <p className="charlie-sales-note">Uma lista com identificadores restringe a operação a esses usuários. O texto de permissão gerencial aparece quando nenhuma lista restritiva foi gravada.</p>
    </section>
  </CharlieSalesPage>;
}

function quando(valor) {
  if (!valor) return "Sem data";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function SalesAudit() {
  const [painel, setPainel] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  useEffect(() => {
    api.get("/charlie-sales-audit").then(setPainel).catch((causa) => setErro(causa.message));
  }, []);
  const fontes = painel?.fontes || [];
  const termo = filtro.trim().toLocaleLowerCase("pt-BR");
  const itens = (painel?.itens || []).filter((item) => !termo || [item.origem, item.evento, item.responsavel, item.referencia, item.descricao].join(" ").toLocaleLowerCase("pt-BR").includes(termo));
  return <CharlieSalesPage
    titulo="Auditoria"
    resumo={painel?.aviso || "Carregando."}
    metricas={[
      { rotulo: "Eventos", valor: painel ? String(painel.total ?? 0) : "…" },
      { rotulo: "Trilhas", valor: painel ? String(fontes.length) : "…" },
      { rotulo: "Nesta lista", valor: painel ? String(itens.length) : "…" },
    ]}
    lacunas={painel?.lacunas}
    erro={erro}
  >
    <form className="charlie-sales-filters" onSubmit={(evento) => evento.preventDefault()}>
      <label>Buscar nesta lista
        <input value={filtro} onChange={(evento) => setFiltro(evento.target.value)} placeholder="Origem, evento, responsável ou descrição" />
      </label>
    </form>
    <section className="panel ecommerce-table">
      <header><h3>Trilhas lidas</h3></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Origem</th><th>Leitura</th><th>Eventos</th></tr></thead><tbody>
        {fontes.length ? fontes.map((fonte) => <tr key={fonte.origem}><td>{fonte.origem}</td><td>{fonte.lida ? "Lida" : "Não lida"}</td><td>{fonte.eventos == null ? "Não lido" : fonte.eventos}</td></tr>) : <tr><td colSpan="3">{painel ? "Nenhuma trilha foi consultada." : "Aguardando as trilhas."}</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel ecommerce-table">
      <header><h3>Eventos</h3><small>{termo ? `${itens.length} nesta lista` : painel?.total > 100 ? "Os 100 mais recentes" : `${itens.length} na lista`}</small></header>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Quando</th><th>Origem</th><th>Evento</th><th>Responsável</th><th>Referência</th><th>Descrição</th></tr></thead><tbody>
        {itens.length ? itens.map((item, index) => <tr key={`${item.origem}-${item.referencia}-${item.em}-${index}`}><td>{quando(item.em)}</td><td>{item.origem}</td><td>{item.evento ? salesStatusLabel(item.evento) : "Não informado"}</td><td>{item.responsavel || "Não informado"}</td><td>{item.referencia || "Sem referência"}</td><td>{item.descricao || "Sem descrição"}</td></tr>) : <tr><td colSpan="6">{painel ? "Nenhum evento nesta lista." : "Aguardando o histórico."}</td></tr>}
      </tbody></table></div>
    </section>
  </CharlieSalesPage>;
}
