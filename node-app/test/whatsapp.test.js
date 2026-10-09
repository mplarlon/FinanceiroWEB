import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { publicConfig, verifyWebhookSignature } from "../server/routes/whatsapp.js";

test("publicConfig mascara segredos e informa estado da configuracao", () => {
  const result = publicConfig({
    verify_token: "verificador",
    access_token: "abcdefgh12345678",
    phone_number_id: "5511999999999",
    app_secret: "segredo123456",
    api_version: "v20.0",
    callback_url: "https://example.test/webhook"
  });
  assert.equal(result.access_token_masked, "abcd...5678");
  assert.equal(result.app_secret_masked, "segr...3456");
  assert.equal(result.configured, true);
  assert.equal("access_token" in result, false);
  assert.equal("app_secret" in result, false);
});

test("verifyWebhookSignature valida HMAC SHA-256 em tempo seguro", () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const config = { app_secret: "segredo" };
  const digest = crypto.createHmac("sha256", config.app_secret).update(raw).digest("hex");
  assert.equal(verifyWebhookSignature(raw, `sha256=${digest}`, config), true);
  assert.equal(verifyWebhookSignature(raw, "sha256=incorreta", config), false);
  assert.equal(verifyWebhookSignature(raw, undefined, { app_secret: "" }), true);
});
