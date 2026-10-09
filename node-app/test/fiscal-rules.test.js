import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeFiscalRule } from "../server/routes/fiscal-reports.js";

test("normaliza e limita os campos permitidos de uma regra fiscal", () => {
  const result = sanitizeFiscalRule({
    idempresa: "2", cfop: " 5102 ", tipo_operacao: "V".repeat(60),
    ativo: "1", campo_injetado: "nao deve chegar ao SQL"
  });
  assert.deepEqual(result, {
    CFOP: "5102", TIPO_OPERACAO: "V".repeat(40), IDEMPRESA: 2, ATIVO: 1
  });
});

test("rejeita inteiro fiscal invalido", () => {
  assert.throws(() => sanitizeFiscalRule({ idempresa: "abc" }), /IDEMPRESA deve ser inteiro/);
});
