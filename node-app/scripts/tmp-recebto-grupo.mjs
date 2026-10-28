import { withDatabase, query } from "../server/db.js";

const rows = await withDatabase(async (db) => {
  const forms = await query(
    db,
    `SELECT CDRECEBTO, TRIM(RECEBTO) AS RECEBTO, CDGRUPO, STATUS, STATUS_PAGTO, SAIR_PAGTO
     FROM RECEBTO
     WHERE COALESCE(INATIVO,0)=0 AND COALESCE(SAIR_PAGTO,0)=-1
     ORDER BY RECEBTO`,
  );
  const triggers = await query(
    db,
    `SELECT TRIM(RDB$TRIGGER_NAME) AS NOME, RDB$TRIGGER_TYPE AS TIPO
     FROM RDB$TRIGGERS
     WHERE TRIM(RDB$RELATION_NAME)='CTAPAGAR' AND COALESCE(RDB$TRIGGER_INACTIVE,0)=0`,
  );
  return { forms, triggers };
});
console.log(JSON.stringify(rows, null, 2));
