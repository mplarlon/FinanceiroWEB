import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson, SEMVER } from "./shared.js";

export function pendingUpdateFile(dataDir) {
  return path.join(dataDir, "updater", "pending-update.json");
}

export function readPendingUpdate(dataDir) {
  let item = null;
  try {
    const raw = fs.readFileSync(pendingUpdateFile(dataDir), "utf8").replace(/^\uFEFF/, "");
    item = JSON.parse(raw);
  } catch { return null; }
  if (!item || !SEMVER.test(String(item.version || ""))) return null;
  return { version: String(item.version), seenAt: item.seenAt || null };
}

export function writePendingUpdate(dataDir, version) {
  const current = readPendingUpdate(dataDir);
  const seenAt = current?.version === version ? current.seenAt : null;
  atomicWriteJson(pendingUpdateFile(dataDir), { version, seenAt });
  return { version, seenAt };
}

export function markPendingUpdateSeen(dataDir, now = new Date().toISOString()) {
  const current = readPendingUpdate(dataDir);
  if (!current || current.seenAt) return current;
  atomicWriteJson(pendingUpdateFile(dataDir), { version: current.version, seenAt: now });
  return { version: current.version, seenAt: now };
}

export function clearPendingUpdate(dataDir) {
  fs.rmSync(pendingUpdateFile(dataDir), { force: true });
}
