const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:8b";
let unavailableUntil = 0;

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

export async function getOllamaStatus() {
  const config = getOllamaConfig();
  if (!config.enabled) return { ...config, online: false, reason: "disabled" };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(config.timeoutMs, 3000),
  );
  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/api/tags`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const models = (body.models || []).map((item) => item.name || item.model);
    return {
      ...config,
      online: true,
      modelAvailable: models.includes(config.model),
      models,
    };
  } catch (error) {
    return { ...config, online: false, reason: error.name || "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export function resetOllamaAvailability() {
  unavailableUntil = 0;
}
