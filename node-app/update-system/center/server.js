import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { UpdateStore } from "./store.js";
import { assertSemver, compareSemver, safeChild, sha256, verifyManifest, verifyRequest } from "../shared.js";

export function createUpdateCenter(options = {}) {
  const dataDir = options.dataDir || process.env.UPDATE_CENTER_DATA_DIR || path.resolve("update-center-data");
  const adminToken = options.adminToken ?? process.env.UPDATE_CENTER_ADMIN_TOKEN;
  if (!adminToken) throw new Error("UPDATE_CENTER_ADMIN_TOKEN e obrigatorio.");
  const readToken = options.readToken ?? process.env.UPDATE_CENTER_READ_TOKEN;
  const metricsToken = options.metricsToken ?? process.env.UPDATE_CENTER_METRICS_TOKEN;
  const releasePublicKeyFile = options.releasePublicKeyFile || process.env.UPDATE_SIGNING_PUBLIC_KEY_FILE;
  const releasePublicKey = options.releasePublicKey || (releasePublicKeyFile ? fs.readFileSync(releasePublicKeyFile, "utf8") : null);
  const store = options.store || new UpdateStore(dataDir);
  const app = express();
  const nonces = new Map();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => res.json({ ok: true, service: "erp-update-center" }));
  app.get("/metrics", bearer(metricsToken, "Credencial de monitoramento invalida."), (_req, res) => {
    const installations = Object.values(store.state.installations);
    const releases = Object.values(store.state.releases);
    const failed = installations.filter((item) => ["failed", "rollback"].includes(item.status)).length;
    res.type("text/plain").send([
      "# HELP erp_update_installations Total de instalacoes registradas.",
      "# TYPE erp_update_installations gauge", `erp_update_installations ${installations.length}`,
      "# HELP erp_update_installations_failed Instalacoes em falha ou rollback.",
      "# TYPE erp_update_installations_failed gauge", `erp_update_installations_failed ${failed}`,
      "# HELP erp_update_releases Total de releases registradas por status.",
      "# TYPE erp_update_releases gauge",
      ...["draft", "published", "blocked"].map((status) => `erp_update_releases{status="${status}"} ${releases.filter((item) => item.status === status).length}`),
      `erp_update_distribution_suspended ${store.state.suspended ? 1 : 0}`, "",
    ].join("\n"));
  });
  app.post("/api/v1/enroll", express.json({ limit: "64kb" }), (req, res, next) => {
    try {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const body = req.body || {};
      if (!body.installationId || !body.publicKey) throw Object.assign(new Error("Identidade incompleta."), { status: 400 });
      const installation = store.enroll(token, {
        installationId: String(body.installationId), publicKey: String(body.publicKey),
        version: assertSemver(body.version), platform: String(body.platform), architecture: String(body.architecture),
        nodeVersion: String(body.nodeVersion || ""), agentVersion: assertSemver(body.agentVersion, "agentVersion"), channel: String(body.channel || "stable"),
      });
      res.status(201).json({ ok: true, installation: publicInstallation(installation) });
    } catch (error) { next(error); }
  });

  const signedJson = [express.raw({ type: "application/json", limit: "256kb" }), signed(store, nonces)];
  app.post("/api/v1/check", ...signedJson, (req, res, next) => {
    try {
      const input = JSON.parse(req.body.toString("utf8") || "{}");
      const installation = store.heartbeat(req.installation.installationId, {
        version: assertSemver(input.version), status: String(input.status || "online"),
        platform: String(input.platform), architecture: String(input.architecture), nodeVersion: String(input.nodeVersion || ""), agentVersion: String(input.agentVersion || ""),
      });
      const release = store.eligible(installation);
      res.json({ ok: true, update: release ? { manifest: release.manifest, signature: release.signature, downloadUrl: `/api/v1/packages/${encodeURIComponent(release.manifest.version)}` } : null, suspended: store.state.suspended });
    } catch (error) { next(error); }
  });
  app.post("/api/v1/events", ...signedJson, (req, res, next) => {
    try {
      const input = JSON.parse(req.body.toString("utf8") || "{}");
      const event = store.event(req.installation.installationId, { type: String(input.type || "unknown"), version: input.version ? assertSemver(input.version) : null, previousVersion: input.previousVersion || null, durationMs: Number(input.durationMs || 0), detail: String(input.detail || "").slice(0, 2000), occurredAt: input.occurredAt || new Date().toISOString() });
      if (["installed", "rollback"].includes(event.type)) store.heartbeat(req.installation.installationId, { version: event.type === "installed" ? event.version : event.previousVersion, status: event.type });
      res.status(202).json({ ok: true, eventId: event.id });
    } catch (error) { next(error); }
  });
  app.get("/api/v1/packages/:version", signed(store, nonces), (req, res, next) => {
    try {
      const release = store.state.releases[req.params.version];
      const installation = store.state.installations[req.installation.installationId];
      if (!release || store.eligible(installation)?.manifest.version !== release.manifest.version) throw Object.assign(new Error("Pacote nao autorizado."), { status: 403 });
      res.download(release.packagePath, release.manifest.package.filename);
    } catch (error) { next(error); }
  });

  app.use("/api/admin", (req, res, next) => req.method === "GET" ? reader(adminToken, readToken)(req, res, next) : admin(adminToken)(req, res, next));
  app.get("/api/admin/summary", (_req, res) => {
    const installations = Object.values(store.state.installations);
    const latest = Object.values(store.state.releases).filter((item) => item.status === "published").sort((a, b) => compareSemver(b.manifest.version, a.manifest.version))[0]?.manifest.version || null;
    res.json({ ok: true, suspended: store.state.suspended, latestVersion: latest, totals: { installations: installations.length, recent: installations.filter((item) => Date.now() - Date.parse(item.lastSeenAt || 0) < 60 * 60_000).length, failed: installations.filter((item) => item.status === "failed" || item.status === "rollback").length, current: installations.filter((item) => item.version === latest).length } });
  });
  app.get("/api/admin/installations", (_req, res) => res.json({ ok: true, installations: Object.values(store.state.installations).map(publicInstallation) }));
  app.get("/api/admin/releases", (_req, res) => res.json({ ok: true, releases: Object.values(store.state.releases).map(({ packagePath: _omit, ...item }) => item) }));
  app.get("/api/admin/events", (req, res) => {
    let events = store.state.events;
    for (const key of ["installationId", "version", "type"]) if (req.query[key]) events = events.filter((item) => item[key] === req.query[key]);
    res.json({ ok: true, events: events.slice(-500).reverse() });
  });
  app.post("/api/admin/enrollment-tokens", express.json({ limit: "16kb" }), (req, res, next) => { try { res.status(201).json({ ok: true, token: store.createEnrollmentToken(req.body) }); } catch (error) { next(error); } });
  app.post("/api/admin/releases/:version/package", express.raw({ type: "application/octet-stream", limit: process.env.UPDATE_CENTER_MAX_PACKAGE || "500mb" }), (req, res, next) => {
    try {
      const manifest = JSON.parse(Buffer.from(String(req.headers["x-update-manifest"] || ""), "base64url").toString("utf8"));
      const signature = String(req.headers["x-update-signature"] || "");
      if (!releasePublicKey) throw Object.assign(new Error("Chave publica de releases nao configurada na central."), { status: 503 });
      if (!verifyManifest(manifest, signature, releasePublicKey)) throw Object.assign(new Error("Assinatura de release invalida."), { status: 400 });
      if (manifest.version !== req.params.version || manifest.package.sha256 !== sha256(req.body) || Number(manifest.package.size) !== req.body.length) throw Object.assign(new Error("Pacote ou manifesto inconsistente."), { status: 400 });
      const filename = safeChild(store.packagesDir, `${assertSemver(manifest.version)}.tar.gz`);
      fs.writeFileSync(filename, req.body, { flag: "wx" });
      res.status(201).json({ ok: true, release: store.release(manifest, signature, filename) });
    } catch (error) { next(error); }
  });
  app.post("/api/admin/authorizations", express.json({ limit: "16kb" }), (req, res, next) => { try { const authorization = store.authorize({ ...req.body, actor: req.adminActor }); store.event("__admin__", { type: "authorization_created", version: authorization.version, detail: `${req.adminActor}:${authorization.id}` }); res.status(201).json({ ok: true, authorization }); } catch (error) { next(error); } });
  app.patch("/api/admin/releases/:version", express.json({ limit: "8kb" }), (req, res, next) => { try { const release = store.state.releases[req.params.version]; if (!release) throw Object.assign(new Error("Versao inexistente."), { status: 404 }); if (!["draft", "published", "blocked"].includes(req.body.status)) throw Object.assign(new Error("Status invalido."), { status: 400 }); release.status = req.body.status; store.save(); store.event("__admin__", { type: "release_status_changed", version: req.params.version, detail: `${req.adminActor}:${req.body.status}` }); res.json({ ok: true, release: { ...release, packagePath: undefined } }); } catch (error) { next(error); } });
  app.post("/api/admin/suspension", express.json({ limit: "8kb" }), (req, res) => { store.state.suspended = Boolean(req.body.suspended); store.save(); store.event("__admin__", { type: "distribution_suspension", detail: `${req.adminActor}:${store.state.suspended}` }); res.json({ ok: true, suspended: store.state.suspended }); });
  app.post("/api/admin/installations/:id/revoke", (req, res, next) => { try { const item = store.state.installations[req.params.id]; if (!item) throw Object.assign(new Error("Instalacao inexistente."), { status: 404 }); item.revokedAt = new Date().toISOString(); store.save(); store.event("__admin__", { type: "installation_revoked", detail: `${req.adminActor}:${req.params.id}` }); res.json({ ok: true }); } catch (error) { next(error); } });

  const uiDir = options.uiDir || path.join(import.meta.dirname, "dist");
  if (fs.existsSync(uiDir)) app.use(express.static(uiDir));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, error: error.message }));
  return { app, store };
}

function admin(token) {
  return (req, res, next) => {
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const valid = supplied.length === token.length && Buffer.byteLength(supplied) === Buffer.byteLength(token) && cryptoSafeEqual(supplied, token);
    if (!valid) return res.status(401).json({ ok: false, error: "Credencial administrativa invalida." });
    req.adminActor = String(req.headers["x-admin-actor"] || "admin").slice(0, 120);
    next();
  };
}

function reader(adminToken, readToken) {
  return bearer([adminToken, readToken].filter(Boolean), "Credencial de leitura invalida.");
}

function bearer(tokens, message) {
  const allowed = [].concat(tokens || []).filter(Boolean);
  return (req, res, next) => {
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const valid = allowed.some((token) => supplied.length === token.length && Buffer.byteLength(supplied) === Buffer.byteLength(token) && cryptoSafeEqual(supplied, token));
    if (!valid) return res.status(401).json({ ok: false, error: message });
    next();
  };
}

function cryptoSafeEqual(a, b) { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }

function signed(store, nonces) {
  return (req, res, next) => {
    const id = String(req.headers["x-installation-id"] || "");
    const timestamp = Number(req.headers["x-update-timestamp"]);
    const nonce = String(req.headers["x-update-nonce"] || "");
    const signature = String(req.headers["x-update-signature"] || "");
    const installation = store.state.installations[id];
    if (!installation || installation.revokedAt) return res.status(401).json({ ok: false, error: "Instalacao nao autorizada." });
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000 || !nonce) return res.status(401).json({ ok: false, error: "Requisicao expirada." });
    const nonceKey = `${id}:${nonce}`;
    if (nonces.has(nonceKey)) return res.status(409).json({ ok: false, error: "Requisicao repetida." });
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyRequest({ method: req.method, pathname: req.path, timestamp, nonce, body }, signature, installation.publicKey)) return res.status(401).json({ ok: false, error: "Assinatura invalida." });
    nonces.set(nonceKey, timestamp);
    for (const [key, value] of nonces) if (Date.now() - value > 10 * 60_000) nonces.delete(key);
    req.installation = installation;
    next();
  };
}

function publicInstallation({ publicKey: _key, ...installation }) { return installation; }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (!process.env.UPDATE_SIGNING_PUBLIC_KEY_FILE) throw new Error("UPDATE_SIGNING_PUBLIC_KEY_FILE e obrigatorio.");
  const port = Number(process.env.UPDATE_CENTER_PORT || 8443);
  const { app } = createUpdateCenter();
  app.listen(port, process.env.UPDATE_CENTER_HOST || "127.0.0.1", () => console.log(`Central de atualizacoes ouvindo na porta ${port}. Use um proxy HTTPS em producao.`));
}
