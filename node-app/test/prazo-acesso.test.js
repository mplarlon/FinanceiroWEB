import assert from "node:assert/strict";
import test from "node:test";

import {
  codeBytes,
  decodeBytes,
  bytesBanco,
  textoBanco,
  formatarData,
  interpretarPrazo,
} from "../server/lib/prazo-acesso.js";

const HOJE = new Date(2026, 9, 27);

function cifrada(data) {
  return textoBanco(codeBytes(formatarData(data)));
}

test("code e decode devolvem a data no formato do Automec", () => {
  for (const data of ["27/10/2026", "26/11/2026", "29/02/2028", "01/01/2030"]) {
    assert.equal(decodeBytes(codeBytes(data)), data);
    assert.equal(decodeBytes(bytesBanco(textoBanco(codeBytes(data)))), data);
  }
});

test("data vazia libera e grava trinta dias", () => {
  const decisao = interpretarPrazo({ datalimite: "", expirado: 0, hoje: HOJE });
  assert.equal(decisao.liberado, true);
  assert.equal(decisao.gravarData, "26/11/2026");
  assert.equal(decisao.marcarExpirado, false);
});

test("data futura com expirado zerado libera", () => {
  const decisao = interpretarPrazo({
    datalimite: cifrada(new Date(2026, 10, 26)),
    expirado: 0,
    hoje: HOJE,
  });
  assert.equal(decisao.liberado, true);
  assert.equal(decisao.marcarExpirado, false);
});

test("o proprio dia do limite trava e marca expirado", () => {
  const decisao = interpretarPrazo({
    datalimite: cifrada(HOJE),
    expirado: null,
    hoje: HOJE,
  });
  assert.equal(decisao.liberado, false);
  assert.equal(decisao.marcarExpirado, true);
});

test("expirado marcado trava mesmo com data futura", () => {
  const decisao = interpretarPrazo({
    datalimite: cifrada(new Date(2027, 0, 1)),
    expirado: -1,
    hoje: HOJE,
  });
  assert.equal(decisao.liberado, false);
  assert.equal(decisao.marcarExpirado, false);
});

test("data ilegivel trava", () => {
  const decisao = interpretarPrazo({ datalimite: "nao-cifrado", expirado: 0, hoje: HOJE });
  assert.equal(decisao.liberado, false);
  assert.equal(decisao.marcarExpirado, true);
});
