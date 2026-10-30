import React, { useEffect, useState } from "react";
import { applyAppUpdate, updateAction } from "../lib/apply-app-update.js";

export default function UpdateAvailable() {
  const [serverVersion, setServerVersion] = useState("");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (active && data.version) setServerVersion(String(data.version));
      } catch { /* atualizacoes nao interferem no uso offline */ }
      try {
        const response = await fetch(`/api/app-update?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (active) setPending(data.pending ? String(data.pending) : "");
      } catch { /* o aviso continua no proximo ciclo */ }
    };
    check();
    const timer = setInterval(check, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const newer = [serverVersion, pending].find((version) => version && version !== __APP_VERSION__);
  if (!newer) return null;
  const updateNow = async () => {
    setError("");
    const action = updateAction({ appVersion: __APP_VERSION__, serverVersion, pending });
    if (action === "reload") {
      setBusy(true);
      const url = new URL(window.location.href);
      url.searchParams.set("atualizado", String(Date.now()));
      window.location.replace(url.toString());
      return;
    }
    setBusy(true);
    const result = await applyAppUpdate({ reload: () => window.location.reload() });
    if (result.error) setError(result.error);
    if (!result.reloading) setBusy(false);
  };
  return (
    <div className="update-available" role="status">
      <div>
        <strong>Nova versão {newer}</strong>
        <span className={error ? "update-error" : ""}>{error || (busy ? "Instalando a versão nova." : "O aviso continua até esta tela entrar na versão nova.")}</span>
      </div>
      <button type="button" disabled={busy} onClick={updateNow}>{busy ? "Atualizando..." : "Atualizar agora"}</button>
    </div>
  );
}
