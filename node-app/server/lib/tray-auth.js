export const ACCESS_REFRESH_MARGIN_MS = 10 * 60 * 1000;

export function parseTrayDate(value) {
  if (!value) return null;
  const date = new Date(String(value).trim().replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function accessTokenNeedsRefresh(expiresAt, now = new Date(), marginMs = ACCESS_REFRESH_MARGIN_MS) {
  const expiry = parseTrayDate(expiresAt);
  if (!expiry) return false;
  return expiry.getTime() <= now.getTime() + marginMs;
}

export function trayRefreshError(payload = {}, status = 502) {
  const causes = Array.isArray(payload.causes) ? payload.causes.map((item) => String(item)) : [];
  const text = `${payload.message || ""} ${payload.name || ""} ${causes.join(" ")}`;
  const invalid = status === 401 || Number(payload.error_code) === 1099 || /unauthorized|inválido|invalido|expirado|invalid|expired/i.test(text);
  if (invalid) {
    return Object.assign(new Error("A renovação automática não foi aceita pela Tray. Autorize o aplicativo novamente."), { status: 503, code: "tray_reauth" });
  }
  const reason = payload.message || payload.name || causes[0] || "Não foi possível renovar o token da Tray.";
  return Object.assign(new Error(String(reason)), { status: status || 502 });
}

function applyTokens(latest, payload) {
  const next = { ...latest };
  if (payload.access_token) next.access_token = payload.access_token;
  if (payload.refresh_token) next.refresh_token = payload.refresh_token;
  if (payload.access_token_expires_at) next.access_token_expires_at = payload.access_token_expires_at;
  if (payload.refresh_token_expires_at) next.refresh_token_expires_at = payload.refresh_token_expires_at;
  if (payload.api_address) next.api_address = payload.api_address;
  if (payload.store_id) next.store_id = String(payload.store_id);
  return next;
}

export function createTokenCoordinator({ read, write, refresh }) {
  let queue = Promise.resolve();
  let flight = null;

  function update(mutator) {
    const run = queue.then(async () => {
      const next = await mutator(read());
      write(next);
      return next;
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  function refreshTokens() {
    if (flight) return flight;
    flight = (async () => {
      const current = read();
      if (!current.refresh_token) {
        throw Object.assign(new Error("Refresh token não configurado. Autorize novamente o aplicativo."), { status: 400 });
      }
      const payload = await refresh(current);
      if (!payload?.access_token) throw trayRefreshError(payload, 401);
      return update((latest) => applyTokens(latest, payload));
    })().finally(() => { flight = null; });
    return flight;
  }

  function ensureAccessToken(now = new Date()) {
    const current = read();
    if (!accessTokenNeedsRefresh(current.access_token_expires_at, now)) return Promise.resolve(current);
    return refreshTokens();
  }

  return { update, refreshTokens, ensureAccessToken };
}
