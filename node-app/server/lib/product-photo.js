import fs from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const LOCAL_LIBRARY = "D:\\Imagem";
const nameCache = new Map();

export function safeProductId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(id) ? id : null;
}

export function photoDirectories({ configured = "", extra = [], fallback = LOCAL_LIBRARY, exists = fs.existsSync } = {}) {
  const dirs = [];
  for (const candidate of [configured, process.env.DASHBOARD_FOTO_DIR, ...extra, fallback]) {
    const raw = String(candidate || "").trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    if (dirs.includes(resolved)) continue;
    try {
      if (exists(resolved) && fs.statSync(resolved).isDirectory()) dirs.push(resolved);
    } catch {
      /* pasta inacessível */
    }
  }
  return dirs;
}

function imageStem(name) {
  const base = path.basename(String(name || ""));
  const ext = path.extname(base).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return null;
  return { base, stem: base.slice(0, -ext.length).toLowerCase() };
}

export function pickProductPhotoName(names, productId) {
  const id = safeProductId(productId);
  if (!id) return null;
  const key = id.toLowerCase();
  const matches = [];
  for (const name of names) {
    const parsed = imageStem(name);
    if (!parsed) continue;
    if (parsed.stem === key || parsed.stem.startsWith(`${key}_`)) matches.push(parsed.base);
  }
  const main = matches.filter((name) => imageStem(name).stem.startsWith(`${key}_0`));
  const pool = main.length ? main : matches;
  return pool.sort((a, b) => a.localeCompare(b, "en")).at(-1) || null;
}

export function cachedPhotoNames(dir, now = Date.now()) {
  const hit = nameCache.get(dir);
  if (hit && now - hit.at < 30_000) return hit.names;
  const names = fs.readdirSync(dir);
  nameCache.set(dir, { at: now, names });
  return names;
}

export function findProductPhoto(productId, dirs, listNames = cachedPhotoNames) {
  const id = safeProductId(productId);
  if (!id) return null;
  for (const dir of dirs) {
    let names;
    try { names = listNames(dir); } catch { continue; }
    const picked = pickProductPhotoName(names, id);
    if (!picked) continue;
    const root = path.resolve(dir);
    const full = path.resolve(root, picked);
    if (full !== root && full.startsWith(root + path.sep)) return full;
  }
  return null;
}

export function attachReviewPhotos(items, dirs, listNames = cachedPhotoNames) {
  return items.map((item) => {
    const id = safeProductId(item.productId);
    const file = id ? findProductPhoto(id, dirs, listNames) : null;
    if (!file) return item;
    let version = "";
    try { version = `?v=${Math.floor(fs.statSync(file).mtimeMs)}`; } catch { /* a url segue sem versão */ }
    return { ...item, foto: `/api/modulo_removido/revisao-hub/foto/${encodeURIComponent(id)}${version}` };
  });
}

export function forgetPhotoNames(dir) {
  if (!dir) {
    nameCache.clear();
    return;
  }
  nameCache.delete(path.resolve(dir));
}

function photoStamp(at) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

function imageExtension(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return ".png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return ".jpg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}

function photoOutputDir(dirs) {
  const list = (dirs || []).map((dir) => path.resolve(String(dir || ""))).filter(Boolean);
  const local = path.resolve(LOCAL_LIBRARY).toLowerCase();
  return list.find((dir) => dir.toLowerCase() === local) || list[0] || null;
}

export function saveProductPhoto(productId, bytes, dirs, { at = new Date(), write = fs.writeFileSync } = {}) {
  const id = safeProductId(productId);
  if (!id) throw new Error("Código de produto inválido para a foto.");
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const ext = buffer.length >= 32 ? imageExtension(buffer) : null;
  if (!ext) throw new Error("O arquivo copiado não é uma foto.");
  const dir = photoOutputDir(dirs);
  if (!dir) throw new Error("Nenhuma pasta de fotos disponível.");
  const full = path.resolve(dir, `${id}_0_${photoStamp(at)}${ext}`);
  if (full !== dir && !full.startsWith(dir + path.sep)) throw new Error("Caminho de foto inválido.");
  write(full, buffer);
  forgetPhotoNames(dir);
  return full;
}

export async function ensureProductPhoto({ productId, product, productName, dirs, fetchPhoto, at } = {}) {
  const existing = findProductPhoto(productId, dirs);
  if (existing) return { created: false, file: existing };
  if (typeof fetchPhoto !== "function") return { created: false, file: null };
  const bytes = await fetchPhoto({
    ...(product || {}),
    name: product?.name || productName,
    productName: product?.productName || productName,
  });
  if (!bytes) return { created: false, file: null };
  return { created: true, file: saveProductPhoto(productId, bytes, dirs, { at }) };
}
