import assert from "node:assert/strict";
import test from "node:test";

process.env.CHARLIE_OLLAMA_AUTOSTART = "0";
process.env.NODE_TEST_CONTEXT = "child";

const ollama = await import("../server/lib/ollama.js");

test("consulta o Ollama em IPv4 e IPv6", () => {
  assert.deepEqual(ollama.ollamaProbeUrls("http://127.0.0.1:11434"), [
    "http://127.0.0.1:11434",
    "http://[::1]:11434",
  ]);
  assert.deepEqual(ollama.ollamaProbeUrls("http://10.0.0.8:11434/"), [
    "http://10.0.0.8:11434",
    "http://127.0.0.1:11434",
    "http://[::1]:11434",
  ]);
});

test("acha o executavel compartilhado antes do perfil do usuario", () => {
  const seen = [];
  const exe = ollama.findOllamaExecutable((candidate) => {
    seen.push(candidate);
    return candidate.endsWith("C:\\Administracao\\Ollama\\ollama.exe");
  });
  assert.equal(exe, "C:\\Administracao\\Ollama\\ollama.exe");
  assert.equal(seen[0], "C:\\Administracao\\Ollama\\ollama.exe");
});

test("prefere o Ollama da pasta de instalacao", () => {
  const previousHome = process.env.OLLAMA_HOME;
  const previousModels = process.env.OLLAMA_MODELS;
  process.env.OLLAMA_HOME = "D:\\Cliente\\Ollama";
  delete process.env.OLLAMA_MODELS;
  try {
    const exe = ollama.findOllamaExecutable((candidate) => candidate === "D:\\Cliente\\Ollama\\ollama.exe");
    assert.equal(exe, "D:\\Cliente\\Ollama\\ollama.exe");
    const dir = ollama.resolveOllamaModelsDir((candidate) => candidate === "D:\\Cliente\\Ollama\\models\\manifests");
    assert.equal(dir, "D:\\Cliente\\Ollama\\models");
  } finally {
    if (previousHome === undefined) delete process.env.OLLAMA_HOME;
    else process.env.OLLAMA_HOME = previousHome;
    if (previousModels === undefined) delete process.env.OLLAMA_MODELS;
    else process.env.OLLAMA_MODELS = previousModels;
  }
});

test("usa a pasta de modelos que ja tem manifestos", () => {
  const dir = ollama.resolveOllamaModelsDir((candidate) => candidate.endsWith("\\models\\manifests") && candidate.includes("C:\\Administracao\\Ollama"));
  assert.equal(dir, "C:\\Administracao\\Ollama\\models");
});

test("le a imagem no json final do Ollama", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 7)]);
  const raw = [
    JSON.stringify({ done: false, response: "" }),
    "lixo",
    JSON.stringify({ done: true, image: png.toString("base64") }),
  ].join("\n");
  assert.equal(ollama.parseOllamaImage(raw).equals(png), true);
  assert.equal(ollama.parseOllamaImage(""), null);
  assert.equal(ollama.getOllamaImageModel(), "x/flux2-klein:4b");
});

test("uma falha passageira não silencia a consulta seguinte", async () => {
  ollama.resetOllamaAvailability();
  const json = (content, extra = {}) => ({ ok: true, json: async () => ({ message: { content, ...extra } }) });
  try {
    assert.equal(ollama.ollamaReplyText({ message: { content: "  oi " } }), "oi");
    assert.equal(ollama.ollamaReplyText({ message: { content: "", thinking: "pré {\"a\":1} pós" } }), "{\"a\":1}");
    assert.equal(ollama.ollamaReplyText({ message: { thinking: "sem json" } }), "");

    let calls = 0;
    const aborted = async () => {
      calls += 1;
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    assert.equal(await ollama.ollamaChat({ messages: [], timeoutMs: 500, fetchImpl: aborted }), null);
    assert.equal(calls, 1);
    calls = 0;
    const answered = async () => {
      calls += 1;
      return json("{\"ok\":1}");
    };
    assert.equal(await ollama.ollamaChat({ messages: [], timeoutMs: 500, fetchImpl: answered }), "{\"ok\":1}");
    assert.equal(calls, 1);

    ollama.resetOllamaAvailability();
    calls = 0;
    const refused = async () => {
      calls += 1;
      const error = new TypeError("fetch failed");
      error.cause = { code: "ECONNREFUSED" };
      throw error;
    };
    assert.equal(await ollama.ollamaChat({ messages: [], timeoutMs: 500, fetchImpl: refused }), null);
    assert.equal(await ollama.ollamaChat({ messages: [], timeoutMs: 500, fetchImpl: refused }), null);
    assert.equal(calls, 1);

    ollama.resetOllamaAvailability();
    calls = 0;
    const blankThenText = async () => {
      calls += 1;
      return calls === 1 ? json("", { thinking: "" }) : json("{\"name\":\"x\"}");
    };
    assert.equal(await ollama.ollamaChat({ messages: [], timeoutMs: 500, fetchImpl: blankThenText }), "{\"name\":\"x\"}");
    assert.equal(calls, 2);

    ollama.resetOllamaAvailability();
    calls = 0;
    const thinking = async () => {
      calls += 1;
      return json("", { thinking: "vou responder {\"name\":\"chave\"}" });
    };
    assert.equal(await ollama.ollamaChat({ messages: [], timeoutMs: 500, fetchImpl: thinking }), "{\"name\":\"chave\"}");
    assert.equal(calls, 1);
  } finally {
    ollama.resetOllamaAvailability();
  }
});

test("nao tenta subir o Ollama durante o teste", async () => {
  const status = await ollama.readOllamaStatus();
  assert.equal(typeof status.online, "boolean");
  assert.equal(status.provider, "ollama");
});
