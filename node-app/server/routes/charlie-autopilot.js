import express from "express";
import { autorizarBaixoRisco, decidirAutopilot, painelAutopilot, rodarCiclo } from "../lib/charlie-autopilot-service.js";

const router = express.Router();

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial) };
}

router.get("/charlie-autopilot", (_req, res) => {
  try { res.json({ ok: true, ...painelAutopilot() }); }
  catch (error) { res.status(500).json({ ok: false, erro: String(error.message || "Falha no Autopilot.").slice(0, 300) }); }
});

router.post("/charlie-autopilot/ciclo", (req, res) => {
  try { res.json({ ok: true, ...rodarCiclo(ator(req)), aviso: "O ciclo classificou os registros existentes. Nada de risco médio ou alto foi executado." }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha no ciclo.").slice(0, 300) }); }
});

router.post("/charlie-autopilot/baixo-risco", (req, res) => {
  try { res.json({ ok: true, ...autorizarBaixoRisco(req.body?.ligado, ator(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha na autorização.").slice(0, 300) }); }
});

router.post("/charlie-autopilot/:id/decisao", (req, res) => {
  try { res.json({ ok: true, item: decidirAutopilot(req.params.id, req.body?.decisao, ator(req)), aviso: "A decisão ficou registrada. Nenhum cadastro foi alterado." }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, erro: String(error.message || "Falha na decisão.").slice(0, 300) }); }
});

export default router;
