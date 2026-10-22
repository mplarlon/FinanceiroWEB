import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:8b";
const SHARED_HOME = "C:\\Administracao\\Ollama";
const SHARED_MODELS = path.join(SHARED_HOME, "models");
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

export async function ollamaChat({
  messages,
  format,
  signal,
  maxTokens = 100,
  temperature = 0,
} = {}) {
  const config = getOllamaConfig();
  if (!config.enabled || Date.now() < unavailableUntil) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        think: false,
        messages,
        format,
        options: { temperature, num_predict: maxTokens },
        keep_alive: config.keepAlive,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const body = await response.json();
    return String(body?.message?.content || "").trim() || null;
  } catch (error) {
    unavailableUntil = Date.now() + 30000;
    if (String(process.env.CHARLIE_AI_LOG_ERRORS || "0") === "1")
      console.warn(`[charlie-ai] fallback por regras: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
      reason = error.name || "unavailable";
    }
  }
  return { ...config, online: false, reason };
}

export function findOllamaExecutable(exists = fs.existsSync) {
  const fixed = [
    path.join(SHARED_HOME, "ollama.exe"),
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
  if (directoryHasModels(SHARED_MODELS, exists)) return SHARED_MODELS;
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
  return SHARED_MODELS;
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
  if (current.online || !autostartAllowed()) return current;
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
