import { loadDatabaseConfig } from "../config.js";
import { query } from "../db.js";

const cache = new Map();

export function itemCostSql(columns, itemAlias = "sp", productAlias = "p") {
  const parts = [];
  // Bancos legados podem conter sentinelas negativas (por exemplo,
  // -9223372.036855) nos custos do item. Elas não representam custo e, se
  // usadas no lucro, transformam a subtração em um ganho artificial.
  const positive = (expression) =>
    `CASE WHEN ${expression}>0 THEN ${expression} ELSE NULL END`;
  // Há também sentinelas positivas (ex.: 51371 para um item vendido a 0,49).
  // O limite amplo de 100x o preço só elimina dados tecnicamente impossíveis,
  // preservando vendas reais feitas abaixo do custo.
  const saneItemCost = (expression) =>
    `CASE WHEN ${expression}>0 AND (` +
    `${itemAlias}.VLUNIT IS NULL OR ${itemAlias}.VLUNIT=0 OR ` +
    `${expression}<=ABS(${itemAlias}.VLUNIT)*100) THEN ${expression} ELSE NULL END`;
  if (columns?.has("VLCUSTOREAL")) parts.push(saneItemCost(`${itemAlias}.VLCUSTOREAL`));
  if (columns?.has("VLCUSTO")) parts.push(saneItemCost(`${itemAlias}.VLCUSTO`));
  if (productAlias && columns?.has("VLCUSTOMEDIO")) parts.push(positive(`${productAlias}.VLCUSTOMEDIO`));
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
