import crypto from "node:crypto";

export function chaveDe(segredo) {
  const texto = String(segredo || "");
  if (texto.length < 16) return null;
  return crypto.createHash("sha256").update(texto).digest();
}

export function cifrar(texto, chave) {
  if (!chave) {
    throw Object.assign(new Error("Defina OPEN_FINANCE_MASTER_KEY com pelo menos 16 caracteres para proteger os tokens."), { status: 409 });
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([cipher.update(String(texto), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), dados]).toString("base64")}`;
}

export function decifrar(payload, chave) {
  const texto = String(payload || "");
  if (!texto) return "";
  if (!texto.startsWith("v1:")) throw new Error("Segredo em formato desconhecido.");
  if (!chave) throw new Error("Chave mestra ausente para ler o segredo.");
  const bruto = Buffer.from(texto.slice(3), "base64");
  const iv = bruto.subarray(0, 12);
  const tag = bruto.subarray(12, 28);
  const dados = bruto.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(dados), decipher.final()]).toString("utf8");
}

export function mascarar(valor) {
  const texto = String(valor || "");
  if (texto.length < 8) return texto ? "••••" : "";
  return `${texto.slice(0, 3)}••••${texto.slice(-2)}`;
}

export function redigir(valor) {
  return String(valor || "")
    .replace(/bearer\s+\S+/gi, "bearer [omitido]")
    .replace(/(clientSecret|client_secret|apiKey|api_key|access_token|secret|password|senha)\s*["']?\s*[:=]\s*["']?[^"'\s,}]*/gi, "$1 [omitido]")
    .slice(0, 300);
}

export function recusarSenhaBancaria(pedido) {
  if (!pedido || typeof pedido !== "object") return;
  const campos = ["senha", "password", "senhaBancaria", "senha_bancaria", "bankPassword"];
  if (campos.some((campo) => pedido[campo])) {
    throw Object.assign(new Error("Senha bancária não é armazenada. A conexão usa somente o consentimento do Open Finance."), { status: 400 });
  }
}
