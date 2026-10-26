import crypto from "node:crypto";
import fs from "node:fs";
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

  async initialize() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    if (!this.identity) {
      if (!this.config.enrollmentToken) throw new Error("ERP_UPDATE_ENROLLMENT_TOKEN e obrigatorio no primeiro registro.");
      this.identity = generateInstallationIdentity();
      atomicWriteJson(this.identityFile, this.identity);
      await this.request("/api/v1/enroll", { companyName: this.config.companyName, installationId: this.identity.installationId, publicKey: this.identity.publicKey, ...this.metadata() }, { enrollment: true });
    }
    await this.engine.recoverInterrupted();
  }

  metadata() { return { version: this.state.version, platform: process.platform, architecture: process.arch, nodeVersion: process.version, agentVersion: AGENT_VERSION, channel: this.config.channel || "stable", hostname: os.hostname() }; }

  async checkOnce() {
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
    companyName: environment.ERP_UPDATE_COMPANY_NAME || os.hostname(), installRoot: environment.ERP_INSTALL_ROOT || "C:\\Program Files\\Dashboard",
    dataDir: environment.DASHBOARD_DATA_DIR || "C:\\Administracao\\Dashboard", releasePublicKey: required(environment.ERP_UPDATE_PUBLIC_KEY_FILE),
    currentVersion: environment.ERP_CURRENT_VERSION || "2.4.5", healthUrl: environment.ERP_HEALTH_URL || "http://127.0.0.1:805/api/status",
    channel: environment.ERP_UPDATE_CHANNEL || "stable", intervalMs: Number(environment.ERP_UPDATE_INTERVAL_MS || 30 * 60_000), timeoutMs: Number(environment.ERP_UPDATE_TIMEOUT_MS || 30_000),
    updateWindow: environment.ERP_UPDATE_WINDOW || "00:00-23:59",
    maxPackageBytes: Number(environment.ERP_UPDATE_MAX_PACKAGE_BYTES || 500 * 1024 * 1024), retention: Number(environment.ERP_UPDATE_RETENTION || 3), maxAttempts: Number(environment.ERP_UPDATE_MAX_ATTEMPTS || 3),
  };
}

function required(value) { if (!value) throw new Error("Configuracao obrigatoria ausente."); return value; }

export function withinUpdateWindow(window, now = new Date()) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(window || ""));
  if (!match) throw new Error("ERP_UPDATE_WINDOW deve usar HH:MM-HH:MM.");
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
  const config = loadAgentConfig(); const agent = new UpdateAgent(config); await agent.initialize();
  let failures = 0;
  const loop = async () => { try { await agent.checkOnce(); failures = 0; } catch (error) { failures += 1; console.error(`[updater] ${error.message}`); } finally { const delay = Math.min(config.intervalMs * (2 ** failures), 6 * 60 * 60_000); setTimeout(loop, delay).unref(); } };
  await loop();
}
