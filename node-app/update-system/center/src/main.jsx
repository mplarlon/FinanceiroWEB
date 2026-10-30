import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const SECTIONS = [
  { id: "visao", label: "Visão geral", icon: "V" },
  { id: "maquinas", label: "Máquinas", icon: "M" },
  { id: "versoes", label: "Versões", icon: "R" },
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
  download_started: "Download iniciado",
  deferred_critical_operation: "Adiada",
  authorization_created: "Liberação",
  release_status_changed: "Status da versão",
  distribution_suspension: "Suspensão",
  installation_revoked: "Revogação",
  release_deleted: "Versão excluída",
  start_ini_queued: "start.ini",
  start_ini_applied: "start.ini",
  start_ini_failed: "start.ini",
  unknown: "Desconhecido",
  registered: "Registrada",
  registration_requested: "Pedido de registro",
  registration_accepted: "Registro aceito",
  waiting: "Aguardando",
};

const ONLINE_MS = 60 * 60 * 1000;
const MACHINE_FILTERS = [
  { id: "attention", label: "Precisa de atenção" },
  { id: "outdated", label: "Desatualizadas" },
  { id: "failed", label: "Com falha" },
  { id: "waiting", label: "Aguardando" },
  { id: "current", label: "Atualizadas" },
  { id: "all", label: "Todas" },
];

const api = async (path, token, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", authorization: `Bearer ${String(token || "").trim()}`, ...(options.headers || {}) },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(
      raw.trim().startsWith("<!")
        ? "A central devolveu a página em vez da API. Atualize com Ctrl+F5 e use a credencial administrativa."
        : `Resposta inválida da central (${response.status}).`,
    );
  }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
};

function when(value) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Nunca";
}

function machinesOf(installations) {
  return [...installations].sort((a, b) =>
    Number(Boolean(b.outdated)) - Number(Boolean(a.outdated))
    || Number(String(b.status || "") === "failed") - Number(String(a.status || "") === "failed")
    || String(a.companyName || "").localeCompare(String(b.companyName || ""), "pt-BR")
    || String(a.hostname || "").localeCompare(String(b.hostname || ""), "pt-BR"));
}

function machineCode(item) {
  return item?.hostname ? "" : String(item?.installationId || "").slice(0, 8);
}

function machineOnline(item) {
  if (!item || item.revokedAt || !item.startIni) return false;
  const seen = Date.parse(item.lastSeenAt || "");
  return Number.isFinite(seen) && Date.now() - seen < ONLINE_MS;
}

function ipsOf(item) {
  const local = [].concat(item?.addresses || []).filter(Boolean);
  if (local.length) return local.join(", ");
  return item?.remoteAddress || "";
}

function machineKind(item) {
  if (item.revokedAt) return "revoked";
  if (String(item.status || "") === "failed") return "failed";
  if (item.outdated) return "outdated";
  if (!item.hostname && !item.installPath) return "waiting";
  return "current";
}

function machineKindLabel(kind) {
  return STATUS_LABEL[kind] || kind;
}

function matchesFilter(item, filter) {
  const kind = machineKind(item);
  if (filter === "all") return true;
  if (filter === "attention") return kind === "outdated" || kind === "failed";
  return kind === filter;
}

function matchesSearch(item, query) {
  if (!query) return true;
  const hay = [item.companyName, item.hostname, item.version, ipsOf(item), item.installPath, item.group]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(query);
}

function auditGroups(events, installations) {
  const machines = machinesOf(installations);
  const known = new Map(machines.map((item) => [item.installationId, item]));
  const decorated = events.map((event) => {
    const machineId = event.machineId || (known.has(event.installationId) ? event.installationId : "");
    const machine = known.get(machineId);
    return {
      ...event,
      machineId,
      label: event.label || STATUS_LABEL[event.type] || "Acontecimento",
      resumo: event.resumo || event.detail || "—",
      companyName: event.companyName || machine?.companyName || (machineId ? "Sem empresa" : "Central"),
      hostname: event.hostname || machine?.hostname || "",
    };
  });
  const groups = machines.map((machine) => ({
    id: machine.installationId,
    companyName: machine.companyName || "Sem empresa",
    hostname: machine.hostname || "Aguardando",
    code: machineCode(machine),
    ip: ipsOf(machine),
    installPath: machine.installPath || "",
    events: decorated.filter((event) => event.machineId === machine.installationId),
  })).filter((group) => group.events.length);
  const placed = new Set(groups.flatMap((group) => group.events.map((event) => event.id)));
  const rest = decorated.filter((event) => !placed.has(event.id));
  if (rest.length) groups.push({ id: "central", companyName: "Central", hostname: "Ações da central", code: "", events: rest });
  return groups;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("update-admin-token") || "");
  const [summary, setSummary] = useState(null);
  const [installations, setInstallations] = useState([]);
  const [releases, setReleases] = useState([]);
  const [events, setEvents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState("visao");
  const [machineFilter, setMachineFilter] = useState("attention");
  const [machineQuery, setMachineQuery] = useState("");
  const [startIniMachine, setStartIniMachine] = useState(null);

  const load = async () => {
    if (!token) return;
    try {
      const [a, b, c, d] = await Promise.all([
        api("/api/admin/summary", token),
        api("/api/admin/installations", token),
        api("/api/admin/releases", token),
        api("/api/admin/events", token),
      ]);
      let requests = [];
      try {
        const pending = await api("/api/admin/registration-requests", token);
        requests = pending.requests || [];
      } catch {
        requests = [];
      }
      setSummary(a);
      setInstallations(b.installations);
      setReleases(c.releases);
      setEvents(d.events);
      setRequests(requests);
      setError("");
      sessionStorage.setItem("update-admin-token", token);
    } catch (e) {
      sessionStorage.removeItem("update-admin-token");
      setSummary(null);
      setToken("");
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [token]);

  const authorize = async (version, input = {}) => {
    await api("/api/admin/authorizations", token, { method: "POST", body: JSON.stringify({ version, ...input }) });
    await load();
  };
  const acceptRegistration = async (id) => {
    await api(`/api/admin/registration-requests/${encodeURIComponent(id)}/accept`, token, { method: "POST", body: "{}" });
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

  const sortedMachines = useMemo(() => machinesOf(installations), [installations]);
  const attentionMachines = useMemo(
    () => sortedMachines.filter((item) => matchesFilter(item, "attention")),
    [sortedMachines],
  );
  const filteredMachines = useMemo(() => {
    const query = machineQuery.trim().toLowerCase();
    return sortedMachines.filter((item) => matchesFilter(item, machineFilter) && matchesSearch(item, query));
  }, [sortedMachines, machineFilter, machineQuery]);
  const filterCounts = useMemo(() => {
    const counts = { all: sortedMachines.length, attention: 0, outdated: 0, failed: 0, waiting: 0, current: 0 };
    for (const item of sortedMachines) {
      const kind = machineKind(item);
      if (kind === "outdated" || kind === "failed") counts.attention += 1;
      if (counts[kind] != null) counts[kind] += 1;
    }
    return counts;
  }, [sortedMachines]);

  if (!summary) {
    return (
      <main className="login">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-dot">P</span>
          <span>PONTUAL<small>TECNOLOGIA</small></span>
        </div>
        <form className="card" onSubmit={(event) => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get("token") || "").trim();
          setError("");
          if (!value) {
            setError("Informe a credencial administrativa.");
            return;
          }
          sessionStorage.removeItem("update-admin-token");
          setToken(value);
        }}>
          <h1>Central de Atualizações</h1>
          <p>Informe a credencial administrativa da central.</p>
          <input name="token" type="password" placeholder="Credencial" autoFocus required />
          <button>Entrar</button>
          {error && <div className="error">{error}</div>}
        </form>
      </main>
    );
  }

  const openMachines = (filter = "attention") => {
    setMachineFilter(filter);
    setActive("maquinas");
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
            <button
              key={item.id}
              type="button"
              className={active === item.id ? "active" : ""}
              onClick={() => {
                if (item.id === "maquinas") setMachineFilter("all");
                setActive(item.id);
              }}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === "maquinas" && filterCounts.attention > 0 && (
                <span className="nav-count">{filterCounts.attention}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <header>
          <div>
            <span className="page-eyebrow">PONTUAL TECNOLOGIA</span>
            <h1>{SECTIONS.find((item) => item.id === active)?.label || "Central de Atualizações"}</h1>
            <p className="page-lead">{pageLead(active, summary, filterCounts)}</p>
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
        {(active === "visao" || active === "maquinas") && requests.length > 0 && (
          <RegistrationRequests requests={requests} onAccept={acceptRegistration} />
        )}

        {active === "visao" && (
          <Overview
            summary={summary}
            attentionMachines={attentionMachines}
            filterCounts={filterCounts}
            onOpenMachines={openMachines}
            onAuthorize={(item) => authorize(summary.latestVersion, { installationId: item.installationId })}
          />
        )}
        {active === "maquinas" && (
          <MachinesPanel
            machines={filteredMachines}
            filter={machineFilter}
            counts={filterCounts}
            query={machineQuery}
            latestVersion={summary.latestVersion}
            onFilter={setMachineFilter}
            onQuery={setMachineQuery}
            onAuthorize={(item) => authorize(summary.latestVersion, { installationId: item.installationId })}
            onEditStartIni={setStartIniMachine}
          />
        )}
        {active === "versoes" && (
          <ReleasesPanel
            releases={releases}
            onAuthorize={authorize}
            onStatus={status}
          />
        )}
        {active === "auditoria" && (
          <AuditPanel events={events} installations={installations} />
        )}
      </main>
      {startIniMachine && (
        <StartIniDialog
          machine={startIniMachine}
          token={token}
          onClose={() => setStartIniMachine(null)}
          onSaved={async () => { setStartIniMachine(null); await load(); }}
        />
      )}
    </div>
  );
}

function RegistrationRequests({ requests, onAccept }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Pedidos de registro</h2>
          <p>Máquinas que clicaram em Atualizar e ainda não estão registradas.</p>
        </div>
      </div>
      <div className="machine-list">
        {requests.map((item) => (
          <article key={item.installationId} className="machine-row kind-waiting">
            <div className="machine-main">
              <strong>{item.companyName || "Sem empresa"}</strong>
              <span className="machine-host">{item.hostname || "Sem nome de máquina"}</span>
              <small className="machine-detail">{[ipsOf(item), item.installPath, item.remoteAddress].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="machine-meta">
              <div className="meta-block">
                <span>Versão</span>
                <strong>{item.version || "—"}</strong>
              </div>
              <div className="meta-block">
                <span>Pedido</span>
                <strong className="when">{when(item.updatedAt || item.requestedAt)}</strong>
              </div>
            </div>
            <div className="machine-actions">
              <button type="button" className="primary" onClick={() => onAccept(item.installationId)}>Registrar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function pageLead(active, summary, counts) {
  if (active === "visao") {
    if (counts.attention) return `${counts.attention} máquina(s) pedem ação agora. Versão atual: ${summary.latestVersion || "—"}.`;
    return `Nenhuma máquina exige ação. Versão atual: ${summary.latestVersion || "—"}.`;
  }
  if (active === "maquinas") return "Veja quem está desatualizado, com falha ou só aguardando o primeiro contato.";
  if (active === "versoes") return "Publique, libere para pilotos ou bloqueie uma versão.";
  return "Histórico recente por máquina e ações feitas na central.";
}

function Overview({ summary, attentionMachines, filterCounts, onOpenMachines, onAuthorize }) {
  return (
    <div className="page-stack">
      <section className="metrics metrics-compact">
        <Card label="Precisa de atenção" value={filterCounts.attention} tone={filterCounts.attention ? "warn" : ""} onClick={() => onOpenMachines("attention")} />
        <Card label="Desatualizadas" value={filterCounts.outdated} tone={filterCounts.outdated ? "warn" : ""} onClick={() => onOpenMachines("outdated")} />
        <Card label="Com falha" value={filterCounts.failed} tone={filterCounts.failed ? "danger" : ""} onClick={() => onOpenMachines("failed")} />
        <Card label="Atualizadas" value={filterCounts.current} onClick={() => onOpenMachines("current")} />
        <Card label="Instalações" value={summary.totals.installations} onClick={() => onOpenMachines("all")} />
        <Card label="Versão atual" value={summary.latestVersion || "—"} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>O que precisa de ação</h2>
            <p>Máquinas desatualizadas ou com falha. O restante fica em Máquinas.</p>
          </div>
          <button type="button" className="ghost" onClick={() => onOpenMachines("attention")}>Ver todas as máquinas</button>
        </div>
        {attentionMachines.length === 0 ? (
          <p className="empty-note">Nada pendente. Todas as máquinas conhecidas estão atualizadas.</p>
        ) : (
          <div className="machine-list">
            {attentionMachines.slice(0, 8).map((item) => (
              <MachineRow
                key={item.installationId}
                item={item}
                latestVersion={summary.latestVersion}
                onAuthorize={onAuthorize}
                compact
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MachinesPanel({ machines, filter, counts, query, latestVersion, onFilter, onQuery, onAuthorize, onEditStartIni }) {
  return (
    <div className="page-stack">
      <section className="panel filters-panel">
        <div className="filter-row">
          {MACHINE_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-chip ${filter === item.id ? "active" : ""}`}
              onClick={() => onFilter(item.id)}
            >
              {item.label}
              <span>{counts[item.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <span>Buscar</span>
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Empresa, máquina, IP ou pasta"
          />
        </label>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{MACHINE_FILTERS.find((item) => item.id === filter)?.label || "Máquinas"}</h2>
            <p>{machines.length} resultado(s)</p>
          </div>
        </div>
        {machines.length === 0 ? (
          <p className="empty-note">Nenhuma máquina neste filtro.</p>
        ) : (
          <div className="machine-list">
            {machines.map((item) => (
              <MachineRow
                key={item.installationId}
                item={item}
                latestVersion={latestVersion}
                onAuthorize={onAuthorize}
                onEditStartIni={onEditStartIni}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MachineRow({ item, latestVersion, onAuthorize, onEditStartIni, compact = false }) {
  const kind = machineKind(item);
  const detail = [
    ipsOf(item) || null,
    item.installPath || null,
    item.group || null,
    machineCode(item) || null,
  ].filter(Boolean).join(" · ");
  return (
    <article className={`machine-row kind-${kind}`}>
      <div className="machine-main">
        <strong>{item.companyName || "Sem empresa"}</strong>
        <span className="machine-host">{item.hostname || "Aguardando primeiro contato"}</span>
        {!compact && detail && <small className="machine-detail">{detail}</small>}
      </div>
      <div className="machine-meta">
        <div className="meta-block">
          <span>Versão</span>
          <strong>{item.version || "—"}</strong>
          {kind === "outdated" && latestVersion && <small>atual {latestVersion}</small>}
        </div>
        <div className="meta-block">
          <span>Situação</span>
          <Badge value={kind} label={machineKindLabel(kind)} />
          {item.startIniPending && <small className="pending-note">start.ini pendente</small>}
        </div>
        <div className="meta-block">
          <span>Última comunicação</span>
          <strong className="when">{when(item.lastSeenAt)}</strong>
        </div>
      </div>
      <div className="machine-actions">
        {latestVersion && kind === "outdated" && (
          <button type="button" className="primary" onClick={() => onAuthorize(item)}>Liberar atualização</button>
        )}
        {!compact && machineOnline(item) && onEditStartIni && (
          <button type="button" onClick={() => onEditStartIni(item)}>Editar start.ini</button>
        )}
      </div>
    </article>
  );
}

function ReleasesPanel({ releases, onAuthorize, onStatus }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Versões publicadas</h2>
          <p>Libere aos poucos ou bloqueie se algo der errado.</p>
        </div>
      </div>
      {releases.length === 0 ? (
        <p className="empty-note">Nenhuma versão publicada.</p>
      ) : (
        <div className="release-list">
          {releases.map((release) => (
            <article key={release.manifest.version} className="release-row">
              <div className="release-main">
                <strong>{release.manifest.version}</strong>
                <span>Canal {release.manifest.channel}</span>
                <small>Publicada em {when(release.createdAt)}</small>
              </div>
              <Badge value={release.status} />
              <div className="machine-actions">
                <button type="button" className="primary" onClick={() => onAuthorize(release.manifest.version, { group: "pilot", percentage: 100 })}>Liberar pilotos</button>
                <button type="button" onClick={() => onAuthorize(release.manifest.version, { percentage: 5 })}>Lote 5%</button>
                <button type="button" className="danger" onClick={() => onStatus(release.manifest.version, "blocked")}>Bloquear</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AuditPanel({ events, installations }) {
  const groups = auditGroups(events, installations);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Auditoria recente</h2>
          <p>Eventos agrupados por máquina.</p>
        </div>
      </div>
      {events.length === 0 && <p className="empty-note">Nenhum acontecimento recente.</p>}
      {groups.map((group) => (
        <div key={group.id} className="audit-machine">
          <h3>{group.companyName}<small>{[group.hostname, group.code, group.ip, group.installPath].filter(Boolean).join(" · ")}</small></h3>
          <div className="table-scroll">
            <table className="tabela">
              <thead>
                <tr><th>Quando</th><th>Acontecimento</th><th>Versão</th><th>Detalhe</th></tr>
              </thead>
              <tbody>
                {group.events.map((item) => (
                  <tr key={item.id}>
                    <td className="quando">{when(item.receivedAt)}</td>
                    <td><Badge value={item.type} label={item.label} /></td>
                    <td className="versao">{item.version || "—"}</td>
                    <td className="resumo">{item.resumo || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

function StartIniDialog({ machine, token, onClose, onSaved }) {
  const current = machine.startIni || {};
  const [form, setForm] = useState({
    name: current.name || "",
    host: current.host || "",
    port: String(current.port || 3050),
    database: current.database || "",
    user: current.user || "",
    password: "",
    charset: current.charset || "WIN1252",
    role: current.role || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setField = (name, value) => setForm((item) => ({ ...item, [name]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { ...form };
      if (!body.password) delete body.password;
      await api(`/api/admin/installations/${machine.installationId}/start-ini`, token, { method: "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  };
  return (
    <div className="start-ini-dialog" role="presentation" onClick={onClose}>
      <form onClick={(event) => event.stopPropagation()} onSubmit={save}>
        <h2>start.ini</h2>
        <p>{machine.companyName || "Sem empresa"} · {machine.hostname || "Máquina"}</p>
        <p>A alteração entra na próxima comunicação. A senha do banco só muda se for preenchida.</p>
        <label>Nome<input value={form.name} onChange={(event) => setField("name", event.target.value)} /></label>
        <label>Servidor<input value={form.host} onChange={(event) => setField("host", event.target.value)} required /></label>
        <label>Porta<input value={form.port} onChange={(event) => setField("port", event.target.value)} inputMode="numeric" required /></label>
        <label>Caminho do banco<input value={form.database} onChange={(event) => setField("database", event.target.value)} required /></label>
        <label>Usuário<input value={form.user} onChange={(event) => setField("user", event.target.value)} autoComplete="off" required /></label>
        <label>Senha do banco<input type="password" value={form.password} onChange={(event) => setField("password", event.target.value)} autoComplete="new-password" placeholder={current.hasPassword ? "Manter a senha atual" : "Senha"} /></label>
        <label>Charset<input value={form.charset} onChange={(event) => setField("charset", event.target.value)} /></label>
        <label>Role<input value={form.role} onChange={(event) => setField("role", event.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <div className="start-ini-actions">
          <button type="submit" className="primary" disabled={busy}>Enviar</button>
          <button type="button" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

function Card({ label, value, tone = "", onClick }) {
  const Tag = onClick ? "button" : "article";
  return (
    <Tag type={onClick ? "button" : undefined} className={`metric ${tone} ${onClick ? "metric-click" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </Tag>
  );
}

function Badge({ value, label }) {
  return <span className={`badge ${value}`}>{label || STATUS_LABEL[value] || value}</span>;
}

createRoot(document.getElementById("root")).render(<App />);
