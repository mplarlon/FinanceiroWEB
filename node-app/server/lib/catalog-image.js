import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ollamaGenerateImage } from "./ollama.js";

const HOME = "C:\\Administracao\\CharlieImage";
const EXE_NAMES = ["sd-cli.exe", "sd.exe"];

function findExe(root, exists = fs.existsSync) {
  if (!root || !exists(root)) return "";
  const levels = [root];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) levels.push(path.join(root, entry.name));
    }
  } catch {
    return "";
  }
  for (const dir of levels) {
    for (const name of EXE_NAMES) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return "";
}

export function catalogImagePaths(env = process.env, exists = fs.existsSync) {
  const configuredBin = String(env.CHARLIE_IMAGE_BIN || "").trim();
  const configuredModel = String(env.CHARLIE_IMAGE_MODEL || "").trim();
  const modelFile = path.join(HOME, "models", "v1-5-pruned-emaonly.safetensors");
  return {
    bin: configuredBin || findExe(path.join(HOME, "bin"), exists),
    model: configuredModel || (exists(modelFile) ? modelFile : ""),
  };
}

export function localImageArgs(prompt, { model, output }) {
  return [
    "-m", model,
    "-p", String(prompt || "").replace(/\s+/g, " ").trim().slice(0, 800),
    "-n", "text, letters, numbers, logo, watermark, blurry, person, hands, cropped, gray background, dark background",
    "-W", "512",
    "-H", "512",
    "--steps", "20",
    "--cfg-scale", "7",
    "-o", output,
  ];
}

export async function generateLocalCatalogImage(prompt, {
  spawnProcess = spawn,
  timeoutMs = 240000,
  paths,
} = {}) {
  const resolved = paths || catalogImagePaths();
  if (!resolved.bin || !resolved.model || !String(prompt || "").trim()) return null;
  const output = path.join(os.tmpdir(), `charlie-foto-${process.pid}-${Date.now()}.png`);
  const args = localImageArgs(prompt, { model: resolved.model, output });
  const code = await new Promise((resolve) => {
    let child;
    try {
      child = spawnProcess(resolved.bin, args, { windowsHide: true, cwd: path.dirname(resolved.bin) });
    } catch {
      resolve(-1);
      return;
    }
    const timer = setTimeout(() => {
      child.kill?.();
      resolve(-1);
    }, Math.max(500, Number(timeoutMs) || 180000));
    child.on?.("error", () => {
      clearTimeout(timer);
      resolve(-1);
    });
    child.on?.("exit", (status) => {
      clearTimeout(timer);
      resolve(status ?? -1);
    });
  });
  try {
    if (code !== 0 || !fs.existsSync(output)) return null;
    const bytes = fs.readFileSync(output);
    return bytes.length >= 32 ? bytes : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(output, { force: true });
  }
}

export async function generateCatalogImage(prompt, deps = {}) {
  const local = await generateLocalCatalogImage(prompt, deps);
  if (local) return local;
  if (deps.ollama === false) return null;
  return ollamaGenerateImage(prompt, { timeoutMs: deps.timeoutMs || 180000 });
}
