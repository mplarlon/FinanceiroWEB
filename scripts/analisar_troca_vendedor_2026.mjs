import { withReadOnlyDatabase, query } from "../node-app/server/db.js";

const config = {
  host: "100.92.55.29",
  port: 3050,
  database: "C:\\Administracao\\db\\MIAUTOMEC.FDB",
  user: "SYSDBA",
  password: "masterkey",
  charset: "WIN1252",
};

const pedido = Number(process.argv[2] || 666800);

await withReadOnlyDatabase(async (db) => {
  const candidates = await query(db, `
    SELECT DISTINCT TRIM(rf.RDB$RELATION_NAME) AS TABELA
    FROM RDB$RELATION_FIELDS rf
    JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
    WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
      AND r.RDB$VIEW_BLR IS NULL
      AND EXISTS (
        SELECT 1 FROM RDB$RELATION_FIELDS p
        WHERE p.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
          AND p.RDB$FIELD_NAME = 'NRPEDIDO'
      )
      AND EXISTS (
        SELECT 1 FROM RDB$RELATION_FIELDS v
        WHERE v.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
          AND (v.RDB$FIELD_NAME CONTAINING 'VEND' OR v.RDB$FIELD_NAME = 'CDVEND')
      )
    ORDER BY 1
  `);

  for (const candidate of candidates) {
    const metadata = await query(db, `
      SELECT TRIM(RDB$FIELD_NAME) AS CAMPO
      FROM RDB$RELATION_FIELDS
      WHERE RDB$RELATION_NAME = ?
      ORDER BY RDB$FIELD_POSITION
    `, [candidate.TABELA]);
    const fields = metadata.map((row) => row.CAMPO).filter((field) =>
      /^(NRPEDIDO|IDEMPRESA|DT|DATA|HORA|SIST_ALT|.*VEND.*|CDVEND$)/i.test(field)
    );
    const select = [...new Set(fields)].map((field) => `"${field}"`).join(", ");
    try {
      const rows = await query(db, `SELECT FIRST 20 ${select} FROM "${candidate.TABELA}" WHERE NRPEDIDO = ?`, [pedido]);
      if (rows.length) console.log(JSON.stringify({ tabela: candidate.TABELA, rows }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ tabela: candidate.TABELA, erro: error.message }));
    }
  }
}, config);
