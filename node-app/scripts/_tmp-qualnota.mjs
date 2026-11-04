import { withDatabase, query } from "../server/db.js";

const ids = await withDatabase(db => query(db, `
  SELECT FIRST 15 n.IDNF, TRIM(n.NRDOC) AS NRDOC
  FROM NOTAFISCAL n
  WHERE COALESCE(n.STATUS, 0) NOT IN (2, 9) AND COALESCE(n.NFCE, 0) = 0
  ORDER BY n.DTEMISS DESC, n.IDNF DESC
`));

for (const nota of ids) {
  try {
    const rows = await withDatabase(db => query(db, `
      SELECT TRIM(COALESCE(c.CLIENTE, '')) AS CLIENTE
      FROM NOTAFISCAL n
      LEFT JOIN CLIENTE c ON c.CDCLIENTE = n.CDCLIENTE
      WHERE n.IDNF = ?
    `, [nota.IDNF]));
    console.log("OK", String(nota.NRDOC).trim(), JSON.stringify(rows[0].CLIENTE));
  } catch (error) {
    console.log("ERRO", String(nota.NRDOC).trim(), nota.IDNF, error.message);
  }
}
