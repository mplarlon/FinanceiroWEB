import { withDatabase, query } from "../server/db.js";

const rows = await withDatabase(async (db) => {
  const titles = await query(
    db,
    `SELECT FIRST 20 CONTROLE, IDEMPRESA, NOTAFISCAL, NRDOC, NRDOC2, PARCELA, STATUS,
            DTEMISSAO, CDRECGRUPO, CODPAGTO, TPPAGTO, ORIGEM, DTINCLUSAO
     FROM CTAPAGAR
     WHERE TRIM(NOTAFISCAL) = '60361' OR TRIM(NRDOC) STARTING WITH '60361'
     ORDER BY CONTROLE DESC`,
  );
  const manual = await query(
    db,
    `SELECT FIRST 12 CONTROLE, IDEMPRESA, NOTAFISCAL, NRDOC, PARCELA, STATUS,
            DTEMISSAO, CDRECGRUPO, CODPAGTO, TPPAGTO, ORIGEM, DTINCLUSAO, DTPAGTO
     FROM CTAPAGAR
     WHERE ORIGEM = 'LANCAMENTO MANUAL'
     ORDER BY CONTROLE DESC`,
  );
  const acordo = await query(
    db,
    `SELECT TRIM(RDB$RELATION_NAME) AS NOME
     FROM RDB$RELATIONS
     WHERE TRIM(RDB$RELATION_NAME) STARTING WITH 'DASH_FIN'`,
  );
  return { titles, manual, acordo };
});
console.log(JSON.stringify(rows, null, 2));
