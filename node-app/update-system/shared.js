import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const MANUAL_CHECK_PORT = 18055;

export function assertSemver(value, label = "versao") {
  if (!SEMVER.test(String(value || ""))) throw new Error(`${label} deve usar MAJOR.MINOR.PATCH.`);
  return String(value);
}

export function compareSemver(left, right) {
  const a = assertSemver(left).split(".").map(Number);
  const b = assertSemver(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function signManifest(manifest, privateKey) {
  return crypto.sign(null, Buffer.from(stableJson(manifest)), privateKey).toString("base64");
}

export function verifyManifest(manifest, signature, publicKey) {
  try {
    return crypto.verify(null, Buffer.from(stableJson(manifest)), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function generateInstallationIdentity() {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    installationId: crypto.randomUUID(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

export function requestPayload({ method, pathname, timestamp, nonce, body }) {
  return [String(method).toUpperCase(), pathname, String(timestamp), nonce, sha256(body || Buffer.alloc(0))].join("\n");
}

export function signRequest(input, privateKey) {
  return crypto.sign(null, Buffer.from(requestPayload(input)), privateKey).toString("base64");
}

export function verifyRequest(input, signature, publicKey) {
  try {
    return crypto.verify(null, Buffer.from(requestPayload(input)), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function atomicWriteJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

export function readJson(filename, fallback) {
  if (!fs.existsSync(filename)) return structuredClone(fallback);
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

export function safeChild(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Caminho fora do diretorio permitido.");
  return target;
}

export function redactError(error) {
  return String(error?.message || error || "Erro desconhecido").replace(/(token|password|secret|authorization)=?[^\s,;]*/gi, "$1=[REMOVIDO]").slice(0, 2000);
}
