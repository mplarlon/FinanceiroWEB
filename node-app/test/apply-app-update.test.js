import assert from "node:assert/strict";
import test from "node:test";
import { applyAppUpdate, updateAction } from "../client/src/lib/apply-app-update.js";

test("o aviso instala a versao pendente e so recarrega quando o arquivo ja e novo", () => {
  assert.equal(updateAction({ appVersion: "1.0.2", serverVersion: "1.0.2", pending: "1.0.9" }), "install");
  assert.equal(updateAction({ appVersion: "1.0.2", serverVersion: "1.0.9", pending: "" }), "reload");
  assert.equal(updateAction({ appVersion: "1.0.9", serverVersion: "1.0.9", pending: "" }), "none");
});

test("o clique mostra o erro quando a instalacao nao acontece", async () => {
  const result = await applyAppUpdate({
    fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, erro: "O painel não respondeu depois da atualização." }) }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /não respondeu/);
});

test("o clique recarrega quando a versao nova foi instalada", async () => {
  let reloaded = false;
  const result = await applyAppUpdate({
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, updated: true, mensagem: "A versão 1.0.9 foi instalada." }) }),
    reload: () => { reloaded = true; },
  });
  assert.equal(reloaded, true);
  assert.equal(result.reloading, true);
});
