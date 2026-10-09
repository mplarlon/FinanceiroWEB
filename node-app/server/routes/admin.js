import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
const fields = `nf.NRDOC,nf.IDNF,nf.IDEMPRESA,nf.NRPEDIDO,nf.CDCLIENTE,nf.STATUS,
  nf.NFE_EMITIDA,nf.ACORDO_NF,nf.IMPRESSO,nf.ESTOQUE_ATUALIZADO,nf.NFE_CANCELADA,
  nf.CANCELAR_NFE,nf.SIST_ALT,CAST(nf.DTEMISS AS DATE) AS DTEMISS,
  CAST(nf.DATASAIDA AS DATE) AS DATASAIDA,nf.VALOR,nf.VLTOTAL,nf.ENTRADA,nf.DEVOLUCAO`;
const run = fn => async (req, res) => {
  try { res.json(await withDatabase(db => fn(db, req))); }
  catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
};

router.get("/nf-teste/listar", run(async db => {
  const registros = await query(db, `SELECT nf.IDNF,TRIM(nf.NRDOC) AS NRDOC,nf.IDEMPRESA,
    CAST(nf.DTALTER AS DATE) AS DTALTER,CAST(nf.DTEMISS AS DATE) AS DTEMISS,nf.STATUS,
    nf.NFE_EMITIDA,nf.ACORDO_NF,TRIM(COALESCE(nf.SIST_ALT,'')) AS SIST_ALT,
    CAST(nf.OBSERVACAO AS VARCHAR(80)) AS OBS FROM NOTAFISCAL nf
    WHERE CAST(nf.DTALTER AS DATE)=CURRENT_DATE ORDER BY nf.IDNF`);
  return { ok: true, total: registros.length, registros };
}));

router.get("/nf-teste/comparar", run(async (db, req) => {
  const nrdoc = String(req.query.nrdoc || "000012219").trim();
  const referencia = (await query(db, `SELECT ${fields} FROM NOTAFISCAL nf WHERE TRIM(nf.NRDOC)=?`, [nrdoc]))[0] || {};
  const nossa = (await query(db, `SELECT FIRST 1 ${fields} FROM NOTAFISCAL nf
    WHERE CAST(nf.DTALTER AS DATE)=CURRENT_DATE AND nf.OBSERVACAO CONTAINING 'Fechamento Carteira'
    ORDER BY nf.IDNF`))[0] || {};
  const diferencas = {};
  for (const key of new Set([...Object.keys(referencia), ...Object.keys(nossa)])) {
    const ref = referencia[key] ?? null, current = nossa[key] ?? null;
    if (String(ref) !== String(current)) diferencas[key] = { [`referencia_${nrdoc}`]: ref, nossa_nf: current };
  }
  return { ok: true, referencia, nossa, diferencas };
}));

router.post("/nf-teste/limpar", async (req, res) => {
  try {
    const result = await withWriteTransaction(async tx => {
      const requested = Array.isArray(req.body?.idnfs) ? req.body.idnfs.map(Number).filter(Number.isInteger) : [];
      const rows = requested.length
        ? await tx.query(`SELECT nf.IDNF,TRIM(COALESCE(nf.NRDOC,'')) AS NRDOC FROM NOTAFISCAL nf
            WHERE nf.IDNF IN (${requested.map(() => "?").join(",")})`, requested)
        : await tx.query(`SELECT nf.IDNF,TRIM(COALESCE(nf.NRDOC,'')) AS NRDOC FROM NOTAFISCAL nf
            WHERE CAST(nf.DTALTER AS DATE)=CURRENT_DATE
              AND nf.OBSERVACAO CONTAINING 'Fechamento Carteira'`);
      if (!rows.length) return { ok:true, removidas:0, msg:"Nenhuma NF encontrada com esses critérios." };
      const ids=rows.map(row=>Number(row.IDNF)), docs=rows.map(row=>String(row.NRDOC||"").trim()).filter(Boolean);
      const idMarks=ids.map(()=>"?").join(","), docMarks=docs.map(()=>"?").join(",");
      const count=async(table,field,values,marks)=>Number((await tx.singleton(
        `SELECT COUNT(*) AS TOTAL FROM ${table} WHERE ${field} IN (${marks})`,values))?.TOTAL||0);
      const nfp=await count("NOTAFIS_PRODUTO","IDNF",ids,idMarks);
      const cta=await count("CTA_NF","IDNF",ids,idMarks);
      let saida=0,receber=0;
      if(docs.length){saida=await count("SAIDAPRODUTO","TRIM(NRDOC)",docs,docMarks);receber=await count("CTARECEBER","TRIM(NRDOC)",docs,docMarks)}
      await tx.execute(`DELETE FROM NOTAFIS_PRODUTO WHERE IDNF IN (${idMarks})`,ids);
      if(docs.length){await tx.execute(`UPDATE SAIDAPRODUTO SET NRDOC=NULL,DTALTER=CURRENT_TIMESTAMP WHERE TRIM(NRDOC) IN (${docMarks})`,docs);await tx.execute(`UPDATE CTARECEBER SET NRDOC=CAST(NRPEDIDO AS VARCHAR(20)),ACORDO_NF=0,VALOR_ACORDO_NF=0,DTALTER=CURRENT_TIMESTAMP WHERE TRIM(NRDOC) IN (${docMarks})`,docs)}
      await tx.execute(`DELETE FROM CTA_NF WHERE IDNF IN (${idMarks})`,ids);
      await tx.execute(`DELETE FROM NOTAFISCAL WHERE IDNF IN (${idMarks})`,ids);
      return {ok:true,removidas:ids.length,nfp_removidas:nfp,cta_nf_removidas:cta,
        saidaproduto_revertidas:saida,ctareceber_revertidas:receber,idnfs:ids,nrdocs:docs};
    });
    res.json(result);
  } catch(error) { res.status(500).json({ok:false,erro:error.message}); }
});

export default router;
