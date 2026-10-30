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

function copyBundledAgent(paths) {
  if (!fs.existsSync(paths.bundled)) return false;
  if (!fs.existsSync(paths.live)) fs.mkdirSync(path.dirname(paths.live), { recursive: true });
  const next = fs.readFileSync(paths.bundled);
  if (fs.existsSync(paths.live) && next.equals(fs.readFileSync(paths.live))) return false;
  fs.copyFileSync(paths.bundled, paths.live);
  return true;
}

function copyIfMissing(source, destination) {
  if (!source || !fs.existsSync(source) || fs.existsSync(destination)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

export function ensureUpdaterFiles(serverDir = import.meta.dirname) {
  const paths = updaterAgentPaths(serverDir);
  const root = path.resolve(serverDir, "..", "..");
  const updaterDir = path.dirname(paths.service);
  const bundledDir = path.resolve(serverDir, "..", "updater");
  fs.mkdirSync(updaterDir, { recursive: true });
  copyIfMissing(path.join(root, "DashboardService.exe"), paths.service);
  copyIfMissing(path.join(root, "DashboardNode.exe"), path.join(updaterDir, "UpdaterNode.exe"));
  copyIfMissing(path.join(bundledDir, "release-public.pem"), path.join(updaterDir, "release-public.pem"));
  copyIfMissing(path.join(bundledDir, "UpdaterService.xml"), path.join(updaterDir, "UpdaterService.xml"));
  return paths;
}

function replaceUpdaterAgent(paths, options) {
  try {
    if (!copyBundledAgent(paths) || !fs.existsSync(paths.service)) return;
    const run = options.spawn || execFile;
    run(paths.service, ["restart"], { windowsHide: true }, () => {});
  } catch (error) {
    console.error(`[updater] ${error.message}`);
  }
}

function runService(paths, options, args) {
  const run = options.spawn || execFile;
  return new Promise((resolve) => {
    run(paths.service, args, { windowsHide: true }, (error) => resolve(!error));
  });
}

export async function activateBundledUpdater(serverDir = import.meta.dirname, options = {}) {
  const paths = fs.existsSync(updaterAgentPaths(serverDir).service) ? updaterAgentPaths(serverDir) : ensureUpdaterFiles(serverDir);
  if (!fs.existsSync(paths.service)) return false;
  try {
    copyBundledAgent(paths);
  } catch (error) {
    console.error(`[updater] ${error.message}`);
    await runService(paths, options, ["stop"]);
    try { copyBundledAgent(paths); } catch (retryError) { console.error(`[updater] ${retryError.message}`); }
  }
  if (await runService(paths, options, ["restart"])) return true;
  await runService(paths, options, ["install"]);
  return runService(paths, options, ["start"]);
}
