import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:8b";
const SHARED_HOME = "C:\\Administracao\\Ollama";

function ollamaHomes() {
  const homes = [];
  const configured = String(process.env.OLLAMA_HOME || "").trim();
  if (configured) homes.push(configured);
  if (!homes.some((home) => path.resolve(home) === path.resolve(SHARED_HOME))) homes.push(SHARED_HOME);
  return homes;
}
let unavailableUntil = 0;
let starting = null;

function enabled() {
  const value = String(process.env.CHARLIE_AI_ENABLED || "auto").toLowerCase();
  return !["0", "false", "off", "disabled"].includes(value);
}

export function getOllamaConfig() {
  return {
    enabled: enabled(),
    provider: "ollama",
    url: process.env.CHARLIE_OLLAMA_URL || DEFAULT_URL,
    model: process.env.CHARLIE_OLLAMA_MODEL || DEFAULT_MODEL,
    timeoutMs: Math.max(
      500,
      Number(process.env.CHARLIE_OLLAMA_TIMEOUT_MS) || 20000,
    ),
    keepAlive: process.env.CHARLIE_OLLAMA_KEEP_ALIVE || "10m",
  };
}

export function ollamaReplyText(body) {
  const content = String(body?.message?.content || "").trim();
  if (content) return content;
  const thinking = String(body?.message?.thinking || "").trim();
  const match = thinking.match(/\{[\s\S]*\}/);
  return match ? match[0].trim() : "";
}

function failureKind(error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError" || error?.ollamaUp) return "aborted";
  const code = error?.cause?.code || error?.code || "";
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "EAI_AGAIN"].includes(code)) return "down";
  return "error";
}

async function requestOllamaChat(config, options, fetchImpl) {
  const limit = Math.max(500, Number(options.timeoutMs) || config.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  const abort = () => controller.abort();
  options.signal?.addEventListener?.("abort", abort, { once: true });
  try {
    const response = await fetchImpl(`${config.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        think: false,
        messages: options.messages,
        format: options.format,
        options: { temperature: options.temperature ?? 0, num_predict: options.maxTokens ?? 100 },
        keep_alive: config.keepAlive,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "error" };
    const text = ollamaReplyText(await response.json());
    return text ? { kind: "text", text } : { kind: "empty" };
  } catch (error) {
    if (String(process.env.CHARLIE_AI_LOG_ERRORS || "0") === "1")
      console.warn(`[charlie-ai] fallback por regras: ${error.message}`);
    return { kind: failureKind(error) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.("abort", abort);
  }
}

export async function ollamaChat({
  messages,
  format,
  signal,
  maxTokens = 100,
  temperature = 0,
  timeoutMs,
  fetchImpl = fetch,
} = {}) {
  const config = getOllamaConfig();
  if (!config.enabled || Date.now() < unavailableUntil) return null;
  const options = { messages, format, signal, maxTokens, temperature, timeoutMs };
  let result = await requestOllamaChat(config, options, fetchImpl);
  if (result.kind === "empty" || result.kind === "error") {
    result = await requestOllamaChat(config, options, fetchImpl);
  }
  if (result.kind === "down") unavailableUntil = Date.now() + 30000;
  return result.kind === "text" ? result.text : null;
}

export function ollamaProbeUrls(configured = getOllamaConfig().url) {
  const urls = [];
  for (const url of [configured, DEFAULT_URL, "http://[::1]:11434"]) {
    const normalized = String(url || "").replace(/\/$/, "");
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return urls;
}

function modelReady(name, models) {
  const wanted = String(name || "");
  return models.some((item) => item === wanted || item.startsWith(`${wanted}:`) || wanted.startsWith(`${item}:`));
}

async function probeUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { ollamaUp: true });
    const body = await response.json();
    return (body.models || []).map((item) => item.name || item.model).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

export async function readOllamaStatus() {
  const config = getOllamaConfig();
  if (!config.enabled) return { ...config, online: false, reason: "disabled" };
  const timeoutMs = Math.min(config.timeoutMs, 3000);
  let reason = "unavailable";
  for (const url of ollamaProbeUrls(config.url)) {
    try {
      const models = await probeUrl(url, timeoutMs);
      return {
        ...config,
        url,
        online: true,
        modelAvailable: modelReady(config.model, models),
        models,
      };
    } catch (error) {
      const next = failureKind(error);
      if (next === "aborted") reason = "busy";
      else if (next === "down") reason = reason === "busy" ? "busy" : "offline";
      else if (reason !== "busy") reason = "unavailable";
    }
  }
  return { ...config, online: false, reason };
}

export function findOllamaExecutable(exists = fs.existsSync) {
  const fixed = [
    ...ollamaHomes().map((home) => path.join(home, "ollama.exe")),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe") : "",
    "C:\\Program Files\\Ollama\\ollama.exe",
  ].filter(Boolean);
  for (const candidate of fixed) {
    if (exists(candidate)) return candidate;
  }
  const users = "C:\\Users";
  if (!exists(users)) return "";
  let entries = [];
  try { entries = fs.readdirSync(users, { withFileTypes: true }); } catch { return ""; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(users, entry.name, "AppData", "Local", "Programs", "Ollama", "ollama.exe");
    if (exists(candidate)) return candidate;
  }
  return "";
}

function directoryHasModels(dir, exists = fs.existsSync) {
  return Boolean(dir) && exists(path.join(dir, "manifests"));
}

export function resolveOllamaModelsDir(exists = fs.existsSync) {
  const explicit = String(process.env.OLLAMA_MODELS || "").trim();
  if (directoryHasModels(explicit, exists)) return explicit;
  for (const home of ollamaHomes()) {
    const models = path.join(home, "models");
    if (directoryHasModels(models, exists)) return models;
  }
  const users = "C:\\Users";
  if (exists(users)) {
    let entries = [];
    try { entries = fs.readdirSync(users, { withFileTypes: true }); } catch { entries = []; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(users, entry.name, ".ollama", "models");
      if (directoryHasModels(candidate, exists)) return candidate;
    }
  }
  return path.join(ollamaHomes()[0], "models");
}

function autostartAllowed() {
  if (process.env.NODE_TEST_CONTEXT) return false;
  return !["0", "false", "off"].includes(String(process.env.CHARLIE_OLLAMA_AUTOSTART || "1").toLowerCase());
}

function startOllamaProcess() {
  const exe = findOllamaExecutable();
  if (!exe) return false;
  const models = resolveOllamaModelsDir();
  fs.mkdirSync(models, { recursive: true });
  const child = spawn(exe, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_MODELS: models,
      OLLAMA_KEEP_ALIVE: getOllamaConfig().keepAlive,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
    },
  });
  child.unref();
  return true;
}

export async function ensureOllamaServer() {
  const current = await readOllamaStatus();
  if (current.online || current.reason === "busy" || !autostartAllowed()) return current;
  if (!starting) {
    starting = (async () => {
      if (!startOllamaProcess()) return { ...current, reason: "not-installed" };
      let last = current;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        last = await readOllamaStatus();
        if (last.online) return last;
      }
      return last;
    })().finally(() => {
      setTimeout(() => { starting = null; }, 15000);
    });
  }
  return starting;
}

export async function getOllamaStatus() {
  return ensureOllamaServer();
}

export function resetOllamaAvailability() {
  unavailableUntil = 0;
}

export function getOllamaImageModel() {
  return process.env.CHARLIE_OLLAMA_IMAGE_MODEL || "x/flux2-klein:4b";
}

export function parseOllamaImage(raw) {
  let encoded = "";
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.image) encoded = String(parsed.image);
    } catch {
      /* linha de progresso incompleta */
    }
  }
  if (!encoded) return null;
  const buffer = Buffer.from(encoded, "base64");
  return buffer.length >= 32 ? buffer : null;
}

export async function ollamaGenerateImage(prompt, { timeoutMs = 180000, model } = {}) {
  const config = getOllamaConfig();
  if (!config.enabled || !String(prompt || "").trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 180000));
  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || getOllamaImageModel(),
        prompt,
        stream: false,
        width: 512,
        height: 512,
        keep_alive: "1m",
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseOllamaImage(await response.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
