import express from "express";
import { painelOportunidades } from "../lib/charlie-sales-opportunities-service.js";

const router = express.Router();

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return {
    id: user.idusuario,
    gerencial: Boolean(user.permissao_gerencial),
    company: Number(user.idempresa) > 0 ? Number(user.idempresa) : null,
  };
}

router.get("/charlie-sales-opportunities", (req, res) => {
  painelOportunidades({}, { ator: ator(req) }).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha nas oportunidades.").slice(0, 300) }),
  );
});

export default router;
