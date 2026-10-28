import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

const ausente = (value) => value == null || value === "" || !Number.isFinite(Number(value));
const money = (value) => ausente(value) ? "não informado" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 1) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const pct = (value) => ausente(value) ? "não informado" : `${number(value, 1)}%`;
const date = (value) => value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";

const TITLES = {
  executive: ["Painel Executivo Multi-Loja", "Resultado, metas, alertas, caixa e estoque em uma visão para decisão."],
  stores: ["Comparativo entre lojas", "Compare faturamento, participação, pedidos e ticket médio por filial."],
  goals: ["Metas e realizado", "Acompanhe o objetivo mensal, o ritmo diário e a projeção de fechamento."],
  margins: ["Margem e rentabilidade", "Encontre produtos com alto faturamento e baixa contribuição."],
  inventory: ["Estoque gerencial", "Rupturas, excesso, capital parado e itens que exigem reposição."],
  cashflow: ["Fluxo de caixa projetado", "Visão de recebimentos, pagamentos e necessidade de capital de giro."],
  sellers: ["Desempenho de vendedores", "Ranking comercial, ticket médio e participação no resultado."],
  retention: ["Clientes e retenção", "Recorrência, churn, inatividade, curva ABC e inadimplência."],
  suppliers: ["Desempenho de fornecedores", "Volume comprado, frequência e concentração das compras."],
  alerts: ["Central de alertas", "Pendências gerenciais priorizadas por impacto e urgência."],
  daily: ["Resumo diário", "A fotografia do dia para compartilhar com os responsáveis pelas lojas."],
};

function Metric({ label, value, detail, tone = "" }) {
  return <article className={`metric executive-metric ${tone}`}><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</article>;
}

function Table({ columns, rows, empty = "Nenhum dado encontrado." }) {
  return <div className="table-scroll"><table className="tabela"><thead><tr>{columns.map(c => <th key={c.key} className={c.money ? "money-cell" : ""}>{c.label}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={row.ID || row.CODIGO || row.CDCLIENTE || `${index}-${columns[0]?.key}`}>
      {columns.map(c => <td key={c.key} className={c.money ? "money-cell" : ""}>{c.render ? c.render(row, index) : row[c.key] ?? "—"}</td>)}
    </tr>)}
    {!rows.length && <tr><td colSpan={columns.length} className="executive-empty">{empty}</td></tr>}
  </tbody></table></div>;
}

function Progress({ value }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return <div className="goal-progress"><span style={{ width: `${safe}%` }} /><b>{pct(value)}</b></div>;
}

function periodDays() {
  const today = new Date();
  return Math.max(1, Math.ceil((today - new Date(today.getFullYear(), today.getMonth(), 1)) / 86400000) + 1);
}

function useExecutiveData(type, days, store, customPeriod) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    const params = {
      dias: days === "custom" ? undefined : days,
      data_inicio: days === "custom" ? customPeriod.data_inicio : undefined,
      data_fim: days === "custom" ? customPeriod.data_fim : undefined,
      loja: store || undefined,
      limite: 100,
    };
    try {
      const section = type;
      const [report, config, options] = await Promise.all([
        api.get(`/relatorios-gerenciais/${section}`, params),
        api.get("/relatorios-gerenciais/settings"),
        api.get("/dashboard-vendas/options"),
      ]);
      setData({ report, settings: config.settings, options });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, error, load };
}

function Stores({ report }) {
  const rows = [...(report?.rows || [])].sort((a, b) => {
    if (a.FATURAMENTO == null && b.FATURAMENTO == null) return 0;
    if (a.FATURAMENTO == null) return 1;
    if (b.FATURAMENTO == null) return -1;
    return b.FATURAMENTO - a.FATURAMENTO;
  });
  const total = report == null ? 0 : report.total == null ? null : Number(report.total);
  const lucro = report == null ? 0 : rows.some((loja) => loja.LUCRO == null) ? null : rows.reduce((soma, loja) => soma + Number(loja.LUCRO), 0);
  return <><section className="grid">
    <Metric label="Faturamento consolidado" value={money(total)} />
    <Metric label="Lojas com movimento" value={number(rows.length, 0)} />
    <Metric label="Melhor resultado" value={rows[0]?.NOME || "—"} detail={money(rows[0]?.FATURAMENTO)} tone="positive" />
    <Metric label="Lucro consolidado" value={money(lucro)} />
  </section><section className="panel"><h2>Ranking das lojas</h2><Table rows={rows} columns={[
    { key: "POS", label: "#", render: (_r, i) => i + 1 }, { key: "NOME", label: "Loja" },
    { key: "PEDIDOS", label: "Pedidos", render: r => number(r.PEDIDOS, 0) },
    { key: "TICKET", label: "Ticket médio", money: true, render: r => money(r.TICKET) },
    { key: "FATURAMENTO", label: "Faturamento", money: true, render: r => money(r.FATURAMENTO) },
    { key: "MARGEM", label: "Margem", render: r => pct(r.MARGEM) },
    { key: "VARIACAO_ANTERIOR", label: "Período anterior", render: r => r.VARIACAO_ANTERIOR === null ? "—" : pct(r.VARIACAO_ANTERIOR) },
    { key: "VARIACAO_ANO", label: "Ano anterior", render: r => r.VARIACAO_ANO === null ? "—" : pct(r.VARIACAO_ANO) },
    { key: "PARTICIPACAO", label: "Participação", render: r => pct(r.PARTICIPACAO) },
  ]} /></section></>;
}

function Goals({ report, settings, reload }) {
  const [targets, setTargets] = useState({stores:settings?.goals||{},sellers:settings?.seller_goals||{},categories:settings?.category_goals||{}});
  useEffect(() => setTargets({stores:settings?.goals||{},sellers:settings?.seller_goals||{},categories:settings?.category_goals||{}}), [settings]);
  const elapsed = periodDays(), totalDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  function change(group,id,value){setTargets(current=>({...current,[group]:{...current[group],[id]:Number(value||0)}}));}
  async function save() { await api.post("/relatorios-gerenciais/settings", { goals: targets.stores,seller_goals:targets.sellers,category_goals:targets.categories }); reload(); }
  const goalTable=(title,group,rows)=><section className="panel"><h2>{title}</h2><Table rows={(rows||[]).map(r=>({...r,META:Number(targets[group]?.[r.ID]||0)}))} columns={[
    { key: "NOME", label: title.replace("Metas mensais por ","") }, { key: "META", label: "Meta mensal", money: true, render: r => <input className="goal-input" type="number" min="0" value={targets[group]?.[r.ID] || ""} placeholder="0,00" onChange={e => change(group,r.ID,e.target.value)} /> },
    { key: "FATURAMENTO", label: "Realizado", money: true, render: r => money(r.FATURAMENTO) },
    { key: "ATING", label: "Atingimento", render: r => ausente(r.FATURAMENTO) || !r.META ? "não informado" : <Progress value={Number(r.FATURAMENTO) / r.META * 100} /> },
    { key: "PROJ", label: "Projeção", money: true, render: r => ausente(r.FATURAMENTO) ? "não informado" : money(Number(r.FATURAMENTO) / elapsed * totalDays) },
    { key: "FALTA", label: "Falta por dia", money: true, render: r => ausente(r.FATURAMENTO) ? "não informado" : money(Math.max(0, r.META - Number(r.FATURAMENTO)) / Math.max(1, totalDays - elapsed)) },
  ]}/></section>;
  return <><div className="overview-notice">Metas mensais compartilhadas. Verde: atingida; amarelo: dentro do ritmo; vermelho: abaixo do ritmo esperado.</div><div className="daily-actions"><button onClick={save}>Salvar todas as metas</button></div>{goalTable("Metas mensais por loja","stores",report?.stores)}{goalTable("Metas mensais por vendedor","sellers",report?.sellers)}{goalTable("Metas mensais por categoria","categories",report?.categories)}</>;
}

function ProfitTable({ title, rows }) { return <section className="panel"><h2>{title}</h2><Table rows={rows || []} columns={[{ key: "NOME", label: title.replace("Rentabilidade por ", "") }, { key: "QTD", label: "Qtd.", render: r => number(r.QTD) }, { key: "FATURAMENTO", label: "Faturamento", money: true, render: r => money(r.FATURAMENTO) }, { key: "DESCONTO", label: "Descontos", money: true, render: r => money(r.DESCONTO) }, { key: "LUCRO", label: "Lucro", money: true, render: r => money(r.LUCRO) }, { key: "MARGEM", label: "Margem", render: r => ausente(r.MARGEM) ? "não informado" : <span className={r.MARGEM < 25 ? "status-danger" : "status-ok"}>{pct(r.MARGEM)}</span> }]} /></section>; }
function Margins({ report }) {
  const rows = report?.products || [];
  const revenue = !report ? 0 : rows.some((item) => item.FATURAMENTO == null) ? null : rows.reduce((soma, item) => soma + Number(item.FATURAMENTO), 0);
  const profit = !report ? 0 : rows.some((item) => item.LUCRO == null) ? null : rows.reduce((soma, item) => soma + Number(item.LUCRO), 0);
  return <><section className="grid"><Metric label="Faturamento" value={money(revenue)} /><Metric label="Lucro bruto" value={money(profit)} /><Metric label="Margem geral" value={ausente(revenue) || ausente(profit) ? "não informado" : pct(revenue ? profit / revenue * 100 : 0)} /><Metric label="Itens abaixo da margem" value={number(report?.below_minimum?.length,0)} tone="danger" /></section><ProfitTable title="Rentabilidade por produto" rows={rows} /><section className="executive-columns"><ProfitTable title="Rentabilidade por loja" rows={report?.stores} /><ProfitTable title="Rentabilidade por vendedor" rows={report?.sellers} /><ProfitTable title="Rentabilidade por categoria" rows={report?.groups} /><ProfitTable title="Rentabilidade por marca/fornecedor" rows={report?.brands} /></section></>;
}

function Inventory({ data, storeCount }) {
  const s = data.summary || {};
  return <><section className="grid"><Metric label="Valor em estoque" value={money(s.value)} /><Metric label="Rupturas" value={number(s.rupture, 0)} tone="danger" /><Metric label="Estoque negativo" value={number(s.negative, 0)} tone="danger" /><Metric label="Capital parado" value={money(s.idle_value)} tone="warning" /><Metric label="Vendas perdidas estimadas" value={s.lost_sales_units == null ? "não informado" : `${number(s.lost_sales_units,0)} un.`} tone="warning" /></section>
    <section className="panel"><h2>Envelhecimento do estoque</h2><Table rows={data.aging||[]} columns={[{key:"label",label:"Sem giro"},{key:"items",label:"Itens",render:r=>number(r.items,0)},{key:"value",label:"Capital imobilizado",money:true,render:r=>money(r.value)}]}/></section>
    {storeCount > 1 && <section className="panel"><h2>Transferências sugeridas entre lojas</h2><Table rows={data.transfers || []} columns={[{key:"PRODUTO",label:"Produto"},{key:"ORIGEM",label:"Origem"},{key:"DESTINO",label:"Destino"},{key:"QUANTIDADE",label:"Quantidade",render:r=>number(r.QUANTIDADE)},{key:"ECONOMIA",label:"Compra evitada",money:true,render:r=>money(r.ECONOMIA)}]} /></section>}
    <section className="panel"><h2>Giro, cobertura e capital parado</h2><Table rows={data.idle || []} columns={[{ key: "PRODUTO", label: "Produto" },{key:"LOJA",label:"Loja"}, { key: "ESTOQUE", label: "Estoque", render: r => ausente(r.ESTOQUE) ? "não informado" : number(r.ESTOQUE) }, {key:"GIRO_90D",label:"Giro 90d",render:r=>ausente(r.GIRO_90D)?"não informado":number(r.GIRO_90D,2)}, {key:"COBERTURA_DIAS",label:"Cobertura",render:r=>ausente(r.ESTOQUE)||ausente(r.VENDA_90D)?"não informado":r.COBERTURA_DIAS===null?"Sem saída":`${number(r.COBERTURA_DIAS,0)} dias`},{key:"CAPITAL",label:"Capital",money:true,render:r=>money(r.CAPITAL)}, { key: "ULTIMA_VENDA", label: "Última venda", render: r => date(r.ULTIMA_VENDA) }]} /></section></>;
}

function Cashflow({ report, settings, reload }) {
  const [selected, setSelected] = useState(settings?.cashflow_accounts || []);
  useEffect(() => setSelected(settings?.cashflow_accounts || []), [settings]);
  function toggle(key) { setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]); }
  async function save() { await api.post("/relatorios-gerenciais/settings", { cashflow_accounts: selected }); reload(); }
  return <><section className="panel executive-settings cashflow-accounts"><h2>Contas consideradas no saldo inicial</h2>
    {(report?.accounts || []).map(account => <label className="check-label" key={account.KEY}><input type="checkbox" checked={selected.includes(account.KEY)} onChange={() => toggle(account.KEY)} /><span><b>{account.BANCO}</b><small>{account.AGENCIA || "—"} / {account.NUMCONTA || "—"} · {money(account.SALDO)}</small></span></label>)}
    {!(report?.accounts || []).length && <span className="executive-empty">Nenhuma conta bancária cadastrada.</span>}<button onClick={save}>Aplicar saldos</button></section>
    <section className="grid"><Metric label="Saldo inicial considerado" value={money(report?.initial_balance)} /><Metric label="Capital de giro necessário" value={money(report?.working_capital)} tone={report?.working_capital>0?"danger":"positive"} />{(report?.buckets||[]).map(x=><Metric key={x.label} label={`Saldo provável em ${x.days} dias`} value={money(x.probable)} tone={x.probable<0?"danger":"positive"}/>)}</section><section className="panel"><h2>Cenários de caixa</h2><div className="overview-notice"><b>Como calculamos:</b> Otimista = saldo inicial + valores a receber − 95% dos valores a pagar; Provável = saldo inicial + valores a receber − valores a pagar; Pessimista = saldo inicial + 75% dos valores a receber − valores a pagar.</div><Table rows={report?.buckets||[]} columns={[{key:"days",label:"Horizonte",render:r=>`${r.days} dias`},{key:"receive",label:"A receber",money:true,render:r=>money(r.receive)},{key:"payable",label:"A pagar",money:true,render:r=>money(r.payable)},{key:"optimistic",label:"Otimista",money:true,render:r=>money(r.optimistic)},{key:"probable",label:"Provável",money:true,render:r=>money(r.probable)},{key:"pessimistic",label:"Pessimista",money:true,render:r=>money(r.pessimistic)}]} /></section></>;
}

function Sellers({ report }) {
  const rows=report?.rows||[];return <section className="panel"><h2>Ranking comercial completo</h2><Table rows={rows} columns={[{key:"POS",label:"#",render:(_r,i)=>i+1},{key:"NOME",label:"Vendedor"},{key:"PEDIDOS",label:"Pedidos",render:r=>number(r.PEDIDOS,0)},{key:"CLIENTES",label:"Clientes",render:r=>number(r.CLIENTES,0)},{key:"TICKET",label:"Ticket",money:true,render:r=>money(r.TICKET)},{key:"FATURAMENTO",label:"Faturamento",money:true,render:r=>money(r.FATURAMENTO)},{key:"MARGEM",label:"Margem",render:r=>pct(r.MARGEM)},{key:"DESCONTOS",label:"Descontos",money:true,render:r=>money(r.DESCONTOS)},{key:"CANCELAMENTOS",label:"Cancel.",render:r=>number(r.CANCELAMENTOS,0)},{key:"COMISSAO",label:"Comissão",money:true,render:r=>money(r.COMISSAO)}]} /></section>;
}

function Retention({ data }) {
  const rows=data.rows||[], risk=rows.filter(x=>x.SEGMENTO==="Em risco"), champions=rows.filter(x=>x.SEGMENTO==="Campeões");
  return <><div className="overview-notice"><b>Entenda:</b> RFM combina recência, frequência e valor monetário. A lista de reativação prioriza clientes inativos ou em risco pelo maior valor histórico.</div><section className="grid"><Metric label="Clientes analisados" value={number(rows.length,0)}/><Metric label="Novos" value={number(data.summary?.new_customers,0)}/><Metric label="Recorrentes" value={number(data.summary?.recurring,0)} tone="positive"/><Metric label="Inativos" value={number(data.summary?.inactive,0)} tone="danger"/><Metric label="Inadimplência" value={money(data.summary?.overdue)} tone="danger"/><Metric label="LTV da carteira" value={money(rows.some((item)=>item.LTV==null)?null:rows.reduce((s,x)=>s+Number(x.LTV),0))}/></section><section className="panel"><h2>Segmentação RFM e curva de valor</h2><Table rows={rows} columns={[{key:"NOME",label:"Cliente"},{key:"TIPO",label:"Relacionamento"},{key:"SEGMENTO",label:"Segmento"},{key:"RFM",label:"RFM"},{key:"RECENCIA",label:"Dias sem compra",render:r=>number(r.RECENCIA,0)},{key:"FREQUENCIA",label:"Compras",render:r=>number(r.FREQUENCIA,0)},{key:"MONETARIO",label:"LTV histórico",money:true,render:r=>money(r.MONETARIO)},{key:"INADIMPLENCIA",label:"Em atraso",money:true,render:r=>money(r.INADIMPLENCIA)}]} /></section><section className="panel"><h2>Lista prioritária para reativação</h2><Table rows={data.reactivation||[]} columns={[{key:"NOME",label:"Cliente"},{key:"SEGMENTO",label:"Motivo"},{key:"RECENCIA",label:"Dias sem comprar",render:r=>number(r.RECENCIA,0)},{key:"LTV",label:"Valor histórico",money:true,render:r=>money(r.LTV)}]}/></section></>;
}

function Suppliers({ report }) {
  const rows=report?.rows||[],total=!report?0:rows.some((item)=>item.TOTAL==null)?null:rows.reduce((s,x)=>s+Number(x.TOTAL),0);return <><section className="grid"><Metric label="Total comprado" value={money(total)}/><Metric label="Fornecedores" value={number(rows.length,0)}/><Metric label="Com atraso" value={number(rows.filter(x=>x.ATRASO_DIAS>0).length,0)} tone="warning"/><Metric label="Dependência acima de 30%" value={number(rows.filter(x=>x.DEPENDENCIA>30).length,0)} tone="danger"/></section><section className="panel"><h2>Qualidade, dependência e rentabilidade</h2><Table rows={rows} columns={[{key:"NOME",label:"Fornecedor"},{key:"ENTRADAS",label:"Entradas",render:r=>number(r.ENTRADAS,0)},{key:"TOTAL",label:"Comprado",money:true,render:r=>money(r.TOTAL)},{key:"DEPENDENCIA",label:"Dependência",render:r=>pct(r.DEPENDENCIA)},{key:"LUCRO",label:"Lucro dos produtos",money:true,render:r=>money(r.LUCRO)},{key:"MARGEM",label:"Margem",render:r=>pct(r.MARGEM)},{key:"PRAZO_REAL",label:"Prazo real",render:r=>ausente(r.PRAZO_REAL)?"não informado":`${number(r.PRAZO_REAL,0)} dias`},{key:"ATRASO_DIAS",label:"Atraso",render:r=>ausente(r.ATRASO_DIAS)?"não informado":`${number(r.ATRASO_DIAS,0)} dias`},{key:"VARIACAO_CUSTO",label:"Variação custo",render:r=>pct(r.VARIACAO_CUSTO)}]} /></section></>;
}

function Alerts({ data, settings, reload }) {
  const alerts=data.alerts||[];const display=a=>a.format==="money"?money(a.value):a.format==="percent"?pct(a.value):a.format==="days"?`${number(a.value,0)} dias`:number(a.value);
  const [form,setForm]=useState(settings||{});useEffect(()=>setForm(settings||{}),[settings]);const set=(key,value)=>setForm(x=>({...x,[key]:Number(value)}));const save=async()=>{await api.post("/relatorios-gerenciais/settings",form);reload();};
  return <><section className="panel executive-settings"><h2>Limites dos alertas</h2><label>Margem mínima (%)<input type="number" value={form.margin_minimum||0} onChange={e=>set("margin_minimum",e.target.value)}/></label><label>Queda de vendas (%)<input type="number" value={form.sales_drop_warning||0} onChange={e=>set("sales_drop_warning",e.target.value)}/></label><label>Estoque sem giro (dias)<input type="number" value={form.idle_stock_days||0} onChange={e=>set("idle_stock_days",e.target.value)}/></label><label>Cliente inativo (dias)<input type="number" value={form.inactive_customer_days||0} onChange={e=>set("inactive_customer_days",e.target.value)}/></label><button onClick={save}>Salvar limites</button></section><section className="grid"><Metric label="Alertas críticos" value={number(data.counts?.danger,0)} tone="danger"/><Metric label="Alertas de atenção" value={number(data.counts?.warning,0)} tone="warning"/><Metric label="Produtos abaixo da margem" value={number(data.details?.below_margin,0)}/></section><section className="alert-center">{alerts.map((a,i)=><article key={`${a.area}-${i}`} className={`panel management-alert ${a.level||"warning"}`}><span>{a.area}</span><div><h2>{a.title}</h2><p>{display(a)}</p></div><b>{a.level==="danger"?"Alta":"Atenção"}</b></article>)}{!alerts.length&&<div className="panel executive-empty">Nenhum alerta crítico encontrado.</div>}</section></>;
}

function Daily({ data, settings, reload }) {
  const t=data.totals||{};const text=`Resumo diário ${data.date||""}\nVendas: ${money(t.sales)}\nPedidos: ${number(t.orders,0)}\nLucro: ${money(t.profit)}\nSaldo bancário: ${money(t.bank_balance)}\nA receber em 7 dias: ${money(t.receivable_7d)}\nA pagar em 7 dias: ${money(t.payable_7d)}\nRecebimentos vencidos: ${money(t.receivable_overdue)}\nPagamentos vencidos: ${money(t.payable_overdue)}\nEstoque negativo: ${number(t.stock_negative,0)}`;
  const [schedule,setSchedule]=useState(settings?.daily||{});useEffect(()=>setSchedule(settings?.daily||{}),[settings]);const change=(key,value)=>setSchedule(x=>({...x,[key]:value}));const save=async()=>{await api.post("/relatorios-gerenciais/settings",{daily:schedule});reload();};
  return <><section className="panel executive-settings"><h2>Envio automático</h2><label className="check-label"><input type="checkbox" checked={Boolean(schedule.enabled)} onChange={e=>change("enabled",e.target.checked)}/>Ativar resumo diário</label><label>Horário<input type="time" value={schedule.time||"08:00"} onChange={e=>change("time",e.target.value)}/></label><label>E-mails<input value={schedule.emails||""} placeholder="gestor@empresa.com.br" onChange={e=>change("emails",e.target.value)}/></label><label>WhatsApp com DDI<input value={schedule.whatsapp_numbers||""} placeholder="5521999999999" onChange={e=>change("whatsapp_numbers",e.target.value)}/></label><button onClick={save}>Salvar agendamento</button></section><section className="daily-actions"><button onClick={()=>navigator.clipboard.writeText(text)}>Copiar resumo</button><a className="button-link" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a><a className="button-link" href={`mailto:?subject=${encodeURIComponent("Resumo diário das lojas")}&body=${encodeURIComponent(text)}`}>Enviar por e-mail</a></section><section className="grid"><Metric label="Vendas de hoje" value={money(t.sales)}/><Metric label="Pedidos" value={number(t.orders,0)}/><Metric label="Lucro bruto" value={money(t.profit)}/><Metric label="Saldo bancos" value={money(t.bank_balance)}/><Metric label="A receber em 7 dias" value={money(t.receivable_7d)}/><Metric label="A pagar em 7 dias" value={money(t.payable_7d)}/><Metric label="Recebimentos vencidos" value={money(t.receivable_overdue)} tone="danger"/><Metric label="Pagamentos vencidos" value={money(t.payable_overdue)} tone="warning"/></section><section className="panel"><h2>Alertas prioritários</h2><Table rows={data.priority||[]} columns={[{key:"title",label:"Alerta"},{key:"value",label:"Valor",render:r=>r.title.includes("Estoque")?number(r.value,0):money(r.value)}]}/></section><section className="panel"><h2>Resultado de hoje por loja</h2><Table rows={data.stores||[]} columns={[{key:"NOME",label:"Loja"},{key:"PEDIDOS",label:"Pedidos",render:r=>number(r.PEDIDOS,0)},{key:"FATURAMENTO",label:"Faturamento",money:true,render:r=>money(r.FATURAMENTO)},{key:"LUCRO",label:"Lucro",money:true,render:r=>ausente(r.FATURAMENTO)?"não informado":money(Number(r.FATURAMENTO)-Number(r.CUSTO||0))}]} /></section></>;
}

function Executive({data}){const stores=data.stores?.rows||[],goals=data.goals?.stores||[],flow=data.cashflow||{},stock=data.inventory||{};const lucro=!data.stores?0:stores.some((loja)=>loja.LUCRO==null)?null:stores.reduce((soma,loja)=>soma+Number(loja.LUCRO),0);return <><section className="grid"><Metric label="Faturamento consolidado" value={money(data.stores?data.stores.total:0)}/><Metric label="Lucro consolidado" value={money(lucro)}/><Metric label="Produtos abaixo da margem" value={number(data.margins?.below,0)} tone="warning"/><Metric label="Capital de giro necessário" value={money(flow.working_capital)} tone={flow.working_capital>0?"danger":"positive"}/><Metric label="Capital parado" value={money(stock.idle_value)} tone="warning"/><Metric label="Rupturas" value={number(stock.rupture,0)} tone="danger"/></section><section className="executive-columns"><section className="panel"><h2>Resultado por loja</h2><Table rows={stores} columns={[{key:"NOME",label:"Loja"},{key:"FATURAMENTO",label:"Faturamento",render:r=>money(r.FATURAMENTO)},{key:"LUCRO",label:"Lucro",render:r=>money(r.LUCRO)},{key:"MARGEM",label:"Margem",render:r=>pct(r.MARGEM)}]}/></section><section className="panel"><h2>Metas e projeção</h2><Table rows={goals} columns={[{key:"NOME",label:"Loja"},{key:"META",label:"Meta",render:r=>money(r.META)},{key:"FATURAMENTO",label:"Realizado",render:r=>money(r.FATURAMENTO)},{key:"ATINGIMENTO",label:"Atingimento",render:r=>ausente(r.FATURAMENTO)||!r.META?"não informado":pct(Number(r.FATURAMENTO)/Number(r.META)*100)}]}/></section></section><section className="executive-columns"><section className="panel"><h2>Alertas que exigem ação</h2><Table rows={data.alerts||[]} columns={[{key:"area",label:"Área"},{key:"title",label:"Alerta"},{key:"value",label:"Valor",render:r=>r.format==="money"?money(r.value):r.format==="percent"?pct(r.value):number(r.value)}]}/></section><section className="panel"><h2>Caixa projetado</h2><Table rows={flow.buckets||[]} columns={[{key:"days",label:"Horizonte",render:r=>`${r.days} dias`},{key:"probable",label:"Provável",render:r=>money(r.probable)},{key:"pessimistic",label:"Pessimista",render:r=>money(r.pessimistic)}]}/></section></section></>}

export default function ExecutiveReports({ type }) {
  const [days, setDays] = useState(type === "daily" ? 1 : "custom");
  const [store, setStore] = useState("");
  const today = new Date(), monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [customPeriod, setCustomPeriod] = useState({ data_inicio: monthStart.toISOString().slice(0, 10), data_fim: today.toISOString().slice(0, 10) });
  const { data, loading, error, load } = useExecutiveData(type, days, store, customPeriod);
  const title = TITLES[type] || TITLES.stores;
  const stores = data.options?.lojas || [];
  const content = useMemo(() => {
    if (type === "executive") return <Executive data={data.report||{}} />;
    if (type === "stores") return <Stores report={data.report} />;
    if (type === "goals") return <Goals report={data.report} settings={data.settings} reload={load} />;
    if (type === "margins") return <Margins report={data.report} />;
    if (type === "inventory") return <Inventory data={data.report || {}} storeCount={stores.length} />;
    if (type === "cashflow") return <Cashflow report={data.report} settings={data.settings} reload={load} />;
    if (type === "sellers") return <Sellers report={data.report} />;
    if (type === "retention") return <Retention data={data.report || {}} />;
    if (type === "suppliers") return <Suppliers report={data.report} />;
    if (type === "alerts") return <Alerts data={data.report || {}} settings={data.settings} reload={load} />;
    return <Daily data={data.report || {}} settings={data.settings} reload={load} />;
  }, [type, data]);
  return <div className="executive-report"><section className="panel dashboard-toolbar"><div><span className="section-kicker">RELATÓRIO GERENCIAL</span><h2>{title[0]}</h2><p>{title[1]}</p></div>{type !== "daily" && <><label>Período<select value={days} onChange={e => setDays(e.target.value === "custom" ? "custom" : Number(e.target.value))}><option value={1}>1 dia</option><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={60}>60 dias</option><option value={90}>90 dias</option><option value={180}>180 dias</option><option value={365}>12 meses</option><option value="custom">Personalizado</option></select></label>{days === "custom" && <div className="custom-period-fields"><label>Data inicial<input type="date" value={customPeriod.data_inicio} max={customPeriod.data_fim} onChange={e => setCustomPeriod(p => ({ ...p, data_inicio: e.target.value }))} /></label><label>Data final<input type="date" value={customPeriod.data_fim} min={customPeriod.data_inicio} onChange={e => setCustomPeriod(p => ({ ...p, data_fim: e.target.value }))} /></label></div>}</>}{stores.length > 1 && !["stores", "goals"].includes(type) && <label>Loja<select value={store} onChange={e => setStore(e.target.value)}><option value="">Todas</option>{stores.map(x => <option key={x.ID} value={x.ID}>{x.NOME}</option>)}</select></label>}<button onClick={load} disabled={loading || (days === "custom" && (!customPeriod.data_inicio || !customPeriod.data_fim))}>{loading ? "Atualizando..." : "Atualizar"}</button></section>{error && <div className="error">{error}</div>}{!error && content}</div>;
}
