import express from "express";
import { query, withDatabase } from "../db.js";
import { ajustarQuantidade, confirmar, escolherProduto, interpretarEntrada, listarOrcamentos } from "../lib/charlie-smart-quotes-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })) };
}

function enviar(res, promessa) {
  return Promise.resolve(promessa).then(
    (dados) => res.json({ ok: true, ...(dados && typeof dados === "object" && !Array.isArray(dados) ? dados : { dados }) }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha no orçamento.").slice(0, 300) }),
  );
}

router.get("/charlie-quotes", (_req, res) => res.json({ ok: true, orcamentos: listarOrcamentos() }));
router.post("/charlie-quotes/interpretar", (req, res) => enviar(res, interpretarEntrada(req.body || {}, deps())));
router.post("/charlie-quotes/:id/escolher", (req, res) => enviar(res, Promise.resolve().then(() => ({ orcamento: escolherProduto(req.params.id, req.body?.indice, req.body?.codigo) }))));
router.post("/charlie-quotes/:id/quantidade", (req, res) => enviar(res, Promise.resolve().then(() => ({ orcamento: ajustarQuantidade(req.params.id, req.body?.indice, req.body?.quantidade) }))));
router.post("/charlie-quotes/:id/confirmar", (req, res) => enviar(res, Promise.resolve().then(() => ({ orcamento: confirmar(req.params.id) }))));

export default router;
