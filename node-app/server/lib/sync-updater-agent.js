import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function updaterAgentPaths(serverDir) {
  return {
    bundled: path.join(serverDir, "..", "updater", "agent.mjs"),
    live: path.join(serverDir, "..", "..", "Updater", "agent.mjs"),
    service: path.join(serverDir, "..", "..", "Updater", "UpdaterService.exe"),
  };
}

export function syncUpdaterAgent(serverDir = import.meta.dirname, options = {}) {
  const paths = updaterAgentPaths(serverDir);
  if (!fs.existsSync(paths.bundled) || !fs.existsSync(paths.live)) return false;
  if (fs.readFileSync(paths.bundled).equals(fs.readFileSync(paths.live))) return false;
  const delayMs = options.delayMs ?? 3 * 60_000;
  const schedule = options.schedule || ((callback, milliseconds) => setTimeout(callback, milliseconds));
  schedule(() => replaceUpdaterAgent(paths, options), delayMs);
  return true;
}

function replaceUpdaterAgent(paths, options) {
  try {
    if (!fs.existsSync(paths.bundled) || !fs.existsSync(paths.live)) return;
    const next = fs.readFileSync(paths.bundled);
    if (next.equals(fs.readFileSync(paths.live))) return;
    fs.copyFileSync(paths.bundled, paths.live);
    if (!fs.existsSync(paths.service)) return;
    const run = options.spawn || execFile;
    run(paths.service, ["restart"], { windowsHide: true }, () => {});
  } catch (error) {
    console.error(`[updater] ${error.message}`);
  }
}
