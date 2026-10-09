import express from "express";
import { query, withDatabase } from "../db.js";
const router=express.Router(), num=x=>Number(x||0);
const run=fn=>async(req,res)=>{try{res.json(await withDatabase(db=>fn(db,req)));}catch(e){res.status(500).json({ok:false,erro:e.message});}};
function period(req){const days=Math.max(1,Math.min(1460,Number(req.query.dias||30))),today=new Date();today.setHours(0,0,0,0);
 const start=req.query.data_inicio?new Date(`${req.query.data_inicio}T00:00:00`):new Date(today);if(!req.query.data_inicio)start.setDate(start.getDate()-days+1);
 const end=req.query.data_fim?new Date(`${req.query.data_fim}T00:00:00`):new Date(today);end.setDate(end.getDate()+1);return{start,end,days};}
function filter(req,prefix,date){const p=period(req),where=[`${date}>=?`,`${date}<?`],params=[p.start,p.end];
 for(const[arg,col]of[["loja",`${prefix}.IDEMPRESA`],["banco",`${prefix}.CDBANCO`]])if(req.query[arg]){where.push(`${col}=?`);params.push(Number(req.query[arg]));}
 return{...p,where:where.join(" AND "),params};}
router.get("/options",run(async db=>({ok:true,cache_ttl:120,
 lojas:await query(db,`SELECT FIRST 100 IDEMPRESA ID,NOMEEMPRESA NOME FROM CONFIGURACAO ORDER BY IDEMPRESA`),
 bancos:await query(db,`SELECT FIRST 100 cc.CDBANCO ID,b.BANCO NOME,cc.NUMCONTA FROM CONTACORRENTE cc LEFT JOIN BANCO b ON b.CDBANCO=cc.CDBANCO ORDER BY b.BANCO,cc.AGENCIA,cc.NUMCONTA`),
 formas_pagamento:await query(db,`SELECT FIRST 200 CDRECEBTO ID,RECEBTO NOME FROM RECEBTO WHERE INATIVO=0 OR INATIVO IS NULL ORDER BY RECEBTO`),
 clientes:await query(db,`SELECT CDCLIENTE ID,COALESCE(CLIENTE,RAZAO) NOME FROM CLIENTE WHERE INATIVO=0 OR INATIVO IS NULL ORDER BY CLIENTE`),
 fornecedores:await query(db,`SELECT CDFORNECEDOR ID,COALESCE(FORNECEDOR,FANTASIA) NOME FROM FORNECEDOR WHERE INATIVO=0 OR INATIVO IS NULL ORDER BY FORNECEDOR`),
 categorias:await query(db,`SELECT FIRST 200 CDCONTA ID,COALESCE(CONTA,CDCONTA) NOME FROM CONTAS ORDER BY CONTA`),
 vendedores:await query(db,`SELECT FIRST 200 CDVENDEDOR ID,VENDEDOR NOME FROM VENDEDOR WHERE INATIVO=0 OR INATIVO IS NULL ORDER BY VENDEDOR`)
})));
router.get("/views",(_q,res)=>res.json({ok:true,arquivo:"financial_dashboard_views.sql",views:["VW_DASH_FIN_TITULOS","VW_DASH_FIN_MOVIMENTO","VW_DASH_FIN_VENDAS","VW_DASH_FIN_DRE"]}));
router.get("/summary",run(async(db,req)=>{const r=filter(req,"cr","cr.DTVENC"),p=filter(req,"cp","cp.DTVENC"),m=filter(req,"mb","mb.DTLANCAMENTO");
 const rec=(await query(db,`SELECT SUM(CASE WHEN STATUS=1 THEN COALESCE(DIVIDA,VALOR,0) ELSE 0 END) TOTAL_ABERTO,
 SUM(CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN COALESCE(DIVIDA,VALOR,0) ELSE 0 END) TOTAL_VENCIDO,
 SUM(CASE WHEN STATUS=1 AND DTVENC>=CURRENT_DATE THEN COALESCE(DIVIDA,VALOR,0) ELSE 0 END) TOTAL_A_VENCER,
 COUNT(CASE WHEN STATUS=1 THEN 1 END) QTD_ABERTO,COUNT(CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN 1 END) QTD_VENCIDO
 FROM CTARECEBER cr WHERE ${r.where}`,r.params))[0]||{};
 const pag=(await query(db,`SELECT SUM(CASE WHEN STATUS=1 THEN COALESCE(VALOR,TOTAL,0) ELSE 0 END) TOTAL_ABERTO,
 SUM(CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN COALESCE(VALOR,TOTAL,0) ELSE 0 END) TOTAL_VENCIDO,
 SUM(CASE WHEN STATUS=1 AND DTVENC>=CURRENT_DATE THEN COALESCE(VALOR,TOTAL,0) ELSE 0 END) TOTAL_A_VENCER,
 COUNT(CASE WHEN STATUS=1 THEN 1 END) QTD_ABERTO,COUNT(CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN 1 END) QTD_VENCIDO
 FROM CTAPAGAR cp WHERE ${p.where}`,p.params))[0]||{};
 const fluxo=(await query(db,`SELECT SUM(CASE WHEN VALOR>0 THEN VALOR ELSE 0 END) ENTRADAS,
 SUM(CASE WHEN VALOR<0 THEN ABS(VALOR) ELSE 0 END) SAIDAS,SUM(COALESCE(VALOR,0)) SALDO_FINAL
 FROM MOV_BANCARIO mb WHERE ${m.where}`,m.params))[0]||{};
 const alertas=[];if(num(rec.TOTAL_VENCIDO)>0)alertas.push({tipo:"contas_vencidas",nivel:"danger",titulo:"Contas a receber vencidas",valor:num(rec.TOTAL_VENCIDO)});
 if(num(pag.TOTAL_VENCIDO)>0)alertas.push({tipo:"pagamentos_vencidos",nivel:"warning",titulo:"Contas a pagar vencidas",valor:num(pag.TOTAL_VENCIDO)});
 return{ok:true,cache_ttl:120,periodo:{inicio:r.start.toISOString().slice(0,10),fim:new Date(r.end-1).toISOString().slice(0,10),dias:r.days},
 contas_receber:{total_em_aberto:num(rec.TOTAL_ABERTO),total_vencido:num(rec.TOTAL_VENCIDO),total_a_vencer:num(rec.TOTAL_A_VENCER),qtd_aberto:num(rec.QTD_ABERTO),qtd_vencido:num(rec.QTD_VENCIDO)},
 contas_pagar:{total_em_aberto:num(pag.TOTAL_ABERTO),total_vencido:num(pag.TOTAL_VENCIDO),total_a_vencer:num(pag.TOTAL_A_VENCER),qtd_aberto:num(pag.QTD_ABERTO),qtd_vencido:num(pag.QTD_VENCIDO)},
 fluxo_caixa:{entradas:num(fluxo.ENTRADAS),saidas:num(fluxo.SAIDAS),saldo_final:num(fluxo.SALDO_FINAL)},alertas};}));
router.get("/charts",run(async(db,req)=>{const r=filter(req,"cr","cr.DTVENC"),p=filter(req,"cp","cp.DTVENC"),m=filter(req,"mb","mb.DTLANCAMENTO");
 return{ok:true,cache_ttl:120,
 receber_status:await query(db,`SELECT CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN 'Vencido' WHEN STATUS=1 THEN 'A vencer' ELSE 'Recebido' END STATUS,COUNT(*) QTD,SUM(COALESCE(DIVIDA,VALOR,0)) TOTAL FROM CTARECEBER cr WHERE ${r.where} GROUP BY 1 ORDER BY 1`,r.params),
 pagar_status:await query(db,`SELECT CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN 'Vencido' WHEN STATUS=1 THEN 'A vencer' ELSE 'Pago' END STATUS,COUNT(*) QTD,SUM(COALESCE(VALOR,TOTAL,0)) TOTAL FROM CTAPAGAR cp WHERE ${p.where} GROUP BY 1 ORDER BY 1`,p.params),
 fluxo_diario:await query(db,`SELECT CAST(DTLANCAMENTO AS DATE) DIA,SUM(CASE WHEN VALOR>0 THEN VALOR ELSE 0 END) ENTRADAS,SUM(CASE WHEN VALOR<0 THEN ABS(VALOR) ELSE 0 END) SAIDAS,SUM(COALESCE(VALOR,0)) SALDO_DIA FROM MOV_BANCARIO mb WHERE ${m.where} GROUP BY CAST(DTLANCAMENTO AS DATE) ORDER BY DIA`,m.params),
 despesas_categoria:await query(db,`SELECT FIRST 20 COALESCE(c.CONTA,cp.CDCONTA,'Sem categoria') CATEGORIA,COUNT(*) QTD,SUM(COALESCE(cp.VLPAGTO,cp.VALOR,cp.TOTAL,0)) TOTAL FROM CTAPAGAR cp LEFT JOIN CONTAS c ON c.CDCONTA=cp.CDCONTA WHERE ${p.where} GROUP BY c.CONTA,cp.CDCONTA ORDER BY TOTAL DESC`,p.params),
 inadimplentes:await query(db,`SELECT FIRST 20 cr.CDCLIENTE ID,COALESCE(c.CLIENTE,c.RAZAO) CLIENTE,COUNT(*) TITULOS,SUM(COALESCE(cr.DIVIDA,cr.VALOR,0)) TOTAL_VENCIDO FROM CTARECEBER cr LEFT JOIN CLIENTE c ON c.CDCLIENTE=cr.CDCLIENTE WHERE cr.STATUS=1 AND cr.DTVENC<CURRENT_DATE AND ${r.where} GROUP BY cr.CDCLIENTE,c.CLIENTE,c.RAZAO ORDER BY TOTAL_VENCIDO DESC`,r.params)
 };}));
export default router;
