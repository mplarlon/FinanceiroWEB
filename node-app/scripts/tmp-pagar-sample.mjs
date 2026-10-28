import { withDatabase, query } from "../server/db.js";

const rows = await withDatabase(async (db) => {
  const sample = await query(
    db,
    `SELECT FIRST 15 CONTROLE, NOTAFISCAL, NRDOC, PARCELA, STATUS, DTEMISSAO, CDRECGRUPO, CODPAGTO, TPPAGTO, ORIGEM
     FROM CTAPAGAR
     WHERE NRDOC CONTAINING '-'
     ORDER BY CONTROLE DESC`,
  );
  const plain = await query(
    db,
    `SELECT FIRST 8 CONTROLE, NOTAFISCAL, NRDOC, PARCELA, ORIGEM
     FROM CTAPAGAR
     WHERE NOTAFISCAL IS NOT NULL AND NRDOC IS NOT NULL AND TRIM(NRDOC) = TRIM(NOTAFISCAL)
       AND ORIGEM IS DISTINCT FROM 'LANCAMENTO MANUAL'
     ORDER BY CONTROLE DESC`,
  );
  const docSql = await query(
    db,
    `SELECT FIRST 5
        CAST(COALESCE(t.NRDOC,t.NOTAFISCAL,t.NRDOC2) AS VARCHAR(40)) AS DOCUMENTO,
        t.NOTAFISCAL, t.NRDOC, t.PARCELA
     FROM CTAPAGAR t
     WHERE t.NRDOC CONTAINING '-'
     ORDER BY t.CONTROLE DESC`,
  );
  const recentQuit = await query(
    db,
    `SELECT FIRST 10 CONTROLE, NRDOC, STATUS, CODPAGTO, TPPAGTO, DTPAGTO, ORIGEM,
            (SELECT RECEBTO FROM RECEBTO r WHERE r.CDRECEBTO = t.CODPAGTO) AS FORMA_COD,
            (SELECT RECEBTO FROM RECEBTO r WHERE r.CDRECEBTO = t.TPPAGTO) AS FORMA_TP
     FROM CTAPAGAR t
     WHERE t.STATUS = 2 AND t.DTPAGTO >= '2026-10-01'
     ORDER BY t.DTPAGTO DESC`,
  );
  return { sample, plain, docSql, recentQuit };
});
console.log(JSON.stringify(rows, null, 2));
