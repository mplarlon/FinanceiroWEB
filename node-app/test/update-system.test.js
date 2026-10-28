import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { movePath, UpdateEngine } from "../update-system/agent/engine.js";
import { activeBlockers, localAddresses, readCompanyFromDatabase, resolveCompanyName, UpdateAgent, withinUpdateWindow } from "../update-system/agent/agent.js";
import { syncUpdaterAgent } from "../server/lib/sync-updater-agent.js";
import { UpdateStore } from "../update-system/center/store.js";
import { createUpdateCenter } from "../update-system/center/server.js";
import { answerUpdateQuestion } from "../server/lib/update-center-client.js";
import { compareSemver, generateInstallationIdentity, sha256, signManifest, signRequest, verifyManifest, verifyRequest } from "../update-system/shared.js";

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "erp-updater-test-")); }
function keys() { return crypto.generateKeyPairSync("ed25519"); }
function manifest(bytes, overrides = {}) {
  return { version: "2.5.0", channel: "stable", releaseDate: new Date().toISOString(), minimumAgentVersion: "1.0.0", platform: [process.platform], architecture: [process.arch], package: { filename: "update.tar.gz", sha256: sha256(bytes), size: bytes.length }, ...overrides };
}

test("versionamento semantico ordena major, minor e patch", () => {
  assert.equal(compareSemver("2.0.0", "1.99.99"), 1);
  assert.equal(compareSemver("1.2.1", "1.2.1"), 0);
  assert.throws(() => compareSemver("1.2", "1.2.0"));
});

test("endereco local ignora loopback e link-local", () => {
  const addresses = localAddresses({ lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }], eth: [{ family: "IPv4", internal: false, address: "192.168.0.20" }, { family: "IPv4", internal: false, address: "169.254.1.2" }, { family: "IPv6", internal: false, address: "fe80::1" }] });
  assert.deepEqual(addresses, ["192.168.0.20"]);
});

test("janela noturna e bloqueadores de operacao critica adiam atualizacao", () => {
  assert.equal(withinUpdateWindow("22:00-05:00", new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(withinUpdateWindow("22:00-05:00", new Date(2026, 0, 1, 12, 0)), false);
  assert.equal(withinUpdateWindow("imediata", new Date(2026, 0, 1, 12, 0)), true);
  const root = temporary(); const directory = path.join(root, "update-blockers"); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, "active.json"), JSON.stringify({ type: "fechamento", expiresAt: new Date(Date.now() + 60_000).toISOString() })); fs.writeFileSync(path.join(directory, "expired.json"), JSON.stringify({ type: "old", expiresAt: new Date(Date.now() - 60_000).toISOString() }));
  assert.deepEqual(activeBlockers(root).map((item) => item.type), ["fechamento"]); assert.equal(fs.existsSync(path.join(directory, "expired.json")), false);
});

test("manifesto assinado detecta adulteracao e assinatura invalida", () => {
  const pair = keys(); const item = manifest(Buffer.from("x")); const signature = signManifest(item, pair.privateKey);
  assert.equal(verifyManifest(item, signature, pair.publicKey), true);
  assert.equal(verifyManifest({ ...item, version: "9.0.0" }, signature, pair.publicKey), false);
  assert.equal(verifyManifest(item, Buffer.from("invalid").toString("base64"), pair.publicKey), false);
});

test("assinatura individual vincula metodo, rota, nonce, data e corpo", () => {
  const identity = generateInstallationIdentity(); const body = Buffer.from('{"version":"2.4.5"}');
  const input = { method: "POST", pathname: "/api/v1/check", timestamp: Date.now(), nonce: "unique", body };
  const signature = signRequest(input, identity.privateKey);
  assert.equal(verifyRequest(input, signature, identity.publicKey), true);
  assert.equal(verifyRequest({ ...input, pathname: "/api/v1/events" }, signature, identity.publicKey), false);
});

test("chave compartilhada registra cada instalacao sem queimar o segredo", () => {
  const store = new UpdateStore(temporary(), { enrollmentKey: "shared-key-value-1234567890" });
  const first = generateInstallationIdentity(); const second = generateInstallationIdentity();
  const franklin = store.enroll("shared-key-value-1234567890", { installationId: first.installationId, publicKey: first.publicKey, version: "1.0.0", platform: "win32", architecture: "x64", companyName: "Franklin" });
  const outro = store.enroll("shared-key-value-1234567890", { installationId: second.installationId, publicKey: second.publicKey, version: "1.0.0", platform: "win32", architecture: "x64", companyName: "Outro cliente" });
  assert.equal(franklin.companyName, "Franklin"); assert.equal(outro.companyName, "Outro cliente"); assert.equal(franklin.group, "pilot");
  assert.throws(() => store.enroll("", { installationId: "vazio", publicKey: "x", version: "1.0.0", platform: "win32", architecture: "x64" }), /invalido|expirado/);
  assert.throws(() => store.enroll("shared-key-value-1234567890", { installationId: first.installationId, publicKey: first.publicKey, version: "1.0.0", platform: "win32", architecture: "x64" }), /ja registrada/);
});

test("central registra instalacao uma vez e permite revogacao isolada", () => {
  const store = new UpdateStore(temporary()); const token = store.createEnrollmentToken({ clientId: "c1", companyName: "Empresa A" }); const identity = generateInstallationIdentity();
  const item = store.enroll(token, { installationId: identity.installationId, publicKey: identity.publicKey, version: "2.4.5", platform: process.platform, architecture: process.arch });
  assert.equal(item.companyName, "Empresa A");
  assert.throws(() => store.enroll(token, { installationId: "other" }), /invalido|expirado/);
  item.revokedAt = new Date().toISOString(); store.save(); assert.ok(store.state.installations[identity.installationId].revokedAt);
});

test("central nao oferece versao sem autorizacao, bloqueada ou incompativel", () => {
  const root = temporary(); const store = new UpdateStore(root); const installation = { installationId: "i1", version: "2.4.5", group: "pilot", platform: process.platform, architecture: process.arch };
  store.state.installations.i1 = installation; store.release(manifest(Buffer.from("x")), "sig", path.join(root, "x"));
  assert.equal(store.eligible(installation), null);
  store.authorize({ version: "2.5.0", group: "pilot", actor: "tester" }); assert.equal(store.eligible(installation).manifest.version, "2.5.0");
  store.state.releases["2.5.0"].status = "blocked"; assert.equal(store.eligible(installation), null);
  store.state.releases["2.5.0"].status = "published"; assert.equal(store.eligible({ ...installation, architecture: "unsupported" }), null);
  store.state.suspended = true; assert.equal(store.eligible(installation), null);
});

test("remove versao publicada e o pacote", () => {
  const root = temporary(); const store = new UpdateStore(root); const packagePath = path.join(store.packagesDir, "2.5.0.tar.gz");
  fs.writeFileSync(packagePath, "pacote"); store.release(manifest(Buffer.from("x")), "sig", packagePath); store.authorize({ version: "2.5.0", percentage: 100, actor: "tester" });
  store.removeRelease("2.5.0");
  assert.equal(store.state.releases["2.5.0"], undefined);
  assert.equal(store.state.authorizations.length, 0);
  assert.equal(fs.existsSync(packagePath), false);
});

test("rollout e cliente atualizado nao repetem instalacao", () => {
  const root = temporary(); const store = new UpdateStore(root); const item = { installationId: "i1", version: "2.5.0", group: "production", platform: process.platform, architecture: process.arch };
  store.state.installations.i1 = item; store.release(manifest(Buffer.from("x")), "sig", path.join(root, "x")); store.authorize({ version: "2.5.0", percentage: 100, actor: "tester" });
  assert.equal(store.eligible(item), null);
});

test("instalacao valida ativa pacote e preserva backup", async () => {
  const root = temporary(); const installRoot = path.join(root, "install"); const dataDir = path.join(root, "data"); const live = path.join(installRoot, "node-app"); fs.mkdirSync(live, { recursive: true }); fs.writeFileSync(path.join(live, "old.txt"), "old");
  const bytes = Buffer.from("package"); const packageFile = path.join(root, "package.tar.gz"); fs.writeFileSync(packageFile, bytes); const pair = keys(); const item = manifest(bytes); let stopped = 0; let started = 0;
  const engine = new UpdateEngine({ installRoot, dataDir, publicKey: pair.publicKey, serviceController: { stop: async () => { stopped += 1; }, start: async () => { started += 1; } }, healthCheck: async () => true, extract: async (_file, destination) => { fs.mkdirSync(path.join(destination, "node-app", "server"), { recursive: true }); fs.mkdirSync(path.join(destination, "node-app", "dist"), { recursive: true }); fs.writeFileSync(path.join(destination, "node-app", "server", "dashboard.mjs"), "new"); fs.writeFileSync(path.join(destination, "node-app", "dist", "index.html"), "new"); } });
  const result = await engine.install({ manifest: item, signature: signManifest(item, pair.privateKey) }, packageFile, "2.4.5");
  assert.equal(result.version, "2.5.0"); assert.equal(fs.readFileSync(path.join(live, "server", "dashboard.mjs"), "utf8"), "new"); assert.equal(fs.readdirSync(engine.backupsDir).length, 1); assert.equal(stopped, 1); assert.equal(started, 1);
});

test("falha de saude restaura automaticamente a versao anterior", async () => {
  const root = temporary(); const installRoot = path.join(root, "install"); const live = path.join(installRoot, "node-app"); fs.mkdirSync(live, { recursive: true }); fs.writeFileSync(path.join(live, "old.txt"), "old"); const bytes = Buffer.from("package"); const packageFile = path.join(root, "package.tar.gz"); fs.writeFileSync(packageFile, bytes); const pair = keys(); const item = manifest(bytes);
  const engine = new UpdateEngine({ installRoot, dataDir: path.join(root, "data"), publicKey: pair.publicKey, serviceController: { stop: async () => {}, start: async () => {} }, healthCheck: async () => { throw new Error("offline"); }, extract: async (_file, destination) => { fs.mkdirSync(path.join(destination, "node-app", "server"), { recursive: true }); fs.mkdirSync(path.join(destination, "node-app", "dist"), { recursive: true }); fs.writeFileSync(path.join(destination, "node-app", "server", "dashboard.mjs"), "new"); fs.writeFileSync(path.join(destination, "node-app", "dist", "index.html"), "new"); } });
  await assert.rejects(engine.install({ manifest: item, signature: signManifest(item, pair.privateKey) }, packageFile, "2.4.5"), /revertida/);
  assert.equal(fs.readFileSync(path.join(live, "old.txt"), "utf8"), "old"); assert.equal(JSON.parse(fs.readFileSync(engine.journalFile)).state, "rolled_back");
});

test("pacote corrompido, assinatura invalida e versao antiga sao recusados antes de parar servico", async () => {
  const root = temporary(); const bytes = Buffer.from("real"); const packageFile = path.join(root, "package.tar.gz"); fs.writeFileSync(packageFile, Buffer.from("corrupt")); const pair = keys(); const item = manifest(bytes); let stopped = false;
  const engine = new UpdateEngine({ installRoot: root, dataDir: path.join(root, "data"), publicKey: pair.publicKey, serviceController: { stop: async () => { stopped = true; }, start: async () => {} }, extract: async () => {} });
  await assert.rejects(engine.install({ manifest: item, signature: signManifest(item, pair.privateKey) }, packageFile, "2.4.5"), /Hash|tamanho/); assert.equal(stopped, false);
  assert.throws(() => engine.validateRelease({ manifest: item, signature: "bad" }, "2.4.5"), /Assinatura/);
  const old = manifest(bytes, { version: "2.4.4" }); assert.throws(() => engine.validateRelease({ manifest: old, signature: signManifest(old, pair.privateKey) }, "2.4.5"), /superior/);
});

test("recuperacao apos interrupcao usa journal persistente", async () => {
  const root = temporary(); const live = path.join(root, "install", "node-app"); const backup = path.join(root, "backup"); fs.mkdirSync(live, { recursive: true }); fs.mkdirSync(backup, { recursive: true }); fs.writeFileSync(path.join(live, "new"), "new"); fs.writeFileSync(path.join(backup, "old"), "old"); const engine = new UpdateEngine({ installRoot: path.join(root, "install"), dataDir: path.join(root, "data"), publicKey: keys().publicKey, serviceController: { stop: async () => {}, start: async () => {} } }); fs.mkdirSync(path.dirname(engine.journalFile), { recursive: true }); fs.writeFileSync(engine.journalFile, JSON.stringify({ state: "activated", live, backup }));
  assert.equal(await engine.recoverInterrupted(), true); assert.equal(fs.readFileSync(path.join(live, "old"), "utf8"), "old");
});

test("API central separa leitura e administracao, autentica instalacao e bloqueia replay", async (context) => {
  const root = temporary(); const releasePair = keys(); const { app, store } = createUpdateCenter({ dataDir: root, adminToken: "test-admin-token", readToken: "read-only-token", metricsToken: "metrics-token", releasePublicKey: releasePair.publicKey, uiDir: path.join(root, "missing") });
  const server = app.listen(0, "127.0.0.1"); context.after(() => server.close()); await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const denied = await fetch(`${base}/api/admin/summary`); assert.equal(denied.status, 401);
  const readable = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer read-only-token" } }); assert.equal(readable.status, 200);
  const readCannotWrite = await fetch(`${base}/api/admin/suspension`, { method: "POST", headers: { authorization: "Bearer read-only-token", "content-type": "application/json" }, body: "{\"suspended\":true}" }); assert.equal(readCannotWrite.status, 401);
  const metricsDenied = await fetch(`${base}/metrics`); assert.equal(metricsDenied.status, 401); const metrics = await fetch(`${base}/metrics`, { headers: { authorization: "Bearer metrics-token" } }); assert.match(await metrics.text(), /erp_update_installations/);
  const tokenResponse = await fetch(`${base}/api/admin/enrollment-tokens`, { method: "POST", headers: { authorization: "Bearer test-admin-token", "content-type": "application/json" }, body: JSON.stringify({ clientId: "c1", companyName: "Empresa A", group: "pilot" }) });
  const enrollmentToken = (await tokenResponse.json()).token; const identity = generateInstallationIdentity();
  const enrolled = await fetch(`${base}/api/v1/enroll`, { method: "POST", headers: { authorization: `Bearer ${enrollmentToken}`, "content-type": "application/json" }, body: JSON.stringify({ installationId: identity.installationId, publicKey: identity.publicKey, version: "2.4.5", platform: process.platform, architecture: process.arch, agentVersion: "1.0.0" }) }); assert.equal(enrolled.status, 201);
  const body = Buffer.from(JSON.stringify({ version: "2.4.5", platform: process.platform, architecture: process.arch, agentVersion: "1.0.0", companyName: "Boca do Mato", hostname: "CAIXA-01", addresses: ["192.168.0.15", "nao-e-ip"], installPath: "C:\\Administracao" })); const timestamp = Date.now(); const nonce = "single-use-nonce"; const signature = signRequest({ method: "POST", pathname: "/api/v1/check", timestamp, nonce, body }, identity.privateKey); const headers = { "content-type": "application/json", "x-installation-id": identity.installationId, "x-update-timestamp": String(timestamp), "x-update-nonce": nonce, "x-update-signature": signature };
  const checked = await fetch(`${base}/api/v1/check`, { method: "POST", headers, body }); assert.equal(checked.status, 200); assert.equal((await checked.json()).update, null);
  const saved = store.state.installations[identity.installationId]; assert.equal(saved.companyName, "Boca do Mato"); assert.equal(saved.hostname, "CAIXA-01"); assert.deepEqual(saved.addresses, ["192.168.0.15"]); assert.equal(saved.installPath, "C:\\Administracao"); assert.equal(saved.remoteAddress, "127.0.0.1");
  const replayed = await fetch(`${base}/api/v1/check`, { method: "POST", headers, body }); assert.equal(replayed.status, 409); assert.ok(store.state.installations[identity.installationId].lastSeenAt);
  const packageBytes = Buffer.from("signed-package"); const releaseManifest = manifest(packageBytes); const uploaded = await fetch(`${base}/api/admin/releases/2.5.0/package`, { method: "POST", headers: { authorization: "Bearer test-admin-token", "content-type": "application/octet-stream", "x-update-manifest": Buffer.from(JSON.stringify(releaseManifest)).toString("base64url"), "x-update-signature": signManifest(releaseManifest, releasePair.privateKey) }, body: packageBytes }); assert.equal(uploaded.status, 201);
  store.authorize({ version: "2.5.0", percentage: 100, actor: "test" }); const previousUrl = process.env.UPDATE_CENTER_URL; const previousToken = process.env.UPDATE_CENTER_READ_TOKEN; process.env.UPDATE_CENTER_URL = base; process.env.UPDATE_CENTER_READ_TOKEN = "read-only-token";
  try { const answer = await answerUpdateQuestion("Charlie, quais clientes estão desatualizados?"); assert.equal(answer.intencao.type, "atualizacoes_consulta"); assert.match(answer.resposta, /instalação/); } finally { if (previousUrl === undefined) delete process.env.UPDATE_CENTER_URL; else process.env.UPDATE_CENTER_URL = previousUrl; if (previousToken === undefined) delete process.env.UPDATE_CENTER_READ_TOKEN; else process.env.UPDATE_CENTER_READ_TOKEN = previousToken; }
});

test("agente registra de novo quando a central nao reconhece a instalacao", async (context) => {
  const root = temporary(); const shared = "shared-key-value-1234567890";
  const { app, store } = createUpdateCenter({ dataDir: path.join(root, "center"), adminToken: "admin-token", enrollmentKey: shared, uiDir: path.join(root, "missing") });
  const server = app.listen(0, "127.0.0.1"); context.after(() => server.close()); await new Promise((resolve) => server.once("listening", resolve));
  const centerUrl = `http://127.0.0.1:${server.address().port}`;
  const enrollmentToken = store.createEnrollmentToken({ clientId: "antigo", companyName: "Antigo", group: "pilot" });
  const agent = new UpdateAgent({ centerUrl, enrollmentToken, companyName: "Franklin", installRoot: path.join(root, "install"), dataDir: path.join(root, "data"), currentVersion: "1.0.0", engine: { recoverInterrupted: async () => {} } });
  await agent.initialize(); const forgotten = agent.identity.installationId;
  delete store.state.installations[forgotten]; store.save();
  agent.config.enrollmentToken = shared;
  const result = await agent.checkOnce();
  assert.deepEqual(result, { updated: false });
  assert.notEqual(agent.identity.installationId, forgotten);
  assert.equal(store.state.installations[agent.identity.installationId].companyName, "Franklin");
});

test("agente troca o token gasto pelo proximo da reserva", async (context) => {
  const root = temporary();
  const { app, store } = createUpdateCenter({ dataDir: path.join(root, "center"), adminToken: "admin-token", uiDir: path.join(root, "missing") });
  const server = app.listen(0, "127.0.0.1"); context.after(() => server.close()); await new Promise((resolve) => server.once("listening", resolve));
  const centerUrl = `http://127.0.0.1:${server.address().port}`;
  const spent = store.createEnrollmentToken({ clientId: "gasto", companyName: "Gasto", group: "pilot" });
  const reserve = store.createEnrollmentToken({ clientId: "reserva", companyName: "Reserva", group: "pilot" });
  const burned = generateInstallationIdentity();
  store.enroll(spent, { installationId: burned.installationId, publicKey: burned.publicKey, version: "1.0.0", platform: process.platform, architecture: process.arch, agentVersion: "1.0.0" });
  const installRoot = path.join(root, "install"); fs.mkdirSync(path.join(installRoot, "Updater"), { recursive: true });
  fs.writeFileSync(path.join(installRoot, "Updater", "enrollment-pool.json"), JSON.stringify({ tokens: [reserve] }));
  const agent = new UpdateAgent({ centerUrl, enrollmentToken: spent, companyName: "Franklin", installRoot, dataDir: path.join(root, "data"), currentVersion: "1.0.0", engine: { recoverInterrupted: async () => {} } });
  await agent.initialize();
  assert.equal(store.state.installations[agent.identity.installationId].companyName, "Franklin");
});

test("agente sem token fica instalado e nao grava identidade", async () => {
  const root = temporary(); const publicKeyFile = path.join(root, "release-public.pem"); fs.writeFileSync(publicKeyFile, keys().publicKey.export({ type: "spki", format: "pem" }));
  const agent = new UpdateAgent({ centerUrl: "https://financeiroweb.nuvempontual.com", enrollmentToken: "", companyName: "Empresa", installRoot: path.join(root, "install"), dataDir: path.join(root, "data"), releasePublicKey: publicKeyFile, currentVersion: "2.4.5", updateWindow: "22:00-05:00" });
  assert.equal(await agent.initialize(), false);
  assert.equal(fs.existsSync(path.join(root, "data", "updater", "identity.json")), false);
});

test("fluxo integrado publica, autoriza, baixa, ativa e confirma a atualizacao", async (context) => {
  const root = temporary(); const releasePair = keys(); const { app, store } = createUpdateCenter({ dataDir: path.join(root, "center"), adminToken: "admin-token", releasePublicKey: releasePair.publicKey, uiDir: path.join(root, "missing") });
  const server = app.listen(0, "127.0.0.1"); context.after(() => server.close()); await new Promise((resolve) => server.once("listening", resolve)); const centerUrl = `http://127.0.0.1:${server.address().port}`;
  const installRoot = path.join(root, "install"); const dataDir = path.join(root, "client-data"); const live = path.join(installRoot, "node-app"); fs.mkdirSync(live, { recursive: true }); fs.writeFileSync(path.join(live, "old.txt"), "old");
  const packageStage = path.join(root, "package-stage", "node-app"); fs.mkdirSync(path.join(packageStage, "server"), { recursive: true }); fs.mkdirSync(path.join(packageStage, "dist"), { recursive: true }); fs.writeFileSync(path.join(packageStage, "server", "dashboard.mjs"), "new-backend"); fs.writeFileSync(path.join(packageStage, "dist", "index.html"), "new-ui"); const archive = path.join(root, "update.tar.gz"); execTar(["-czf", archive, "-C", path.dirname(packageStage), "node-app"]); const packageBytes = fs.readFileSync(archive); const releaseManifest = manifest(packageBytes);
  store.release(releaseManifest, signManifest(releaseManifest, releasePair.privateKey), path.join(store.packagesDir, "2.5.0.tar.gz")); fs.copyFileSync(archive, path.join(store.packagesDir, "2.5.0.tar.gz"));
  const enrollmentToken = store.createEnrollmentToken({ clientId: "client", companyName: "Piloto", group: "pilot" }); const publicKeyFile = path.join(root, "release-public.pem"); fs.writeFileSync(publicKeyFile, releasePair.publicKey.export({ type: "spki", format: "pem" })); const engine = new UpdateEngine({ installRoot, dataDir, publicKey: releasePair.publicKey, serviceController: { stop: async () => {}, start: async () => {} }, healthCheck: async () => true });
  const agent = new UpdateAgent({ centerUrl, enrollmentToken, companyName: "Piloto", installRoot, dataDir, releasePublicKey: publicKeyFile, currentVersion: "2.4.5", channel: "stable", updateWindow: "00:00-23:59", maxPackageBytes: 10_000_000, engine }); await agent.initialize(); store.authorize({ version: "2.5.0", installationId: agent.identity.installationId, actor: "test" });
  const result = await agent.checkOnce(); assert.deepEqual(result, { updated: true, version: "2.5.0" }); assert.equal(fs.readFileSync(path.join(live, "server", "dashboard.mjs"), "utf8"), "new-backend"); assert.equal(store.state.installations[agent.identity.installationId].version, "2.5.0"); assert.ok(store.state.events.some((item) => item.type === "installed"));
});

test("pasta em outro disco e copiada quando o rename cruza unidades", () => {
  const root = temporary(); const source = path.join(root, "origem"); const destination = path.join(root, "destino", "backup");
  fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(path.join(source, "old.txt"), "old");
  const fake = { mkdirSync: fs.mkdirSync.bind(fs), cpSync: fs.cpSync.bind(fs), rmSync: fs.rmSync.bind(fs), renameSync() { const error = new Error("cross-device"); error.code = "EXDEV"; throw error; } };
  movePath(source, destination, fake);
  assert.equal(fs.readFileSync(path.join(destination, "old.txt"), "utf8"), "old");
  assert.equal(fs.existsSync(source), false);
});

test("nome da empresa sai do banco quando o instalador nao informou", async () => {
  const root = temporary(); const config = { installRoot: path.join(root, "install"), dataDir: path.join(root, "data"), companyName: "" };
  assert.equal(await readCompanyFromDatabase(config), "");
  assert.equal(await resolveCompanyName(config), os.hostname());
  assert.equal(await resolveCompanyName({ ...config, companyName: "Boca do Mato" }), "Boca do Mato");
});

test("dashboard troca o agente somente depois que a atualizacao ja terminou", () => {
  const root = temporary(); const serverDir = path.join(root, "node-app", "server"); const bundled = path.join(root, "node-app", "updater", "agent.mjs"); const live = path.join(root, "Updater", "agent.mjs");
  fs.mkdirSync(path.dirname(bundled), { recursive: true }); fs.mkdirSync(path.dirname(live), { recursive: true });
  fs.writeFileSync(bundled, "novo"); fs.writeFileSync(live, "antigo");
  let scheduled = null;
  assert.equal(syncUpdaterAgent(serverDir, { delayMs: 180000, schedule: (callback, delay) => { scheduled = { callback, delay }; } }), true);
  assert.equal(scheduled.delay, 180000); assert.equal(fs.readFileSync(live, "utf8"), "antigo");
  scheduled.callback();
  assert.equal(fs.readFileSync(live, "utf8"), "novo");
  assert.equal(syncUpdaterAgent(serverDir, { schedule: () => { throw new Error("nao deveria agendar"); } }), false);
});

test("auditoria fica em portugues e na maquina de cada acontecimento", async (context) => {
  const root = temporary();
  const { app, store } = createUpdateCenter({ dataDir: root, adminToken: "test-admin-token", releasePublicKey: keys().publicKey, uiDir: path.join(root, "missing") });
  const server = app.listen(0, "127.0.0.1"); context.after(() => server.close()); await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const boca = generateInstallationIdentity();
  const caixa = generateInstallationIdentity();
  const headers = { authorization: "Bearer test-admin-token", "content-type": "application/json" };
  store.enroll(store.createEnrollmentToken({ clientId: "boca", companyName: "Boca do Mato", group: "pilot" }), { installationId: boca.installationId, publicKey: boca.publicKey, version: "1.0.2", platform: "win32", architecture: "x64", agentVersion: "1.0.0", companyName: "Boca do Mato", hostname: "CAIXA-01" });
  store.enroll(store.createEnrollmentToken({ clientId: "outro", companyName: "Outro cliente", group: "pilot" }), { installationId: caixa.installationId, publicKey: caixa.publicKey, version: "1.0.0", platform: "win32", architecture: "x64", agentVersion: "1.0.0", companyName: "Outro cliente", hostname: "" });
  store.release(manifest(Buffer.from("pacote"), { version: "1.0.3" }), "assinatura", path.join(root, "pacote.tar.gz"));
  store.event(boca.installationId, { type: "download_started", version: "1.0.3", detail: "" });
  store.event(boca.installationId, { type: "failed", version: "1.0.3", detail: "Agente precisa ser atualizado antes deste pacote." });
  store.event(caixa.installationId, { type: "rollback", version: "1.0.2", detail: "Atualizacao revertida: EXDEV: cross-device link not permitted, rename 'D:\\app' -> 'C:\\backup'" });
  const antiga = store.authorize({ version: "1.0.3", installationId: boca.installationId, actor: "admin" });
  store.event("__admin__", { type: "authorization_created", version: "1.0.3", detail: `admin:${antiga.id}` });
  store.event("__admin__", { type: "installation_revoked", detail: `admin:${caixa.installationId}` });
  store.event("__admin__", { type: "release_status_changed", version: "1.0.2", detail: "admin:blocked" });
  const fleet = await fetch(`${base}/api/admin/authorizations`, { method: "POST", headers, body: JSON.stringify({ version: "1.0.3", percentage: 100 }) });
  assert.equal(fleet.status, 201);
  const response = await fetch(`${base}/api/admin/events`, { headers });
  assert.equal(response.status, 200);
  const { events } = await response.json();
  const download = events.find((item) => item.type === "download_started");
  assert.equal(download.label, "Download iniciado");
  assert.equal(download.companyName, "Boca do Mato");
  assert.equal(download.hostname, "CAIXA-01");
  assert.equal(download.machineId, boca.installationId);
  assert.equal(download.resumo, "O pacote começou a ser baixado nesta máquina.");
  const failed = events.find((item) => item.type === "failed");
  assert.equal(failed.machineId, boca.installationId);
  assert.match(failed.resumo, /atualizador desta máquina/);
  const rollback = events.find((item) => item.type === "rollback");
  assert.equal(rollback.companyName, "Outro cliente");
  assert.equal(rollback.machineId, caixa.installationId);
  assert.match(rollback.resumo, /outro disco/);
  const liberacao = events.find((item) => item.type === "authorization_created" && item.detail.startsWith("admin:"));
  assert.equal(liberacao.machineId, boca.installationId);
  assert.equal(liberacao.label, "Liberação");
  assert.match(liberacao.resumo, /esta máquina/);
  const revogacao = events.find((item) => item.type === "installation_revoked");
  assert.equal(revogacao.machineId, caixa.installationId);
  assert.match(revogacao.resumo, /deixou de receber/);
  const status = events.find((item) => item.type === "release_status_changed");
  assert.equal(status.companyName, "Central");
  assert.equal(status.machineId, "");
  assert.match(status.resumo, /bloqueada/);
  const lote = events.find((item) => item.type === "authorization_created" && item.detail.startsWith("lote:"));
  assert.equal(lote.companyName, "Central");
  assert.match(lote.resumo, /todas as máquinas/);
});

function execTar(args) { const result = spawnSync("tar.exe", args, { windowsHide: true }); if (result.status !== 0) throw new Error(result.stderr.toString()); }
