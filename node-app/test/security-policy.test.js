import assert from "node:assert/strict";
import test from "node:test";

import { adHocQueryEnabled, debugLoginEnabled, isPublicApiPath } from "../server/security-policy.js";
import { publicDatabaseConfig } from "../server/config.js";

test("somente endpoints mínimos permanecem públicos", () => {
  assert.equal(isPublicApiPath("/api/status"), true);
  assert.equal(isPublicApiPath("/api/auth/login"), true);
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
