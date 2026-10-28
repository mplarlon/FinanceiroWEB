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
  const store = options.store || new UpdateStore(dataDir, { enrollmentKey: options.enrollmentKey ?? process.env.UPDATE_CENTER_ENROLLMENT_KEY });
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
        companyName: text(body.companyName, 160), hostname: text(body.hostname, 120), addresses: addressesOf(body.addresses), installPath: installPathOf(body.installPath), remoteAddress: seenAddress(req),
      });
      res.status(201).json({ ok: true, installation: publicInstallation(installation) });
    } catch (error) { next(error); }
  });

  const signedJson = [express.raw({ type: "application/json", limit: "256kb" }), signed(store, nonces)];
  app.post("/api/v1/check", ...signedJson, (req, res, next) => {
    try {
      const input = JSON.parse(req.body.toString("utf8") || "{}");
      const patch = {
        version: assertSemver(input.version), status: String(input.status || "online"),
        platform: String(input.platform), architecture: String(input.architecture), nodeVersion: String(input.nodeVersion || ""), agentVersion: String(input.agentVersion || ""),
        remoteAddress: seenAddress(req),
      };
      if (input.hostname) patch.hostname = text(input.hostname, 120);
      if (input.companyName) patch.companyName = text(input.companyName, 160);
      if (Array.isArray(input.addresses)) patch.addresses = addressesOf(input.addresses);
      if (input.installPath) patch.installPath = installPathOf(input.installPath);
      const installation = store.heartbeat(req.installation.installationId, patch);
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
    const outdated = installations.filter((item) => isOutdated(item, latest)).length;
    res.json({ ok: true, suspended: store.state.suspended, latestVersion: latest, totals: { installations: installations.length, recent: installations.filter((item) => Date.now() - Date.parse(item.lastSeenAt || 0) < 60 * 60_000).length, failed: installations.filter((item) => item.status === "failed" || item.status === "rollback").length, current: installations.filter((item) => item.version === latest).length, outdated } });
  });
  app.get("/api/admin/installations", (_req, res) => {
    const latest = latestPublished(store);
    res.json({ ok: true, installations: Object.values(store.state.installations).map((item) => ({ ...publicInstallation(item), outdated: isOutdated(item, latest) })) });
  });
  app.get("/api/admin/releases", (_req, res) => res.json({ ok: true, releases: Object.values(store.state.releases).map(({ packagePath: _omit, ...item }) => item) }));
  app.get("/api/admin/events", (req, res) => {
    let events = store.state.events;
    for (const key of ["installationId", "version", "type"]) if (req.query[key]) events = events.filter((item) => item[key] === req.query[key]);
    res.json({ ok: true, events: events.slice(-500).reverse().map((event) => presentAuditEvent(store, event)) });
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
  app.post("/api/admin/authorizations", express.json({ limit: "16kb" }), (req, res, next) => { try { const authorization = store.authorize({ ...req.body, actor: req.adminActor }); const detail = authorization.installationId ? "maquina" : authorization.group ? `grupo:${authorization.group}` : `lote:${authorization.percentage}`; store.event(authorization.installationId || "__admin__", { type: "authorization_created", version: authorization.version, detail }); res.status(201).json({ ok: true, authorization }); } catch (error) { next(error); } });
  app.patch("/api/admin/releases/:version", express.json({ limit: "8kb" }), (req, res, next) => { try { const release = store.state.releases[req.params.version]; if (!release) throw Object.assign(new Error("Versao inexistente."), { status: 404 }); if (!["draft", "published", "blocked"].includes(req.body.status)) throw Object.assign(new Error("Status invalido."), { status: 400 }); release.status = req.body.status; store.save(); store.event("__admin__", { type: "release_status_changed", version: req.params.version, detail: req.body.status }); res.json({ ok: true, release: { ...release, packagePath: undefined } }); } catch (error) { next(error); } });
  app.delete("/api/admin/releases/:version", (req, res, next) => { try { store.removeRelease(assertSemver(req.params.version)); store.event("__admin__", { type: "release_deleted", version: req.params.version, detail: "excluida" }); res.json({ ok: true }); } catch (error) { next(error); } });
  app.post("/api/admin/suspension", express.json({ limit: "8kb" }), (req, res) => { store.state.suspended = Boolean(req.body.suspended); store.save(); store.event("__admin__", { type: "distribution_suspension", detail: store.state.suspended ? "suspensa" : "retomada" }); res.json({ ok: true, suspended: store.state.suspended }); });
  app.post("/api/admin/installations/:id/revoke", (req, res, next) => { try { const item = store.state.installations[req.params.id]; if (!item) throw Object.assign(new Error("Instalacao inexistente."), { status: 404 }); item.revokedAt = new Date().toISOString(); store.save(); store.event(req.params.id, { type: "installation_revoked", detail: "revogada" }); res.json({ ok: true }); } catch (error) { next(error); } });

  const uiDir = options.uiDir || path.join(import.meta.dirname, "dist");
  if (fs.existsSync(uiDir)) app.use(express.static(uiDir));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, error: error.message }));
  return { app, store };
}

const AUDIT_LABEL = {
  blocked: "Bloqueada",
  published: "Publicada",
  draft: "Rascunho",
  online: "Online",
  offline: "Offline",
  failed: "Falha",
  rollback: "Revertida",
  revoked: "Revogada",
  outdated: "Desatualizada",
  current: "Atualizada",
  installed: "Instalada",
  download_started: "Download iniciado",
  deferred_critical_operation: "Adiada",
  authorization_created: "Liberação",
  release_status_changed: "Status da versão",
  distribution_suspension: "Suspensão",
  installation_revoked: "Revogação",
  release_deleted: "Versão excluída",
  unknown: "Desconhecido",
  registered: "Registrada",
};

export function presentAuditEvent(store, event) {
  const scope = auditScope(store, event);
  const installation = scope.installation || null;
  return {
    ...event,
    machineId: installation?.installationId || "",
    label: AUDIT_LABEL[event.type] || "Acontecimento",
    resumo: auditSummary(event, scope),
    companyName: installation ? (installation.companyName || "Sem empresa") : "Central",
    hostname: installation?.hostname || "",
    addresses: installation?.addresses || [],
    group: installation?.group || "",
    nota: installation ? "" : (scope.nota || ""),
  };
}

function auditScope(store, event) {
  const direct = event.installationId && event.installationId !== "__admin__" ? store.state.installations[event.installationId] : null;
  if (event.type === "installation_revoked") {
    const id = String(event.detail || "").split(":").pop();
    return { installation: direct || store.state.installations[id] || null };
  }
  if (event.type !== "authorization_created") return { installation: direct || null };
  if (direct) return { installation: direct };
  const detail = String(event.detail || "");
  const group = /^grupo:(.+)$/.exec(detail);
  if (group) return { nota: `Grupo ${groupName(group[1])}` };
  const lote = /^lote:(\d+(?:\.\d+)?)$/.exec(detail);
  if (lote) {
    const percentage = Number(lote[1]);
    return { nota: percentage >= 100 ? "Todas as máquinas" : `${percentage}% das máquinas` };
  }
  const referenced = detail.split(":").pop();
  const authorization = (store.state.authorizations || []).find((item) => item.id === referenced);
  if (authorization?.installationId && store.state.installations[authorization.installationId]) return { installation: store.state.installations[authorization.installationId] };
  if (authorization?.group) return { nota: `Grupo ${groupName(authorization.group)}` };
  if (authorization) {
    const percentage = Number(authorization.percentage);
    return { nota: percentage >= 100 ? "Todas as máquinas" : `${percentage}% das máquinas` };
  }
  return { nota: "Todas as máquinas" };
}

function auditSummary(event, scope) {
  const detail = String(event.detail || "").trim();
  switch (event.type) {
    case "download_started":
      return "O pacote começou a ser baixado nesta máquina.";
    case "installed":
      return event.previousVersion ? `A versão ${event.version} substituiu a ${event.previousVersion}.` : "A atualização foi concluída nesta máquina.";
    case "failed":
      return translateFailure(detail) || "A atualização falhou nesta máquina.";
    case "rollback":
      return translateFailure(detail) || "A atualização foi desfeita e a versão anterior voltou.";
    case "deferred_critical_operation":
      return "A atualização foi adiada porque a máquina estava no meio de uma operação.";
    case "authorization_created":
      if (scope.installation) return "A versão foi liberada para esta máquina.";
      if (scope.nota?.startsWith("Grupo ")) return `A versão foi liberada para o grupo ${scope.nota.slice(6)}.`;
      if (scope.nota) return `A versão foi liberada para ${scope.nota.charAt(0).toLowerCase()}${scope.nota.slice(1)}.`;
      return "A versão foi liberada.";
    case "release_status_changed": {
      const label = AUDIT_LABEL[detail.split(":").pop()];
      return label ? `O status da versão passou para ${label.toLowerCase()}.` : "O status da versão foi alterado.";
    }
    case "distribution_suspension": {
      const flag = detail.split(":").pop();
      return flag === "true" || flag === "suspensa" ? "A distribuição de atualizações foi suspensa." : "A distribuição de atualizações foi retomada.";
    }
    case "installation_revoked":
      return "Esta máquina deixou de receber atualizações.";
    case "release_deleted":
      return "A versão foi excluída da central.";
    default:
      return translateFailure(detail) || "—";
  }
}

function translateFailure(detail) {
  const text = String(detail || "").trim();
  if (!text) return "";
  if (/EXDEV|cross-device link not permitted/i.test(text)) return "A atualização foi desfeita porque a pasta do sistema está em outro disco e a troca direta não foi permitida.";
  const known = [
    [/Agente precisa ser atualizado antes deste pacote\.?/i, "O atualizador desta máquina precisa ser atualizado antes deste pacote."],
    [/Assinatura do manifesto invalida/i, "A assinatura do pacote não confere."],
    [/nao e superior a instalada/i, "A versão oferecida não é mais nova do que a instalada."],
    [/incompativel com esta plataforma/i, "Esta versão não serve para o sistema desta máquina."],
    [/Manifesto nao informa integridade/i, "O pacote não informa a verificação de integridade."],
    [/estrategia de banco nao automatizavel/i, "Esta atualização exige um procedimento manual de banco."],
    [/Rollback destrutivo automatico/i, "Não é permitido desfazer o banco automaticamente."],
    [/Pacote excede o limite/i, "O pacote é maior que o limite configurado."],
    [/Hash ou tamanho do pacote invalido/i, "O pacote chegou incompleto ou alterado."],
    [/Download recusado \(HTTP (\d+)\)/i, "O download foi recusado (HTTP $1)."],
    [/Timeout no download/i, "O download demorou demais e foi interrompido."],
    [/Pacote vazio ou com arquivos demais/i, "O pacote está vazio ou tem arquivos demais."],
    [/caminho inseguro/i, "O pacote contém um caminho não permitido."],
    [/link nao permitido/i, "O pacote contém um atalho não permitido."],
    [/Health check HTTP (\d+)/i, "O sistema não respondeu depois da atualização (HTTP $1)."],
    [/Health check falhou/i, "O sistema não respondeu depois da atualização."],
    [/Pacote incompleto: (.+)/i, "O pacote não contém $1."],
    [/Atualizacao revertida: (.+)/i, "A atualização foi desfeita: $1"],
  ];
  for (const [pattern, message] of known) if (pattern.test(text)) return text.replace(pattern, message).replace(/\.{2,}/g, ".");
  return text;
}

function groupName(group) {
  return { pilot: "Pilotos", production: "Produção" }[group] || String(group || "geral");
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

function text(value, max) { return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max); }

function cleanAddress(value) {
  const raw = String(value || "").trim().replace(/^::ffff:/i, "");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw) && raw.split(".").every((part) => Number(part) <= 255)) return raw;
  if (/^[0-9a-f:]{2,45}$/i.test(raw) && raw.includes(":")) return raw.slice(0, 45);
  return "";
}

function addressesOf(value) { return [...new Set((Array.isArray(value) ? value : []).map(cleanAddress).filter(Boolean))].slice(0, 8); }

function installPathOf(value) {
  const raw = text(value, 240);
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(raw)) return "";
  return raw;
}

function seenAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return cleanAddress(forwarded || req.socket?.remoteAddress || "");
}

function latestPublished(store) {
  return Object.values(store.state.releases).filter((item) => item.status === "published").sort((a, b) => compareSemver(b.manifest.version, a.manifest.version))[0]?.manifest.version || null;
}

function isOutdated(installation, latest) {
  if (!latest || installation.revokedAt || !installation.version) return false;
  try { return compareSemver(latest, installation.version) > 0; } catch { return false; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (!process.env.UPDATE_SIGNING_PUBLIC_KEY_FILE) throw new Error("UPDATE_SIGNING_PUBLIC_KEY_FILE e obrigatorio.");
  const port = Number(process.env.UPDATE_CENTER_PORT || 8443);
  const { app } = createUpdateCenter();
  app.listen(port, process.env.UPDATE_CENTER_HOST || "127.0.0.1", () => console.log(`Central de atualizacoes ouvindo na porta ${port}. Use um proxy HTTPS em producao.`));
}
