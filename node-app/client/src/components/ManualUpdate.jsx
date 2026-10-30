import React, { useState } from "react";
import { applyAppUpdate } from "../lib/apply-app-update.js";

export default function ManualUpdate() {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  async function updateNow() {
    setBusy(true);
    setInfo("");
    setError("");
    const result = await applyAppUpdate({ reload: () => window.location.reload() });
    if (result.info) setInfo(result.info);
    if (result.error) setError(result.error);
    if (!result.reloading) setBusy(false);
  }

  return (
    <>
      <button type="button" className="link-btn start-ini-open" disabled={busy} onClick={updateNow}>
        {busy ? "Atualizando..." : "Atualizar"}
      </button>
      {info && <div className="manual-update-note success">{info}</div>}
      {error && <div className="manual-update-note error">{error}</div>}
    </>
  );
}
