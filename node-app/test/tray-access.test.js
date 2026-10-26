import assert from "node:assert/strict";
import test from "node:test";
import { trayPasswordMatches } from "../server/lib/tray-access.js";

test("acesso ao ecommerce aceita somente a senha configurada", () => {
  assert.equal(trayPasswordMatches("2907", "2907"), true);
  assert.equal(trayPasswordMatches("2908", "2907"), false);
  assert.equal(trayPasswordMatches("29070", "2907"), false);
});
