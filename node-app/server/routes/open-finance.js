import express from "express";
import { empresasOpenFinance, servicoOpenFinance } from "../lib/open-finance-runtime.js";

const router = express.Router();

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return {
    idusuario: Number(user.idusuario || 0) || null,
    nome: String(user.nome || user.login || "").slice(0, 100),
    perfil: String(user.perfil || user.grupo || "").toLowerCase(),
    idempresa: Number(user.idempresa || 0) || null,
  };
}

function empresaDe(req) {
  const usuario = ator(req);
  const informada = Number(req.query.empresa || req.body?.empresa || req.params.empresa || 0);
  if (usuario.idempresa && !["admin", "gerente"].includes(usuario.perfil) && informada && informada !== usuario.idempresa) {
    const erro = new Error("Empresa diferente da sessão.");
    erro.status = 403;
    throw erro;
  }
  const empresa = informada || usuario.idempresa;
  if (!empresa) {
    const erro = new Error("Informe a empresa.");
    erro.status = 400;
    throw erro;
  }
  return empresa;
}

function responder(res, promessa) {
  return Promise.resolve(promessa).then(
    (corpo) => {
      if (corpo && corpo.ok === false && corpo.status) return res.status(corpo.status).json(corpo);
      res.json({ ok: true, ...corpo });
    },
    (error) => res.status(error.status || 500).json({ ok: false, erro: error.message }),
  );
}

router.get("/capacidades", (_req, res) => {
  res.json({ ok: true, ...servicoOpenFinance().capacidades() });
});

router.get("/estado", (req, res) => responder(res, servicoOpenFinance().estado(Number(req.query.empresa || 0) || null)));

router.get("/empresas", (_req, res) => responder(res, empresasOpenFinance().then((empresas) => ({ empresas }))));

router.get("/contas-erp", (_req, res) => responder(res, servicoOpenFinance().contasDoErp().then((contas) => ({ contas }))));

router.put("/configuracao", (req, res) => responder(res, servicoOpenFinance().configurar({ ...req.body, empresa: Number(req.body?.empresa || 0) || null }, ator(req))));

router.put("/politica", (req, res) => responder(res, servicoOpenFinance().salvarPolitica(empresaDe(req), req.body || {}, ator(req)).then((politica) => ({ politica }))));

router.get("/instituicoes", (req, res) => responder(res, servicoOpenFinance().instituicoes().then((instituicoes) => ({ instituicoes }))));

router.post("/conexoes", (req, res) => responder(res, servicoOpenFinance().iniciarConexao({ ...req.body, empresa: empresaDe(req), idusuario: ator(req).idusuario, urlPublica: process.env.OPEN_FINANCE_PUBLIC_URL || "" })));

router.post("/conexoes/confirmar", (req, res) => responder(res, servicoOpenFinance().confirmarConexao({ ...req.body, empresa: empresaDe(req), idusuario: ator(req).idusuario })));

router.post("/conexoes/:id/renovar", (req, res) => responder(res, servicoOpenFinance().renovar({ ...req.body, idConexao: Number(req.params.id), empresa: empresaDe(req) })));

router.delete("/conexoes/:id", (req, res) => responder(res, servicoOpenFinance().desconectar({ idConexao: Number(req.params.id), empresa: empresaDe(req), idusuario: ator(req).idusuario }).then((conexao) => ({ conexao }))));

router.post("/contas/:id/vincular", (req, res) => responder(res, servicoOpenFinance().vincularConta({ ...req.body, idConta: Number(req.params.id), empresa: empresaDe(req), idusuario: ator(req).idusuario }).then((conta) => ({ conta }))));

router.post("/conexoes/:id/sincronizar", (req, res) => responder(res, servicoOpenFinance().sincronizar({ ...req.body, idConexao: Number(req.params.id), empresa: empresaDe(req), manual: true })));

router.get("/painel", (req, res) => responder(res, servicoOpenFinance().painel({
  empresa: empresaDe(req),
  banco: req.query.banco || "",
  conta: req.query.conta || "",
  de: req.query.de || "",
  ate: req.query.ate || "",
  natureza: req.query.natureza || "",
  status: req.query.status || "",
  classe: req.query.classe || "",
})));

router.post("/movimentos/:id/aprovar", (req, res) => responder(res, servicoOpenFinance().aprovar({ ...req.body, id: Number(req.params.id), empresa: empresaDe(req), ...ator(req), confirmado: req.body?.confirmado === true })));

router.post("/movimentos/:id/rejeitar", (req, res) => responder(res, servicoOpenFinance().rejeitar({ id: Number(req.params.id), empresa: empresaDe(req), ...ator(req) })));

router.post("/movimentos/:id/classificar", (req, res) => responder(res, servicoOpenFinance().classificar({ ...req.body, id: Number(req.params.id), empresa: empresaDe(req), ...ator(req), confirmado: req.body?.confirmado === true })));

router.post("/movimentos/:id/estornar", (req, res) => responder(res, servicoOpenFinance().estornar({ ...req.body, id: Number(req.params.id), empresa: empresaDe(req), ...ator(req), confirmado: req.body?.confirmado === true })));

router.put("/regras/:id", (req, res) => responder(res, servicoOpenFinance().regraAtualizar({ id: Number(req.params.id), empresa: empresaDe(req), patch: { ativa: req.body?.ativa, padrao: req.body?.padrao, categoria: req.body?.categoria } })));

router.get("/relatorio", (req, res) => responder(res, servicoOpenFinance().relatorio({ empresa: empresaDe(req), data: req.query.data, nomeEmpresa: req.query.nome || "", enviar: req.query.enviar === "1" })));

router.post("/webhook", (req, res) => {
  const token = req.get("x-webhook-token") || req.get("x-open-finance-webhook") || "";
  responder(res, servicoOpenFinance().webhook({
    token,
    eventoId: req.body?.eventId || req.body?.id || "",
    evento: req.body?.event || req.body?.webhook_type || "",
    itemId: req.body?.itemId || req.body?.link_id || req.body?.link || "",
    erro: req.body?.error?.message || "",
  }));
});

export default router;
