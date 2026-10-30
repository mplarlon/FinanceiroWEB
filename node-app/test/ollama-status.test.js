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

test("nao tenta subir o Ollama durante o teste", async () => {
  const status = await ollama.readOllamaStatus();
  assert.equal(typeof status.online, "boolean");
  assert.equal(status.provider, "ollama");
});
