import { query, withDatabase } from "./server/db.js";

const r = await withDatabase(async (db) => {
  const gens = await query(db, `
    SELECT TRIM(RDB$GENERATOR_NAME) AS NOME
      FROM RDB$GENERATORS
     WHERE RDB$SYSTEM_FLAG = 0
       AND (RDB$GENERATOR_NAME CONTAINING 'CANAL'
         OR RDB$GENERATOR_NAME CONTAINING 'PRODUTO_X')
  `);
  const trg = await query(db, `
    SELECT TRIM(RDB$TRIGGER_NAME) AS NOME,
           CAST(SUBSTRING(RDB$TRIGGER_SOURCE FROM 1 FOR 1500) AS VARCHAR(1500)) AS SRC
      FROM RDB$TRIGGERS
     WHERE RDB$TRIGGER_NAME STARTING WITH 'PRODUTO_X_CANAL'
  `);
  const maxId = await query(db, "SELECT MAX(ID) AS M FROM PRODUTO_X_CANAL");
  const tipicos = await query(db, `
    SELECT FIRST 8 ID_CANAL, COUNT(*) AS QTD
      FROM PRODUTO_X_CANAL
     GROUP BY ID_CANAL
     ORDER BY 2 DESC
  `);
  const empresa = await query(db, "SELECT FIRST 1 IDEMPRESA FROM PRODUTO_X_CANAL");
  const unEx = await query(db, `
    SELECT FIRST 5 CDPRODUTO, UNIDADEDEMEDIDA, CDUNIDVENDA
      FROM PRODUTO
     WHERE COALESCE(UNIDADEDEMEDIDA, '') <> ''
  `);
  return { gens, trg, maxId, tipicos, empresa, unEx };
});

console.log(JSON.stringify({
  gens: r.gens,
  maxId: r.maxId,
  tipicos: r.tipicos,
  empresa: r.empresa,
  unEx: r.unEx,
}, null, 2));
for (const t of r.trg) {
  console.log("---", t.NOME);
  console.log(t.SRC);
}
