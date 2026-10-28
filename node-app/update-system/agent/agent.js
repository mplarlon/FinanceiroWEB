import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { UpdateEngine, downloadPackage } from "./engine.js";
import { atomicWriteJson, generateInstallationIdentity, readJson, signRequest } from "../shared.js";

const AGENT_VERSION = "1.0.0";

export class UpdateAgent {
  constructor(config) {
    this.config = config;
    this.stateDir = path.resolve(config.dataDir, "updater");
    this.identityFile = path.join(this.stateDir, "identity.json");
    this.stateFile = path.join(this.stateDir, "state.json");
    this.identity = readJson(this.identityFile, null);
    this.state = readJson(this.stateFile, { version: config.currentVersion, failures: {}, nextCheckAt: null });
    this.engine = config.engine || new UpdateEngine({ installRoot: config.installRoot, dataDir: config.dataDir, publicKey: fs.readFileSync(config.releasePublicKey, "utf8"), healthUrl: config.healthUrl, retention: config.retention, maxPackageBytes: config.maxPackageBytes });
  }

  enrollmentCandidates() {
    const found = [];
    const add = (value) => {
      const token = String(value || "").trim();
      if (token && !found.includes(token)) found.push(token);
    };
    add(this.config.enrollmentToken);
    for (const token of this.config.enrollmentPool || []) add(token);
    const poolFile = this.config.enrollmentPoolFile || path.join(this.config.installRoot, "Updater", "enrollment-pool.json");
    if (fs.existsSync(poolFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(poolFile, "utf8"));
        for (const token of [].concat(parsed.tokens || parsed)) add(token);
      } catch { /* reserva ilegivel nao impede o token principal */ }
    }
    return found;
  }

  async initialize() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    if (!this.identity) {
      const tokens = this.enrollmentCandidates();
      if (!tokens.length) return false;
      const identity = generateInstallationIdentity();
      let lastError = null;
      for (const token of tokens) {
        this.config.enrollmentToken = token;
        try {
          await this.request("/api/v1/enroll", { companyName: this.config.companyName, installationId: identity.installationId, publicKey: identity.publicKey, ...this.metadata() }, { enrollment: true });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!/invalido ou expirado|HTTP 401/.test(String(error.message || ""))) throw error;
        }
      }
      if (lastError) throw lastError;
      this.identity = identity;
      atomicWriteJson(this.identityFile, this.identity);
    }
    await this.engine.recoverInterrupted();
    return true;
  }

  metadata() { return { version: this.state.version, platform: process.platform, architecture: process.arch, nodeVersion: process.version, agentVersion: AGENT_VERSION, channel: this.config.channel || "stable", companyName: this.config.companyName || "", hostname: os.hostname(), addresses: localAddresses(), installPath: path.resolve(this.config.installRoot || "") }; }

  async checkOnce(options = {}) {
    try {
      const result = await this.request("/api/v1/check", { ...this.metadata(), status: "online" });
      if (!result.update) return { updated: false };
      if (!withinUpdateWindow(this.config.updateWindow)) return { updated: false, deferred: "outside_window" };
      const blockers = activeBlockers(this.config.dataDir);
      if (blockers.length) { await this.event("deferred_critical_operation", result.update.manifest.version, { detail: blockers.map((item) => item.type).join(", ") }); return { updated: false, deferred: "critical_operation", blockers: blockers.length }; }
      const version = result.update.manifest.version;
      if ((this.state.failures[version] || 0) >= Number(this.config.maxAttempts || 3)) return { updated: false, blocked: true };
      const packageFile = path.join(this.stateDir, "downloads", `${version}.tar.gz`);
      await this.event("download_started", version);
      await this.download(result.update.downloadUrl, packageFile);
      const started = Date.now();
      try {
        const installed = await this.engine.install(result.update, packageFile, this.state.version);
        this.state.version = version; delete this.state.failures[version]; atomicWriteJson(this.stateFile, this.state);
        await this.event("installed", version, { previousVersion: installed.previousVersion, durationMs: Date.now() - started });
        return { updated: true, version };
      } catch (error) {
        this.state.failures[version] = (this.state.failures[version] || 0) + 1; atomicWriteJson(this.stateFile, this.state);
        await this.event(error.rolledBack ? "rollback" : "failed", version, { previousVersion: this.state.version, detail: error.message, durationMs: Date.now() - started });
        throw error;
      }
    } catch (error) {
      if (!options.retried && this.config.enrollmentToken && /Instalacao (desconhecida|nao autorizada)/.test(String(error.message || ""))) {
        this.identity = null;
        fs.rmSync(this.identityFile, { force: true });
        if (await this.initialize()) return this.checkOnce({ retried: true });
      }
      this.state.lastError = String(error.message).slice(0, 1000); this.state.lastCheckAt = new Date().toISOString(); atomicWriteJson(this.stateFile, this.state);
      throw error;
    }
  }

  async download(relativeUrl, destination) {
    const target = new URL(relativeUrl, this.config.centerUrl).toString();
    return downloadPackage(target, destination, { maxBytes: this.config.maxPackageBytes, headers: this.signedHeaders("GET", new URL(target).pathname, Buffer.alloc(0)) });
  }

  event(type, version, extra = {}) { return this.request("/api/v1/events", { type, version, occurredAt: new Date().toISOString(), ...extra }); }

  async request(pathname, data, options = {}) {
    const body = Buffer.from(JSON.stringify(data));
    const headers = { "content-type": "application/json", ...(options.enrollment ? { authorization: `Bearer ${this.config.enrollmentToken}` } : this.signedHeaders("POST", pathname, body)) };
    const response = await fetch(new URL(pathname, this.config.centerUrl), { method: "POST", headers, body, signal: AbortSignal.timeout(Number(this.config.timeoutMs || 30_000)) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Central respondeu HTTP ${response.status}.`);
    return result;
  }

  signedHeaders(method, pathname, body) {
    const timestamp = Date.now(); const nonce = crypto.randomBytes(16).toString("hex");
    return { "x-installation-id": this.identity.installationId, "x-update-timestamp": String(timestamp), "x-update-nonce": nonce, "x-update-signature": signRequest({ method, pathname, timestamp, nonce, body }, this.identity.privateKey) };
  }
}

export function loadAgentConfig(environment = process.env) {
  const centerUrl = required(environment.ERP_UPDATE_CENTER_URL);
  const parsedCenter = new URL(centerUrl);
  if (parsedCenter.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsedCenter.hostname)) throw new Error("ERP_UPDATE_CENTER_URL deve usar HTTPS.");
  return {
    centerUrl, enrollmentToken: environment.ERP_UPDATE_ENROLLMENT_TOKEN,
    companyName: String(environment.ERP_UPDATE_COMPANY_NAME || "").trim(), installRoot: environment.ERP_INSTALL_ROOT || "C:\\Program Files\\Dashboard",
    dataDir: environment.DASHBOARD_DATA_DIR || "C:\\Administracao\\Dashboard", releasePublicKey: required(environment.ERP_UPDATE_PUBLIC_KEY_FILE),
    currentVersion: environment.ERP_CURRENT_VERSION || "2.4.5", healthUrl: environment.ERP_HEALTH_URL || "http://127.0.0.1:805/api/status",
    channel: environment.ERP_UPDATE_CHANNEL || "stable", intervalMs: Number(environment.ERP_UPDATE_INTERVAL_MS || 5 * 60_000), timeoutMs: Number(environment.ERP_UPDATE_TIMEOUT_MS || 30_000),
    updateWindow: environment.ERP_UPDATE_WINDOW || "imediata",
    maxPackageBytes: Number(environment.ERP_UPDATE_MAX_PACKAGE_BYTES || 500 * 1024 * 1024), retention: Number(environment.ERP_UPDATE_RETENTION || 3), maxAttempts: Number(environment.ERP_UPDATE_MAX_ATTEMPTS || 3),
  };
}

function required(value) { if (!value) throw new Error("Configuracao obrigatoria ausente."); return value; }

export async function readCompanyFromDatabase(config) {
  try {
    return await Promise.race([
      queryCompanyName(config),
      new Promise((resolve) => setTimeout(() => resolve(""), 15000)),
    ]);
  } catch {
    return "";
  }
}

async function queryCompanyName(config) {
  const iniPath = path.join(config.dataDir, "start.ini");
  if (!fs.existsSync(iniPath)) return "";
  const settings = JSON.parse(fs.readFileSync(iniPath, "utf8"));
  const host = String(settings.host || "").trim();
  const database = String(settings.database || "").trim();
  if (!host || !database) return "";
  const packageJson = path.join(config.installRoot, "node-app", "node_modules", "node-firebird-driver-native", "package.json");
  if (!fs.existsSync(packageJson)) return "";
  const driverName = ["node", "firebird", "driver", "native"].join("-");
  const driver = createRequire(packageJson)(driverName);
  const fbclient = path.join(config.installRoot, "Firebird-5.0.4", "fbclient.dll");
  const library = fs.existsSync(fbclient) ? fbclient : driver.getDefaultLibraryFilename();
  const client = driver.createNativeClient(library);
  const db = await client.connect(`${host}/${Number(settings.port) || 3050}:${database}`, {
    username: String(settings.user || "SYSDBA"),
    password: String(settings.password || ""),
    charSetForNONE: "windows-1252",
  });
  try {
    const tx = await db.startTransaction({ accessMode: "READ_ONLY" });
    const result = await db.executeQuery(tx, "SELECT FIRST 1 TRIM(NOMEEMPRESA) AS NOME FROM CONFIGURACAO WHERE NOMEEMPRESA IS NOT NULL AND TRIM(NOMEEMPRESA) <> '' ORDER BY IDEMPRESA");
    const rows = await result.fetchAsObject();
    await result.close();
    await tx.commit();
    const value = rows[0]?.NOME;
    const text = Buffer.isBuffer(value) ? value.toString("latin1").trim() : String(value || "").trim();
    return text.slice(0, 160);
  } finally {
    await db.disconnect();
  }
}

export async function resolveCompanyName(config) {
  const configured = String(config.companyName || "").trim();
  if (configured) return configured;
  return (await readCompanyFromDatabase(config)) || os.hostname();
}

export function localAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      const family = entry.family === 4 || entry.family === "IPv4" ? "IPv4" : String(entry.family || "");
      if (entry.internal || family !== "IPv4") continue;
      if (String(entry.address || "").startsWith("169.254.")) continue;
      found.push(entry.address);
    }
  }
  return [...new Set(found)].slice(0, 8);
}

export function withinUpdateWindow(window, now = new Date()) {
  const texto = String(window || "").trim().toLowerCase();
  if (!texto || texto === "imediata" || texto === "sempre") return true;
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(texto);
  if (!match) throw new Error("ERP_UPDATE_WINDOW deve usar HH:MM-HH:MM ou imediata.");
  const values = match.slice(1).map(Number); if (values[0] > 23 || values[2] > 23 || values[1] > 59 || values[3] > 59) throw new Error("ERP_UPDATE_WINDOW invalida.");
  const current = now.getHours() * 60 + now.getMinutes(); const start = values[0] * 60 + values[1]; const end = values[2] * 60 + values[3];
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

export function activeBlockers(dataDir, now = Date.now()) {
  const directory = path.join(dataDir, "update-blockers"); if (!fs.existsSync(directory)) return [];
  const active = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    const filename = path.join(directory, name);
    try { const item = JSON.parse(fs.readFileSync(filename, "utf8")); if (Date.parse(item.expiresAt) > now) active.push(item); else fs.rmSync(filename, { force: true }); } catch { fs.rmSync(filename, { force: true }); }
  }
  return active;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const config = loadAgentConfig();
  const agent = new UpdateAgent(config);
  let ready = false;
  let failures = 0;
  let announcedWait = false;
  let companyAttempts = 0;
  const loop = async () => {
    try {
      if (!config.companyFromDatabase && !String(process.env.ERP_UPDATE_COMPANY_NAME || "").trim() && companyAttempts < 3) {
        companyAttempts += 1;
        const name = await readCompanyFromDatabase(config);
        if (name) {
          config.companyName = name;
          config.companyFromDatabase = true;
        }
      }
      if (!config.companyName) config.companyName = os.hostname();
      if (!ready || !agent.identity) {
        ready = await agent.initialize();
        if (!ready && !announcedWait) {
          console.error("[updater] servico instalado. Aguardando token de registro.");
          announcedWait = true;
        }
      }
      if (ready) {
        await agent.checkOnce();
        failures = 0;
      }
    } catch (error) {
      failures += 1;
      console.error(`[updater] ${error.message}`);
    } finally {
      const delay = Math.min(config.intervalMs * (2 ** failures), 6 * 60 * 60_000);
      setTimeout(loop, delay);
    }
  };
  await loop();
}
