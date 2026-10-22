import express from "express";
import { query, withDatabase } from "../db.js";
import { readJsonConfig, writeJsonConfig } from "../lib/json-config.js";

const router = express.Router();
const SETTINGS_FILE = "management_reports.json";
const defaults = {
  goals: {}, seller_goals: {}, category_goals: {}, margin_minimum: 25, sales_drop_warning: 10,
  inactive_customer_days: 60, idle_stock_days: 90,
  cashflow_accounts: [],
  daily: { enabled: false, time: "08:00", emails: "", whatsapp_numbers: "" },
};
const num = (value) => Number(value || 0);
const iso = (date) => date.toISOString().slice(0, 10);
const dateValue = (value, fallback) => {
  if (!value) return fallback;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
};
const company = req => {
  const value = Number(req.query.loja || req.query.idempresa || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
};
function settings() { return { ...defaults, ...readJsonConfig(SETTINGS_FILE, {}), daily: { ...defaults.daily, ...readJsonConfig(SETTINGS_FILE, {}).daily } }; }
function period(req) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.min(1460, Number(req.query.dias || 30)));
  const endDay = dateValue(req.query.data_fim, today);
  const start = dateValue(req.query.data_inicio, new Date(endDay));
  if (!req.query.data_inicio) start.setDate(start.getDate() - days + 1);
  const end = new Date(endDay); end.setDate(end.getDate() + 1);
  return { start, end, endDay, days };
}
const salesWhere = (alias = "se", companyId = null) => `${alias}.DTSAIDA>=? AND ${alias}.DTSAIDA<? AND ${alias}.DTCANCELAMENTO IS NULL AND COALESCE(${alias}.STATUS,0) IN (1,3) AND (${alias}.STATUS_ORC IS NULL OR ${alias}.STATUS_ORC<>0)${companyId ? ` AND ${alias}.IDEMPRESA=?` : ""}`;
const periodParams = (p, companyId) => companyId ? [p.start, p.end, companyId] : [p.start, p.end];
// A conexão vai em UTF8. Cadastros antigos estão em NONE e um byte inválido
// para UTF-8 aborta a consulta com "Malformed string". OCTETS lê o bruto e
// NONE devolve ao driver, que decodifica em Windows-1252.
const legacyText = (expression, size) =>
  `CAST(CAST(${expression} AS VARCHAR(${size}) CHARACTER SET OCTETS) AS VARCHAR(${size}) CHARACTER SET NONE)`;
const legacyName = (columns, fallback = "") => {
  const parts = columns.map(([expression, size]) => legacyText(expression, size));
  if (fallback) parts.push(`CAST('${fallback}' AS VARCHAR(${Math.max(fallback.length, 1)}) CHARACTER SET NONE)`);
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(",")})`;
};
const run = (factory) => async (req, res) => { try { res.json(await withDatabase(db => factory(db, req))); } catch (error) { res.status(500).json({ ok: false, erro: error.message }); } };

async function storeRows(db, start, end, companyId = null) {
  return query(db, `SELECT se.IDEMPRESA ID,c.NOMEEMPRESA NOME,
    COUNT(DISTINCT se.NRPEDIDO) PEDIDOS,SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) FATURAMENTO,
    SUM(COALESCE(sp.QTDPRODUTO,0)*COALESCE(sp.VLCUSTOREAL,sp.VLCUSTO,p.VLCUSTOMEDIO,0)) CUSTO,
    SUM(COALESCE(se.DESCONTO,0)) DESCONTOS
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO LEFT JOIN CONFIGURACAO c ON c.IDEMPRESA=se.IDEMPRESA
    WHERE ${salesWhere("se", companyId)} AND COALESCE(sp.STATUSSE,0)=0
    GROUP BY se.IDEMPRESA,c.NOMEEMPRESA ORDER BY FATURAMENTO DESC`, companyId ? [start, end, companyId] : [start, end]);
}

async function stores(db, req) {
  const p = period(req), duration = Math.max(1, Math.round((p.end - p.start) / 86400000));
  const previousStart = new Date(p.start); previousStart.setDate(previousStart.getDate() - duration);
  const yearStart = new Date(p.start); yearStart.setFullYear(yearStart.getFullYear() - 1);
  const yearEnd = new Date(p.end); yearEnd.setFullYear(yearEnd.getFullYear() - 1);
  const companyId = company(req);
  const current = await storeRows(db, p.start, p.end, companyId);
  const previous = await storeRows(db, previousStart, p.start, companyId);
  const lastYear = await storeRows(db, yearStart, yearEnd, companyId);
  const map = rows => new Map(rows.map(x => [String(x.ID), num(x.FATURAMENTO)]));
  const prev = map(previous), year = map(lastYear), total = current.reduce((s, x) => s + num(x.FATURAMENTO), 0);
  return { ok: true, periodo: { inicio: iso(p.start), fim: iso(p.endDay) }, rows: current.map(x => ({
    ...x, LUCRO: num(x.FATURAMENTO) - num(x.CUSTO), MARGEM: num(x.FATURAMENTO) ? (num(x.FATURAMENTO) - num(x.CUSTO)) / num(x.FATURAMENTO) * 100 : 0,
    TICKET: num(x.PEDIDOS) ? num(x.FATURAMENTO) / num(x.PEDIDOS) : 0, PARTICIPACAO: total ? num(x.FATURAMENTO) / total * 100 : 0,
    VARIACAO_ANTERIOR: prev.get(String(x.ID)) ? (num(x.FATURAMENTO) - prev.get(String(x.ID))) / prev.get(String(x.ID)) * 100 : null,
    VARIACAO_ANO: year.get(String(x.ID)) ? (num(x.FATURAMENTO) - year.get(String(x.ID))) / year.get(String(x.ID)) * 100 : null,
  })), total };
}

async function goals(db,req){
  const storeData=await stores(db,req), sellerData=await sellers(db,req), p=period(req),companyId=company(req),cfg=settings();
  const categories=await query(db,`SELECT pr.CDGRUPO ID,COALESCE(g.GRUPOS,'Sem grupo') NOME,
    SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) FATURAMENTO
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO LEFT JOIN GRUPOS g ON g.CDGRUPO=pr.CDGRUPO
    WHERE ${salesWhere("se",companyId)} AND COALESCE(sp.STATUSSE,0)=0
    GROUP BY pr.CDGRUPO,g.GRUPOS ORDER BY FATURAMENTO DESC`,periodParams(p,companyId));
  return{ok:true,periodo:storeData.periodo,stores:storeData.rows.map(x=>({...x,META:num(cfg.goals[x.ID])})),sellers:sellerData.rows.map(x=>({...x,META:num(cfg.seller_goals[x.ID])})),categories:categories.map(x=>({...x,META:num(cfg.category_goals[x.ID])}))};
}

async function margins(db, req) {
  const p = period(req), companyId=company(req), params = periodParams(p,companyId), from = `FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA LEFT JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO`;
  const measures = `SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) FATURAMENTO,SUM(COALESCE(sp.QTDPRODUTO,0)*COALESCE(sp.VLCUSTOREAL,sp.VLCUSTO,pr.VLCUSTOMEDIO,0)) CUSTO,SUM(COALESCE(sp.DESCONTO,0)) DESCONTO,SUM(COALESCE(sp.QTDPRODUTO,0)) QTD`;
  const where = `${salesWhere("se",companyId)} AND COALESCE(sp.STATUSSE,0)=0`;
  const make = async (select, joins, group) => (await query(db, `SELECT FIRST 100 ${select},${measures} ${from} ${joins} WHERE ${where} GROUP BY ${group} ORDER BY FATURAMENTO DESC`, params)).map(x => ({ ...x, LUCRO: num(x.FATURAMENTO) - num(x.CUSTO), MARGEM: num(x.FATURAMENTO) ? (num(x.FATURAMENTO) - num(x.CUSTO)) / num(x.FATURAMENTO) * 100 : 0 }));
  const label = (columns, fallback) => `MAX(${legacyName(columns, fallback)}) NOME`;
  const products = await make(`sp.CDPRODUTO ID,${label([["pr.PRODUTO", 70], ["sp.DESCRICAO", 150]])}`, "", "sp.CDPRODUTO");
  const storesData = await make(`se.IDEMPRESA ID,${label([["c.NOMEEMPRESA", 60]])}`, "LEFT JOIN CONFIGURACAO c ON c.IDEMPRESA=se.IDEMPRESA", "se.IDEMPRESA");
  const sellersData = await make(`se.CDVENDEDOR ID,${label([["v.VENDEDOR", 50]], "Sem vendedor")}`, "LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR", "se.CDVENDEDOR");
  const groups = await make(`pr.CDGRUPO ID,${label([["g.GRUPOS", 50]], "Sem grupo")}`, "LEFT JOIN GRUPOS g ON g.CDGRUPO=pr.CDGRUPO", "pr.CDGRUPO");
  const brands = await make(`pr.CDFORNECEDOR ID,${label([["f.FORNECEDOR", 65], ["f.FANTASIA", 65], ["pr.MARCA", 60]], "Sem marca")}`, "LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=pr.CDFORNECEDOR", "pr.CDFORNECEDOR");
  return { ok: true, products, stores: storesData, sellers: sellersData, groups, brands, below_minimum: products.filter(x => x.MARGEM < settings().margin_minimum) };
}

async function inventory(db, req) {
  const p = period(req), companyId=company(req), idleDays = Math.max(1, Number(req.query.sem_giro_dias || settings().idle_stock_days));
  const balances = await query(db, `SELECT m.CDPRODUTO,c.IDEMPRESA,c.NOMEEMPRESA LOJA,m.CDDEPOSITO,
    COALESCE(pr.PRODUTO,m.CDPRODUTO) PRODUTO,COALESCE(m.QTDEATUAL,0) ESTOQUE,COALESCE(m.QTDEMINIMA,0) MINIMO,
    COALESCE(m.QTDEMAXIMA,0) MAXIMO,COALESCE(pr.VLCUSTOMEDIO,0) CUSTO
    FROM MOVIMENTO m JOIN PRODUTO pr ON pr.CDPRODUTO=m.CDPRODUTO LEFT JOIN CONFIGURACAO c ON c.CDDEPOSITO=m.CDDEPOSITO
    WHERE (pr.INATIVO=0 OR pr.INATIVO IS NULL)${companyId ? " AND c.IDEMPRESA=?" : ""}`, companyId ? [companyId] : []);
  const sales90 = await query(db, `SELECT sp.CDPRODUTO,se.IDEMPRESA,SUM(COALESCE(sp.QTDPRODUTO,0)) QTD,MAX(CAST(se.DTSAIDA AS DATE)) ULTIMA_VENDA
    FROM SAIDAPRODUTO sp JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    WHERE se.DTCANCELAMENTO IS NULL AND se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE)${companyId ? " AND se.IDEMPRESA=?" : ""}
    GROUP BY sp.CDPRODUTO,se.IDEMPRESA`, companyId ? [companyId] : []);
  const sold = new Map(sales90.map(x => [`${x.CDPRODUTO}|${x.IDEMPRESA}`, x]));
  const rows = balances.map(x => { const s = sold.get(`${x.CDPRODUTO}|${x.IDEMPRESA}`), daily = num(s?.QTD) / 90, shortage=Math.max(0,num(x.MINIMO)-num(x.ESTOQUE)); return { ...x, VENDA_90D: num(s?.QTD), ULTIMA_VENDA: s?.ULTIMA_VENDA || null, GIRO_90D: num(x.ESTOQUE) ? num(s?.QTD) / num(x.ESTOQUE) : 0, COBERTURA_DIAS: daily ? num(x.ESTOQUE) / daily : null, CAPITAL: num(x.ESTOQUE) * num(x.CUSTO), VENDA_PERDIDA_ESTIMADA: num(x.ESTOQUE)<=0 ? daily*30 : shortage>0 ? Math.min(shortage,daily*30) : 0 }; });
  const byProduct = new Map(); for (const row of rows) { const list = byProduct.get(String(row.CDPRODUTO)) || []; list.push(row); byProduct.set(String(row.CDPRODUTO), list); }
  const transfers = []; for (const list of byProduct.values()) { const deficits = list.filter(x => num(x.ESTOQUE) < num(x.MINIMO)).map(x => ({ ...x, need: num(x.MINIMO) - num(x.ESTOQUE) })); const sources = list.filter(x => num(x.ESTOQUE) > Math.max(num(x.MINIMO), num(x.MAXIMO) || num(x.MINIMO) * 2)).map(x => ({ ...x, spare: num(x.ESTOQUE) - Math.max(num(x.MINIMO), num(x.MAXIMO) || num(x.MINIMO) * 2) })); for (const d of deficits) for (const s of sources) { const qty = Math.min(d.need, s.spare); if (qty > 0) { transfers.push({ CDPRODUTO: d.CDPRODUTO, PRODUTO: d.PRODUTO, ORIGEM: s.LOJA, DESTINO: d.LOJA, QUANTIDADE: qty, ECONOMIA: qty * num(d.CUSTO) }); d.need -= qty; s.spare -= qty; } } }
  const now=Date.now(), age=x=>x.ULTIMA_VENDA?(now-new Date(x.ULTIMA_VENDA))/86400000:99999;
  const idle = rows.filter(x => num(x.ESTOQUE) > 0 && age(x)>=idleDays).sort((a,b)=>num(b.CAPITAL)-num(a.CAPITAL));
  const aging=[30,60,90,180].map((days,index)=>{const upper=[60,90,180,Infinity][index],items=rows.filter(x=>num(x.ESTOQUE)>0&&age(x)>=days&&age(x)<upper);return{days,label:upper===Infinity?"180+ dias":`${days}–${upper-1} dias`,items:items.length,value:items.reduce((s,x)=>s+num(x.CAPITAL),0)}});
  return { ok: true, transfers: transfers.slice(0, 200), idle: idle.slice(0, 500), aging, summary: { value: rows.reduce((s, x) => s + num(x.CAPITAL), 0), idle_value: idle.reduce((s, x) => s + num(x.CAPITAL), 0), negative: rows.filter(x => num(x.ESTOQUE) < 0).length, rupture: rows.filter(x => num(x.ESTOQUE) <= 0).length, lost_sales_units: rows.reduce((s,x)=>s+num(x.VENDA_PERDIDA_ESTIMADA),0) } };
}

async function cashflow(db) {
  const accounts = await query(db, `SELECT cc.CDBANCO,cc.AGENCIA,cc.NUMCONTA,
    COALESCE(b.BANCO,'Banco ' || CAST(cc.CDBANCO AS VARCHAR(20))) BANCO,
    COALESCE((SELECT SUM(COALESCE(mb.VALOR,0)) FROM MOV_BANCARIO mb
      WHERE mb.CDBANCO=cc.CDBANCO
      AND COALESCE(TRIM(mb.AGENCIA),'')=COALESCE(TRIM(cc.AGENCIA),'')
      AND COALESCE(TRIM(mb.NUMCONTA),'')=COALESCE(TRIM(cc.NUMCONTA),'')),0) SALDO
    FROM CONTACORRENTE cc LEFT JOIN BANCO b ON b.CDBANCO=cc.CDBANCO
    ORDER BY b.BANCO,cc.AGENCIA,cc.NUMCONTA`);
  const selected = new Set(settings().cashflow_accounts || []);
  const accountRows = accounts.map(account => ({
    ...account,
    KEY: `${account.CDBANCO}|${String(account.AGENCIA || "").trim()}|${String(account.NUMCONTA || "").trim()}`,
  }));
  const initialBalance = accountRows
    .filter(account => selected.has(account.KEY))
    .reduce((sum, account) => sum + num(account.SALDO), 0);
  const buckets = [[1, "D1"], [7, "D7"], [30, "D30"], [60, "D60"], [90, "D90"]], result = [];
  for (const [days, label] of buckets) {
    const rec = (await query(db, `SELECT SUM(COALESCE(DIVIDA,VALOR,0)) TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC BETWEEN CURRENT_DATE AND DATEADD(${days} DAY TO CURRENT_DATE)`))[0];
    const pay = (await query(db, `SELECT SUM(COALESCE(VALOR,TOTAL,0)) TOTAL FROM CTAPAGAR WHERE STATUS=1 AND DTVENC BETWEEN CURRENT_DATE AND DATEADD(${days} DAY TO CURRENT_DATE)`))[0];
    const receive = num(rec?.TOTAL), payable = num(pay?.TOTAL); result.push({ label, days, receive, payable, probable: initialBalance + receive - payable, optimistic: initialBalance + receive - payable * .95, pessimistic: initialBalance + receive * .75 - payable });
  }
  return { ok: true, accounts: accountRows, initial_balance: initialBalance, buckets: result, working_capital: Math.max(0, ...result.map(x => -x.pessimistic)) };
}

async function sellers(db, req) {
  const p = period(req), companyId=company(req), rows = await query(db, `SELECT se.CDVENDEDOR ID,COALESCE(v.VENDEDOR,'Sem vendedor') NOME,
    COUNT(DISTINCT se.NRPEDIDO) PEDIDOS,SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) FATURAMENTO,
    SUM(COALESCE(sp.QTDPRODUTO,0)*COALESCE(sp.VLCUSTOREAL,sp.VLCUSTO,pr.VLCUSTOMEDIO,0)) CUSTO,
    SUM(COALESCE(sp.DESCONTO,0))+SUM(COALESCE(se.DESCONTO,0)) DESCONTOS,SUM(COALESCE(se.VLCOMISSVEND,se.VLCOMISSAO,0)) COMISSAO,
    COUNT(DISTINCT se.CDCLIENTE) CLIENTES
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR
    WHERE ${salesWhere("se",companyId)} AND COALESCE(sp.STATUSSE,0)=0 GROUP BY se.CDVENDEDOR,v.VENDEDOR ORDER BY FATURAMENTO DESC`, periodParams(p,companyId));
  const cancelled = await query(db, `SELECT CDVENDEDOR ID,COUNT(*) CANCELAMENTOS,SUM(COALESCE(VLTOTAL,0)) VALOR_CANCELADO FROM SAIDAESTOQUE WHERE DTSAIDA>=? AND DTSAIDA<? AND DTCANCELAMENTO IS NOT NULL${companyId?" AND IDEMPRESA=?":""} GROUP BY CDVENDEDOR`, periodParams(p,companyId));
  const cancels = new Map(cancelled.map(x => [String(x.ID), x]));
  const goals=settings().seller_goals||{};
  return { ok: true, rows: rows.map(x => {const meta=num(goals[x.ID]);return { ...x, LUCRO: num(x.FATURAMENTO) - num(x.CUSTO), MARGEM: num(x.FATURAMENTO) ? (num(x.FATURAMENTO) - num(x.CUSTO)) / num(x.FATURAMENTO) * 100 : 0, TICKET: num(x.PEDIDOS) ? num(x.FATURAMENTO) / num(x.PEDIDOS) : 0, CANCELAMENTOS: num(cancels.get(String(x.ID))?.CANCELAMENTOS), VALOR_CANCELADO: num(cancels.get(String(x.ID))?.VALOR_CANCELADO),META:meta,ATINGIMENTO:meta?num(x.FATURAMENTO)/meta*100:0 };}) };
}

async function retention(db, req) {
  const p = period(req),companyId=company(req), rows = await query(db, `SELECT FIRST 1000 se.CDCLIENTE ID,COALESCE(c.CLIENTE,c.RAZAO,se.CLIENTE) NOME,
    MAX(CAST(se.DTSAIDA AS DATE)) ULTIMA_COMPRA,COUNT(DISTINCT se.NRPEDIDO) FREQUENCIA,SUM(COALESCE(se.VLTOTAL,se.SUBTOTAL,0)) MONETARIO,
    DATEDIFF(DAY,MAX(CAST(se.DTSAIDA AS DATE)),CURRENT_DATE) RECENCIA
    FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE WHERE se.DTCANCELAMENTO IS NULL AND se.CDCLIENTE>0
    AND se.DTSAIDA>=DATEADD(-730 DAY TO CURRENT_DATE)${companyId?" AND se.IDEMPRESA=?":""} GROUP BY se.CDCLIENTE,c.CLIENTE,c.RAZAO,se.CLIENTE ORDER BY MONETARIO DESC`,companyId?[companyId]:[]);
  const overdue=await query(db,`SELECT CDCLIENTE ID,SUM(COALESCE(DIVIDA,VALOR,0)) INADIMPLENCIA FROM CTARECEBER WHERE STATUS=1 AND DTVENC<CURRENT_DATE${companyId?" AND IDEMPRESA=?":""} GROUP BY CDCLIENTE`,companyId?[companyId]:[]), overdueMap=new Map(overdue.map(x=>[String(x.ID),num(x.INADIMPLENCIA)]));
  const sortedM = [...rows].sort((a,b)=>num(a.MONETARIO)-num(b.MONETARIO)), sortedF=[...rows].sort((a,b)=>num(a.FREQUENCIA)-num(b.FREQUENCIA));
  const quartile=(list,val,key)=>{const pos=list.findIndex(x=>num(x[key])>=num(val));return Math.min(4,Math.floor(Math.max(0,pos)/Math.max(1,list.length)*4)+1)};
  const result = rows.map(x => { const r = num(x.RECENCIA)<=30?4:num(x.RECENCIA)<=60?3:num(x.RECENCIA)<=120?2:1, f=quartile(sortedF,x.FREQUENCIA,"FREQUENCIA"), m=quartile(sortedM,x.MONETARIO,"MONETARIO"),inad=overdueMap.get(String(x.ID))||0; const segment=r>=3&&f>=3?"Campeões":r<=2&&f>=3?"Em risco":r===1?"Inativos":f>=2?"Potenciais":"Novos/ocasionais"; return {...x,R:r,F:f,M:m,RFM:`${r}${f}${m}`,SEGMENTO:segment,LTV:num(x.MONETARIO),INADIMPLENCIA:inad,TIPO:num(x.FREQUENCIA)===1?"Novo":num(x.RECENCIA)<=120?"Recorrente":"Inativo"}; });
  return { ok:true, rows:result, reactivation:result.filter(x=>["Em risco","Inativos"].includes(x.SEGMENTO)).sort((a,b)=>num(b.LTV)-num(a.LTV)).slice(0,200), summary:{...Object.fromEntries([...new Set(result.map(x=>x.SEGMENTO))].map(s=>[s,result.filter(x=>x.SEGMENTO===s).length])),new_customers:result.filter(x=>x.TIPO==="Novo").length,recurring:result.filter(x=>x.TIPO==="Recorrente").length,inactive:result.filter(x=>x.TIPO==="Inativo").length,overdue:result.reduce((s,x)=>s+num(x.INADIMPLENCIA),0)}, period:{inicio:iso(p.start),fim:iso(p.endDay)} };
}

async function suppliers(db, req) {
  const p=period(req),companyId=company(req), rows=await query(db,`SELECT ee.CDFORNECEDOR ID,COALESCE(f.FORNECEDOR,f.FANTASIA,'Sem fornecedor') NOME,
    COUNT(DISTINCT ee.IDENTRADA) ENTRADAS,SUM(COALESCE(ep.QTDE,0)) QTD,SUM(COALESCE(ep.VLTOT,ep.QTDE*ep.VLUNIT,0)) TOTAL,
    AVG(COALESCE(f.PRAZOENTREGA,0)) PRAZO_PROMETIDO,AVG(CASE WHEN ee.DTNTFISCAL IS NOT NULL THEN DATEDIFF(DAY,CAST(ee.DTNTFISCAL AS DATE),CAST(ee.DTENTRADA AS DATE)) ELSE NULL END) PRAZO_REAL,
    AVG(CASE WHEN COALESCE(ep.CUSTOMED_ANTERIOR,0)>0 THEN (COALESCE(ep.VLCUSTO,ep.VLUNIT,0)-ep.CUSTOMED_ANTERIOR)/ep.CUSTOMED_ANTERIOR*100 ELSE NULL END) VARIACAO_CUSTO,
    SUM(CASE WHEN ee.CDORDEM IS NULL THEN 1 ELSE 0 END) SEM_PEDIDO
    FROM ENTRESTOQUE ee JOIN ENTRPRODUTO ep ON ep.IDENTRADA=ee.IDENTRADA AND ep.IDEMPRESA=ee.IDEMPRESA
    LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=ee.CDFORNECEDOR WHERE ee.DTENTRADA>=? AND ee.DTENTRADA<? AND ee.DTCANCELAMENTO IS NULL${companyId?" AND ee.IDEMPRESA=?":""}
    GROUP BY ee.CDFORNECEDOR,f.FORNECEDOR,f.FANTASIA ORDER BY TOTAL DESC`,periodParams(p,companyId));
  const profit=await query(db,`SELECT pr.CDFORNECEDOR ID,SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) FATURAMENTO,
    SUM(COALESCE(sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)-sp.QTDPRODUTO*COALESCE(sp.VLCUSTOREAL,sp.VLCUSTO,pr.VLCUSTOMEDIO,0)) LUCRO
    FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA JOIN PRODUTO pr ON pr.CDPRODUTO=sp.CDPRODUTO
    WHERE ${salesWhere("se",companyId)} AND COALESCE(sp.STATUSSE,0)=0 GROUP BY pr.CDFORNECEDOR`,periodParams(p,companyId)),profitMap=new Map(profit.map(x=>[String(x.ID),x])),total=rows.reduce((s,x)=>s+num(x.TOTAL),0);
  return {ok:true,rows:rows.map(x=>{const pr=profitMap.get(String(x.ID))||{};return {...x,ATRASO_DIAS:Math.max(0,num(x.PRAZO_REAL)-num(x.PRAZO_PROMETIDO)),NO_PRAZO:num(x.PRAZO_REAL)<=num(x.PRAZO_PROMETIDO),PARTICIPACAO:total?num(x.TOTAL)/total*100:0,FATURAMENTO:num(pr.FATURAMENTO),LUCRO:num(pr.LUCRO),MARGEM:num(pr.FATURAMENTO)?num(pr.LUCRO)/num(pr.FATURAMENTO)*100:0,DEPENDENCIA:total?num(x.TOTAL)/total*100:0};})};
}

async function daily(db) {
  const today=new Date();today.setHours(0,0,0,0);const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
  const storesData=await storeRows(db,today,tomorrow), receivable=(await query(db,"SELECT SUM(COALESCE(DIVIDA,VALOR,0)) TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC<CURRENT_DATE"))[0], payable=(await query(db,"SELECT SUM(COALESCE(VALOR,TOTAL,0)) TOTAL FROM CTAPAGAR WHERE STATUS=1 AND DTVENC<CURRENT_DATE"))[0];
  const upcomingRec=(await query(db,"SELECT SUM(COALESCE(DIVIDA,VALOR,0)) TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC BETWEEN CURRENT_DATE AND DATEADD(7 DAY TO CURRENT_DATE)"))[0],upcomingPay=(await query(db,"SELECT SUM(COALESCE(VALOR,TOTAL,0)) TOTAL FROM CTAPAGAR WHERE STATUS=1 AND DTVENC BETWEEN CURRENT_DATE AND DATEADD(7 DAY TO CURRENT_DATE)"))[0];
  const bank=(await query(db,"SELECT SUM(COALESCE(VALOR,0)) TOTAL FROM MOV_BANCARIO"))[0];
  const stock=await inventory(db,{query:{sem_giro_dias:settings().idle_stock_days}}),totals={sales:storesData.reduce((s,x)=>s+num(x.FATURAMENTO),0),profit:storesData.reduce((s,x)=>s+num(x.FATURAMENTO)-num(x.CUSTO),0),orders:storesData.reduce((s,x)=>s+num(x.PEDIDOS),0),receivable_overdue:num(receivable?.TOTAL),payable_overdue:num(payable?.TOTAL),receivable_7d:num(upcomingRec?.TOTAL),payable_7d:num(upcomingPay?.TOTAL),bank_balance:num(bank?.TOTAL),stock_negative:num(stock.summary.negative)};
  const priority=[];if(totals.receivable_overdue)priority.push({level:"danger",title:"Recebimentos vencidos",value:totals.receivable_overdue});if(totals.payable_overdue)priority.push({level:"warning",title:"Pagamentos vencidos",value:totals.payable_overdue});if(totals.stock_negative)priority.push({level:"danger",title:"Estoque negativo",value:totals.stock_negative});
  return {ok:true,date:iso(today),stores:storesData,totals,priority};
}

async function executive(db,req){const [storeData,goalData,marginData,stockData,flowData,alertData]=await Promise.all([stores(db,req),goals(db,req),margins(db,req),inventory(db,req),cashflow(db),buildAlerts(db,req)]);return{ok:true,stores:storeData,goals:goalData,margins:{below:marginData.below_minimum.length,top_low_margin:marginData.products.filter(x=>num(x.MARGEM)<settings().margin_minimum).slice(0,10)},inventory:stockData.summary,cashflow:{initial_balance:flowData.initial_balance,working_capital:flowData.working_capital,buckets:flowData.buckets},alerts:alertData.alerts.slice(0,10)}}

const factories={executive,stores,goals,margins,inventory,cashflow,sellers,retention,suppliers,daily};
for(const [name,factory] of Object.entries(factories)) router.get(`/${name}`,run(factory));
router.get("/settings",(_req,res)=>res.json({ok:true,settings:settings()}));
router.post("/settings",(req,res)=>{try{const current=settings(),input=req.body||{},next={...current,...input,goals:{...current.goals,...(input.goals||{})},daily:{...current.daily,...(input.daily||{})}};writeJsonConfig(SETTINGS_FILE,next);res.json({ok:true,settings:next});}catch(error){res.status(400).json({ok:false,erro:error.message});}});
async function buildAlerts(db,req){const storeData=await stores(db,req),marginData=await margins(db,req),stockData=await inventory(db,req),flowData=await cashflow(db),supplierData=await suppliers(db,req),cfg=settings(),alerts=[];
  for(const row of storeData.rows){if(row.VARIACAO_ANTERIOR!==null&&row.VARIACAO_ANTERIOR<-cfg.sales_drop_warning)alerts.push({area:"Vendas",level:"danger",title:`Queda de vendas — ${row.NOME}`,value:row.VARIACAO_ANTERIOR,format:"percent"});if(row.MARGEM<cfg.margin_minimum)alerts.push({area:"Margem",level:"warning",title:`Margem baixa — ${row.NOME}`,value:row.MARGEM,format:"percent"});}
  if(stockData.summary.negative)alerts.push({area:"Estoque",level:"danger",title:"Itens com estoque negativo",value:stockData.summary.negative});if(stockData.summary.idle_value)alerts.push({area:"Estoque",level:"warning",title:"Capital em estoque sem giro",value:stockData.summary.idle_value,format:"money"});
  if(flowData.working_capital)alerts.push({area:"Financeiro",level:"danger",title:"Necessidade projetada de capital de giro",value:flowData.working_capital,format:"money"});for(const x of supplierData.rows.filter(x=>x.ATRASO_DIAS>0).slice(0,5))alerts.push({area:"Fornecedor",level:"warning",title:`Prazo acima do combinado — ${x.NOME}`,value:x.ATRASO_DIAS,format:"days"});
  const overdueRows=await query(db,"SELECT SUM(COALESCE(DIVIDA,VALOR,0)) TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC<CURRENT_DATE");
  const overdueOldRows=await query(db,"SELECT SUM(COALESCE(DIVIDA,VALOR,0)) TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC<DATEADD(-30 DAY TO CURRENT_DATE)");
  const overdueNow=num(overdueRows[0]?.TOTAL),overdueOld=num(overdueOldRows[0]?.TOTAL);
  if(overdueNow)alerts.push({area:"Financeiro",level:overdueOld>0&&overdueNow>overdueOld*1.1?"danger":"warning",title:"Inadimplência em aberto",value:overdueNow,format:"money"});
  const expenseRows=await query(db,"SELECT SUM(COALESCE(VALOR,TOTAL,0)) TOTAL FROM CTAPAGAR WHERE DTINCLUSAO>=DATEADD(-30 DAY TO CURRENT_DATE)");
  const expensePrevRows=await query(db,"SELECT SUM(COALESCE(VALOR,TOTAL,0)) TOTAL FROM CTAPAGAR WHERE DTINCLUSAO>=DATEADD(-60 DAY TO CURRENT_DATE) AND DTINCLUSAO<DATEADD(-30 DAY TO CURRENT_DATE)");
  const expenseNow=num(expenseRows[0]?.TOTAL),expensePrev=num(expensePrevRows[0]?.TOTAL);
  if(expensePrev>0&&expenseNow>expensePrev*1.1)alerts.push({area:"Despesas",level:"warning",title:"Despesas acima da média dos 30 dias anteriores",value:(expenseNow-expensePrev)/expensePrev*100,format:"percent"});
  return {ok:true,alerts,settings:cfg,counts:{danger:alerts.filter(x=>x.level==="danger").length,warning:alerts.filter(x=>x.level==="warning").length},details:{below_margin:marginData.below_minimum.length}};}
router.get("/alerts",run(buildAlerts));

export { buildAlerts, daily, executive, goals, inventory, margins, retention, sellers, stores, suppliers, cashflow, settings };
export default router;
