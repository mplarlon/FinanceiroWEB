import express from "express";
import { query, withDatabase } from "../db.js";

const router = express.Router();
const n = (req, key, fallback = null, min = -Infinity, max = Infinity) => {
  const value = req.query[key] === undefined ? fallback : Number(req.query[key]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
};
const iso = date => date.toISOString().slice(0, 10);
function period(req) {
  const days = n(req, "dias", 30, 1, 1460);
  const endDay = req.query.data_fim ? new Date(`${req.query.data_fim}T00:00:00`) : new Date();
  endDay.setHours(0, 0, 0, 0);
  const start = req.query.data_inicio ? new Date(`${req.query.data_inicio}T00:00:00`) : new Date(endDay);
  if (!req.query.data_inicio) start.setDate(start.getDate() - days + 1);
  const end = new Date(endDay); end.setDate(end.getDate() + 1);
  return { start, end, days };
}
function saleFilter(req, includePeriod = true) {
  const p = period(req);
  const where = ["se.DTCANCELAMENTO IS NULL", "se.CDCLIENTE IS NOT NULL", "se.CDCLIENTE > 0"];
  const params = [];
  if (includePeriod) { where.push("se.DTSAIDA>=?", "se.DTSAIDA<?"); params.push(p.start, p.end); }
  for (const [arg, col] of [["loja","se.IDEMPRESA"],["vendedor","se.CDVENDEDOR"],["cliente","se.CDCLIENTE"],
    ["cidade","COALESCE(se.CDMUNICIPIO,c.CDMUNICIPIO)"],["regiao","COALESCE(se.CDREGIAO,c.CDREGIAO)"]]) {
    const value = n(req, arg);
    if (value !== null) { where.push(`${col}=?`); params.push(value); }
  }
  if (req.query.estado) { where.push("UPPER(COALESCE(se.UF,c.UF,''))=UPPER(?)"); params.push(req.query.estado); }
  if (req.query.tipo_cliente) { where.push("UPPER(COALESCE(c.TIPOJURIDICO,''))=UPPER(?)"); params.push(req.query.tipo_cliente); }
  return { ...p, where: where.join(" AND "), params };
}
// Evite misturar colunas do charset legado com CAST numérico no mesmo
// COALESCE: o Firebird pode tentar converter a expressão inteira e responder
// "Malformed string" mesmo quando o nome do cliente está preenchido.
const name = "COALESCE(c.CLIENTE,c.RAZAO,se.CLIENTE)";
function ranked(rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.FATURAMENTO || 0), 0);
  let accumulated = 0;
  return { total, rows: rows.map((row, index) => {
    accumulated += Number(row.FATURAMENTO || 0);
    const pct = total ? accumulated / total * 100 : 0;
    return { ...row, POSICAO:index + 1, PARTICIPACAO:total ? Number(row.FATURAMENTO || 0)/total*100:0,
      PARTICIPACAO_ACUMULADA:pct, CLASSE_ABC:pct<=80?"A":pct<=95?"B":"C" };
  })};
}
const run = factory => async (req,res) => {
  try { res.json(await withDatabase(db => factory(db,req))); }
  catch(error){ res.status(500).json({ok:false,erro:error.message}); }
};

router.get("/options", run(async db => {
  const lojas=await query(db,`SELECT FIRST 100 IDEMPRESA ID,NOMEEMPRESA NOME FROM CONFIGURACAO ORDER BY IDEMPRESA`);
  const vendedores=await query(db,`SELECT FIRST 200 CDVENDEDOR ID,VENDEDOR NOME FROM VENDEDOR ORDER BY VENDEDOR`);
  const clientes=await query(db,`SELECT FIRST 500 CDCLIENTE ID,COALESCE(CLIENTE,RAZAO) NOME FROM CLIENTE WHERE INATIVO=0 OR INATIVO IS NULL ORDER BY CLIENTE`);
  const estados=await query(db,`SELECT FIRST 40 UF ID,UF NOME FROM CLIENTE WHERE UF IS NOT NULL AND TRIM(UF)<>'' GROUP BY UF ORDER BY UF`);
  const regioes=await query(db,`SELECT FIRST 200 CDREGIAO ID,CAST(CDREGIAO AS VARCHAR(20)) NOME FROM CLIENTE WHERE CDREGIAO IS NOT NULL GROUP BY CDREGIAO ORDER BY CDREGIAO`);
  return {ok:true,cache_ttl:120,lojas,vendedores,clientes,estados,regioes,
    tipos_cliente:[{ID:"F",NOME:"Cliente físico"},{ID:"J",NOME:"Cliente jurídico"}]};
}));
async function ranking(db,req,limit=50) {
  const f=saleFilter(req);
  const rows=await query(db,`SELECT FIRST ${n(req,"limite",limit,1,200)} se.CDCLIENTE,${name} NOME,
    COUNT(DISTINCT CAST(se.NRPEDIDO AS VARCHAR(20))||'-'||CAST(se.IDEMPRESA AS VARCHAR(20))) PEDIDOS,
    SUM(COALESCE(se.VLTOTAL,se.SUBTOTAL,0)) FATURAMENTO,MAX(se.DTSAIDA) ULTIMA_COMPRA,
    MIN(se.DTSAIDA) PRIMEIRA_COMPRA FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
    WHERE ${f.where} GROUP BY se.CDCLIENTE,${name} ORDER BY FATURAMENTO DESC`,f.params);
  return {...f,...ranked(rows)};
}
router.get("/ranking",run(async(db,req)=>{const r=await ranking(db,req);return {ok:true,cache_ttl:120,
  total_faturamento:r.total,periodo:{inicio:iso(r.start),fim:iso(new Date(r.end-1)),dias:r.days},
  dados:r.rows.map(x=>({...x,TICKET_MEDIO:Number(x.PEDIDOS)?Number(x.FATURAMENTO)/Number(x.PEDIDOS):0}))};}));
router.get("/abc",run(async(db,req)=>{const r=await ranking(db,req,200);const resumo={A:{CLIENTES:0,FATURAMENTO:0},B:{CLIENTES:0,FATURAMENTO:0},C:{CLIENTES:0,FATURAMENTO:0}};
  for(const x of r.rows){resumo[x.CLASSE_ABC].CLIENTES++;resumo[x.CLASSE_ABC].FATURAMENTO+=Number(x.FATURAMENTO||0);}
  for(const x of Object.values(resumo))x.PARTICIPACAO=r.total?x.FATURAMENTO/r.total*100:0;
  return {ok:true,cache_ttl:120,total_faturamento:r.total,resumo,dados:r.rows};}));
router.get("/inadimplencia",run(async(db,req)=>{
  const limit=n(req,"limite",50,1,200);const params=[];const where=["cr.CDCLIENTE>0","cr.STATUS=0","cr.DTVENC<CURRENT_DATE","COALESCE(cr.VALOR,0)-COALESCE(cr.TOTALPG,0)>0"];
  for(const [arg,col] of [["loja","cr.IDEMPRESA"],["vendedor","cr.CDVEND"],["cliente","cr.CDCLIENTE"]]){const v=n(req,arg);if(v!==null){where.push(`${col}=?`);params.push(v);}}
  const dados=await query(db,`SELECT FIRST ${limit} cr.CDCLIENTE,COALESCE(c.CLIENTE,c.RAZAO) NOME,
    COUNT(*) TITULOS,SUM(COALESCE(cr.VALOR,0)-COALESCE(cr.TOTALPG,0)) VALOR_EM_ABERTO,
    AVG(CAST(CURRENT_DATE-CAST(cr.DTVENC AS DATE) AS INTEGER)) MEDIA_ATRASO,MIN(cr.DTVENC) VENCIMENTO_MAIS_ANTIGO
    FROM CTARECEBER cr LEFT JOIN CLIENTE c ON c.CDCLIENTE=cr.CDCLIENTE WHERE ${where.join(" AND ")}
    GROUP BY cr.CDCLIENTE,c.CLIENTE,c.RAZAO ORDER BY VALOR_EM_ABERTO DESC`,params);
  return {ok:true,cache_ttl:120,total_em_aberto:dados.reduce((s,x)=>s+Number(x.VALOR_EM_ABERTO||0),0),dados};
}));
router.get("/recompra",run(async(db,req)=>{const f=saleFilter(req);const dados=await query(db,`SELECT FIRST 100 se.CDCLIENTE,${name} NOME,
  COUNT(DISTINCT CAST(se.NRPEDIDO AS VARCHAR(20))||'-'||CAST(se.IDEMPRESA AS VARCHAR(20))) PEDIDOS,
  SUM(COALESCE(se.VLTOTAL,se.SUBTOTAL,0)) FATURAMENTO,MIN(se.DTSAIDA) PRIMEIRA_COMPRA,MAX(se.DTSAIDA) ULTIMA_COMPRA,
  CAST(CAST(MAX(se.DTSAIDA) AS DATE)-CAST(MIN(se.DTSAIDA) AS DATE) AS INTEGER) DIAS_ENTRE_PRIMEIRA_ULTIMA
  FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE WHERE ${f.where}
  GROUP BY se.CDCLIENTE,${name} HAVING COUNT(DISTINCT CAST(se.NRPEDIDO AS VARCHAR(20))||'-'||CAST(se.IDEMPRESA AS VARCHAR(20)))>1
  ORDER BY PEDIDOS DESC,FATURAMENTO DESC`,f.params);return {ok:true,cache_ttl:120,dados};}));
async function inactive(db,req){const days=n(req,"dias",60,1,1460),limit=n(req,"limite",50,1,200);
  const dados=await query(db,`SELECT FIRST ${limit} c.CDCLIENTE,COALESCE(c.CLIENTE,c.RAZAO) NOME,
  MAX(se.DTSAIDA) ULTIMA_COMPRA,CAST(CURRENT_DATE-CAST(MAX(se.DTSAIDA) AS DATE) AS INTEGER) DIAS_SEM_COMPRA,
  COUNT(DISTINCT se.NRPEDIDO) TOTAL_PEDIDOS,SUM(COALESCE(se.VLTOTAL,se.SUBTOTAL,0)) TOTAL_HISTORICO
  FROM CLIENTE c JOIN SAIDAESTOQUE se ON se.CDCLIENTE=c.CDCLIENTE AND se.DTCANCELAMENTO IS NULL
  WHERE (c.INATIVO=0 OR c.INATIVO IS NULL) AND c.CDCLIENTE>0 GROUP BY c.CDCLIENTE,c.CLIENTE,c.RAZAO
  HAVING CAST(CURRENT_DATE-CAST(MAX(se.DTSAIDA) AS DATE) AS INTEGER)>=${days} ORDER BY DIAS_SEM_COMPRA DESC`);
  return {ok:true,cache_ttl:120,dados};}
router.get("/sem-compra",run(inactive));router.get("/inativos",run(inactive));
router.get("/churn",run(async(db,req)=>{const f=saleFilter(req),duration=Math.round((f.end-f.start)/86400000),previous=new Date(f.start);previous.setDate(previous.getDate()-duration);
  const dados=await query(db,`SELECT FIRST 100 se.CDCLIENTE,${name} NOME,MAX(se.DTSAIDA) ULTIMA_COMPRA,
  SUM(COALESCE(se.VLTOTAL,se.SUBTOTAL,0)) FATURAMENTO_ANTERIOR FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
  WHERE se.DTCANCELAMENTO IS NULL AND se.DTSAIDA>=? AND se.DTSAIDA<? AND NOT EXISTS
  (SELECT 1 FROM SAIDAESTOQUE atual WHERE atual.CDCLIENTE=se.CDCLIENTE AND atual.DTCANCELAMENTO IS NULL AND atual.DTSAIDA>=? AND atual.DTSAIDA<?)
  GROUP BY se.CDCLIENTE,${name} ORDER BY FATURAMENTO_ANTERIOR DESC`,[previous,f.start,f.start,f.end]);
  return {ok:true,cache_ttl:120,dados};}));
router.get("/kpis",run(async(db,req)=>{const f=saleFilter(req);const r=(await query(db,`SELECT COUNT(DISTINCT se.CDCLIENTE) CLIENTES_ATIVOS,
  COUNT(DISTINCT se.NRPEDIDO) PEDIDOS,SUM(COALESCE(se.VLTOTAL,se.SUBTOTAL,0)) FATURAMENTO
  FROM SAIDAESTOQUE se LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE WHERE ${f.where}`,f.params))[0]||{};
  const ativos=Number(r.CLIENTES_ATIVOS||0),pedidos=Number(r.PEDIDOS||0),fat=Number(r.FATURAMENTO||0);
  return {ok:true,cache_ttl:120,periodo:{inicio:iso(f.start),fim:iso(new Date(f.end-1)),dias:f.days},
    kpis:{CLIENTES_ATIVOS:ativos,TICKET_MEDIO:ativos?fat/ativos:0,TICKET_MEDIO_PEDIDO:pedidos?fat/pedidos:0,FATURAMENTO:fat}};}));
export default router;
