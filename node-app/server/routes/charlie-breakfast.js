import express from "express";
import { applyView, assertBreakfastAccess, dispatchAllowed, prepareCampaign } from "../lib/charlie-breakfast-engine.js";
import { buildBreakfastReport, clearBreakfastCache, listSellers, runBreakfast } from "../lib/charlie-breakfast-service.js";
import { readAlerts, readLink, readRuns, readSettings, saveExpenseClass, saveSettings, updateAlert } from "../lib/charlie-breakfast-store.js";
import { deliverCampaign, renderPdf } from "../lib/charlie-breakfast-delivery.js";
import { withReadOnlyDatabase } from "../db.js";

const router = express.Router();

function manager(req, companyId) {
  const settings = readSettings();
  assertBreakfastAccess(req.dashboardSession?.user, companyId, settings);
  return settings;
}

function referenceOf(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function filtersOf(source = {}) {
  const categoria = String(source.categoria || "");
  const severidade = String(source.severidade || "");
  return {
    vendedor: Number(source.vendedor || 0) || null,
    categoria: ["comercial", "estoque", "financeiro", "crm"].includes(categoria) ? categoria : "",
    severidade: ["alta", "media", "baixa", "info"].includes(severidade) ? severidade : "",
    filial: Number(source.filial || 0) || null,
  };
}

function scope(req) {
  const source = req.method === "GET" ? req.query : { ...req.query, ...req.body };
  return {
    companyId: Number(source.empresa || 0) || null,
    depositId: Number(source.filial || 0) || null,
    reference: referenceOf(source.ate),
    view: filtersOf(source),
  };
}

router.get("/painel", async (req, res) => {
  try {
    const { companyId, depositId, reference, view } = scope(req);
    const settings = manager(req, companyId);
    let relatorio = null;
    let vendedores = [];
    let aviso = null;
    try {
      const loaded = await withReadOnlyDatabase(async (db) => ({
        relatorio: await buildBreakfastReport(db, { companyId, depositId, reference, settings }),
        vendedores: await listSellers(db),
      }));
      relatorio = applyView(loaded.relatorio, view);
      vendedores = loaded.vendedores;
    } catch (error) {
      aviso = error.message || "Não foi possível montar o relatório.";
    }
    const alertas = readAlerts().filter((item) => !companyId || Number(item.empresa) === companyId || item.empresa == null)
      .filter((item) => !view.categoria || item.categoria === view.categoria)
      .filter((item) => !view.severidade || item.severidade === view.severidade)
      .filter((item) => !view.filial || !item.filial || Number(item.filial) === view.filial);
    res.json({ ok: true, relatorio, configuracao: settings, historico: readRuns().slice(0, 30), alertas, vendedores, aviso });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/gerar", async (req, res) => {
  try {
    const { companyId, depositId, reference, view } = scope(req);
    const settings = manager(req, companyId);
    clearBreakfastCache();
    const result = await runBreakfast({ companyId, depositId, reference, send: false, reason: "manual", user: req.dashboardSession.user, settings });
    res.json({ ok: true, relatorio: applyView(result.report, view), entrega: result.entrega });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/enviar", async (req, res) => {
  try {
    const { companyId, depositId, reference, view } = scope(req);
    const settings = manager(req, companyId);
    clearBreakfastCache();
    const result = await runBreakfast({ companyId, depositId, reference, send: true, reason: "manual", user: req.dashboardSession.user, settings });
    res.json({ ok: true, relatorio: applyView(result.report, view), entrega: result.entrega });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.get("/config", (req, res) => {
  try {
    res.json({ ok: true, configuracao: manager(req) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.put("/config", (req, res) => {
  try {
    manager(req);
    clearBreakfastCache();
    res.json({ ok: true, configuracao: saveSettings(req.body || {}) });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, erro: error.message });
  }
});

router.get("/historico", (req, res) => {
  try {
    manager(req);
    res.json({ ok: true, historico: readRuns() });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.get("/alertas", (req, res) => {
  try {
    manager(req);
    res.json({ ok: true, alertas: readAlerts() });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.patch("/alertas/:id", (req, res) => {
  try {
    const settings = manager(req);
    const current = readAlerts().find((item) => item.id === req.params.id);
    if (current?.empresa && settings.empresas?.length && !settings.empresas.map(Number).includes(Number(current.empresa))) {
      return res.status(403).json({ ok: false, erro: "Alerta fora do recorte autorizado." });
    }
    res.json({ ok: true, alerta: updateAlert(req.params.id, req.body || {}, req.dashboardSession.user) });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, erro: error.message });
  }
});

router.get("/acesso/:token", (req, res) => {
  try {
    manager(req);
    const link = readLink(req.params.token);
    if (!link || link.expirado) return res.status(410).json({ ok: false, erro: "Link expirado ou inválido." });
    const relatorio = readRuns().find((item) => item.id === link.reportId);
    if (!relatorio) return res.status(404).json({ ok: false, erro: "Relatório não encontrado." });
    res.json({ ok: true, relatorio, expiraEm: link.expiraEm });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/campanha/preparar", (req, res) => {
  try {
    const settings = manager(req);
    const campanha = prepareCampaign(req.body?.clientes || [], req.body?.promocao || {});
    res.json({ ok: true, campanha, disparo: dispatchAllowed(campanha, settings) });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, erro: error.message });
  }
});

router.post("/campanha/disparar", async (req, res) => {
  try {
    const settings = manager(req);
    const campanha = prepareCampaign(req.body?.clientes || [], req.body?.promocao || {});
    const entrega = await deliverCampaign(campanha, settings);
    res.json({ ok: true, campanha, entrega });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, erro: error.message });
  }
});

router.patch("/despesas", (req, res) => {
  try {
    clearBreakfastCache();
    res.json({ ok: true, classificacao: saveExpenseClass(req.body?.historico, req.body?.classe, manager(req) && req.dashboardSession.user) });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, erro: error.message });
  }
});

router.get("/pdf", async (req, res) => {
  try {
    const { companyId, depositId, reference } = scope(req);
    const settings = manager(req, companyId);
    const relatorio = await withReadOnlyDatabase((db) => buildBreakfastReport(db, { companyId, depositId, reference, settings }));
    const pdf = await renderPdf(relatorio);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="cafe-manha-${relatorio.referencia}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

export default router;
