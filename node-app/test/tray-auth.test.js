import assert from "node:assert/strict";
import test from "node:test";
import { accessTokenNeedsRefresh, createTokenCoordinator, trayRefreshError } from "../server/lib/tray-auth.js";

test("renova o access token antes de vencer e também depois de vencido", () => {
  const now = new Date("2026-10-28T13:00:00");
  assert.equal(accessTokenNeedsRefresh("2026-10-28 12:00:00", now), true);
  assert.equal(accessTokenNeedsRefresh("2026-10-28 13:09:00", now), true);
  assert.equal(accessTokenNeedsRefresh("2026-10-28 13:30:00", now), false);
  assert.equal(accessTokenNeedsRefresh("", now), false);
});

test("a recusa da Tray não volta como Unauthorized access", () => {
  const error = trayRefreshError({ name: "Unauthorized access", error_code: 1099, causes: ["Token inválido ou expirado"] }, 401);
  assert.equal(error.status, 503);
  assert.equal(error.message.includes("Unauthorized"), false);
  assert.match(error.message, /renovação automática/);
});

test("uma renovação em andamento não é desfeita por outra gravação", async () => {
  let stored = {
    access_token: "a1",
    refresh_token: "r1",
    store_host: "antiga",
    access_token_expires_at: "2020-01-01 00:00:00",
  };
  let calls = 0;
  const hub = createTokenCoordinator({
    read: () => stored,
    write: (value) => { stored = value; },
    refresh: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        access_token: "a2",
        refresh_token: "r2",
        access_token_expires_at: "2099-01-01 00:00:00",
        refresh_token_expires_at: "2099-02-01 00:00:00",
      };
    },
  });
  const pending = hub.refreshTokens();
  await hub.update((current) => ({ ...current, store_host: "nova" }));
  const [first, second] = await Promise.all([pending, hub.refreshTokens()]);
  assert.equal(calls, 1);
  assert.equal(first.access_token, "a2");
  assert.equal(second.refresh_token, "r2");
  assert.equal(stored.store_host, "nova");
  assert.equal(stored.access_token, "a2");
});

test("não chama a Tray enquanto o access token ainda tem folga", async () => {
  let calls = 0;
  const stored = { access_token: "a1", refresh_token: "r1", access_token_expires_at: "2099-01-01 00:00:00" };
  const hub = createTokenCoordinator({
    read: () => stored,
    write: () => {},
    refresh: async () => { calls += 1; return { access_token: "a2" }; },
  });
  const current = await hub.ensureAccessToken(new Date("2026-10-28T13:00:00"));
  assert.equal(current.access_token, "a1");
  assert.equal(calls, 0);
});
