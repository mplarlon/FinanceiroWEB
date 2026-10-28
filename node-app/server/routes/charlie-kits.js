import express from "express";
import { query, withDatabase } from "../db.js";
import { painelKits } from "../lib/charlie-kit-builder-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 30000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, company: user.idempresa || null };
}

router.get("/charlie-kits", (req, res) => {
  painelKits(deps(), { ator: ator(req) }).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha nas sugestões de kit.").slice(0, 300) }),
  );
});

export default router;
