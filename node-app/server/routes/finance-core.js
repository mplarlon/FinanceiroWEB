import express from "express";
import { query, withDatabase } from "../db.js";

const router = express.Router();
const run = fn => async (req, res) => {
  try { res.json(await withDatabase(db => fn(db, req))); }
  catch (error) { res.status(error.status || 500).json({ ok: false, erro: error.message }); }
};

router.get("/fluxo-caixa", run(async (db, req) => {
  const dias = Math.max(1, Math.min(1460, Number(req.query.dias || 30)));
  const dados = await query(db, `SELECT CAST(DTLANCAMENTO AS DATE) AS DIA,
    SUM(CASE WHEN VALOR>0 THEN VALOR ELSE 0 END) AS ENTRADAS,
    SUM(CASE WHEN VALOR<0 THEN ABS(VALOR) ELSE 0 END) AS SAIDAS,
    SUM(VALOR) AS SALDO_DIA FROM MOV_BANCARIO
    WHERE DTLANCAMENTO>=DATEADD(-${dias} DAY TO CURRENT_DATE)
    GROUP BY CAST(DTLANCAMENTO AS DATE) ORDER BY DIA`);
  return { ok: true, dados };
}));

router.get("/saldo-bancos", run(async db => ({ ok: true, dados: await query(db, `SELECT FIRST 20
  c.CDBANCO, c.AGENCIA, c.NUMCONTA, c.CONTROLE, CAST(c.DTFINAL AS DATE) AS DTFINAL,
  b.BANCO AS BANCO,
  c.SALDOFINAL AS SALDO FROM CONCILIACAO c LEFT JOIN BANCO b ON b.CDBANCO = c.CDBANCO
  JOIN CONTACORRENTE cc ON cc.CDBANCO = c.CDBANCO
    AND COALESCE(TRIM(cc.AGENCIA), '') = COALESCE(TRIM(c.AGENCIA), '')
    AND COALESCE(TRIM(cc.NUMCONTA), '') = COALESCE(TRIM(c.NUMCONTA), '')
  WHERE NOT EXISTS (SELECT 1 FROM CONCILIACAO c2 WHERE c2.CDBANCO = c.CDBANCO
    AND COALESCE(TRIM(c2.AGENCIA), '') = COALESCE(TRIM(c.AGENCIA), '')
    AND COALESCE(TRIM(c2.NUMCONTA), '') = COALESCE(TRIM(c.NUMCONTA), '')
    AND (CAST(c2.DTFINAL AS DATE) > CAST(c.DTFINAL AS DATE) OR
      (CAST(c2.DTFINAL AS DATE) = CAST(c.DTFINAL AS DATE) AND c2.CONTROLE > c.CONTROLE)))
  ORDER BY c.SALDOFINAL DESC`) })));

router.get("/historico", run(async (db, req) => {
  const tipo = String(req.query.tipo || "receber").toLowerCase();
  if (!["receber", "pagar"].includes(tipo)) {
    const error = new Error("Tipo financeiro invalido."); error.status = 400; throw error;
  }
  const limite = Math.max(1, Math.min(1000, Number(req.query.limite || 500)));
  const exists = await query(db, `SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)='DASH_FIN_AUDIT'`);
  if (!exists.length) return { ok: true, tipo, dados: [] };
  const table = tipo === "receber" ? "CTARECEBER" : "CTAPAGAR";
  const personJoin = tipo === "receber" ? "LEFT JOIN CLIENTE p ON p.CDCLIENTE=t.CDCLIENTE" :
    "LEFT JOIN FORNECEDOR p ON p.CDFORNECEDOR=t.CDFORNECEDOR";
  const personName = tipo === "receber" ?
    "COALESCE(p.CLIENTE,p.RAZAO)" :
    "COALESCE(p.FORNECEDOR,p.FANTASIA)";
  const dados = await query(db, `SELECT FIRST ${limite} a.IDAUDIT,a.OPERACAO,a.TIPO,a.CONTROLE,a.IDEMPRESA,
    a.DETALHE,a.USUARIO_ID,CAST(a.DATAHORA AS DATE) AS DATAHORA,
    SUBSTRING(CAST(a.DATAHORA AS VARCHAR(24)) FROM 12 FOR 8) AS HORA,cfg.NOMEEMPRESA AS EMPRESA,
    ${personName} AS PESSOA,COALESCE(u.NOMECOMPLETO,u.LOGIN) AS USUARIO
    FROM DASH_FIN_AUDIT a LEFT JOIN ${table} t ON t.CONTROLE=a.CONTROLE AND t.IDEMPRESA=a.IDEMPRESA
    ${personJoin} LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA=a.IDEMPRESA
    LEFT JOIN USUARIOS u ON u.IDUSUARIO=a.USUARIO_ID WHERE a.TIPO=?
    ORDER BY a.DATAHORA DESC,a.IDAUDIT DESC`, [tipo]);
  return { ok: true, tipo, dados };
}));

export default router;
