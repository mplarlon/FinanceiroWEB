import React, { useEffect, useState } from "react";
import { api } from "./lib/api.js";
import Overview from "./pages/Overview.jsx";
import FechamentoCarteira from "./pages/FechamentoCarteira.jsx";
import FiscalNfe from "./pages/FiscalNfe.jsx";
import BusinessDashboard from "./pages/BusinessDashboard.jsx";
import FinanceAccounts from "./pages/FinanceAccounts.jsx";
import Charlie from "./pages/Charlie.jsx";
import Reconciliation from "./pages/Reconciliation.jsx";
import ManagementDashboard from "./pages/ManagementDashboard.jsx";
import ExecutiveReports from "./pages/ExecutiveReports.jsx";
import GlobalTableSorting from "./components/GlobalTableSorting.jsx";

const PAGES = [
  { id: "overview", label: "Visão geral", icon: "◫" },
  { id: "charlie", label: "Charlie", icon: "✦" },
  { id: "financeiro", label: "Contas pagar/receber", icon: "$" },
  { id: "caixa", label: "Controle de caixa", icon: "▤" },
  { id: "conciliacao", label: "Conciliação", icon: "⇄" },
  { id: "dre", label: "DRE completo", icon: "▥" },
  { id: "fechamento", label: "Fechamento carteira", icon: "✓" },
  { id: "fiscal", label: "Fiscal", icon: "≡" },
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
const REPORT_PAGES = PAGES.filter((item) => item.group === "reports");

export default function App() {
  const [session, setSession] = useState();
  const [status, setStatus] = useState();
  const [error, setError] = useState("");
  const [page, setPage] = useState("overview");
  const [reportsOpen, setReportsOpen] = useState(false);

  useEffect(() => {
    const unauthorized = () => {
      setSession({ ok: true, authenticated: false });
      setError("Sua sessão expirou. Entre novamente.");
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
    return () => window.removeEventListener("dashboard:unauthorized", unauthorized);
  }, []);

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
      <main className="login">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-dot">P</span>
          <span>PONTUAL<small>TECNOLOGIA</small></span>
        </div>
        <form className="card" onSubmit={login}>
          <h1>Dashboard Gerencial</h1>
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
      </main>
    );

  const current = PAGES.find((p) => p.id === page) || PAGES[0];
  return (
    <div className="layout">
      <GlobalTableSorting />
      <aside>
        <div className="brand">
          <span className="brand-dot">P</span>
          <span className="brand-name">PONTUAL<small>TECNOLOGIA</small></span>
        </div>
        <div className="nav-caption">GESTÃO AUT⦁MEC</div>
        <nav>
          {MAIN_PAGES.map((p) => (
            <button
              key={p.id}
              className={p.id === page ? "active" : ""}
              onClick={() => setPage(p.id)}
            >
              <span className="nav-icon" aria-hidden="true">{p.icon}</span>
              {p.label}
            </button>
          ))}
          <div className={`nav-group ${reportsOpen ? "open" : ""}`}>
            <button
              type="button"
              className={REPORT_PAGES.some((item) => item.id === page) ? "group-active" : ""}
              aria-expanded={reportsOpen}
              aria-controls="reports-navigation"
              onClick={() => setReportsOpen((open) => !open)}
            >
              <span className="nav-icon" aria-hidden="true">▧</span>
              <span>Relatórios</span>
              <span className="nav-chevron" aria-hidden="true">⌄</span>
            </button>
            {reportsOpen && (
              <div className="nav-submenu" id="reports-navigation">
                {REPORT_PAGES.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={p.id === page ? "active" : ""}
                    onClick={() => setPage(p.id)}
                  >
                    <span className="nav-icon" aria-hidden="true">{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
      </aside>
      <main className="content">
        <header>
          <div>
            <span className="page-eyebrow">PAINEL GERENCIAL</span>
            <h1>{current.label}</h1>
          </div>
          <div className="header-actions">
            <span className={`connection-pill ${status?.ok ? "online" : "offline"}`}>
              <i /> {status?.ok ? "Banco conectado" : "Banco indisponível"}
            </span>
            <span className="user-name">{session.user?.nome}</span>
            <button className="link-btn" onClick={logout}>
              Sair
            </button>
          </div>
        </header>
        {page === "overview" && <Overview status={status} onNavigate={setPage} />}
        {page === "charlie" && <Charlie />}
        {page === "financeiro" && <FinanceAccounts />}
        {page === "caixa" && <ManagementDashboard type="cash" />}
        {page === "conciliacao" && <Reconciliation />}
        {page === "dre" && <ManagementDashboard type="dre" />}
        {page === "fechamento" && <FechamentoCarteira />}
        {page === "estoque" && <ManagementDashboard type="stock" />}
        {page === "compras" && <BusinessDashboard type="purchases" />}
        {page === "clientes" && <ManagementDashboard type="customers" />}
        {page === "fiscal" && <FiscalNfe />}
        {current.executive && <ExecutiveReports type={current.executive} />}
      </main>
    </div>
  );
}
