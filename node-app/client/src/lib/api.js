const BASE = "/api";

function toQuery(params) {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach(item => usp.append(key, item));
    else usp.append(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

async function request(path, options = {}) {
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const requestOptions = {
    headers: options.body && !isForm ? { "Content-Type": "application/json" } : undefined,
    ...options
  };
  const fetchOnce = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try { return await fetch(`${BASE}${path}`, { ...requestOptions, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
  let response;
  try {
    response = await fetchOnce();
  } catch (error) {
    // Uma atualização do serviço local pode interromper brevemente uma
    // consulta. Refaça apenas leituras, sem repetir operações de gravação.
    if (options.method) throw new Error("Não foi possível conectar ao servidor. Tente novamente.");
    await new Promise(resolve => setTimeout(resolve, 700));
    try { response = await fetchOnce(); }
    catch { throw new Error(error?.name === "AbortError" ? "A consulta demorou mais de 60 segundos. Reduza o período e tente novamente." : "Não foi possível conectar ao servidor. Atualize a página e tente novamente."); }
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("dashboard:unauthorized"));
  if (!response.ok || data?.ok === false) throw new Error(data.erro || `Falha na requisicao (${response.status})`);
  return data;
}

export const api = {
  get: (path, params) => request(`${path}${toQuery(params)}`),
  post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: (path, body) => request(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: (path, body) => request(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
  upload: (path, formData) => request(path, { method: "POST", body: formData })
};
