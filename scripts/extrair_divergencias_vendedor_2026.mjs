import fs from "node:fs/promises";
import path from "node:path";
import { withReadOnlyDatabase, query } from "../node-app/server/db.js";

const config = {
  host: "100.92.55.29",
  port: 3050,
  database: "C:\\Administracao\\db\\MIAUTOMEC.FDB",
  user: "SYSDBA",
  password: "masterkey",
  charset: "WIN1252",
};

const output = path.resolve("outputs", "trocas-vendedores-2026", "dados_divergencias_2026.json");
const where = `
  WHERE s.DTSAIDA >= DATE '2026-01-01'
    AND s.DTSAIDA < DATE '2027-01-01'
    AND s.CDVENDEDOR IS DISTINCT FROM c.CDVENDEDOR
`;

await withReadOnlyDatabase(async (db) => {
  const detalhes = await query(db, `
    SELECT
      s.NRPEDIDO,
      s.IDEMPRESA,
      s.DTSAIDA,
      s.HORAPED,
      s.DTALTER,
      s.CDCLIENTE,
      s.CLIENTE,
      c.CDVENDEDOR AS CDVENDEDOR_CLIENTE,
      vo.VENDEDOR AS VENDEDOR_CLIENTE,
      s.CDVENDEDOR AS CDVENDEDOR_PEDIDO,
      vn.VENDEDOR AS VENDEDOR_PEDIDO,
      s.VLTOTAL,
      s.STATUS,
      CASE WHEN s.DTCANCELAMENTO IS NOT NULL OR EXISTS (
        SELECT 1 FROM PEDCANCEL pc
        WHERE pc.NRPEDIDO = s.NRPEDIDO AND pc.IDEMPRESA = s.IDEMPRESA
      ) THEN 1 ELSE 0 END AS CANCELADO,
      s.DTCANCELAMENTO,
      s.SIST_ALT
    FROM SAIDAESTOQUE s
    JOIN CLIENTE c ON c.CDCLIENTE = s.CDCLIENTE
    LEFT JOIN VENDEDOR vo ON vo.CDVENDEDOR = c.CDVENDEDOR
    LEFT JOIN VENDEDOR vn ON vn.CDVENDEDOR = s.CDVENDEDOR
    ${where}
    ORDER BY s.DTSAIDA, s.NRPEDIDO
  `, [], { timeoutMs: 120000 });

  const combinacoes = await query(db, `
    SELECT
      c.CDVENDEDOR AS CDVENDEDOR_CLIENTE,
      COALESCE(vo.VENDEDOR, '(sem vendedor)') AS VENDEDOR_CLIENTE,
      s.CDVENDEDOR AS CDVENDEDOR_PEDIDO,
      COALESCE(vn.VENDEDOR, '(sem vendedor)') AS VENDEDOR_PEDIDO,
      COUNT(*) AS QTD_PEDIDOS,
      SUM(s.VLTOTAL) AS VALOR_TOTAL,
      MIN(s.DTSAIDA) AS PRIMEIRA_DATA,
      MAX(s.DTSAIDA) AS ULTIMA_DATA
    FROM SAIDAESTOQUE s
    JOIN CLIENTE c ON c.CDCLIENTE = s.CDCLIENTE
    LEFT JOIN VENDEDOR vo ON vo.CDVENDEDOR = c.CDVENDEDOR
    LEFT JOIN VENDEDOR vn ON vn.CDVENDEDOR = s.CDVENDEDOR
    ${where}
    GROUP BY c.CDVENDEDOR, vo.VENDEDOR, s.CDVENDEDOR, vn.VENDEDOR
    ORDER BY QTD_PEDIDOS DESC, VALOR_TOTAL DESC
  `, [], { timeoutMs: 120000 });

  const meses = await query(db, `
    SELECT
      EXTRACT(MONTH FROM s.DTSAIDA) AS MES,
      COUNT(*) AS QTD_PEDIDOS,
      SUM(s.VLTOTAL) AS VALOR_TOTAL,
      SUM(CASE WHEN s.DTCANCELAMENTO IS NOT NULL OR EXISTS (
        SELECT 1 FROM PEDCANCEL pc
        WHERE pc.NRPEDIDO = s.NRPEDIDO AND pc.IDEMPRESA = s.IDEMPRESA
      ) THEN 1 ELSE 0 END) AS QTD_CANCELADOS
    FROM SAIDAESTOQUE s
    JOIN CLIENTE c ON c.CDCLIENTE = s.CDCLIENTE
    ${where}
    GROUP BY EXTRACT(MONTH FROM s.DTSAIDA)
    ORDER BY 1
  `, [], { timeoutMs: 120000 });

  const payload = {
    extraidoEm: new Date().toISOString(),
    fonte: "Firebird remoto 100.92.55.29:C:\\Administracao\\db\\MIAUTOMEC.FDB (somente leitura)",
    criterio: "Vendedor gravado em SAIDAESTOQUE diferente do vendedor atualmente vinculado ao CLIENTE",
    detalhes,
    combinacoes,
    meses,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload), "utf8");
  console.log(JSON.stringify({ output, detalhes: detalhes.length, combinacoes: combinacoes.length, meses: meses.length }));
}, config);
