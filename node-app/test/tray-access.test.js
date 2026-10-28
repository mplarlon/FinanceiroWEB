import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("acesso ao ecommerce nao exige senha adicional", () => {
  const source = fs.readFileSync(new URL("../server/routes/tray.js", import.meta.url), "utf8");
  assert.equal(source.includes("Informe a senha para abrir o e-commerce"), false);
  assert.equal(source.includes("ecommerce_password_required"), false);
  assert.equal(source.includes("DASHBOARD_TRAY_PASSWORD"), false);
  assert.match(source, /router\.get\("\/acesso", \(_req, res\) => \{\s*res\.json\(\{ ok: true, liberado: true \}\);/);
});
