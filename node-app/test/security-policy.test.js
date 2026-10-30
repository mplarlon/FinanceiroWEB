import assert from "node:assert/strict";
import test from "node:test";

import { adHocQueryEnabled, consumeStartIniAttempt, debugLoginEnabled, isPublicApiPath, resetStartIniAttempts, startIniPasswordOk } from "../server/security-policy.js";
import { publicDatabaseConfig } from "../server/config.js";

test("somente endpoints mínimos permanecem públicos", () => {
  assert.equal(isPublicApiPath("/api/status"), true);
  assert.equal(isPublicApiPath("/api/app-update"), true);
  assert.equal(isPublicApiPath("/api/app-update/now"), true);
  assert.equal(isPublicApiPath("/api/auth/login"), true);
  assert.equal(isPublicApiPath("/api/setup/start-ini"), true);
  assert.equal(isPublicApiPath("/api/database/config"), false);
  assert.equal(isPublicApiPath("/api/database/test"), false);
  assert.equal(isPublicApiPath("/api/auth/debug-login"), false);
  assert.equal(isPublicApiPath("/api/query"), false);
  assert.equal(isPublicApiPath("/api/schema"), false);
});

test("diagnóstico de login exige ativação explícita", () => {
  assert.equal(debugLoginEnabled({}), false);
  assert.equal(debugLoginEnabled({ DASHBOARD_DEBUG_LOGIN: "1" }), true);
  assert.equal(debugLoginEnabled({ DASHBOARD_DEBUG_LOGIN: "true" }), false);
});

test("senha 115 abre a edição do start.ini", () => {
  resetStartIniAttempts();
  assert.equal(startIniPasswordOk("115"), true);
  assert.equal(startIniPasswordOk(" 115 "), true);
  assert.equal(startIniPasswordOk("116"), false);
  assert.equal(startIniPasswordOk(""), false);
  for (let i = 0; i < 4; i += 1) {
    const fail = consumeStartIniAttempt("000", "teste-login");
    assert.equal(fail.status, 403);
  }
  assert.equal(consumeStartIniAttempt("000", "teste-login").status, 429);
  assert.equal(consumeStartIniAttempt("115", "teste-login").ok, false);
  assert.equal(consumeStartIniAttempt("115", "outro-login").ok, true);
});

test("consulta SQL avulsa permanece desativada por padrão", () => {
  assert.equal(adHocQueryEnabled({}), false);
  assert.equal(adHocQueryEnabled({ DASHBOARD_ADHOC_QUERY_ENABLED: "1" }), true);
  assert.equal(adHocQueryEnabled({ DASHBOARD_ADHOC_QUERY_ENABLED: "yes" }), false);
});

test("configuração pública não revela partes da senha", () => {
  const config = publicDatabaseConfig({
    host: "localhost",
    database: "C:\\dados\\erp.fdb",
    user: "app",
    password: "segredo-operacional",
  });
  assert.equal(config.has_password, true);
  assert.equal(config.password_masked, "********");
  assert.equal(JSON.stringify(config).includes("segredo"), false);
  assert.equal(JSON.stringify(config).includes("onal"), false);
});
