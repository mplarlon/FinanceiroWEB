import assert from "node:assert/strict";
import test from "node:test";
import { detectIntent } from "../server/routes/assistant.js";
import { validateAiIntent, validAiSummary } from "../server/lib/charlie-ai.js";

test("interpreta perguntas operacionais sem IA externa", () => {
  assert.deepEqual(detectIntent("top 5 produtos vendidos"), {
    type: "produtos",
    limit: 5,
  });
  assert.deepEqual(detectIntent("saldo dos bancos"), {
    type: "saldo_bancos",
  });
  assert.deepEqual(detectIntent("contas a receber"), {
    type: "contas_receber",
  });
  assert.deepEqual(detectIntent("Bom dia Charlie, vamos abrir o dia"), {
    type: "abertura_dia",
  });
  assert.deepEqual(detectIntent("o que você sabe fazer?"), { type: "ajuda" });
  assert.equal(detectIntent("qualquer coisa"), null);
});

test("Ollama fica limitado as intencoes permitidas", () => {
  assert.deepEqual(validateAiIntent({ tipo: "produtos", limite: 999 }), {
    type: "produtos",
    limit: 50,
    interpretador: "ollama",
  });
  assert.equal(validateAiIntent({ tipo: "executar_sql" }), null);
  assert.equal(
    validateAiIntent({ tipo: "vendas", sql: "DROP TABLE X" }).sql,
    undefined,
  );
});

test("narrativa do Ollama nao pode inventar numeros", () => {
  assert.equal(
    validAiSummary("Foram 12 vendas, total de 150,00.", "12 vendas; R$ 150,00"),
    true,
  );
  assert.equal(
    validAiSummary("Foram 13 vendas.", "12 vendas; R$ 150,00"),
    false,
  );
});
