export const START_INI_ONLINE_MS = 60 * 60 * 1000;
const FIELDS = ["name", "host", "port", "database", "user", "charset", "role"];

function clean(value, max) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

export function instalacaoOnline(installation, now = Date.now()) {
  if (!installation || installation.revokedAt) return false;
  const seen = Date.parse(installation.lastSeenAt || "");
  return Number.isFinite(seen) && now - seen < START_INI_ONLINE_MS;
}

export function publicStartIni(value) {
  if (!value || typeof value !== "object") return null;
  const port = Number(value.port || 3050);
  return {
    name: clean(value.name, 120),
    host: clean(value.host, 200),
    port: Number.isInteger(port) && port > 0 ? port : 3050,
    database: clean(value.database, 260),
    user: clean(value.user, 64),
    charset: clean(value.charset, 32) || "WIN1252",
    role: clean(value.role, 64),
    hasPassword: Boolean(value.hasPassword || String(value.password || "").trim()),
  };
}

export function startIniCommand(input = {}) {
  const command = {};
  for (const key of FIELDS) command[key] = key === "port" ? Number(input.port || 3050) : clean(input[key], key === "database" ? 260 : key === "host" ? 200 : 120);
  command.charset = command.charset || "WIN1252";
  const password = String(input.password || "");
  if (password.length > 128) throw Object.assign(new Error("Senha do banco longa demais."), { status: 400 });
  if (password.trim()) command.password = password;
  if (!command.host || !command.database) throw Object.assign(new Error("Informe o servidor e o caminho do banco."), { status: 400 });
  if (!command.user) throw Object.assign(new Error("Informe o usuário do banco."), { status: 400 });
  if (!Number.isInteger(command.port) || command.port < 1 || command.port > 65535) throw Object.assign(new Error("Porta inválida."), { status: 400 });
  return command;
}

export function mergeStartIni(current = {}, patch = {}) {
  const command = startIniCommand(patch);
  const next = { ...current, type: "firebird" };
  for (const key of FIELDS) next[key] = command[key];
  if (command.password) next.password = command.password;
  return next;
}

export function commandForAgent(command) {
  if (!command) return null;
  const delivered = startIniCommand(command);
  return { id: String(command.id || ""), requestedAt: command.requestedAt || null, ...delivered };
}

export function publicStartIniCommand(command) {
  if (!command) return null;
  return { id: String(command.id || ""), requestedAt: command.requestedAt || null, hasPassword: Boolean(command.password) };
}
