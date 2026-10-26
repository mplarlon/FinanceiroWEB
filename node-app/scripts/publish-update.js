import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertSemver, sha256, signManifest } from "../update-system/shared.js";

const args = Object.fromEntries(process.argv.slice(2).map((item) => { const index = item.indexOf("="); return [item.slice(2, index), item.slice(index + 1)]; }));
const version = assertSemver(args.version);
const centerUrl = required(process.env.UPDATE_CENTER_URL);
const adminToken = required(process.env.UPDATE_CENTER_ADMIN_TOKEN);
const privateKey = fs.readFileSync(required(process.env.UPDATE_SIGNING_PRIVATE_KEY_FILE), "utf8");
const root = path.resolve(import.meta.dirname, "..");
const source = path.resolve(args.source || path.join(root, "..", "build", "cliente-sem-fontes", "runtime", "node-app"));
if (!fs.existsSync(path.join(source, "server", "dashboard.mjs")) || !fs.existsSync(path.join(source, "dist", "index.html"))) throw new Error("Runtime nao foi construido. Execute o build do instalador primeiro.");
const outputDir = path.resolve(args.output || path.join(root, "..", "output", "updates"));
fs.mkdirSync(outputDir, { recursive: true });
const archive = path.join(outputDir, `erp-update-${version}-win32-x64.tar.gz`);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "erp-update-"));
try {
  fs.cpSync(source, path.join(stage, "node-app"), { recursive: true });
  execFileSync("tar.exe", ["-czf", archive, "-C", stage, "node-app"], { stdio: "inherit", windowsHide: true });
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
const bytes = fs.readFileSync(archive);
const manifest = {
  version, channel: args.channel || "stable", releaseDate: new Date().toISOString(), minimumAgentVersion: args.minimumAgentVersion || "1.0.0",
  platform: ["win32"], architecture: ["x64"], requiresRestart: true, criticality: args.criticality || "normal",
  package: { filename: path.basename(archive), sha256: sha256(bytes), size: bytes.length },
  database: { strategy: args.databaseStrategy || "none", automaticRollback: false, migrationReference: args.migrationReference || null },
  releaseNotes: args.notes ? args.notes.split("|").map((item) => item.trim()).filter(Boolean) : [],
};
const signature = signManifest(manifest, privateKey);
const response = await fetch(new URL(`/api/admin/releases/${version}/package`, centerUrl), {
  method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/octet-stream", "x-update-manifest": Buffer.from(JSON.stringify(manifest)).toString("base64url"), "x-update-signature": signature, "x-admin-actor": process.env.UPDATE_PUBLISHER || os.userInfo().username }, body: bytes,
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(result.error || `Publicacao recusada: HTTP ${response.status}`);
fs.writeFileSync(`${archive}.manifest.json`, `${JSON.stringify({ manifest, signature }, null, 2)}\n`);
console.log(`Versao ${version} publicada como rascunho. Autorize-a no painel antes da distribuicao.`);

function required(value) { if (!value) throw new Error("Variavel de ambiente obrigatoria ausente."); return value; }
