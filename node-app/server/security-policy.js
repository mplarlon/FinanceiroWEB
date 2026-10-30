import { timingSafeEqual } from "node:crypto";

// Keep this list deliberately small. Database configuration, diagnostics and
// schema/query helpers must always pass through the authenticated API guard.
// /api/setup/start-ini is public because it sits on the login screen; the
// password below is what opens the editor.
export const PUBLIC_API_PATHS = new Set([
  "/api/status",
  "/api/app-update",
  "/api/app-update/now",
  "/api/branding",
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/setup/start-ini",
  "/api/whatsapp/webhook",
  "/api/tray/webhook",
  "/api/integracoes/casa-dos-dados/webhook",
  "/api/open-finance/webhook",
]);

export function isPublicApiPath(pathname) {
  return PUBLIC_API_PATHS.has(String(pathname || ""));
}

export function debugLoginEnabled(environment = process.env) {
  return String(environment.DASHBOARD_DEBUG_LOGIN || "0") === "1";
}

export function adHocQueryEnabled(environment = process.env) {
  return String(environment.DASHBOARD_ADHOC_QUERY_ENABLED || "0") === "1";
}

export const START_INI_EDIT_PASSWORD = "115";
const startIniAttempts = new Map();

export function resetStartIniAttempts() {
  startIniAttempts.clear();
}

export function startIniPasswordOk(senha) {
  const given = Buffer.from(String(senha ?? "").trim(), "utf8");
  const expected = Buffer.from(START_INI_EDIT_PASSWORD, "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function consumeStartIniAttempt(senha, key = "local") {
  const now = Date.now();
  const state = startIniAttempts.get(key) || { fails: 0, lockedUntil: 0 };
  if (state.lockedUntil > now) {
    const segundos = Math.ceil((state.lockedUntil - now) / 1000);
    return { ok: false, status: 429, erro: `Muitas tentativas. Aguarde ${segundos}s.` };
  }
  if (!startIniPasswordOk(senha)) {
    state.fails += 1;
    if (state.fails >= 5) {
      state.lockedUntil = now + 60_000;
      state.fails = 0;
      startIniAttempts.set(key, state);
      return { ok: false, status: 429, erro: "Muitas tentativas. Aguarde 60s." };
    }
    startIniAttempts.set(key, state);
    return { ok: false, status: 403, erro: "Senha incorreta." };
  }
  startIniAttempts.delete(key);
  return { ok: true };
}
