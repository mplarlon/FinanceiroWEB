import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const money = (value) => value == null ? "—" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = (value) => value == null ? "—" : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_PT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const MONTHS_PT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const MONTHS_EN = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function brDate(iso) {
  const [year, month, day] = String(iso || "").slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : "";
}

function evolutionDate(item) {
  if (item?.label) return item.label;
  const text = String(item?.date || "");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const weekday = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))).getUTCDay();
    return `${WEEKDAYS_PT[weekday]} ${iso[3]} ${MONTHS_PT[Number(iso[2]) - 1]}`;
  }
  const english = text.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2})(?: (\d{4}))?/);
  const month = english ? MONTHS_EN[english[1].toLowerCase()] : undefined;
  if (month == null) return text;
  const year = Number(english[3] || new Date().getFullYear());
  const day = Number(english[2]);
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return `${WEEKDAYS_PT[weekday]} ${String(day).padStart(2, "0")} ${MONTHS_PT[month]}`;
}

function Recado({ texto }) {
  const blocks = String(texto || "").split(/\n{2,}/).map((block) => block.split("\n").filter(Boolean)).filter((block) => block.length);
  return <div className="cafe-preview">{blocks.map((block, index) => <div key={index}>{block.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</div>)}</div>;
}

function conversionOf(quotes) {
  if (quotes?.conversao) return quotes.conversao;
  if (quotes?.taxa != null) return { taxa: quotes.taxa, texto: "No dia." };
  if (quotes?.mes?.taxa != null) return { taxa: quotes.mes.taxa, texto: "No mês." };
  return { taxa: null, texto: "Sem orçamento." };
}

const AREA = { comercial: "Comercial", estoque: "Estoque", financeiro: "Financeiro", crm: "CRM" };
const GRAVIDADE = { alta: "Urgente", media: "Atenção", baixa: "Acompanhar", info: "Informação" };
const SITUACAO = { novo: "Novo", visualizado: "Visualizado", em_tratamento: "Em tratamento", resolvido: "Resolvido", ignorado: "Ignorado" };
const MARCAR = [["visualizado", "Visualizado"], ["em_tratamento", "Em tratamento"], ["resolvido", "Resolvido"], ["ignorado", "Ignorar"]];
const ASSUNTO = {
  meta: "Meta do mês em risco",
  contato: "Orçamentos sem data de contato",
  oportunidade: "Oportunidades prioritárias",
  parado: "Capital parado no estoque",
  receber: "Contas a receber vencidas",
  baixa: "Baixas manuais acima do padrão",
};
const AREA_ORDEM = ["comercial", "crm", "estoque", "financeiro"];

function frase(text) {
  const value = String(text || "").trim().replace(/\.$/, "");
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}.` : "";
}

function contextoEstoque(motivo) {
  const text = String(motivo || "").toLowerCase();
  if (text.includes("zerado") || text.includes("negativ")) return "Produto sem estoque";
  if (text.includes("cobertura")) return "Cobertura baixa";
  if (text.includes("mínimo") || text.includes("minimo")) return "Estoque no mínimo";
  return "Estoque em risco";
}

function medidaAlerta(item) {
  const ind = item.indicadores || {};
  const parts = [];
  if (ind.valor != null && ind.valor !== "") parts.push(money(ind.valor));
  if (ind.atingimento != null) parts.push(`${percent(ind.atingimento)} da meta`);
  if (ind.faltam != null) parts.push(`Faltam ${money(ind.faltam)}`);
  if (ind.estoque != null && ind.estoque !== "") parts.push(`Saldo ${Number(ind.estoque).toLocaleString("pt-BR")}`);
  if (ind.cobertura != null && ind.cobertura !== "" && Number(ind.cobertura) >= 0) parts.push(`Cobertura de ${Number(ind.cobertura).toLocaleString("pt-BR")} dias`);
  if (ind.dias != null && ind.dias !== "") parts.push(`${Number(ind.dias).toLocaleString("pt-BR")} dias sem giro`);
  return parts.join(" · ");
}

function apresentarAlerta(item) {
  const kind = String(item.chave || "").split(":")[0];
  const tom = GRAVIDADE[item.severidade] ? item.severidade : "info";
  const medida = medidaAlerta(item);
  let titulo = item.titulo || ASSUNTO[kind] || "";
  let contexto = item.contexto || "";
  let detalhe = item.descricao || "";
  if (kind === "ruptura") {
    const match = String(item.descricao || "").match(/^(.*) com ([^.]+)\.?$/);
    titulo = item.titulo || (match ? match[1] : "") || "Produto sem estoque";
    contexto = item.contexto || contextoEstoque(match ? match[2] : item.descricao);
    detalhe = match ? frase(match[2]) : (item.descricao || "");
  }
  if ((kind === "receber" || kind === "parado") && medida) detalhe = "";
  if (!titulo) titulo = AREA[item.categoria] || "Alerta";
  if (detalhe.trim() === titulo.trim()) detalhe = "";
  return {
    area: AREA[item.categoria] || "Outros",
    tom,
    gravidade: GRAVIDADE[tom],
    situacao: SITUACAO[item.status] || "Novo",
    titulo,
    contexto: contexto && contexto !== titulo ? contexto : "",
    detalhe,
    medida,
    acao: item.acao || "",
  };
}

function groupAlerts(items) {
  const buckets = new Map();
  for (const item of items) {
    const id = AREA[item.categoria] ? item.categoria : "outros";
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(item);
  }
  const rank = { alta: 0, media: 1, baixa: 2, info: 3 };
  const order = [...AREA_ORDEM.filter((id) => buckets.has(id)), ...[...buckets.keys()].filter((id) => !AREA_ORDEM.includes(id))];
  return order.map((id) => ({
    id,
    label: AREA[id] || "Outros",
    items: buckets.get(id).slice().sort((a, b) => (rank[a.severidade] ?? 9) - (rank[b.severidade] ?? 9)),
  }));
}

function groupExpenses(rows) {
  const groups = new Map();
  for (const item of rows) {
    const key = item?.classe || item?.texto || "Sem classificação contábil";
    const current = groups.get(key) || { ...item, valor: 0, quantidade: 0, historicos: [] };
    current.valor += Number(item?.valor || 0);
    current.quantidade += Number(item?.quantidade || 0);
    const historico = String(item?.historico || "").trim();
    if (!current.historicos.includes(historico)) current.historicos.push(historico);
    groups.set(key, current);
  }
  return [...groups.values()].map((item) => {
    const names = item.historicos.map((historico) => historico || "Sem histórico");
    const historico = names.length <= 3 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} e mais ${names.length - 2}`;
    return { ...item, historico };
  }).sort((a, b) => Number(b.valor) - Number(a.valor));
}

function Goal({ label, goal }) {
  const missing = goal?.atingimento == null;
  return <article className="metric"><small>{label}</small><strong>{missing ? (goal?.texto || "Meta não cadastrada.") : percent(goal.atingimento)}</strong>{!missing && goal?.texto ? <span>{goal.texto}</span> : null}</article>;
}

function mergeSellers(catalog, saved) {
  const map = new Map((saved || []).map((item) => [Number(item.id), item]));
  const base = catalog?.length ? catalog : (saved || []);
  return base.map((item) => {
    const current = map.get(Number(item.id)) || {};
    return {
      id: Number(item.id),
      nome: item.nome || current.nome || "",
      telefone: current.telefone || item.telefone || "",
      consentimento: Boolean(current.consentimento),
      ativo: current.ativo !== false,
    };
  });
}

export default function CafeManha({ open = false, onClose, token = "", embedded = false, variant = "report" }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [empresa, setEmpresa] = useState("");
  const [filial, setFilial] = useState("");
  const [ate, setAte] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [categoria, setCategoria] = useState("");
  const [severidade, setSeveridade] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(null);

  function query() {
    return {
      empresa: empresa || undefined,
      filial: filial || undefined,
      ate: ate || undefined,
      vendedor: vendedor || undefined,
      categoria: categoria || undefined,
      severidade: severidade || undefined,
    };
  }

  async function load(next = query()) {
    setBusy(true);
    setError("");
    try {
      const payload = await api.get("/cafe-manha/painel", next);
      setData(payload);
      setForm({ ...payload.configuracao, vendedores: mergeSellers(payload.vendedores, payload.configuracao?.vendedores) });
      if (payload.aviso) setError(payload.aviso);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (open) load({}); }, [open]);
  useEffect(() => {
    if (!ate && data?.relatorio?.referencia) setAte(data.relatorio.referencia);
  }, [data, ate]);
  useEffect(() => {
    if (!open || !token) return;
    api.get(`/cafe-manha/acesso/${token}`).then((payload) => setLinked(payload.relatorio)).catch((reason) => setError(reason.message));
  }, [open, token]);

  async function save() {
    setBusy(true);
    try {
      const payload = await api.put("/cafe-manha/config", {
        ...form,
        empresas: String(form.empresasTexto ?? (form.empresas || []).join(",")).split(/[,\s]+/).map(Number).filter((item) => item > 0),
        weekdays: form.weekdays,
        vendedores: form.vendedores || [],
      });
      setForm({ ...payload.configuracao, vendedores: mergeSellers(form.vendedores, payload.configuracao?.vendedores) });
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function generate(send) {
    setBusy(true);
    setError("");
    try {
      const payload = await api.post(send ? "/cafe-manha/enviar" : "/cafe-manha/gerar", query());
      setLinked(payload.relatorio);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function setAlert(alert, status) {
    const motivo = status === "ignorado" ? window.prompt("Motivo para ignorar o alerta") : "";
    if (status === "ignorado" && !motivo) return;
    try {
      await api.patch(`/cafe-manha/alertas/${alert.id}`, { status, motivo });
      await load();
    } catch (reason) { setError(reason.message); }
  }

  const report = linked || data?.relatorio;
  const conversao = conversionOf(report?.orcamentos);
  const max = Math.max(1, ...(report?.evolucao || []).map((item) => Number(item.revenue || 0)));
  const sellers = [...new Map([...(report?.ranking || []), ...(report?.rankingMes || []), ...(report?.orcamentos?.porVendedor || [])].map((item) => [item.id || item.vendedorId, item])).values()];
  const rankingDia = report?.ranking || [];
  const rankingTabela = rankingDia.length ? rankingDia : (report?.rankingMes || []);
  const rankingDoMes = !rankingDia.length && rankingTabela.length > 0;
  if (!open) return null;
  const settingsOnly = variant === "settings";
  const body = <>
      {!form && !error ? <p>Carregando…</p> : <div className="cafe-page">
    {error && <div className="error">{error}</div>}
    {!settingsOnly && <section className="panel cafe-toolbar">
      <label>Empresa
        <select value={empresa} onChange={(event) => { setEmpresa(event.target.value); load({ ...query(), empresa: event.target.value || undefined }); }}>
          <option value="">Todas as autorizadas</option>
          {(report?.empresas || []).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
        </select>
      </label>
      <label>Depósito
        <select value={filial} onChange={(event) => { setFilial(event.target.value); load({ ...query(), filial: event.target.value || undefined }); }}>
          <option value="">Todos</option>
          {(report?.filiais || []).filter((item) => !empresa || !item.empresa || String(item.empresa) === String(empresa)).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
        </select>
      </label>
      <label>Dia de referência
        <input type="date" value={ate} onChange={(event) => { setAte(event.target.value); load({ ...query(), ate: event.target.value || undefined }); }} />
      </label>
      <label>Vendedor
        <select value={vendedor} onChange={(event) => { setVendedor(event.target.value); load({ ...query(), vendedor: event.target.value || undefined }); }}>
          <option value="">Todos</option>
          {sellers.map((item) => <option key={item.id || item.vendedorId} value={item.id || item.vendedorId}>{item.nome || item.vendedor}</option>)}
        </select>
      </label>
      <label>Categoria
        <select value={categoria} onChange={(event) => { setCategoria(event.target.value); load({ ...query(), categoria: event.target.value || undefined }); }}>
          <option value="">Todas</option>
          <option value="comercial">Comercial</option>
          <option value="estoque">Estoque</option>
          <option value="financeiro">Financeiro</option>
          <option value="crm">CRM</option>
        </select>
      </label>
      <label>Severidade
        <select value={severidade} onChange={(event) => { setSeveridade(event.target.value); load({ ...query(), severidade: event.target.value || undefined }); }}>
          <option value="">Todas</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
          <option value="info">Informação</option>
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => generate(false)}>Gerar relatório</button>
      <button type="button" className="primary" disabled={busy} onClick={() => generate(true)}>Enviar agora</button>
      <button type="button" disabled={busy} onClick={() => window.open(`/api/cafe-manha/pdf?empresa=${encodeURIComponent(empresa)}&filial=${encodeURIComponent(filial)}&ate=${encodeURIComponent(ate)}`, "_blank")}>Abrir PDF</button>
    </section>}
    {!settingsOnly && report && <>
      <section className="grid">
        <article className="metric"><small>Vendas do dia</small><strong>{money(report.vendas?.ontem)}</strong></article>
        <article className="metric"><small>Vendas no mês</small><strong>{money(report.vendas?.mes)}</strong></article>
        <Goal label="Meta mensal" goal={report.meta} />
        <Goal label="Meta diária" goal={report.metaDiaria} />
        <Goal label="Meta semanal" goal={report.metaSemanal} />
        <Goal label="Meta da equipe" goal={report.metaEquipe} />
        <article className="metric"><small>Conversão</small><strong>{conversao.taxa == null ? conversao.texto : percent(conversao.taxa)}</strong>{conversao.taxa != null && <span>{conversao.texto}</span>}</article>
        <article className="metric"><small>Orçamentos em aberto</small><strong>{report.orcamentos?.abertos ?? 0}</strong><span>{money(report.orcamentos?.valorAberto)}</span></article>
        <article className="metric"><small>Estoque crítico</small><strong>{report.estoque?.ruptura?.length ?? 0}</strong></article>
        <article className="metric"><small>Oportunidades</small><strong>{money(report.crm?.valorPrioritario)}</strong></article>
        <article className="metric"><small>Contas vencidas</small><strong>{money(report.financeiro?.receberVencido)}</strong></article>
      </section>
      <section className="panel">
        <h2>Estoque sem venda</h2>
        <div className="grid">
          {["30", "60", "90"].map((days) => <article className="metric" key={days}><small>{days} dias ou mais</small><strong>{report.estoque?.faixas?.[days] ? report.estoque.faixas[days].quantidade : "—"}</strong><span>{report.estoque?.faixas?.[days] ? money(report.estoque.faixas[days].capital) : ""}</span></article>)}
        </div>
        {!!report.estoque?.comprasParadas?.length && <ul>{report.estoque.comprasParadas.map((item) => <li key={item.produto}>{item.produto} · compra recente {money(item.valor)} · venda insuficiente no período</li>)}</ul>}
      </section>
      <section className="panel">
        <h2>Evolução recente</h2>
        <div className="cafe-bars">
          {(report.evolucao || []).map((item) => <div key={item.date}><span>{evolutionDate(item)}</span><i style={{ width: `${Math.max(4, (Number(item.revenue || 0) / max) * 100)}%` }} /><b>{money(item.revenue)}</b></div>)}
          {!report.evolucao?.length && <p>Dado indisponível para esta análise.</p>}
        </div>
      </section>
      <section className="panel">
        <h2>Ranking de vendedores</h2>
        {rankingDoMes && <p>Nenhuma venda em {brDate(report.referencia)}. Ranking acumulado do mês.</p>}
        <div className="table-scroll"><table className="tabela"><thead><tr><th>Posição</th><th>Vendedor</th><th>Vendas</th><th>Pedidos</th><th>Ticket</th><th>Orçamentos</th><th>Conversão</th><th>Variação</th></tr></thead><tbody>
          {rankingTabela.map((item) => <tr key={item.id}><td>{item.posicao}</td><td>{item.nome}</td><td>{money(item.faturamento)}</td><td>{item.pedidos}</td><td>{money(item.ticket)}</td><td>{item.orcamentos || 0}</td><td>{percent(item.taxaConversao)}</td><td>{item.variacao?.texto || "sem base comparável"}</td></tr>)}
          {!rankingTabela.length && <tr><td colSpan="8">{report?.referencia ? `Nenhuma venda em ${brDate(report.referencia)}.` : "Nenhuma venda no período."}</td></tr>}
        </tbody></table></div>
      </section>
      <section className="panel">
        <h2>Oportunidades em aberto</h2>
        <div className="table-scroll"><table className="tabela"><thead><tr><th>Orçamento</th><th>Cliente</th><th>Vendedor</th><th>Valor</th><th>Prioridade</th><th>Probabilidade</th><th>Motivo</th><th>Próxima ação</th></tr></thead><tbody>
          {(report.orcamentos?.lista || []).map((item) => <tr key={item.numero}><td>{item.numero}</td><td>{item.cliente}</td><td>{item.vendedor}</td><td>{money(item.valor)}</td><td>{item.prioridade}</td><td>{item.probabilidadeTexto}</td><td>{item.motivo}</td><td>{item.proximaAcao}</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel">
        <h2>Despesas em aberto</h2>
        {Array.isArray(report.financeiro?.classificacaoDespesas) ? (report.financeiro.classificacaoDespesas.length ? <div className="table-scroll"><table className="tabela"><thead><tr><th>Histórico</th><th>Classificação contábil</th><th>Valor</th></tr></thead><tbody>
          {groupExpenses(report.financeiro.classificacaoDespesas).map((item) => <tr key={item.classe || item.texto || item.historico}><td>{item.historico || "Sem histórico"}</td><td>{item.classe || item.texto || "Sem classificação contábil"}</td><td>{money(item.valor)}</td></tr>)}
        </tbody></table></div> : <p>Nenhuma despesa em aberto no período.</p>) : <p>Sem dado.</p>}
      </section>
      <section className="panel">
        <h2>Alertas</h2>
        <AlertList items={data?.alertas || report.alertas || []} onStatus={setAlert} />
      </section>
      <section className="panel">
        <h2>Pré-visualização</h2>
        <Recado texto={report.texto} />
        {report.leitura?.texto && <p className="cafe-reading">{report.leitura.texto}</p>}
        {report.entrega && <p className="cafe-reading">{[report.entrega.email, report.entrega.whatsapp, ...(report.entrega.motivos || [])].filter(Boolean).join(" · ")}</p>}
      </section>
    </>}
    {variant !== "report" && form && <section className="panel cafe-settings">
      <h2>Charlie Daily</h2>
      <label>Empresa da meta
        <select value={empresa} onChange={(event) => setEmpresa(event.target.value)}>
          <option value="">Meta geral</option>
          {(report?.empresas || []).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
        </select>
      </label>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.enabled)} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Agenda ativa</label>
      <label>Horário<input type="time" value={form.time || "07:00"} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
      <div className="cafe-days">{DAYS.map((label, index) => <label key={label} className="check-label"><input type="checkbox" checked={(form.weekdays || []).includes(index)} onChange={(event) => {
        const weekdays = new Set(form.weekdays || []);
        if (event.target.checked) weekdays.add(index); else weekdays.delete(index);
        setForm({ ...form, weekdays: [...weekdays].sort() });
      }} />{label}</label>)}</div>
      <label>E-mails<input value={form.emails || ""} onChange={(event) => setForm({ ...form, emails: event.target.value })} /></label>
      <label>WhatsApp<input value={form.whatsapp || ""} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} /></label>
      <label>Empresas<input value={form.empresasTexto ?? (form.empresas || []).join(", ")} onChange={(event) => setForm({ ...form, empresasTexto: event.target.value })} /></label>
      <label>Formato<select value={form.formato || "completo"} onChange={(event) => setForm({ ...form, formato: event.target.value })}><option value="completo">Completo</option><option value="resumido">Resumido</option></select></label>
      <label>Meta mensal<input type="number" value={form.metas?.mensal ?? ""} onChange={(event) => setForm({ ...form, metas: { ...form.metas, mensal: event.target.value === "" ? null : Number(event.target.value) } })} /></label>
      {empresa && <label>Meta desta empresa<input type="number" value={form.metas?.filiais?.[empresa] ?? ""} onChange={(event) => setForm({ ...form, metas: { ...form.metas, filiais: { ...form.metas?.filiais, [empresa]: event.target.value === "" ? null : Number(event.target.value) } } })} /></label>}
      <label>Meta diária<input type="number" value={form.metas?.diaria ?? ""} onChange={(event) => setForm({ ...form, metas: { ...form.metas, diaria: event.target.value === "" ? null : Number(event.target.value) } })} /></label>
      <label>Meta semanal<input type="number" value={form.metas?.semanal ?? ""} onChange={(event) => setForm({ ...form, metas: { ...form.metas, semanal: event.target.value === "" ? null : Number(event.target.value) } })} /></label>
      <label>Meta da equipe<input type="number" value={form.metas?.equipe ?? ""} onChange={(event) => setForm({ ...form, metas: { ...form.metas, equipe: event.target.value === "" ? null : Number(event.target.value) } })} /></label>
      <label>Valor prioritário<input type="number" value={form.limites?.valorPrioridade ?? 0} onChange={(event) => setForm({ ...form, limites: { ...form.limites, valorPrioridade: Number(event.target.value) } })} /></label>
      <label>Margem mínima %<input type="number" value={form.limites?.margemMinima ?? 0} onChange={(event) => setForm({ ...form, limites: { ...form.limites, margemMinima: Number(event.target.value) } })} /></label>
      <label>Sem giro (dias)<input type="number" value={form.limites?.semGiroDias ?? 90} onChange={(event) => setForm({ ...form, limites: { ...form.limites, semGiroDias: Number(event.target.value) } })} /></label>
      <label>Acompanhamento (horas)<input type="number" value={form.limites?.acompanhamentoHoras ?? 48} onChange={(event) => setForm({ ...form, limites: { ...form.limites, acompanhamentoHoras: Number(event.target.value) } })} /></label>
      <label>Modelo WhatsApp<input value={form.templateWhatsapp || ""} onChange={(event) => setForm({ ...form, templateWhatsapp: event.target.value })} /></label>
      <p>O modelo aprovado na Meta recebe três variáveis de texto: data, venda do dia e link do relatório. O recado do vendedor usa nome, quantidade de orçamentos e link.</p>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.canais?.email)} onChange={(event) => setForm({ ...form, canais: { ...form.canais, email: event.target.checked } })} />E-mail</label>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.canais?.whatsapp)} onChange={(event) => setForm({ ...form, canais: { ...form.canais, whatsapp: event.target.checked } })} />WhatsApp</label>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.enviarReal)} onChange={(event) => setForm({ ...form, enviarReal: event.target.checked })} />Liberar envio real</label>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.notificacaoIndividual?.ativo)} onChange={(event) => setForm({ ...form, notificacaoIndividual: { ...form.notificacaoIndividual, ativo: event.target.checked } })} />Recado individual</label>
      <label className="check-label"><input type="checkbox" checked={Boolean(form.campanhas?.aprovada)} onChange={(event) => setForm({ ...form, campanhas: { ...form.campanhas, aprovada: event.target.checked } })} />Campanha aprovada</label>
      <button type="button" disabled={busy} onClick={save}>Salvar configuração</button>
      <div className="table-scroll"><table className="tabela"><thead><tr><th>Vendedor</th><th>Telefone</th><th>Meta mensal</th><th>Consentimento</th></tr></thead><tbody>
        {(form.vendedores || []).map((seller, index) => <tr key={seller.id}>
          <td>{seller.nome}</td>
          <td><input value={seller.telefone || ""} onChange={(event) => {
            const vendedores = form.vendedores.slice();
            vendedores[index] = { ...seller, telefone: event.target.value };
            setForm({ ...form, vendedores });
          }} /></td>
          <td><input type="number" value={form.metas?.vendedores?.[seller.id] ?? ""} onChange={(event) => setForm({ ...form, metas: { ...form.metas, vendedores: { ...form.metas?.vendedores, [seller.id]: event.target.value === "" ? null : Number(event.target.value) } } })} /></td>
          <td><input type="checkbox" checked={Boolean(seller.consentimento)} onChange={(event) => {
            const vendedores = form.vendedores.slice();
            vendedores[index] = { ...seller, consentimento: event.target.checked, ativo: true };
            setForm({ ...form, vendedores });
          }} /></td>
        </tr>)}
      </tbody></table></div>
    </section>}
    {!settingsOnly && <section className="panel">
      <h2>Histórico</h2>
      <ul>{(data?.historico || []).map((item) => <li key={item.id}>{item.referencia} · {item.motivo} · {item.entrega?.email || "sem envio"} · {item.entrega?.whatsapp || ""} · {item.em}</li>)}</ul>
    </section>}
      </div>}
  </>;
  if (embedded) return body;
  return <div className="charlie-modal-backdrop">
    <section className="charlie-modal charlie-daily" role="dialog" aria-modal="true" aria-label="Charlie Daily">
      <header>
        <div>
          <h2>Charlie Daily</h2>
          <small>O dia de referência é o dia anterior, salvo quando outra data é escolhida. Os números saem do ERP.</small>
        </div>
        <button type="button" onClick={onClose}>Fechar</button>
      </header>
      {body}
    </section>
  </div>;
}

function AlertList({ items, onStatus }) {
  const abertos = items.filter((item) => !["resolvido", "ignorado"].includes(item.status));
  const tratados = items.filter((item) => ["resolvido", "ignorado"].includes(item.status));
  const fraseAbertos = abertos.length === 1 ? "1 pendência pede uma decisão." : `${abertos.length} pendências pedem uma decisão.`;
  return <>
    <p className="cafe-alert-intro">{abertos.length ? fraseAbertos : "Nenhuma pendência neste recorte."}</p>
    {groupAlerts(abertos).map((group) => <section key={group.id} className="cafe-alert-group">
      <h3>{group.label}<span>{group.items.length}</span></h3>
      {group.items.map((item) => <AlertCard key={item.id || item.chave} item={item} onStatus={onStatus} />)}
    </section>)}
    {tratados.length > 0 && <details className="cafe-alert-done">
      <summary>Já tratados ({tratados.length})</summary>
      <div className="cafe-alert-group">
        {tratados.map((item) => <AlertCard key={item.id || item.chave} item={item} onStatus={onStatus} closed />)}
      </div>
    </details>}
  </>;
}

function AlertCard({ item, onStatus, closed = false }) {
  const view = apresentarAlerta(item);
  return <article className={`cafe-alert cafe-tone-${view.tom}${closed ? " cafe-alert-closed" : ""}`}>
    <header>
      <strong className="cafe-alert-badge">{view.gravidade}</strong>
      <span>{view.area}</span>
      <span className="cafe-alert-status">{view.situacao}</span>
    </header>
    {view.contexto ? <p className="cafe-alert-kicker">{view.contexto}</p> : null}
    <h3>{view.titulo}</h3>
    {view.detalhe ? <p>{view.detalhe}</p> : null}
    {view.medida ? <b className="cafe-alert-metric">{view.medida}</b> : null}
    {view.acao ? <p className="cafe-alert-next"><span>O que fazer</span>{view.acao}</p> : null}
    {item.id ? <div className="cafe-alert-actions">
      <span>Marcar como</span>
      {MARCAR.map(([status, label]) => <button key={status} type="button" aria-pressed={item.status === status} onClick={() => onStatus(item, status)}>{label}</button>)}
    </div> : null}
  </article>;
}

