import assert from "node:assert/strict";
import test from "node:test";

import { passwordMatches, userCanEnterDashboard } from "../server/auth.js";
import { codeBytes } from "../server/lib/prazo-acesso.js";

test("aceita a codificacao Code/Decode do Automec desktop", () => {
  assert.equal(passwordMatches("2907", codeBytes("2907")), true);
  assert.equal(passwordMatches("1234", codeBytes("1234")), true);
  assert.equal(passwordMatches("123", codeBytes("123")), true);
  assert.equal(passwordMatches("1", codeBytes("1")), true);
  assert.equal(passwordMatches("CAROL", codeBytes("CAROL")), true);
});

test("aceita senha numerica tipica de usuario so com digitos", () => {
  assert.equal(
    passwordMatches("1234", Buffer.from([0xef, 0x06, 0x28, 0xf2])),
    true,
  );
});

test("aceita a codificacao XOR legada quando Code nao confere", () => {
  assert.equal(
    passwordMatches(
      "!@Pontua",
      Buffer.from([0xfd, 0x23, 0x63, 0x30, 0x25, 0x46, 0x0a, 0xe4]),
    ),
    true,
  );
});

test("usuario ativo entra no Dashboard sem permissao de menu", () => {
  assert.equal(userCanEnterDashboard({ inactive: 0 }), true);
  assert.equal(userCanEnterDashboard({ inactive: 1 }), false);
});

test("nao aceita senha incorreta com o mesmo tamanho", () => {
  assert.equal(passwordMatches("1235", codeBytes("1234")), false);
  assert.equal(
    passwordMatches(
      "!@Pontub",
      Buffer.from([0xfd, 0x23, 0x63, 0x30, 0x25, 0x46, 0x0a, 0xe4]),
    ),
    false,
  );
});
