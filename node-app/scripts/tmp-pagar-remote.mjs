import { withDatabase, query } from "../server/db.js";

const remote = {
  type: "firebird",
  host: "100.92.55.29",
  port: 3050,
  database: "C:\\Administracao\\db\\MIAUTOMEC.FDB",
  user: "SYSDBA",
  password: "masterkey",
  charset: "WIN1252",
  role: "",
};

const rows = await withDatabase(async (db) => {
  const titles = await query(
    db,
    `SELECT FIRST 20 CONTROLE, IDEMPRESA, NOTAFISCAL, NRDOC, NRDOC2, PARCELA, STATUS,
            DTEMISSAO, CDRECGRUPO, CODPAGTO, TPPAGTO, ORIGEM
     FROM CTAPAGAR
     WHERE TRIM(NOTAFISCAL) = '60361' OR TRIM(NRDOC) STARTING WITH '60361'
     ORDER BY CONTROLE DESC`,
  );
  const manual = await query(
    db,
    `SELECT FIRST 8 CONTROLE, IDEMPRESA, NOTAFISCAL, NRDOC, PARCELA, STATUS,
            DTEMISSAO, CDRECGRUPO, CODPAGTO, TPPAGTO, ORIGEM, DTINCLUSAO
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
}, remote);
console.log(JSON.stringify(rows, null, 2));
