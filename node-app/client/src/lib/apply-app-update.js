export function updateAction({ appVersion, serverVersion, pending }) {
  if (pending && pending !== appVersion && pending !== serverVersion) return "install";
  if ((serverVersion && serverVersion !== appVersion) || (pending && pending !== appVersion)) return "reload";
  return "none";
}

export async function applyAppUpdate({
  fetchImpl = globalThis.fetch,
  reload = () => {},
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
} = {}) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    const response = await fetchImpl("/api/app-update/now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      return { ok: false, error: data.erro || "Não foi possível atualizar esta máquina." };
    }
    if (data.updated) {
      reload();
      return { ok: true, reloading: true, info: data.mensagem || "A versão nova foi instalada." };
    }
    return { ok: true, info: data.mensagem || "Consulta concluída." };
  } catch {
    if (now() - started < 1500) return { ok: false, error: "Não foi possível falar com o sistema nesta máquina." };
    const back = await waitForDashboard({ fetchImpl, pause, now, started: now() });
    if (back) {
      reload();
      return { ok: true, reloading: true, info: "A atualização está sendo aplicada. Aguarde a tela voltar." };
    }
    return { ok: false, error: "A atualização não terminou. Abra o sistema de novo em instantes." };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForDashboard({ fetchImpl, pause, now, started }) {
  while (now() - started < 3 * 60_000) {
    await pause(2000);
    try {
      const response = await fetchImpl(`/api/status?t=${now()}`, { cache: "no-store" });
      if (response.ok) return true;
    } catch { /* o serviço ainda está reiniciando */ }
  }
  return false;
}
