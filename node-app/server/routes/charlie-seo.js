import express from "express";
import { query, withDatabase } from "../db.js";
import { painelSeo } from "../lib/charlie-seo-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })) };
}

router.get("/charlie-seo", (req, res) => {
  painelSeo(deps()).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha nas sugestões.").slice(0, 300) }),
  );
});

export default router;
