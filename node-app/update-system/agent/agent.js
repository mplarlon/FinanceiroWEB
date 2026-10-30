import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { UpdateEngine, downloadPackage } from "./engine.js";
import { atomicWriteJson, compareSemver, generateInstallationIdentity, MANUAL_CHECK_PORT, readJson, SEMVER, signRequest } from "../shared.js";
import { clearPendingUpdate, writePendingUpdate } from "../pending-update.js";
import { mergeStartIni, publicStartIni } from "../start-ini.js";

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
    this.sessionActive = config.sessionActive || (() => interactiveSessionActive());
  }

  syncRunningVersion() {
    const disk = installedAppVersion(this.config.installRoot);
    if (!disk) return;
    if (!this.state.version || compareSemver(String(this.state.version), disk) > 0) {
      this.state.version = disk;
      atomicWriteJson(this.stateFile, this.state);
    }
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

  runCheck(options = {}) {
    const previous = this._queue || Promise.resolve();
    const job = previous.catch(() => {}).then(() => this.checkOnce(options));
    const settled = job.finally(() => { if (this._queue === settled) this._queue = null; });
    settled.catch(() => {});
    this._queue = settled;
    return job;
  }

  async tryEnroll() {
    if (this.identity?.installationId && this.identity?.privateKey) return true;
    if (!this._enrolling) {
      this._enrolling = this.initialize().finally(() => { this._enrolling = null; });
    }
    try {
      const enrolled = await this._enrolling;
      return Boolean(enrolled && this.identity?.installationId && this.identity?.privateKey);
    } catch (error) {
      if (isRejectedToken(error)) return false;
      throw error;
    }
  }

  restoreIdentity(previous) {
    if (!previous?.installationId || !previous?.privateKey) return;
    this.identity = previous;
    atomicWriteJson(this.identityFile, previous);
  }

  async submitRegistrationRequest() {
    if (!this.identity?.installationId || !this.identity?.publicKey || !this.identity?.privateKey) {
      this.identity = generateInstallationIdentity();
    }
    atomicWriteJson(this.identityFile, this.identity);
    try {
      return await this.request("/api/v1/registration-requests", {
        installationId: this.identity.installationId,
        publicKey: this.identity.publicKey,
        ...this.metadata(),
      }, { open: true });
    } catch (error) {
      if (/HTTP 404/.test(String(error.message || ""))) throw new Error("A central ainda não recebe pedido de registro.");
      throw error;
    }
  }

  async askRegistration(options) {
    const answer = await this.submitRegistrationRequest();
    if (answer.alreadyRegistered && !options.registrationConfirmed) {
      return this.checkOnce({ ...options, registrationConfirmed: true });
    }
    return { updated: false, registrationRequested: true };
  }

  async checkOnce(options = {}) {
    try {
      if (!(await this.tryEnroll())) {
        if (options.manual) return this.askRegistration(options);
        throw new Error("Esta máquina ainda não está registrada para atualizar.");
      }
      this.syncRunningVersion();
      const iniPath = path.join(this.config.dataDir, "start.ini");
      const payload = { ...this.metadata(), status: "online", startIni: readStartIniFile(iniPath) };
      if (this.state.pendingStartIniAck) payload.startIniResult = this.state.pendingStartIniAck;
      const result = await this.request("/api/v1/check", payload);
      if (this.state.pendingStartIniAck) {
        delete this.state.pendingStartIniAck;
        atomicWriteJson(this.stateFile, this.state);
      }
      await this.consumeStartIni(result.startIni, iniPath);
      if (!result.update) {
        this.clearUpdateDeferral();
        this.forgetLastError();
        return { updated: false };
      }
      const offered = result.update.manifest.version;
      if (options.manual) {
        writePendingUpdate(this.config.dataDir, offered);
      } else {
        const held = await this.holdUntilNotice(offered);
        if (held) return held;
        if (!withinUpdateWindow(this.config.updateWindow)) return { updated: false, deferred: "outside_window" };
      }
      const blockers = activeBlockers(this.config.dataDir);
      if (blockers.length) { await this.event("deferred_critical_operation", result.update.manifest.version, { detail: blockers.map((item) => item.type).join(", ") }); return { updated: false, deferred: "critical_operation", blockers: blockers.length }; }
      const version = result.update.manifest.version;
      if (!options.manual && (this.state.failures[version] || 0) >= Number(this.config.maxAttempts || 3)) return { updated: false, blocked: true };
      const packageFile = path.join(this.stateDir, "downloads", `${version}.tar.gz`);
      await this.event("download_started", version);
      await this.download(result.update.downloadUrl, packageFile);
      const started = Date.now();
      try {
        const installed = await this.engine.install(result.update, packageFile, this.state.version);
        const confirmed = installedAppVersion(this.config.installRoot);
        if (confirmed && compareSemver(confirmed, version) < 0) throw new Error("A versao em disco nao foi atualizada.");
        this.state.version = confirmed || version; delete this.state.failures[version]; delete this.state.deferral; this.forgetLastError(); atomicWriteJson(this.stateFile, this.state);
        clearPendingUpdate(this.config.dataDir);
        await this.event("installed", this.state.version, { previousVersion: installed.previousVersion, durationMs: Date.now() - started });
        return { updated: true, version };
      } catch (error) {
        this.state.failures[version] = (this.state.failures[version] || 0) + 1; atomicWriteJson(this.stateFile, this.state);
        await this.event(error.rolledBack ? "rollback" : "failed", version, { previousVersion: this.state.version, detail: error.message, durationMs: Date.now() - started });
        throw error;
      }
    } catch (error) {
      if (!options.retried && !options.registrationConfirmed && /Instalacao (desconhecida|nao autorizada)/.test(String(error.message || ""))) {
        const previous = this.identity;
        this.identity = null;
        fs.rmSync(this.identityFile, { force: true });
        try {
          if (this.enrollmentCandidates().length && await this.initialize()) return this.checkOnce({ ...options, retried: true });
        } catch (enrollError) {
          if (!isRejectedToken(enrollError)) {
            this.restoreIdentity(previous);
            throw enrollError;
          }
        }
        this.restoreIdentity(previous);
        if (options.manual) {
          try { return await this.askRegistration({ ...options, retried: true }); }
          catch (requestError) { error = requestError; }
        }
      }
      const shown = explainUpdateFailure(error);
      this.state.lastError = String(shown.message).slice(0, 1000); this.state.lastCheckAt = new Date().toISOString(); atomicWriteJson(this.stateFile, this.state);
      throw shown;
    }
  }

  async download(relativeUrl, destination) {
    const target = new URL(relativeUrl, this.config.centerUrl).toString();
    return downloadPackage(target, destination, { maxBytes: this.config.maxPackageBytes, headers: this.signedHeaders("GET", new URL(target).pathname, Buffer.alloc(0)) });
  }

  event(type, version, extra = {}) { return this.request("/api/v1/events", { type, version, occurredAt: new Date().toISOString(), ...extra }); }

  async holdUntilNotice(version) {
    const pending = writePendingUpdate(this.config.dataDir, version);
    if (!this.sessionActive()) return this.deferUpdate("logged_off", version, "sem usuario logado");
    if (!pending.seenAt) return this.deferUpdate("awaiting_notice", version, "aviso pendente");
    return null;
  }

  async deferUpdate(reason, version, detail) {
    if (this.state.deferral !== reason) {
      this.state.deferral = reason;
      atomicWriteJson(this.stateFile, this.state);
      await this.event(reason === "logged_off" ? "deferred_logged_off" : "deferred_awaiting_notice", version, { detail });
    }
    return { updated: false, deferred: reason };
  }

  forgetLastError() {
    if (!this.state.lastError) return;
    delete this.state.lastError;
    atomicWriteJson(this.stateFile, this.state);
  }

  clearUpdateDeferral() {
    clearPendingUpdate(this.config.dataDir);
    if (!this.state.deferral) return;
    delete this.state.deferral;
    atomicWriteJson(this.stateFile, this.state);
  }

  async consumeStartIni(command, iniPath) {
    if (!command?.id) return;
    try {
      writeStartIniFile(iniPath, command);
      this.state.pendingStartIniAck = { id: command.id, ok: true };
    } catch (error) {
      this.state.pendingStartIniAck = { id: command.id, ok: false, error: String(error.message || "falha").slice(0, 300) };
    }
    atomicWriteJson(this.stateFile, this.state);
  }

  async request(pathname, data, options = {}) {
    const body = Buffer.from(JSON.stringify(data));
    const headers = { "content-type": "application/json", ...(options.enrollment ? { authorization: `Bearer ${this.config.enrollmentToken}` } : options.open ? {} : this.signedHeaders("POST", pathname, body)) };
    const response = await fetch(new URL(pathname, this.config.centerUrl), { method: "POST", headers, body, signal: AbortSignal.timeout(Number(this.config.timeoutMs || 30_000)) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Central respondeu HTTP ${response.status}.`);
    return result;
  }

  signedHeaders(method, pathname, body) {
    if (!this.identity?.installationId || !this.identity?.privateKey) throw new Error("Esta máquina ainda não está registrada para atualizar.");
    const timestamp = Date.now(); const nonce = crypto.randomBytes(16).toString("hex");
    return { "x-installation-id": this.identity.installationId, "x-update-timestamp": String(timestamp), "x-update-nonce": nonce, "x-update-signature": signRequest({ method, pathname, timestamp, nonce, body }, this.identity.privateKey) };
  }
}

function isRejectedToken(error) {
  return /Token de registro invalido ou expirado|invalido ou expirado|HTTP 401/.test(String(error?.message || ""));
}

export function explainUpdateFailure(error) {
  const text = String(error?.message || "");
  if (/Token de registro invalido ou expirado|HTTP 401/.test(text)) return new Error("O registro desta máquina está inválido ou expirado.");
  if (/reading 'installationId'/.test(text)) return new Error("Esta máquina ainda não está registrada para atualizar.");
  return error;
}

export function resolveInstallLayout(environment = process.env, agentDirectory = "") {
  const configuredRoot = absolutePath(environment.ERP_INSTALL_ROOT);
  const besideRoot = agentDirectory ? path.resolve(agentDirectory, "..") : "";
  let installRoot = configuredRoot;
  if (!hasFile(installRoot, "DashboardService.exe") && hasFile(besideRoot, "DashboardService.exe")) installRoot = besideRoot;
  if (!installRoot) installRoot = path.resolve("C:\\Program Files\\Dashboard");
  const configuredData = absolutePath(environment.DASHBOARD_DATA_DIR);
  const besideData = path.join(installRoot, "Dashboard");
  let dataDir = configuredData;
  if (!dataDir) dataDir = besideData;
  else if (!fs.existsSync(dataDir) && fs.existsSync(besideData)) dataDir = besideData;
  return { installRoot, dataDir };
}

function absolutePath(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function hasFile(dir, name) {
  return Boolean(dir) && fs.existsSync(path.join(dir, name));
}

export function loadAgentConfig(environment = process.env, agentDirectory = "") {
  const centerUrl = required(environment.ERP_UPDATE_CENTER_URL);
  const parsedCenter = new URL(centerUrl);
  if (parsedCenter.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsedCenter.hostname)) throw new Error("ERP_UPDATE_CENTER_URL deve usar HTTPS.");
  const layout = resolveInstallLayout(environment, agentDirectory);
  return {
    centerUrl, enrollmentToken: environment.ERP_UPDATE_ENROLLMENT_TOKEN,
    companyName: String(environment.ERP_UPDATE_COMPANY_NAME || "").trim(), installRoot: layout.installRoot,
    dataDir: layout.dataDir, releasePublicKey: required(environment.ERP_UPDATE_PUBLIC_KEY_FILE),
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

function readStartIniFile(iniPath) {
  if (!fs.existsSync(iniPath)) return null;
  try { return publicStartIni(JSON.parse(fs.readFileSync(iniPath, "utf8"))); } catch { return null; }
}

function writeStartIniFile(iniPath, command) {
  const current = fs.existsSync(iniPath) ? JSON.parse(fs.readFileSync(iniPath, "utf8")) : {};
  const next = mergeStartIni(current, command);
  fs.mkdirSync(path.dirname(iniPath), { recursive: true });
  fs.writeFileSync(iniPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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

export function installedAppVersion(installRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(installRoot, "node-app", "dist", "version.json"), "utf8"));
    if (SEMVER.test(String(parsed.version || ""))) return String(parsed.version);
  } catch { /* a versao instalada continua a do estado */ }
  return "";
}

export function windowsUserLoggedOn(output) {
  const text = String(output || "");
  if (/explorer\.exe/i.test(text)) return true;
  return text.split(/\r?\n/).some((line) => {
    const row = line.trim();
    if (!row || /^(SESSIONNAME|NOME DA SESS)/i.test(row)) return false;
    return /\b(Active|Ativo)\b/.test(row);
  });
}

export function interactiveSessionActive(runner = defaultSessionQuery) {
  if (process.platform !== "win32") return true;
  try { return windowsUserLoggedOn(runner()); } catch { return false; }
}

function defaultSessionQuery() {
  const root = process.env.SystemRoot || "C:\\Windows";
  const commands = [
    [path.join(root, "System32", "tasklist.exe"), ["/FI", "IMAGENAME eq explorer.exe", "/FO", "CSV", "/NH"]],
    [path.join(root, "System32", "qwinsta.exe"), []],
    [path.join(root, "System32", "query.exe"), ["session"]],
  ];
  let lastError;
  for (const [command, args] of commands) {
    try {
      return execFileSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });
    } catch (error) {
      lastError = error;
      if (error?.code !== "ENOENT") break;
    }
  }
  throw lastError || new Error("Não foi possível ler a sessão do Windows.");
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

export function startManualCheckServer(agent, options = {}) {
  const port = options.port ?? Number(process.env.ERP_UPDATE_CONTROL_PORT || MANUAL_CHECK_PORT);
  const server = http.createServer(async (req, res) => {
    const remote = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    if (remote !== "127.0.0.1" && remote !== "::1") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, erro: "A consulta manual só aceita esta máquina." }));
      return;
    }
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (req.method !== "POST" || pathname !== "/check") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, erro: "Rota inexistente." }));
      return;
    }
    try {
      const result = await agent.runCheck({ manual: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, erro: String(error.message || "falha").slice(0, 300) }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
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

export function isAgentEntrypoint(argvPath, moduleFilename, realpath = fs.realpathSync.native) {
  if (!argvPath || !moduleFilename) return false;
  const normalize = (value) => {
    const resolved = path.resolve(String(value));
    try { return realpath(resolved); } catch { return resolved; }
  };
  return normalize(argvPath).toLowerCase() === normalize(moduleFilename).toLowerCase();
}

if (isAgentEntrypoint(process.argv[1], import.meta.filename)) {
  let config;
  let agent;
  while (!agent) {
    try {
      config = loadAgentConfig(process.env, path.dirname(import.meta.filename));
      agent = new UpdateAgent(config);
    } catch (error) {
      console.error(`[updater] ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  startManualCheckServer(agent).then(
    (server) => console.error(`[updater] consulta manual em 127.0.0.1:${server.address().port}`),
    (error) => console.error(`[updater] consulta manual indisponivel: ${error.message}`),
  );
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
        await agent.runCheck();
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
