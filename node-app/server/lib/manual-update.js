import { MANUAL_CHECK_PORT } from "../../update-system/shared.js";

export function manualCheckUrl(environment = process.env) {
  const configured = String(environment.ERP_UPDATE_CONTROL_URL || "").trim();
  if (configured) return configured;
  const port = Number(environment.ERP_UPDATE_CONTROL_PORT || MANUAL_CHECK_PORT);
  return `http://127.0.0.1:${port}/check`;
}

export function presentManualUpdate(result = {}) {
  if (result.updated) {
    return { ok: true, updated: true, version: result.version, mensagem: `A versão ${result.version} foi instalada. A tela vai recarregar.` };
  }
  if (result.deferred === "critical_operation") {
    return { ok: false, erro: "A atualização ficou para depois porque esta máquina está no meio de uma operação." };
  }
  if (result.blocked) {
    return { ok: false, erro: "Esta versão já falhou várias vezes nesta máquina." };
  }
  if (result.deferred) {
    return { ok: false, erro: "A atualização ficou para depois nesta máquina." };
  }
  if (result.registrationRequested) {
    return { ok: true, updated: false, registrationRequested: true, mensagem: "Solicitação de registro enviada para a central. Ela fica na fila até alguém registrar esta máquina." };
  }
  if (result.ok === false || result.erro) {
    return { ok: false, erro: explainManualUpdateError(result.erro) };
  }
  if (result.updated === false) {
    return { ok: true, updated: false, mensagem: "Não há atualização nova para esta máquina." };
  }
  return { ok: false, erro: "Não foi possível consultar a atualização." };
}

export function explainManualUpdateError(value) {
  const text = String(value || "");
  if (/installationId|não está registrada|nao está registrada|Token de registro invalido ou expirado|inválido ou expirado|invalido ou expirado/i.test(text)) {
    return "Esta máquina não conseguiu se registrar para atualizar. O registro está inválido ou expirado.";
  }
  return text.slice(0, 300) || "Não foi possível consultar a atualização.";
}

const UNREACHABLE = {
  status: 503,
  ok: false,
  erro: "Esta máquina não tem o serviço de atualização.",
};

async function askUpdater(fetchImpl, url) {
  const response = await fetchImpl(url, { method: "POST", signal: AbortSignal.timeout(10 * 60_000) });
  const result = await response.json().catch(() => ({}));
  const body = presentManualUpdate(result);
  const status = body.ok ? 200 : response.status >= 400 ? response.status : 409;
  return { status, ...body };
}

export async function requestManualUpdate(fetchImpl = globalThis.fetch, url = manualCheckUrl(), options = {}) {
  try {
    return await askUpdater(fetchImpl, url);
  } catch {
    if (!options.awaken) return UNREACHABLE;
    const started = await options.awaken();
    if (!started) return UNREACHABLE;
    const pause = options.pause || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const deadline = Date.now() + Number(options.waitMs ?? 45_000);
    while (Date.now() < deadline) {
      await pause(1000);
      try {
        return await askUpdater(fetchImpl, url);
      } catch { /* o serviço ainda está subindo */ }
    }
    return {
      status: 202,
      ok: true,
      updated: false,
      mensagem: "O atualizador desta máquina foi reiniciado e vai buscar a versão nova.",
    };
  }
}
