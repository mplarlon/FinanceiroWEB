import express from "express";
import { query, withDatabase } from "../db.js";
import { painelCoach } from "../lib/charlie-sales-coach-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial) };
}

router.get("/charlie-sales-coach", (req, res) => {
  painelCoach(deps(), ator(req), { todos: req.query.todos === "1" }).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha no coach.").slice(0, 300) }),
  );
});

export default router;
