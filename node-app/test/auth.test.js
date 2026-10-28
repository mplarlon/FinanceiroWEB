import assert from "node:assert/strict";
import test from "node:test";

import { passwordMatches, userCanEnterDashboard } from "../server/auth.js";

test("aceita a codificacao atual do ERP", () => {
  assert.equal(
    passwordMatches("2907", Buffer.from([0xf6, 0x03, 0x2b, 0xf3])),
    true,
  );
});

test("aceita a codificacao legada de oito bytes", () => {
  assert.equal(
    passwordMatches(
      "!@Pontua",
      Buffer.from([0xfd, 0x23, 0x63, 0x30, 0x25, 0x46, 0x0a, 0xe4]),
    ),
    true,
  );
});

test("permissao do Automec libera o Dashboard", () => {
  assert.equal(userCanEnterDashboard({ inactive: 0, hasAutomecPermission: true }), true);
  assert.equal(userCanEnterDashboard({ inactive: 0, hasAutomecPermission: false }), false);
  assert.equal(userCanEnterDashboard({ inactive: 1, hasAutomecPermission: true }), false);
});

test("nao aceita senha incorreta com o mesmo tamanho", () => {
  assert.equal(
    passwordMatches(
      "!@Pontub",
      Buffer.from([0xfd, 0x23, 0x63, 0x30, 0x25, 0x46, 0x0a, 0xe4]),
    ),
    false,
  );
});
