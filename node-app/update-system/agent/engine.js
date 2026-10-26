import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson, compareSemver, readJson, safeChild, sha256, verifyManifest } from "../shared.js";

const execFile = promisify(execFileCallback);

export class UpdateEngine {
  constructor(options) {
    this.installRoot = path.resolve(options.installRoot);
    this.dataDir = path.resolve(options.dataDir);
    this.publicKey = options.publicKey;
    this.serviceController = options.serviceController || windowsService(this.installRoot);
    this.healthCheck = options.healthCheck || (() => waitForHealth(options.healthUrl || "http://127.0.0.1:805/api/status"));
    this.extract = options.extract || extractTarGz;
    this.retention = Number(options.retention || 3);
    this.maxPackageBytes = Number(options.maxPackageBytes || 500 * 1024 * 1024);
    this.workDir = path.join(this.dataDir, "updater");
    this.backupsDir = path.join(this.workDir, "backups");
    this.journalFile = path.join(this.workDir, "transaction.json");
    fs.mkdirSync(this.backupsDir, { recursive: true });
  }

  validateRelease(update, currentVersion) {
    const { manifest, signature } = update;
    if (!verifyManifest(manifest, signature, this.publicKey)) throw new Error("Assinatura do manifesto invalida.");
    if (compareSemver(manifest.version, currentVersion) <= 0) throw new Error("A versao oferecida nao e superior a instalada.");
    if (![].concat(manifest.platform).includes(process.platform) || ![].concat(manifest.architecture).includes(process.arch)) throw new Error("Versao incompativel com esta plataforma.");
    if (compareSemver(manifest.minimumAgentVersion || "0.0.0", process.env.ERP_UPDATER_VERSION || "1.0.0") > 0) throw new Error("Agente precisa ser atualizado antes deste pacote.");
    if (!manifest.package?.sha256 || !Number.isSafeInteger(Number(manifest.package.size))) throw new Error("Manifesto nao informa integridade do pacote.");
    const databaseStrategy = manifest.database?.strategy || "none";
    if (!new Set(["none", "additive-compatible"]).has(databaseStrategy)) throw new Error("Atualizacao exige estrategia de banco nao automatizavel. Use procedimento manual homologado.");
    if (manifest.database?.automaticRollback) throw new Error("Rollback destrutivo automatico de banco nao e permitido.");
    if (Number(manifest.package.size) > this.maxPackageBytes) throw new Error("Pacote excede o limite configurado.");
  }

  async install(update, packageFile, currentVersion) {
    this.validateRelease(update, currentVersion);
    const { manifest } = update;
    const bytes = fs.readFileSync(packageFile);
    if (bytes.length !== Number(manifest.package.size) || sha256(bytes) !== String(manifest.package.sha256).toLowerCase()) throw new Error("Hash ou tamanho do pacote invalido.");
    const staging = path.join(this.workDir, `staging-${manifest.version}-${crypto.randomUUID()}`);
    const prepared = path.join(staging, "node-app");
    fs.mkdirSync(staging, { recursive: true });
    try {
      await this.extract(packageFile, staging);
      for (const required of ["server/dashboard.mjs", "dist/index.html"]) if (!fs.existsSync(safeChild(prepared, required))) throw new Error(`Pacote incompleto: ${required}.`);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    const live = path.join(this.installRoot, "node-app");
    const backup = path.join(this.backupsDir, `${currentVersion}-${Date.now()}`);
    atomicWriteJson(this.journalFile, { state: "prepared", from: currentVersion, to: manifest.version, live, backup, staging, startedAt: new Date().toISOString() });
    try {
      await this.serviceController.stop();
      fs.renameSync(live, backup);
      fs.renameSync(prepared, live);
      atomicWriteJson(this.journalFile, { ...readJson(this.journalFile, {}), state: "activated" });
      await this.serviceController.start();
      await this.healthCheck(manifest);
      atomicWriteJson(this.journalFile, { ...readJson(this.journalFile, {}), state: "completed", completedAt: new Date().toISOString() });
      this.pruneBackups();
      fs.rmSync(staging, { recursive: true, force: true });
      return { ok: true, version: manifest.version, previousVersion: currentVersion };
    } catch (error) {
      await this.rollback({ live, backup, staging, error });
      throw Object.assign(new Error(`Atualizacao revertida: ${error.message}`), { rolledBack: true, cause: error });
    }
  }

  async rollback(transaction = readJson(this.journalFile, null)) {
    if (!transaction) return false;
    try { await this.serviceController.stop(); } catch { /* tenta recuperar mesmo assim */ }
    if (fs.existsSync(transaction.backup)) {
      if (fs.existsSync(transaction.live)) fs.rmSync(transaction.live, { recursive: true, force: true });
      fs.renameSync(transaction.backup, transaction.live);
    }
    try { await this.serviceController.start(); } catch { /* registrado no journal */ }
    atomicWriteJson(this.journalFile, { ...transaction, state: "rolled_back", rolledBackAt: new Date().toISOString(), error: String(transaction.error?.message || transaction.error || "falha") });
    if (transaction.staging && fs.existsSync(transaction.staging)) fs.rmSync(transaction.staging, { recursive: true, force: true });
    return true;
  }

  async recoverInterrupted() {
    const transaction = readJson(this.journalFile, null);
    if (!transaction || ["completed", "rolled_back"].includes(transaction.state)) return false;
    return this.rollback(transaction);
  }

  pruneBackups() {
    const items = fs.readdirSync(this.backupsDir, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => ({ name: item.name, time: fs.statSync(path.join(this.backupsDir, item.name)).mtimeMs })).sort((a, b) => b.time - a.time);
    for (const item of items.slice(this.retention)) fs.rmSync(path.join(this.backupsDir, item.name), { recursive: true, force: true });
  }
}

export async function downloadPackage(url, destination, options = {}) {
  const maxBytes = Number(options.maxBytes || 500 * 1024 * 1024);
  const timeoutMs = Number(options.timeoutMs || 120_000);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  const start = fs.existsSync(temporary) ? fs.statSync(temporary).size : 0;
  const headers = { ...(options.headers || {}), ...(start ? { Range: `bytes=${start}-` } : {}) };
  await new Promise((resolve, reject) => {
    const transport = url.startsWith("https:") ? https : http;
    const request = transport.get(url, { headers, timeout: timeoutMs }, (response) => {
      if (![200, 206].includes(response.statusCode)) return reject(new Error(`Download recusado (HTTP ${response.statusCode}).`));
      const append = response.statusCode === 206 && start > 0;
      let total = append ? start : 0;
      const output = fs.createWriteStream(temporary, { flags: append ? "a" : "w" });
      response.on("data", (chunk) => { total += chunk.length; if (total > maxBytes) request.destroy(new Error("Pacote excede o limite.")); });
      response.pipe(output);
      output.on("finish", () => output.close(resolve));
      output.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Timeout no download.")));
    request.on("error", reject);
  });
  fs.renameSync(temporary, destination);
  return destination;
}

async function extractTarGz(archive, destination) {
  const { stdout } = await execFile("tar.exe", ["-tzf", archive], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const verbose = await execFile("tar.exe", ["-tvzf", archive], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.length > 50_000) throw new Error("Pacote vazio ou com arquivos demais.");
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) throw new Error("Pacote contem caminho inseguro.");
  }
  if (verbose.stdout.split(/\r?\n/).some((line) => /^[lh]/.test(line))) throw new Error("Pacote contem link nao permitido.");
  await execFile("tar.exe", ["-xzf", archive, "-C", destination], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}

function windowsService(installRoot) {
  const executable = path.join(installRoot, "DashboardService.exe");
  const run = (command) => execFile(executable, [command], { cwd: installRoot, windowsHide: true, timeout: 60_000 });
  return { stop: () => run("stop"), start: () => run("start") };
}

async function waitForHealth(url, attempts = 20) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(5_000) }); if (response.ok) return true; lastError = new Error(`Health check HTTP ${response.status}.`); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw lastError || new Error("Health check falhou.");
}
