import React, { useEffect, useState } from "react";

export default function UpdateAvailable() {
  const [available, setAvailable] = useState(null);
  const [later, setLater] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        const data = await response.json();
        if (active && data.version && data.version !== __APP_VERSION__) setAvailable(data.version);
      } catch { /* atualizacoes nao interferem no uso offline */ }
    };
    check(); const timer = setInterval(check, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  if (!available || later) return null;
  return <aside className="update-available" role="status"><div><strong>Uma nova versão do sistema está disponível.</strong><span>Atualize a página para utilizar as melhorias. Seus dados não serão recarregados sem sua confirmação.</span></div><button onClick={() => window.location.reload()}>Atualizar agora</button><button className="secondary" onClick={() => setLater(true)}>Atualizar posteriormente</button></aside>;
}
