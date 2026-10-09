import fs from "node:fs";
import path from "node:path";
import { createNativeClient, getDefaultLibraryFilename } from "node-firebird-driver-native";
import { appRoot, loadDatabaseConfig } from "./config.js";

const bundledClient = path.resolve(appRoot, "..", "Firebird-5.0.4", "fbclient.dll");
const library = process.env.DASHBOARD_FBCLIENT ||
  (fs.existsSync(bundledClient) ? bundledClient : getDefaultLibraryFilename());
const client = createNativeClient(library);

function uri(config) {
  return `${config.host || "localhost"}/${Number(config.port || 3051)}:${config.database}`;
}

export function attach(config = loadDatabaseConfig()) {
  return client.connect(uri(config), {
    username: config.user || "SYSDBA",
    password: config.password || "masterkey",
    role: config.role || undefined,
    charSetForNONE: config.charset === "WIN1252" ? "windows-1252" : config.charset
  });
}

export async function withDatabase(action, config) {
  const db = await attach(config);
  try {
    return await action(db);
  } finally {
    await db.disconnect();
  }
}

export async function query(db, sql, params = []) {
  const transaction = await db.startTransaction({ accessMode: "READ_ONLY" });
  let resultSet;
  try {
    resultSet = await db.executeQuery(transaction, sql, params);
    const rows = await resultSet.fetchAsObject();
    return rows.map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.trim(),
        Buffer.isBuffer(value) ? value.toString("latin1").trim() : value
      ])
    ));
  } finally {
    if (resultSet?.isValid) await resultSet.close();
    if (transaction.isValid) await transaction.rollback();
  }
}

// Normaliza uma linha vinda do driver: apara nome de coluna e decodifica
// buffers (colunas CHAR/VARCHAR de bancos legados costumam vir em latin1).
function normalizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.trim(),
      Buffer.isBuffer(value) ? value.toString("latin1").trim() : value
    ])
  );
}

// Roda uma transacao de leitura/escrita (READ_WRITE) e entrega helpers
// (execute/query/singleton) presos a ela. Usada pelos modulos fiscal e
// fechamento de carteira, que precisam de INSERT/UPDATE dentro da mesma
// transacao com commit/rollback explicito.
export async function withWriteTransaction(action, config) {
  const db = await attach(config);
  const transaction = await db.startTransaction({ accessMode: "READ_WRITE" });
  try {
    const tx = {
      execute: (sql, params = []) => db.execute(transaction, sql, params),
      query: async (sql, params = []) => {
        const resultSet = await db.executeQuery(transaction, sql, params);
        try {
          const rows = await resultSet.fetchAsObject();
          return rows.map(normalizeRow);
        } finally {
          if (resultSet.isValid) await resultSet.close();
        }
      },
      singleton: async (sql, params = []) => {
        const rows = await tx.query(sql, params);
        return rows[0];
      },
    };
    const result = await action(tx);
    await transaction.commit();
    return result;
  } catch (error) {
    try { if (transaction.isValid) await transaction.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    await db.disconnect();
  }
}
