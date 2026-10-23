import { loadDatabaseConfig } from "../config.js";
import { query } from "../db.js";

const cache = new Map();

export function itemCostSql(columns, itemAlias = "sp", productAlias = "p") {
  const parts = [];
  if (columns?.has("VLCUSTOREAL")) parts.push(`${itemAlias}.VLCUSTOREAL`);
  if (columns?.has("VLCUSTO")) parts.push(`${itemAlias}.VLCUSTO`);
  if (productAlias && columns?.has("VLCUSTOMEDIO")) parts.push(`${productAlias}.VLCUSTOMEDIO`);
  if (!parts.length) parts.push("0");
  return `COALESCE(${parts.join(",")},0)`;
}

export async function loadSaleCostColumns(db) {
  const key = String(loadDatabaseConfig().database || "").toUpperCase();
  if (cache.has(key)) return cache.get(key);
  const rows = await query(
    db,
    `SELECT TRIM(RF.RDB$RELATION_NAME) TABELA, TRIM(RF.RDB$FIELD_NAME) CAMPO
       FROM RDB$RELATION_FIELDS RF
      WHERE TRIM(RF.RDB$RELATION_NAME) IN ('SAIDAPRODUTO', 'PRODUTO')
        AND TRIM(RF.RDB$FIELD_NAME) IN ('VLCUSTOREAL', 'VLCUSTO', 'VLCUSTOMEDIO')`,
  );
  const columns = new Set();
  for (const row of rows) {
    const table = String(row.TABELA || "").trim();
    const name = String(row.CAMPO || "").trim();
    if (table === "SAIDAPRODUTO" && (name === "VLCUSTOREAL" || name === "VLCUSTO")) columns.add(name);
    if (table === "PRODUTO" && name === "VLCUSTOMEDIO") columns.add(name);
  }
  cache.set(key, columns);
  return columns;
}

export async function saleItemCost(db, itemAlias = "sp", productAlias = "p") {
  return itemCostSql(await loadSaleCostColumns(db), itemAlias, productAlias);
}
