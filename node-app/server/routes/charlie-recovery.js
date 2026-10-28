import express from "express";
import { query, withDatabase } from "../db.js";
import { agir, painelRecuperacao } from "../lib/charlie-recovery-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })) };
}

router.get("/charlie-recovery", (req, res) => {
  painelRecuperacao(deps(), req.query || {}).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na recuperação.").slice(0, 300) }),
  );
});

router.post("/charlie-recovery/:id/acao", (req, res) => {
  try {
    const registro = agir(req.params.id, req.body || {});
    res.json({ ok: true, registro, aviso: "A ação ficou registrada no Charlie. Nenhuma mensagem externa foi enviada." });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na ação.").slice(0, 300) });
  }
});

export default router;
