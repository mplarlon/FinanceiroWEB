import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../config.js";

export function configPath(name) { return path.join(dataDir, name); }
export function readJsonConfig(name, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(configPath(name), "utf8")); }
  catch { return structuredClone(fallback); }
}
export function writeJsonConfig(name, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = configPath(name), temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
  return value;
}
export function mergeAllowed(current, incoming, allowed, allowEmpty = false) {
  const next = { ...current };
  for (const key of allowed) {
    if (!(key in incoming)) continue;
    if (!allowEmpty && (incoming[key] === null || incoming[key] === "")) continue;
    next[key] = incoming[key];
  }
  return next;
}
