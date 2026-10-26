// Keep this list deliberately small. Database configuration, diagnostics and
// schema/query helpers must always pass through the authenticated API guard.
export const PUBLIC_API_PATHS = new Set([
  "/api/status",
  "/api/branding",
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/whatsapp/webhook",
  "/api/tray/webhook",
  "/api/integracoes/casa-dos-dados/webhook",
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
