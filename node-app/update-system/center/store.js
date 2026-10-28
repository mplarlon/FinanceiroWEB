import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson, compareSemver, readJson } from "../shared.js";

const EMPTY = { installations: {}, releases: {}, authorizations: [], events: [], enrollmentTokens: {}, suspended: false };

export class UpdateStore {
  constructor(dataDir, options = {}) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, "center.json");
    this.packagesDir = path.join(this.dataDir, "packages");
    fs.mkdirSync(this.packagesDir, { recursive: true });
    this.state = readJson(this.file, EMPTY);
    this.enrollmentKey = String(options.enrollmentKey ?? process.env.UPDATE_CENTER_ENROLLMENT_KEY ?? "");
  }

  save() { atomicWriteJson(this.file, this.state); }

  createEnrollmentToken({ clientId, companyName, group = "pilot", expiresInMinutes = 60 }) {
    const token = crypto.randomBytes(32).toString("base64url");
    const digest = crypto.createHash("sha256").update(token).digest("hex");
    this.state.enrollmentTokens[digest] = { clientId, companyName, group, expiresAt: Date.now() + expiresInMinutes * 60_000 };
    this.save();
    return token;
  }

  enroll(token, installation) {
    const supplied = String(token || "");
    if (sameSecret(supplied, this.enrollmentKey)) {
      if (this.state.installations[installation.installationId]) throw Object.assign(new Error("Instalacao ja registrada."), { status: 409 });
      const companyName = String(installation.companyName || installation.hostname || "").slice(0, 160);
      this.state.installations[installation.installationId] = { ...installation, clientId: installation.installationId, group: "pilot", companyName, status: "registered", enrolledAt: new Date().toISOString(), revokedAt: null };
      this.save();
      return this.state.installations[installation.installationId];
    }
    const digest = crypto.createHash("sha256").update(supplied).digest("hex");
    const grant = this.state.enrollmentTokens[digest];
    if (!grant || grant.usedAt || grant.expiresAt < Date.now()) throw Object.assign(new Error("Token de registro invalido ou expirado."), { status: 401 });
    if (this.state.installations[installation.installationId]) throw Object.assign(new Error("Instalacao ja registrada."), { status: 409 });
    grant.usedAt = Date.now();
    const companyName = String(installation.companyName || grant.companyName || "").slice(0, 160);
    this.state.installations[installation.installationId] = { ...installation, clientId: grant.clientId, group: grant.group, companyName, status: "registered", enrolledAt: new Date().toISOString(), revokedAt: null };
    this.save();
    return this.state.installations[installation.installationId];
  }

  heartbeat(id, patch) {
    const item = this.state.installations[id];
    if (!item) throw Object.assign(new Error("Instalacao desconhecida."), { status: 401 });
    Object.assign(item, patch, { lastSeenAt: new Date().toISOString() });
    this.save();
    return item;
  }

  release(manifest, signature, packagePath) {
    this.state.releases[manifest.version] = { manifest, signature, packagePath, status: "draft", createdAt: new Date().toISOString() };
    this.save();
    return this.state.releases[manifest.version];
  }

  removeRelease(version) {
    const release = this.state.releases[version];
    if (!release) throw Object.assign(new Error("Versao inexistente."), { status: 404 });
    if (release.packagePath) fs.rmSync(release.packagePath, { force: true });
    delete this.state.releases[version];
    this.state.authorizations = this.state.authorizations.filter((item) => item.version !== version);
    this.save();
  }

  authorize({ version, installationId = null, group = null, percentage = 100, actor }) {
    const release = this.state.releases[version];
    if (!release || release.status === "blocked") throw Object.assign(new Error("Versao indisponivel."), { status: 409 });
    release.status = "published";
    const authorization = { id: crypto.randomUUID(), version, installationId, group, percentage: Math.max(0, Math.min(100, Number(percentage))), actor, createdAt: new Date().toISOString(), paused: false };
    this.state.authorizations.push(authorization);
    this.save();
    return authorization;
  }

  eligible(installation) {
    if (this.state.suspended) return null;
    const authorized = this.state.authorizations.filter((item) => !item.paused && (!item.installationId || item.installationId === installation.installationId) && (!item.group || item.group === installation.group));
    return Object.values(this.state.releases)
      .filter((release) => release.status === "published" && compareSemver(release.manifest.version, installation.version) > 0)
      .filter((release) => authorized.some((authorization) => authorization.version === release.manifest.version && rolloutIncludes(installation.installationId, authorization.percentage)))
      .filter((release) => compatible(release.manifest, installation))
      .sort((a, b) => compareSemver(b.manifest.version, a.manifest.version))[0] || null;
  }

  event(installationId, input) {
    const event = { id: crypto.randomUUID(), installationId, ...input, receivedAt: new Date().toISOString() };
    this.state.events.push(event);
    if (this.state.events.length > 20_000) this.state.events.splice(0, this.state.events.length - 20_000);
    this.save();
    return event;
  }
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function rolloutIncludes(id, percentage) {
  if (percentage >= 100) return true;
  const bucket = Number.parseInt(crypto.createHash("sha256").update(id).digest("hex").slice(0, 8), 16) % 100;
  return bucket < percentage;
}

function compatible(manifest, installation) {
  const platforms = Array.isArray(manifest.platform) ? manifest.platform : [manifest.platform];
  const architectures = Array.isArray(manifest.architecture) ? manifest.architecture : [manifest.architecture];
  return platforms.includes(installation.platform) && architectures.includes(installation.architecture);
}
