import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = async (path, token, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
};

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("update-admin-token") || "");
  const [summary, setSummary] = useState(null); const [installations, setInstallations] = useState([]); const [releases, setReleases] = useState([]); const [events, setEvents] = useState([]); const [error, setError] = useState("");
  const load = async () => { if (!token) return; try { const [a, b, c, d] = await Promise.all([api("/api/admin/summary", token), api("/api/admin/installations", token), api("/api/admin/releases", token), api("/api/admin/events", token)]); setSummary(a); setInstallations(b.installations); setReleases(c.releases); setEvents(d.events); setError(""); sessionStorage.setItem("update-admin-token", token); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [token]);
  const authorize = async (version, input = {}) => { await api("/api/admin/authorizations", token, { method: "POST", body: JSON.stringify({ version, ...input }) }); await load(); };
  const status = async (version, value) => { await api(`/api/admin/releases/${version}`, token, { method: "PATCH", body: JSON.stringify({ status: value }) }); await load(); };
  if (!summary) return <main className="login"><form onSubmit={(event) => { event.preventDefault(); setToken(new FormData(event.currentTarget).get("token")); }}><h1>Central de Atualizações</h1><p>Informe a credencial administrativa da central.</p><input name="token" type="password" autoFocus/><button>Entrar</button>{error && <strong>{error}</strong>}</form></main>;
  return <main><header><div><span>PONTUAL TECNOLOGIA</span><h1>Central de Atualizações</h1></div><button className={summary.suspended ? "danger" : "secondary"} onClick={async () => { await api("/api/admin/suspension", token, { method: "POST", body: JSON.stringify({ suspended: !summary.suspended }) }); load(); }}>{summary.suspended ? "Retomar distribuição" : "Suspender distribuição"}</button></header>
    {error && <div className="alert">{error}</div>}
    <section className="cards"><Card label="Instalações" value={summary.totals.installations}/><Card label="Online recentemente" value={summary.totals.recent}/><Card label="Atualizadas" value={summary.totals.current}/><Card label="Com falha" value={summary.totals.failed}/><Card label="Versão atual" value={summary.latestVersion || "—"}/></section>
    <section><h2>Versões</h2><div className="table"><table><thead><tr><th>Versão</th><th>Canal</th><th>Status</th><th>Publicada</th><th>Ações</th></tr></thead><tbody>{releases.map((release) => <tr key={release.manifest.version}><td>{release.manifest.version}</td><td>{release.manifest.channel}</td><td><Badge value={release.status}/></td><td>{new Date(release.createdAt).toLocaleString("pt-BR")}</td><td><button onClick={() => authorize(release.manifest.version, { group: "pilot", percentage: 100 })}>Liberar pilotos</button><button onClick={() => authorize(release.manifest.version, { percentage: 5 })}>Lote 5%</button><button className="danger" onClick={() => status(release.manifest.version, "blocked")}>Bloquear</button></td></tr>)}</tbody></table></div></section>
    <section><h2>Clientes</h2><div className="table"><table><thead><tr><th>Cliente</th><th>Grupo</th><th>Versão</th><th>Status</th><th>Última comunicação</th><th>Ação</th></tr></thead><tbody>{installations.map((item) => <tr key={item.installationId}><td>{item.companyName}<small>{item.installationId}</small></td><td>{item.group}</td><td>{item.version}</td><td><Badge value={item.revokedAt ? "revoked" : item.status}/></td><td>{item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString("pt-BR") : "Nunca"}</td><td>{summary.latestVersion && <button onClick={() => authorize(summary.latestVersion, { installationId: item.installationId })}>Liberar</button>}</td></tr>)}</tbody></table></div></section>
    <section><h2>Auditoria recente</h2><div className="table"><table><thead><tr><th>Quando</th><th>Instalação</th><th>Evento</th><th>Versão</th><th>Detalhe</th></tr></thead><tbody>{events.slice(0, 50).map((item) => <tr key={item.id}><td>{new Date(item.receivedAt).toLocaleString("pt-BR")}</td><td>{item.installationId}</td><td><Badge value={item.type}/></td><td>{item.version || "—"}</td><td>{item.detail || "—"}</td></tr>)}</tbody></table></div></section>
  </main>;
}
function Card({ label, value }) { return <article><span>{label}</span><strong>{value}</strong></article>; }
function Badge({ value }) { return <span className={`badge ${value}`}>{value}</span>; }
createRoot(document.getElementById("root")).render(<App/>);
