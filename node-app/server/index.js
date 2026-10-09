import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { authenticate, debugLogin } from "./auth.js";
import {
  clientDist,
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
import bankConfigRoutes from "./routes/bank-configs.js";
import whatsappRoutes from "./routes/whatsapp.js";
import boletoBradescoRoutes from "./routes/boleto-bradesco.js";
import boletoOtherBankRoutes from "./routes/boleto-other-banks.js";
import boletoCaixaRoutes from "./routes/boleto-caixa.js";
import reportsExtraRoutes from "./routes/reports-extra.js";
import purchaseReplenishmentRoutes from "./routes/purchase-replenishment.js";

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

const publicPaths = new Set([
  "/api/status",
  "/api/branding",
  "/api/auth/session",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/database/config",
  "/api/database/test",
  "/api/whatsapp/webhook",
  "/api/auth/debug-login",
]);
app.use("/api", (req, res, next) => {
  const apiPath = new URL(req.originalUrl, "http://localhost").pathname;
  if (publicPaths.has(apiPath)) return next();
  if (!req.dashboardSession)
    return res.status(401).json({
      ok: false,
      auth_required: true,
      erro: "Login necessario.",
    });
  req.dashboardSession.lastActionAt = Date.now();
  next();
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
app.get("/api/branding", (_req, res) =>
  res.json({ ok: true, empresa_nome: "Dashboard Gerencial" }),
);
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
      banco: config.database,
      tipo_banco: "firebird",
      nome_banco: config.name,
      servidor: config.host,
      porta: config.port,
      total_tabelas: Number(rows[0]?.TOTAL || 0),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.json({
      ok: false,
      erro: error.message,
      banco: config.database,
      servidor: config.host,
      porta: config.port,
      tipo_banco: "firebird",
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
app.use("/api/boletos", bankConfigRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/boletos/bradesco", boletoBradescoRoutes);
app.use("/api/boletos", boletoOtherBankRoutes);
app.use("/api/boletos/caixa", boletoCaixaRoutes);
app.use("/api", reportsExtraRoutes);
app.use("/api/dashboard-compras", purchaseReplenishmentRoutes);

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
if (fs.existsSync(clientDist)) app.use(express.static(clientDist));
app.get("*splat", (_req, res) =>
  res.sendFile(path.join(clientDist, "index.html")),
);
app.listen(port, "0.0.0.0", () =>
  console.log(`Dashboard Node iniciado em http://localhost:${port}`),
);

export default app;
