import express from "express";
import { query, withDatabase } from "../db.js";
import { painelEstoque, registrarAcao } from "../lib/charlie-stock-guardian-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 30000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial), company: user.idempresa || null };
}

router.get("/charlie-stock", (req, res) => {
  painelEstoque(deps(), req.query || {}, ator(req)).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha no estoque.").slice(0, 300) }),
  );
});

router.post("/charlie-stock/:id/acao", (req, res) => {
  registrarAcao(req.params.id, req.body?.tipo, ator(req), deps(), req.query || {}).then(
    (resultado) => res.json({ ok: true, ...resultado, aviso: "A ação ficou registrada. Nenhuma quantidade física foi alterada." }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na ação.").slice(0, 300) }),
  );
});

export default router;
