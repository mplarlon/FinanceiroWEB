import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const SECTIONS = [
  { id: "visao", label: "Visão geral", icon: "V" },
  { id: "versoes", label: "Versões", icon: "R" },
  { id: "maquinas", label: "Máquinas", icon: "M" },
  { id: "auditoria", label: "Auditoria", icon: "A" },
];

const STATUS_LABEL = {
  blocked: "Bloqueada",
  published: "Publicada",
  draft: "Rascunho",
  online: "Online",
  offline: "Offline",
  failed: "Falha",
  rollback: "Revertida",
  revoked: "Revogada",
  outdated: "Desatualizada",
  current: "Atualizada",
  installed: "Instalada",
  authorization_created: "Liberação",
  release_status_changed: "Status",
  distribution_suspension: "Suspensão",
  installation_revoked: "Revogação",
};

const api = async (path, token, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};

function when(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Nunca";
}

function machinesOf(installations) {
  return [...installations].sort((a, b) =>
    Number(Boolean(b.outdated)) - Number(Boolean(a.outdated))
    || String(a.companyName || "").localeCompare(String(b.companyName || ""), "pt-BR")
    || String(a.hostname || "").localeCompare(String(b.hostname || ""), "pt-BR"));
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("update-admin-token") || "");
  const [summary, setSummary] = useState(null);
  const [installations, setInstallations] = useState([]);
  const [releases, setReleases] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState("visao");

  const load = async () => {
    if (!token) return;
    try {
      const [a, b, c, d] = await Promise.all([
        api("/api/admin/summary", token),
        api("/api/admin/installations", token),
        api("/api/admin/releases", token),
        api("/api/admin/events", token),
      ]);
      setSummary(a);
      setInstallations(b.installations);
      setReleases(c.releases);
      setEvents(d.events);
      setError("");
      sessionStorage.setItem("update-admin-token", token);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!summary) return undefined;
    const nodes = SECTIONS.map((item) => document.getElementById(item.id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-15% 0px -55% 0px", threshold: [0.15, 0.4] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [summary]);

  const authorize = async (version, input = {}) => {
    await api("/api/admin/authorizations", token, { method: "POST", body: JSON.stringify({ version, ...input }) });
    await load();
  };
  const status = async (version, value) => {
    await api(`/api/admin/releases/${version}`, token, { method: "PATCH", body: JSON.stringify({ status: value }) });
    await load();
  };
  const logout = () => {
    sessionStorage.removeItem("update-admin-token");
    setToken("");
    setSummary(null);
    setError("");
  };

  if (!summary) {
    return (
      <main className="login">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-dot">P</span>
          <span>PONTUAL<small>TECNOLOGIA</small></span>
        </div>
        <form className="card" onSubmit={(event) => { event.preventDefault(); setToken(new FormData(event.currentTarget).get("token")); }}>
          <h1>Central de Atualizações</h1>
          <p>Informe a credencial administrativa da central.</p>
          <input name="token" type="password" placeholder="Credencial" autoFocus required />
          <button>Entrar</button>
          {error && <div className="error">{error}</div>}
        </form>
      </main>
    );
  }

  const go = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="layout">
      <aside>
        <div className="brand">
          <span className="brand-dot">P</span>
          <span className="brand-name">PONTUAL<small>TECNOLOGIA</small></span>
        </div>
        <div className="nav-caption">ATUALIZAÇÕES</div>
        <nav>
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" className={active === item.id ? "active" : ""} onClick={() => go(item.id)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <header>
          <div>
            <span className="page-eyebrow">PONTUAL TECNOLOGIA</span>
            <h1>Central de Atualizações</h1>
          </div>
          <div className="header-actions">
            <span className={`connection-pill ${summary.suspended ? "offline" : "online"}`}>
              <i /> {summary.suspended ? "Distribuição suspensa" : "Distribuição ativa"}
            </span>
            <button
              type="button"
              className={summary.suspended ? "primary" : "ghost"}
              onClick={async () => { await api("/api/admin/suspension", token, { method: "POST", body: JSON.stringify({ suspended: !summary.suspended }) }); load(); }}
            >
              {summary.suspended ? "Retomar distribuição" : "Suspender distribuição"}
            </button>
            <button type="button" className="link-btn" onClick={logout}>Sair</button>
          </div>
        </header>
        {error && <div className="error alert">{error}</div>}
        <section id="visao" className="metrics">
          <Card label="Instalações" value={summary.totals.installations} />
          <Card label="Online recentemente" value={summary.totals.recent} />
          <Card label="Atualizadas" value={summary.totals.current} />
          <Card label="Desatualizadas" value={summary.totals.outdated || 0} />
          <Card label="Com falha" value={summary.totals.failed} />
          <Card label="Versão atual" value={summary.latestVersion || "—"} />
        </section>
        <section id="versoes" className="panel">
          <h2>Versões</h2>
          <div className="table-scroll">
            <table className="tabela">
              <thead>
                <tr><th>Versão</th><th>Canal</th><th>Status</th><th>Publicada</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {releases.length === 0 && <tr><td colSpan={5} className="empty">Nenhuma versão publicada.</td></tr>}
                {releases.map((release) => (
                  <tr key={release.manifest.version}>
                    <td>{release.manifest.version}</td>
                    <td>{release.manifest.channel}</td>
                    <td><Badge value={release.status} /></td>
                    <td>{when(release.createdAt)}</td>
                    <td className="acoes">
                      <button type="button" className="primary" onClick={() => authorize(release.manifest.version, { group: "pilot", percentage: 100 })}>Liberar pilotos</button>
                      <button type="button" onClick={() => authorize(release.manifest.version, { percentage: 5 })}>Lote 5%</button>
                      <button type="button" className="danger" onClick={() => status(release.manifest.version, "blocked")}>Bloquear</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section id="maquinas" className="panel">
          <h2>Máquinas</h2>
          <div className="table-scroll">
            <table className="tabela">
              <thead>
                <tr><th>Empresa</th><th>Máquina</th><th>IP na rede</th><th>Versão</th><th>Atualização</th><th>Status</th><th>Última comunicação</th><th>Ação</th></tr>
              </thead>
              <tbody>
                {installations.length === 0 && <tr><td colSpan={8} className="empty">Nenhuma máquina registrada.</td></tr>}
                {machinesOf(installations).map((item) => (
                  <tr key={item.installationId} className={item.outdated ? "outdated" : ""}>
                    <td>{item.companyName || "Sem empresa"}<small>{item.group}</small></td>
                    <td>{item.hostname || "Aguardando"}</td>
                    <td>{(item.addresses || []).join(", ") || "Aguardando"}</td>
                    <td>{item.version}</td>
                    <td><Badge value={item.revokedAt ? "revoked" : item.outdated ? "outdated" : "current"} /></td>
                    <td><Badge value={item.revokedAt ? "revoked" : item.status} /></td>
                    <td>{when(item.lastSeenAt)}</td>
                    <td className="acoes">
                      {summary.latestVersion && item.outdated && <button type="button" className="primary" onClick={() => authorize(summary.latestVersion, { installationId: item.installationId })}>Liberar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section id="auditoria" className="panel">
          <h2>Auditoria recente</h2>
          <div className="table-scroll">
            <table className="tabela">
              <thead>
                <tr><th>Quando</th><th>Instalação</th><th>Evento</th><th>Versão</th><th>Detalhe</th></tr>
              </thead>
              <tbody>
                {events.length === 0 && <tr><td colSpan={5} className="empty">Nenhum evento recente.</td></tr>}
                {events.slice(0, 50).map((item) => (
                  <tr key={item.id}>
                    <td>{when(item.receivedAt)}</td>
                    <td>{item.installationId}</td>
                    <td><Badge value={item.type} /></td>
                    <td>{item.version || "—"}</td>
                    <td>{item.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function Card({ label, value }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong></article>;
}

function Badge({ value, label }) {
  return <span className={`badge ${value}`}>{label || STATUS_LABEL[value] || value}</span>;
}

createRoot(document.getElementById("root")).render(<App />);
