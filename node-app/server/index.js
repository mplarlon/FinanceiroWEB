import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { authenticate, debugLogin } from "./auth.js";
import {
  clientDist,
  dataDir,
  databaseSetupInput,
  loadDatabaseConfig,
  normalizeDatabaseConfig,
  port,
  publicDatabaseConfig,
  saveDatabaseConfig,
  schemaFile,
} from "./config.js";
import { query, withDatabase } from "./db.js";
import { sessionMiddleware } from "./session.js";
import salesRoutes from "./routes/sales.js";
import customerRoutes from "./routes/customers.js";
import financialDashboardRoutes from "./routes/financial-dashboard.js";
import legacySalesStockRoutes from "./routes/legacy-sales-stock.js";
import purchaseRoutes from "./routes/purchases.js";
import fiscalNfeRoutes from "./routes/fiscal-nfe.js";
import nfeReturnRoutes from "./routes/nfe-return.js";
import fechamentoCarteiraRoutes from "./routes/fechamento-carteira.js";
import systemRoutes from "./routes/system.js";
import fiscalReportRoutes from "./routes/fiscal-reports.js";
import taxSummaryRoutes from "./routes/tax-summary.js";
import shippingRoutes from "./routes/shipping.js";
import financeCoreRoutes from "./routes/finance-core.js";
import financeAccountRoutes from "./routes/finance-accounts.js";
import cashControlRoutes from "./routes/cash-control.js";
import pdvRoutes from "./routes/pdv.js";
import assistantRoutes from "./routes/assistant.js";
import fiscalAssessmentRoutes from "./routes/fiscal-assessment.js";
import fiscalValuesRoutes from "./routes/fiscal-values.js";
import adminRoutes from "./routes/admin.js";
import reconciliationBaseRoutes from "./routes/reconciliation-base.js";
import reconciliationOfxRoutes from "./routes/reconciliation-ofx.js";
import reconciliationActionRoutes from "./routes/reconciliation-actions.js";
import reconciliationCardRoutes from "./routes/reconciliation-card.js";
import reconciliationIntelligenceRoutes from "./routes/reconciliation-intelligence.js";
import bankConfigRoutes from "./routes/bank-configs.js";
import whatsappRoutes from "./routes/whatsapp.js";
import boletoBradescoRoutes from "./routes/boleto-bradesco.js";
import boletoOtherBankRoutes from "./routes/boleto-other-banks.js";
import boletoCaixaRoutes from "./routes/boleto-caixa.js";
import reportsExtraRoutes from "./routes/reports-extra.js";
import purchaseReplenishmentRoutes from "./routes/purchase-replenishment.js";
import managementReportRoutes from "./routes/management-reports.js";
import breakfastRoutes from "./routes/charlie-breakfast.js";
import charlieLeadsRoutes from "./routes/charlie-leads.js";
import charlieQuotesRoutes from "./routes/charlie-quotes.js";
import charlieRecoveryRoutes from "./routes/charlie-recovery.js";
import charlieRebuyRoutes from "./routes/charlie-rebuy.js";
import charlieStockRoutes from "./routes/charlie-stock.js";
import charlieCampaignRoutes from "./routes/charlie-campaigns.js";
import charlieAutopilotRoutes from "./routes/charlie-autopilot.js";
import charlieProductMatchRoutes from "./routes/charlie-product-match.js";
import charlieSignalRoutes from "./routes/charlie-signals.js";
import charliePurchasingRoutes from "./routes/charlie-purchasing.js";
import charlieCoachRoutes from "./routes/charlie-coach.js";
import charlieShoppingRoutes from "./routes/charlie-shopping.js";
import charlieSeoRoutes from "./routes/charlie-seo.js";
import charlieKitRoutes from "./routes/charlie-kits.js";
import charlieProfitRoutes from "./routes/charlie-profit.js";
import charlieCustomer360Routes from "./routes/charlie-customer360.js";
import charlieMissionRoutes from "./routes/charlie-mission.js";
import charlieAutomationCenterRoutes from "./routes/charlie-automation-center.js";
import charlieAlertRoutes from "./routes/charlie-alerts.js";
import charlieSalesAuditRoutes from "./routes/charlie-sales-audit.js";
import charlieSalesOpportunityRoutes from "./routes/charlie-sales-opportunities.js";
import openFinanceRoutes from "./routes/open-finance.js";
import trayRoutes, { startTrayScheduler } from "./routes/tray.js";
import { startManagementScheduler } from "./management-scheduler.js";
import { startCharlieMonitor } from "./charlie-monitor-scheduler.js";
import { startCharlieAutomations } from "./charlie-automation-scheduler.js";
import { startBreakfastScheduler } from "./charlie-breakfast-scheduler.js";
import { startCharlieLeads } from "./charlie-leads-scheduler.js";
import { startReconciliationIntelligence } from "./reconciliation-intelligence-scheduler.js";
import { startOpenFinance } from "./open-finance-scheduler.js";
import { ensureOllamaServer } from "./lib/ollama.js";
import { escolherNomeEmpresa, NOME_EMPRESA_PADRAO } from "./lib/empresa-nome.js";
import { adHocQueryEnabled, consumeStartIniAttempt, debugLoginEnabled, isPublicApiPath } from "./security-policy.js";
import { exigirPrazo } from "./lib/prazo-acesso.js";
import { beginCriticalOperation, tracksCriticalOperation } from "./lib/update-readiness.js";
import { manualCheckUrl, requestManualUpdate } from "./lib/manual-update.js";
import { activateBundledUpdater, syncUpdaterAgent } from "./lib/sync-updater-agent.js";
import { compareSemver } from "../update-system/shared.js";
import { markPendingUpdateSeen, readPendingUpdate } from "../update-system/pending-update.js";

const app = express();
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buffer) => {
      req.rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(cookieParser());
app.use(sessionMiddleware);

app.use("/api", (req, res, next) => {
  const apiPath = new URL(req.originalUrl, "http://localhost").pathname;
  if (isPublicApiPath(apiPath)) return next();
  if (!req.dashboardSession)
    return res.status(401).json({
      ok: false,
      auth_required: true,
      erro: "Login necessario.",
    });
  req.dashboardSession.lastActionAt = Date.now();
  next();
});
app.use("/api", async (req, res, next) => {
  const apiPath = new URL(req.originalUrl, "http://localhost").pathname;
  if (isPublicApiPath(apiPath)) return next();
  try {
    await exigirPrazo();
    next();
  } catch (error) {
    if (!error.expirado) return next(error);
    req.clearDashboardSession?.();
    res.status(401).json({ ok: false, auth_required: true, expirado: true, erro: error.message });
  }
});
app.use("/api", (req, res, next) => {
  const apiPath = new URL(req.originalUrl, "http://localhost").pathname;
  if (!tracksCriticalOperation(req.method, apiPath)) return next();
  const operation = beginCriticalOperation(`http:${req.method}`, { path: apiPath });
  let finished = false;
  const finish = () => { if (!finished) { finished = true; operation.finish(); } };
  res.once("finish", finish); res.once("close", finish);
  next();
});

app.get("/api/app-update", (_req, res) => {
  const current = readInstalledUiVersion(clientDist);
  const pending = readPendingUpdate(dataDir);
  const waiting = pending && pendingIsNewer(pending.version, current) ? markPendingUpdateSeen(dataDir) : null;
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, current, pending: waiting?.version || null });
});
app.post("/api/app-update/now", async (_req, res) => {
  const { status, ...body } = await requestManualUpdate(undefined, manualCheckUrl(), {
    awaken: () => activateBundledUpdater(import.meta.dirname),
  });
  res.status(status).json(body);
});
app.get("/api/auth/session", (req, res) =>
  res.json({
    ok: true,
    authenticated: Boolean(req.dashboardSession),
    user: req.dashboardSession?.user || null,
  }),
);
app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await authenticate(req.body.login, req.body.senha);
    req.createDashboardSession(user);
    res.json({ ok: true, authenticated: true, user });
  } catch (error) {
    res.status(401).json({ ok: false, erro: error.message });
  }
});
app.post("/api/auth/logout", (req, res) => {
  req.clearDashboardSession();
  res.json({ ok: true, authenticated: false });
});
app.post("/api/auth/debug-login", async (req, res) => {
  if (!debugLoginEnabled())
    return res.status(404).json({ ok: false, erro: "Diagnóstico de login desativado." });
  if (!req.dashboardSession?.user?.permissao_gerencial)
    return res.status(403).json({ ok: false, erro: "Sem permissão para diagnóstico." });
  try {
    res.json(
      await debugLogin(req.body?.login, req.body?.senha || req.body?.password),
    );
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ ok: false, erro: `Erro no debug de login: ${error.message}` });
  }
});
app.get("/api/branding", async (_req, res) => {
  try {
    const rows = await withDatabase((db) =>
      query(db, "SELECT IDEMPRESA, NOMEEMPRESA, PADRAO FROM CONFIGURACAO"),
    );
    res.json({ ok: true, empresa_nome: escolherNomeEmpresa(rows) });
  } catch {
    res.json({ ok: true, empresa_nome: NOME_EMPRESA_PADRAO });
  }
});
app.get("/api/status", async (_req, res) => {
  const config = loadDatabaseConfig();
  try {
    const rows = await withDatabase(
      (db) =>
        query(
          db,
          `
      SELECT COUNT(*) AS TOTAL FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
    `,
        ),
      config,
    );
    res.json({
      ok: true,
      tipo_banco: "firebird",
      banco_disponivel: Number(rows[0]?.TOTAL || 0) >= 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      tipo_banco: "firebird",
      erro: "Banco de dados indisponível.",
      timestamp: new Date().toISOString(),
    });
  }
});
app.get("/api/database/config", (_req, res) =>
  res.json({ ok: true, config: publicDatabaseConfig() }),
);
app.post("/api/database/config", (req, res) => {
  try {
    res.json({
      ok: true,
      config: publicDatabaseConfig(saveDatabaseConfig(req.body)),
    });
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message });
  }
});
app.post("/api/setup/start-ini", async (req, res) => {
  const access = consumeStartIniAttempt(req.body?.senha, req.ip || "local");
  if (!access.ok) return res.status(access.status).json({ ok: false, erro: access.erro });
  const acao = String(req.body?.acao || "abrir");
  try {
    if (acao === "abrir") return res.json({ ok: true, config: publicDatabaseConfig() });
    if (acao !== "salvar" && acao !== "testar") {
      return res.status(400).json({ ok: false, erro: "Ação inválida." });
    }
    const input = databaseSetupInput(req.body);
    if (acao === "salvar") {
      return res.json({ ok: true, config: publicDatabaseConfig(saveDatabaseConfig(input)) });
    }
    const config = normalizeDatabaseConfig(input);
    const rows = await withDatabase(
      (db) =>
        query(
          db,
          `
      SELECT COUNT(*) AS TOTAL FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
    `,
        ),
      config,
    );
    res.json({
      ok: true,
      mensagem: "Conexão Firebird realizada com sucesso.",
      total_tabelas: Number(rows[0]?.TOTAL || 0),
    });
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message });
  }
});
app.post("/api/database/test", async (req, res) => {
  try {
    const config = normalizeDatabaseConfig(req.body);
    const rows = await withDatabase(
      (db) =>
        query(
          db,
          `
      SELECT COUNT(*) AS TOTAL FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
    `,
        ),
      config,
    );
    res.json({
      ok: true,
      mensagem: "Conexao Firebird realizada com sucesso.",
      tipo_banco: "firebird",
      banco: config.database,
      total_tabelas: Number(rows[0]?.TOTAL || 0),
    });
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message });
  }
});
app.get("/api/schema", (_req, res) => {
  if (!fs.existsSync(schemaFile))
    return res
      .status(404)
      .json({ ok: false, erro: "schema.json nao encontrado" });
  res.type("json").send(fs.readFileSync(schemaFile, "utf8"));
});
app.post("/api/query", async (req, res) => {
  if (!adHocQueryEnabled())
    return res.status(404).json({ ok: false, erro: "Consulta avulsa desativada." });
  if (!req.dashboardSession?.user?.permissao_gerencial)
    return res.status(403).json({ ok: false, erro: "Sem permissão para consulta avulsa." });
  const sql = String(req.body.sql || "").trim();
  if (!/^select\b/i.test(sql))
    return res
      .status(403)
      .json({ ok: false, erro: "Apenas queries SELECT sao permitidas" });
  try {
    const dados = await withDatabase((db) =>
      query(db, sql, req.body.params || []),
    );
    res.json({ ok: true, dados, total: dados.length });
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message });
  }
});
app.use("/api/dashboard-vendas", salesRoutes);
app.use("/api/clientes", customerRoutes);
app.use("/api/dashboard-financeiro", financialDashboardRoutes);
app.use("/api", legacySalesStockRoutes);
app.use("/api/dashboard-compras", purchaseRoutes);
app.use("/api/fiscal/nfe", fiscalNfeRoutes);
app.use("/api/fiscal/nfe", nfeReturnRoutes);
app.use("/api/financeiro", fechamentoCarteiraRoutes);
app.use("/api", systemRoutes);
app.use("/api/fiscal", fiscalReportRoutes);
app.use("/api/fiscal-impostos", taxSummaryRoutes);
app.use("/api/expedicao", shippingRoutes);
app.use("/api/financeiro", financeCoreRoutes);
app.use("/api/financeiro", financeAccountRoutes);
app.use("/api/financeiro", cashControlRoutes);
app.use("/api/financeiro", pdvRoutes);
app.use("/api/ia", assistantRoutes);
app.use("/api/fiscal", fiscalAssessmentRoutes);
app.use("/api/fiscal", fiscalValuesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/conciliacao", reconciliationBaseRoutes);
app.use("/api/conciliacao", reconciliationOfxRoutes);
app.use("/api/conciliacao", reconciliationActionRoutes);
app.use("/api/conciliacao", reconciliationCardRoutes);
app.use("/api/conciliacao", reconciliationIntelligenceRoutes);
app.use("/api/open-finance", openFinanceRoutes);
app.use("/api/boletos", bankConfigRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/boletos/bradesco", boletoBradescoRoutes);
app.use("/api/boletos", boletoOtherBankRoutes);
app.use("/api/boletos/caixa", boletoCaixaRoutes);
app.use("/api", reportsExtraRoutes);
app.use("/api/dashboard-compras", purchaseReplenishmentRoutes);
app.use("/api/relatorios-gerenciais", managementReportRoutes);
app.use("/api/cafe-manha", breakfastRoutes);
app.use("/api", charlieLeadsRoutes);
app.use("/api", charlieQuotesRoutes);
app.use("/api", charlieRecoveryRoutes);
app.use("/api", charlieRebuyRoutes);
app.use("/api", charlieStockRoutes);
app.use("/api", charlieCampaignRoutes);
app.use("/api", charlieAutopilotRoutes);
app.use("/api", charlieProductMatchRoutes);
app.use("/api", charlieSignalRoutes);
app.use("/api", charliePurchasingRoutes);
app.use("/api", charlieCoachRoutes);
app.use("/api", charlieShoppingRoutes);
app.use("/api", charlieSeoRoutes);
app.use("/api", charlieKitRoutes);
app.use("/api", charlieProfitRoutes);
app.use("/api", charlieCustomer360Routes);
app.use("/api", charlieMissionRoutes);
app.use("/api", charlieAutomationCenterRoutes);
app.use("/api", charlieAlertRoutes);
app.use("/api", charlieSalesAuditRoutes);
app.use("/api", charlieSalesOpportunityRoutes);
app.use("/api/tray", trayRoutes);

app.get("/api/debug/rotas", (_req, res) => {
  const rotas = app.router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${layer.route.path}`,
      ),
    );
  res.json({ total: rotas.length, rotas: rotas.sort() });
});

app.get("/", (_req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.sendFile(path.join(clientDist, "index.html"));
});
if (fs.existsSync(clientDist)) app.use(express.static(clientDist, {
  immutable: true,
  maxAge: "1y",
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === "version.json") res.set("Cache-Control", "no-store");
  },
}));
app.get("*splat", (_req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.sendFile(path.join(clientDist, "index.html"));
});
app.listen(port, "0.0.0.0", () =>
  console.log(`Dashboard Node iniciado em http://localhost:${port}`),
);
startManagementScheduler();
startCharlieMonitor();
startCharlieAutomations();
startBreakfastScheduler();
startCharlieLeads();
startTrayScheduler();
startReconciliationIntelligence();
startOpenFinance();
syncUpdaterAgent();
ensureOllamaServer().catch((error) => console.error(`[ollama] ${error.message}`));

function pendingIsNewer(pending, current) {
  if (!current) return true;
  try { return compareSemver(pending, current) > 0; } catch { return true; }
}

function readInstalledUiVersion(directory) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(directory, "version.json"), "utf8"));
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export default app;
