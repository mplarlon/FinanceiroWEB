import express from "express";
import { query, withDatabase } from "../db.js";
import { painelCliente } from "../lib/charlie-customer360-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 30000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { company: user.idempresa || null };
}

router.get("/charlie-customer360", (req, res) => {
  painelCliente(deps(), { ator: ator(req) }).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na ficha do cliente.").slice(0, 300) }),
  );
});

export default router;
