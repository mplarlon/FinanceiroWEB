import React, { useEffect, useState } from "react";
import { api } from "./lib/api.js";
import Overview from "./pages/Overview.jsx";
import FechamentoCarteira from "./pages/FechamentoCarteira.jsx";
import FiscalNfe from "./pages/FiscalNfe.jsx";
import BusinessDashboard from "./pages/BusinessDashboard.jsx";
import FinanceAccounts from "./pages/FinanceAccounts.jsx";
import Charlie from "./pages/Charlie.jsx";
import Reconciliation from "./pages/Reconciliation.jsx";
import OpenFinance from "./pages/OpenFinance.jsx";
import ManagementDashboard from "./pages/ManagementDashboard.jsx";
import ExecutiveReports from "./pages/ExecutiveReports.jsx";
import GlobalTableSorting from "./components/GlobalTableSorting.jsx";
import CharlieTraining from "./components/CharlieTraining.jsx";
import TrayIntegration from "./pages/TrayIntegration.jsx";
import UpdateAvailable from "./components/UpdateAvailable.jsx";
import StartIniSetup from "./components/StartIniSetup.jsx";

const PAGES = [
  { id: "overview", label: "Visão geral", icon: "◫" },
  { id: "charlie", label: "Charlie", icon: "✦" },
  { id: "financeiro", label: "Contas pagar/receber", icon: "$" },
  { id: "caixa", label: "Controle de caixa", icon: "▤" },
  { id: "conciliacao", label: "Conciliação", icon: "⇄" },
  { id: "open-finance", label: "Open Finance", icon: "⬡" },
  { id: "dre", label: "DRE completo", icon: "▥" },
  { id: "fechamento", label: "Fechamento carteira", icon: "✓" },
  { id: "fiscal", label: "Fiscal", icon: "≡" },
  { id: "tray", label: "Ecommerce", icon: "↗" },
  { id: "compras", label: "Compras", icon: "▣", group: "reports" },
  { id: "clientes", label: "Clientes", icon: "◎", group: "reports" },
  { id: "estoque", label: "Estoque", icon: "▦", group: "reports" },
  { id: "painel-executivo", label: "Painel executivo", icon: "◆", group: "reports", executive: "executive" },
  { id: "lojas", label: "Comparativo de lojas", icon: "▤", group: "reports", executive: "stores" },
  { id: "metas", label: "Metas e realizado", icon: "◎", group: "reports", executive: "goals" },
  { id: "margens", label: "Margem e rentabilidade", icon: "%", group: "reports", executive: "margins" },
  { id: "estoque-gerencial", label: "Estoque gerencial", icon: "▦", group: "reports", executive: "inventory" },
  { id: "fluxo-projetado", label: "Fluxo projetado", icon: "↗", group: "reports", executive: "cashflow" },
  { id: "vendedores", label: "Vendedores", icon: "♙", group: "reports", executive: "sellers" },
  { id: "retencao", label: "Clientes e retenção", icon: "◉", group: "reports", executive: "retention" },
  { id: "fornecedores", label: "Fornecedores", icon: "▣", group: "reports", executive: "suppliers" },
  { id: "alertas", label: "Central de alertas", icon: "!", group: "reports", executive: "alerts" },
  { id: "resumo-diario", label: "Resumo diário", icon: "☷", group: "reports", executive: "daily" },
];

const MAIN_PAGES = PAGES.filter((item) => !item.group);

function briefWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function briefTone(alerts) {
  if ((alerts || []).some((item) => item.gravidade === "critico")) return "critico";
  if ((alerts || []).some((item) => item.gravidade === "atencao")) return "atencao";
  return "informativo";
}

function CharlieBriefBar({ brief, onOpen, onLater }) {
  const groups = (brief.grupos || []).filter((group) => group.alertas?.length);
  const total = Number(brief.total || groups.reduce((sum, group) => sum + group.alertas.length, 0));
  const when = briefWhen(brief.analiseEm);
  return (
    <section className="charlie-brief" aria-label="Resumo do Charlie">
      <div className="charlie-brief-head">
        <strong>{total === 1 ? "1 situação em aberto" : `${total} situações em aberto`}</strong>
        {when ? <span>Análise de {when}</span> : null}
      </div>
      {groups.length > 0 && (
        <ul className="charlie-brief-counts">
          {groups.map((group) => (
            <li key={group.categoria} className={briefTone(group.alertas)}>
              <b>{group.alertas.length}</b>
              <span>{group.rotulo}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="charlie-brief-actions">
        <button className="primary" type="button" onClick={onOpen}>Ver com o Charlie</button>
        <button type="button" onClick={onLater}>Agora não</button>
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState();
  const [status, setStatus] = useState();
  const [error, setError] = useState("");
  const cafeToken = new URLSearchParams(window.location.search).get("cafe") || "";
  const [page, setPage] = useState(() => cafeToken ? "charlie" : "overview");
  const [charlieAlerts, setCharlieAlerts] = useState(0);
  const [charlieBrief, setCharlieBrief] = useState(null);
  const [alertLaunch, setAlertLaunch] = useState(0);
  const [ecommerceUnlocked, setEcommerceUnlocked] = useState(false);
  const [editingIni, setEditingIni] = useState(false);
  const [companyName, setCompanyName] = useState("Dashboard Gerencial");

  useEffect(() => {
    const unauthorized = (event) => {
      setSession({ ok: true, authenticated: false });
      setError(event.detail || "Sua sessão expirou. Entre novamente.");
    };
    window.addEventListener("dashboard:unauthorized", unauthorized);
    api
      .get("/auth/session")
      .then(setSession)
      .catch((e) => setError(e.message));
    api
      .get("/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
    api
      .get("/branding")
      .then((data) => {
        const nome = String(data?.empresa_nome || "").trim();
        if (!nome) return;
        setCompanyName(nome);
        document.title = nome;
      })
      .catch(() => {});
    return () => window.removeEventListener("dashboard:unauthorized", unauthorized);
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return undefined;
    let active = true;
    const load = () => {
      api.get("/ia/alertas/contador").then((data) => { if (active) setCharlieAlerts(Number(data.total || 0)); }).catch(() => {});
      api.get("/ia/alertas/resumo").then((data) => {
        if (!active || !Number(data.total)) return;
        try {
          if (data.analiseEm && localStorage.getItem("charlie-resumo-visto") === data.analiseEm) return;
        } catch { /* sem armazenamento local, o resumo continua visível */ }
        setCharlieBrief(data);
      }).catch(() => {});
    };
    load();
    const timer = setInterval(load, 120000);
    return () => { active = false; clearInterval(timer); };
  }, [session?.authenticated]);

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setError("");
      setSession(
        await api.post("/auth/login", {
          login: form.get("login"),
          senha: form.get("senha"),
        }),
      );
    } catch (e) {
      setError(e.message);
    }
  }
  function rememberBrief() {
    if (!charlieBrief?.analiseEm) return;
    try { localStorage.setItem("charlie-resumo-visto", charlieBrief.analiseEm); } catch { /* ignora */ }
  }
  function openAlerts() {
    rememberBrief();
    setCharlieBrief(null);
    setPage("charlie");
    setAlertLaunch((value) => value + 1);
  }
  function goToPage(id) {
    if (id === "tray" && !ecommerceUnlocked) {
      const senha = window.prompt("Senha para abrir o Ecommerce");
      if (senha === null) return;
      if (senha.trim() !== "2907") {
        window.alert("Senha incorreta.");
        return;
      }
      setEcommerceUnlocked(true);
    }
    setPage(id);
  }
  function reloadStatus() {
    api.get("/status").then(setStatus).catch(() => {});
  }
  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    setSession({ ok: true, authenticated: false });
  }

  if (!session?.authenticated)
    return (
      <>
      <UpdateAvailable />
      <main className="login">
        <div className="login-brand">
          <span className="brand-dot" aria-hidden="true">P</span>
          <span className="login-brand-copy">
            <span aria-hidden="true">PONTUAL<small>TECNOLOGIA</small></span>
            <span className="login-version">Versão {__APP_VERSION__}</span>
          </span>
        </div>
        <div className={`card${editingIni ? " card-setup" : ""}`}>
          {!editingIni && (
            <form className="login-form" onSubmit={login}>
              <h1>{companyName}</h1>
              <p>Acesse com seu usuário do sistema.</p>
              <input name="login" placeholder="Usuário" autoFocus required />
              <input name="senha" type="password" placeholder="Senha" required />
              <button>Entrar</button>
              {status?.ok && (
                <div className="database-state database-online">
                  Banco conectado: {status.nome_banco || status.banco}
                </div>
              )}
              {status && !status.ok && (
                <div className="database-state database-offline">
                  <strong>Banco de dados indisponível</strong>
                  <span>
                    {status.servidor}:{status.porta} — {status.banco}
                  </span>
                  <small>{status.erro}</small>
                </div>
              )}
              {error && <div className="error">{error}</div>}
            </form>
          )}
          <StartIniSetup onEditing={setEditingIni} onSaved={reloadStatus} />
        </div>
      </main>
      </>
    );

  const current = PAGES.find((p) => p.id === page) || PAGES[0];
  return (
    <div className="layout">
      <GlobalTableSorting />
      <UpdateAvailable />
      <aside>
        <div className="brand">
          <span className="brand-dot">P</span>
          <span className="brand-copy">
            <span className="brand-name">PONTUAL<small>TECNOLOGIA</small></span>
            <small className="brand-version">Versão {__APP_VERSION__}</small>
          </span>
        </div>
        <div className="nav-caption">AUTOMEC</div>
        <nav>
          {MAIN_PAGES.map((p) => (
            <button
              key={p.id}
              data-charlie-control={`nav-${p.id}`}
              className={p.id === page ? "active" : ""}
              onClick={() => goToPage(p.id)}
            >
              <span className="nav-icon" aria-hidden="true">{p.icon}</span>
              {p.label}
              {p.id === "charlie" && charlieAlerts > 0 ? <span className="nav-badge">{charlieAlerts}</span> : null}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <header>
          <div>
            <span className="page-eyebrow">PAINEL GERENCIAL</span>
            <h1 data-charlie-control="page-title">{current.label}</h1>
          </div>
          <div className="header-actions">
            <button type="button" className="header-alerts" onClick={openAlerts}>
              Alertas
              {charlieAlerts > 0 ? <span className="nav-badge">{charlieAlerts}</span> : null}
            </button>
            <span className={`connection-pill ${status?.ok ? "online" : "offline"}`}>
              <i /> {status?.ok ? "Banco conectado" : "Banco indisponível"}
            </span>
            <span className="user-name">{session.user?.nome}</span>
            <button className="link-btn" onClick={logout}>
              Sair
            </button>
          </div>
        </header>
        {charlieBrief && (
          <CharlieBriefBar
            brief={charlieBrief}
            onOpen={openAlerts}
            onLater={() => { rememberBrief(); setCharlieBrief(null); }}
          />
        )}
        {page === "overview" && <Overview status={status} onNavigate={goToPage} />}
        {page === "charlie" && <Charlie alertLaunch={alertLaunch} dailyToken={cafeToken} />}
        {page === "financeiro" && <FinanceAccounts />}
        {page === "caixa" && <ManagementDashboard type="cash" />}
        {page === "conciliacao" && <Reconciliation />}
        {page === "open-finance" && <OpenFinance />}
        {page === "dre" && <ManagementDashboard type="dre" />}
        {page === "fechamento" && <FechamentoCarteira />}
        {page === "estoque" && <ManagementDashboard type="stock" />}
        {page === "compras" && <BusinessDashboard type="purchases" />}
        {page === "clientes" && <ManagementDashboard type="customers" />}
        {page === "fiscal" && <FiscalNfe />}
        {page === "tray" && <TrayIntegration />}
        {current.executive && <ExecutiveReports type={current.executive} />}
        <CharlieTraining page={page} pageLabel={current.label} onNavigate={goToPage} />
      </main>
    </div>
  );
}
