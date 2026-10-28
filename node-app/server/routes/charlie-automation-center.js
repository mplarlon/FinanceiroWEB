import express from "express";
import { painelAutomacoes } from "../lib/charlie-automation-center-service.js";

const router = express.Router();

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial) };
}

router.get("/charlie-automations", (req, res) => {
  painelAutomacoes({}, { ator: ator(req) }).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha nas automações.").slice(0, 300) }),
  );
});

export default router;
