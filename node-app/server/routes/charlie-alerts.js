import express from "express";
import { painelAlertas } from "../lib/charlie-alert-center-service.js";

const router = express.Router();

router.get("/charlie-alerts", (_req, res) => {
  painelAlertas().then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha nos alertas.").slice(0, 300) }),
  );
});

export default router;
