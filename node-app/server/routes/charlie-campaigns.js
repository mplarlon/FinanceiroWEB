import express from "express";
import { autorizarPublicacao, criarCampanha, decidirCampanha, painelCampanhas, publicarCampanha } from "../lib/charlie-smart-campaigns-service.js";

const router = express.Router();

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial) };
}

router.get("/charlie-campaigns", (_req, res) => {
  try { res.json({ ok: true, ...painelCampanhas() }); }
  catch (error) { res.status(500).json({ ok: false, erro: String(error.message || "Falha nas campanhas.").slice(0, 300) }); }
});

router.post("/charlie-campaigns", (req, res) => {
  try { res.status(201).json({ ok: true, ...criarCampanha(req.body?.id, ator(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha ao criar.").slice(0, 300) }); }
});

router.post("/charlie-campaigns/autorizacao", (req, res) => {
  try { res.json({ ok: true, ...autorizarPublicacao(req.body?.autorizada, ator(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha na autorização.").slice(0, 300) }); }
});

router.post("/charlie-campaigns/:id/decisao", (req, res) => {
  try { res.json({ ok: true, campanha: decidirCampanha(req.params.id, req.body?.decisao, ator(req)), aviso: "A decisão ficou registrada. Nenhuma mensagem foi enviada." }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha na decisão.").slice(0, 300) }); }
});

router.post("/charlie-campaigns/:id/publicar", (req, res) => {
  try { res.json({ ok: true, campanha: publicarCampanha(req.params.id, ator(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha na publicação.").slice(0, 300) }); }
});

export default router;
