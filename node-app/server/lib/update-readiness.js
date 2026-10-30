import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";

const blockersDir = path.join(dataDir, "update-blockers");

export function tracksCriticalOperation(method, pathname) {
  if (["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase())) return false;
  return String(pathname || "") !== "/api/app-update/now";
}

export function beginCriticalOperation(type, details = {}, ttlMs = 2 * 60 * 60_000) {
  fs.mkdirSync(blockersDir, { recursive: true });
  const id = crypto.randomUUID();
  const record = { id, type: String(type || "operation").slice(0, 80), startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + Math.max(60_000, ttlMs)).toISOString(), details: sanitize(details) };
  const filename = path.join(blockersDir, `${id}.json`); const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filename);
  return { ...record, finish: () => fs.rmSync(filename, { force: true }) };
}

export async function withCriticalOperation(type, details, callback, ttlMs) {
  const operation = beginCriticalOperation(type, details, ttlMs);
  try { return await callback(); } finally { operation.finish(); }
}

export function activeCriticalOperations(now = Date.now()) {
  if (!fs.existsSync(blockersDir)) return [];
  const active = [];
  for (const name of fs.readdirSync(blockersDir)) {
    if (!name.endsWith(".json")) continue;
    const filename = path.join(blockersDir, name);
    try {
      const record = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (Date.parse(record.expiresAt) <= now) fs.rmSync(filename, { force: true }); else active.push(record);
    } catch { fs.rmSync(filename, { force: true }); }
  }
  return active;
}

function sanitize(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) if (!/(senha|password|token|secret|credencial)/i.test(key)) output[key] = String(value).slice(0, 200);
  return output;
}
