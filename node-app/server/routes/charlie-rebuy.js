import express from "express";
import { query, withDatabase } from "../db.js";
import { criarOportunidade, criarTarefa, painelRecompra } from "../lib/charlie-rebuy-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 30000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return {
    id: user.idusuario,
    gerencial: Boolean(user.permissao_gerencial),
    company: user.idempresa || null,
    branch: user.idfilial || null,
  };
}

router.get("/charlie-rebuy", (req, res) => {
  painelRecompra(deps(), req.query || {}, ator(req)).then(
    (painel) => res.json({ ok: true, ...painel }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na recompra.").slice(0, 300) }),
  );
});

router.post("/charlie-rebuy/:id/oportunidade", (req, res) => {
  criarOportunidade(req.params.id, ator(req), deps(), req.query || {}).then(
    (resultado) => res.json({ ok: true, ...resultado, aviso: "A oportunidade entrou na lista comercial. Nenhum pedido foi gerado." }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na oportunidade.").slice(0, 300) }),
  );
});

router.post("/charlie-rebuy/:id/tarefa", (req, res) => {
  criarTarefa(req.params.id, ator(req), deps(), req.query || {}).then(
    (resultado) => res.json({ ok: true, ...resultado, aviso: "A tarefa ficou no Charlie. Nenhuma mensagem foi enviada." }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na tarefa.").slice(0, 300) }),
  );
});

export default router;
