const TRAY_IMAGE_HOST = "images.tcdn.com.br";

export function safeTrayImage(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "0") return null;
  const upgraded = /^http:\/\/images\.tcdn\.com\.br\//i.test(raw)
    ? `https://${raw.slice("http://".length)}`
    : raw;
  try {
    const parsed = new URL(upgraded);
    if (parsed.protocol !== "https:" || parsed.hostname !== TRAY_IMAGE_HOST) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function entryUrl(entry) {
  if (!entry || typeof entry !== "object") return safeTrayImage(entry);
  const thumbs = entry.thumbs || {};
  return safeTrayImage(thumbs["90"]?.https)
    || safeTrayImage(thumbs["180"]?.https)
    || safeTrayImage(thumbs["30"]?.https)
    || safeTrayImage(entry.https)
    || safeTrayImage(thumbs["90"]?.http)
    || safeTrayImage(thumbs["180"]?.http)
    || safeTrayImage(thumbs["30"]?.http)
    || safeTrayImage(entry.http)
    || safeTrayImage(entry.image);
}

export function trayProductPhoto(product = {}) {
  const direct = safeTrayImage(product.imagem);
  if (direct) return direct;
  const list = [product.ProductImage, product.ProductImages, product.images].find(Array.isArray);
  if (list) {
    for (const entry of list) {
      const url = entryUrl(entry?.ProductImage || entry);
      if (url) return url;
    }
    return null;
  }
  return safeTrayImage(product.image) || safeTrayImage(product.picture) || safeTrayImage(product.url_image);
}
