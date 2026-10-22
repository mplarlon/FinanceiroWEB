import assert from "node:assert/strict";
import test from "node:test";
import { interpretWithOllama } from "../server/lib/charlie-ai.js";
import { ACTION_RUNNERS } from "../server/lib/charlie-task-actions.js";
import { getAction, listActions, userCan, validateActionParams } from "../server/lib/charlie-task-catalog.js";

test("catálogo autorizado possui metadados, validação, executor e política de risco", () => {
  const ids = new Set();
  for (const action of listActions()) {
    assert.match(action.id, /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
    assert.equal(ids.has(action.id), false, `ação duplicada: ${action.id}`);
    ids.add(action.id);
    assert.equal(typeof action.nome, "string");
    assert.equal(typeof action.modulo, "string");
    assert.ok(Number.isInteger(action.nivel) && action.nivel >= 1 && action.nivel <= 4);
    assert.equal(typeof action.confirmacao, "boolean");
    assert.equal(typeof action.permissao, "string");
    assert.ok(action.parametros && typeof action.parametros === "object");
    assert.ok(Array.isArray(action.auditoria));
    if (action.habilitada) assert.equal(typeof ACTION_RUNNERS[action.id], "function", `executor ausente: ${action.id}`);
    if (action.nivel >= 3) assert.equal(userCan(action, { id: 1, gerencial: false }, "executar"), false);
    if (action.nivel >= 4) assert.equal(action.habilitada, false);
  }
});

test("validação descarta parâmetros desconhecidos e rejeita tipos e limites incompatíveis", () => {
  const action = getAction("produtos.reajuste_precos");
  const invalid = validateActionParams(action, {
    tabela: "não-numérico",
    percentual: 999999,
    confirmar: true,
    sql: "DELETE FROM PRODUTOPRECO",
  });
  assert.equal(invalid.ok, false);
  assert.equal("confirmar" in invalid.params, false);
  assert.equal("sql" in invalid.params, false);
  assert.ok(invalid.errors.length >= 2);
});

test("indisponibilidade do Ollama preserva o interpretador determinístico", async () => {
  const previous = process.env.CHARLIE_AI_ENABLED;
  process.env.CHARLIE_AI_ENABLED = "false";
  try {
    const deterministic = { type: "financeiro_titulos", domain: "receber", status: "vencido" };
    const result = await interpretWithOllama("títulos vencidos", deterministic);
    assert.deepEqual(result, { ...deterministic, interpretador: "regras_fallback" });
  } finally {
    if (previous === undefined) delete process.env.CHARLIE_AI_ENABLED;
    else process.env.CHARLIE_AI_ENABLED = previous;
  }
});
