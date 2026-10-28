import express from "express";
import { query, withDatabase } from "../db.js";
import { cadastrarSinal, criarOportunidade, painelSinais } from "../lib/charlie-buying-signals-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial) };
}

router.get("/charlie-signals", (req, res) => {
  painelSinais(deps()).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha nos sinais.").slice(0, 300) }),
  );
});

router.post("/charlie-signals", (req, res) => {
  cadastrarSinal(req.body || {}, ator(req), deps()).then(
    (sinal) => res.status(201).json({ ok: true, sinal, aviso: "Sinal registrado. Nenhuma página foi consultada." }),
    (error) => res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha no cadastro.").slice(0, 300) }),
  );
});

router.post("/charlie-signals/:id/oportunidade", (req, res) => {
  criarOportunidade(req.params.id, ator(req), deps()).then(
    (resultado) => res.json({ ok: true, ...resultado, aviso: "A oportunidade entrou na lista comercial. Nenhuma mensagem foi enviada." }),
    (error) => res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha na oportunidade.").slice(0, 300) }),
  );
});

export default router;
