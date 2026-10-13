import crypto from "node:crypto";
import express from "express";
import { readJsonConfig, writeJsonConfig } from "../lib/json-config.js";
import { withDatabase } from "../db.js";
import { answer } from "./assistant.js";

const router = express.Router();
const CONFIG_FILE = "whatsapp_config.json";
const CONFIG_KEYS = [
  "verify_token",
  "access_token",
  "phone_number_id",
  "app_secret",
  "api_version",
  "callback_url",
];

function environmentConfig() {
  return {
    verify_token: process.env.WHATSAPP_VERIFY_TOKEN || "",
    access_token: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    app_secret: process.env.WHATSAPP_APP_SECRET || "",
    api_version: process.env.WHATSAPP_API_VERSION || "v20.0",
    callback_url: "",
  };
}

function loadConfig() {
  const config = environmentConfig();
  const saved = readJsonConfig(CONFIG_FILE, {});
  for (const key of CONFIG_KEYS) {
    if (saved[key]) config[key] = saved[key];
  }
  return config;
}

function saveConfig(input = {}) {
  const config = loadConfig();
  for (const key of CONFIG_KEYS) {
    if (!(key in input)) continue;
    const value = String(input[key] ?? "").trim();
    if (
      (key === "access_token" || key === "app_secret") &&
      !value &&
      config[key]
    )
      continue;
    config[key] = value;
  }
  if (!config.api_version) config.api_version = "v20.0";
  return writeJsonConfig(CONFIG_FILE, config);
}

function maskSecret(value, visible = 4) {
  if (!value) return "";
  if (value.length <= visible * 2) return "*".repeat(value.length);
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}

function publicConfig(config = loadConfig()) {
  return {
    verify_token: config.verify_token || "",
    access_token_masked: maskSecret(config.access_token || ""),
    has_access_token: Boolean(config.access_token),
    phone_number_id: config.phone_number_id || "",
    app_secret_masked: maskSecret(config.app_secret || ""),
    has_app_secret: Boolean(config.app_secret),
    api_version: config.api_version || "v20.0",
    callback_url: config.callback_url || "",
    webhook_path: "/api/whatsapp/webhook",
    configured: Boolean(
      config.verify_token && config.access_token && config.phone_number_id,
    ),
  };
}

router.get("/webhook", (req, res) => {
  const config = loadConfig();
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] &&
    req.query["hub.verify_token"] === config.verify_token
  ) {
    return res.type("text/plain").send(req.query["hub.challenge"] || "");
  }
  return res.status(403).json({ erro: "Verify token invalido", ok: false });
});

router.get("/config", (_req, res) =>
  res.json({ ok: true, config: publicConfig() }),
);

router.post("/config", (req, res) => {
  try {
    const config = saveConfig(req.body || {});
    res.json({ ok: true, config: publicConfig(config) });
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message });
  }
});

router.post("/sync", async (_req, res) => {
  const config = loadConfig();
  if (!config.access_token || !config.phone_number_id) {
    return res.status(400).json({
      erro: "Informe access_token e phone_number_id antes de sincronizar.",
      ok: false,
    });
  }
  const fields =
    "id,display_phone_number,verified_name,quality_rating,code_verification_status";
  const url = new URL(
    `https://graph.facebook.com/${config.api_version || "v20.0"}/${config.phone_number_id}`,
  );
  url.searchParams.set("fields", fields);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.access_token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    if (!response.ok) {
      return res.status(400).json({
        erro: `Erro ao consultar Meta API ${response.status}: ${body}`,
        ok: false,
      });
    }
    res.json({
      ok: true,
      message: "Conexao com a Meta validada com sucesso.",
      meta: body ? JSON.parse(body) : {},
      config: publicConfig(config),
    });
  } catch (error) {
    res
      .status(400)
      .json({
        ok: false,
        erro: `Erro ao sincronizar com a Meta: ${error.message}`,
      });
  }
});

function incomingMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || [])
    for (const change of entry?.changes || []) {
      for (const message of change?.value?.messages || []) {
        const body = message?.text?.body;
        if (message?.from && body)
          messages.push({
            from: String(message.from),
            id: message.id || null,
            text: String(body).trim(),
            phoneNumberId: change?.value?.metadata?.phone_number_id || null,
          });
      }
    }
  return messages;
}

async function sendText(config, recipient, body, phoneNumberId) {
  if (!config.access_token || !(phoneNumberId || config.phone_number_id)) {
    throw new Error("Configuracao do WhatsApp incompleta.");
  }
  const response = await fetch(
    `https://graph.facebook.com/${config.api_version || "v20.0"}/${phoneNumberId || config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "text",
        text: { body },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `Erro WhatsApp API ${response.status}: ${JSON.stringify(payload)}`,
    );
  return payload;
}

router.post("/webhook", async (req, res) => {
  const config = loadConfig();
  if (
    !verifyWebhookSignature(req.rawBody, req.get("X-Hub-Signature-256"), config)
  ) {
    return res.status(403).json({ ok: false, erro: "Assinatura invalida" });
  }
  const messages = incomingMessages(req.body || {});
  const responses = [];
  for (const message of messages) {
    try {
      const result = await withDatabase((db) => answer(db, message.text));
      const delivery = await sendText(
        config,
        message.from,
        result.resposta,
        message.phoneNumberId,
      );
      responses.push({
        from: message.from,
        message_id: message.id,
        resposta: result.resposta,
        envio: delivery,
      });
    } catch (error) {
      responses.push({
        from: message.from,
        message_id: message.id,
        erro: error.message,
      });
    }
  }
  res.json({
    ok: true,
    received: true,
    mensagens: messages.length,
    respostas: responses,
  });
});

export function verifyWebhookSignature(
  rawBody,
  signature,
  config = loadConfig(),
) {
  if (!config.app_secret) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const digest = crypto
    .createHmac("sha256", config.app_secret)
    .update(rawBody || Buffer.alloc(0))
    .digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const supplied = Buffer.from(signature);
  return (
    supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected)
  );
}

export { loadConfig, publicConfig, saveConfig, sendText };
export default router;
