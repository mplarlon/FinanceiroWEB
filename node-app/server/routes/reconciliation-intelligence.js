import express from "express";
import { withDatabase, withWriteTransaction } from "../db.js";
import {
  aplicarConciliacao,
  aprovarExcecao,
  aprovarLote,
  carregarConciliacao,
  desfazerConciliacao,
  desfazerNoBanco,
  executarCiclo,
  fecharDefinitivo,
  gerarPreFechamento,
  importarExtratoConfirmado,
  lerEstado,
  montarPainel,
  prepararImportacao,
  rejeitarExcecao,
  salvarConfiguracao,
} from "../lib/reconciliation-intelligence-service.js";
import { enviarAvisosConciliacao, lerFontesExtrato, salvarFonteExtrato } from "../lib/reconciliation-intelligence-delivery.js";

const router = express.Router();

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return {
    idusuario: Number(user.idusuario || req.get("X-Usuario-Id") || 0) || null,
    nome: String(user.nome || user.login || req.get("X-Usuario") || "").slice(0, 100),
    perfil: String(user.perfil || user.grupo || req.get("X-Perfil") || "").toLowerCase(),
  };
}

function empresaDe(req) {
  const valor = Number(req.query.empresa || req.body?.empresa || 0);
  return valor > 0 ? valor : null;
}

function aplicar(decisao, autor) {
  return withWriteTransaction((tx) => aplicarConciliacao(tx, decisao, autor));
}

router.get("/inteligencia/painel", (_req, res) => {
  try {
    res.json({ ok: true, ...montarPainel(lerEstado(), lerFontesExtrato()) });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

router.get("/inteligencia/excecoes", (_req, res) => {
  res.json({ ok: true, excecoes: montarPainel(lerEstado()).excecoes });
});

router.post("/inteligencia/executar", async (req, res) => {
  try {
    const empresa = empresaDe(req);
    const estado = lerEstado();
    const carga = await withDatabase((db) => carregarConciliacao(db, empresa, estado.configuracao.maxMovimentos || 500, estado.fila || 0));
    const resultado = await executarCiclo({ ...carga, empresa, manual: true, aplicar, enviarAvisos: enviarAvisosConciliacao });
    res.json({ ok: true, ...resultado, painel: montarPainel(lerEstado()) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/inteligencia/excecoes/lote", async (req, res) => {
  try {
    const resultado = await aprovarLote({ aplicar }, Array.isArray(req.body?.ids) ? req.body.ids : [], ator(req));
    if (!resultado.ok) return res.status(409).json(resultado);
    res.json(resultado);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/inteligencia/excecoes/:id/aprovar", async (req, res) => {
  try {
    const resultado = await aprovarExcecao({ aplicar }, req.params.id, { ...req.body, confirmado: req.body?.confirmado === true }, ator(req));
    if (!resultado.ok) return res.status(409).json(resultado);
    res.json(resultado);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/inteligencia/excecoes/:id/rejeitar", (req, res) => {
  const resultado = rejeitarExcecao({}, req.params.id, ator(req));
  if (!resultado.ok) return res.status(409).json(resultado);
  res.json(resultado);
});

router.post("/inteligencia/desfazer", async (req, res) => {
  try {
    const resultado = await desfazerConciliacao({
      desfazer: (registro) => withWriteTransaction((tx) => desfazerNoBanco(tx, registro)),
    }, req.body?.id, { ...req.body, ...ator(req), confirmado: req.body?.confirmado === true });
    if (!resultado.ok) return res.status(409).json(resultado);
    res.json(resultado);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.get("/inteligencia/fechamento", async (req, res) => {
  try {
    const data = String(req.query.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const empresa = empresaDe(req);
    const carga = await withDatabase((db) => carregarConciliacao(db, empresa, 1000));
    res.json({ ok: true, fechamento: await gerarPreFechamento({ ...carga, empresa }, data) });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/inteligencia/fechamento", async (req, res) => {
  try {
    const data = String(req.body?.data || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const empresa = empresaDe(req);
    const carga = await withDatabase((db) => carregarConciliacao(db, empresa, 1000));
    const resultado = await fecharDefinitivo({ ...carga, empresa }, data, { ...ator(req), confirmado: req.body?.confirmado === true });
    if (!resultado.ok) return res.status(409).json(resultado);
    res.json(resultado);
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.put("/inteligencia/configuracao", (req, res) => {
  try {
    res.json({ ok: true, configuracao: salvarConfiguracao({}, req.body || {}) });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

router.post("/inteligencia/arquivo/preview", (req, res) => {
  const texto = String(req.body?.conteudo || "");
  if (!texto.trim()) return res.status(400).json({ ok: false, erro: "Informe o conteúdo do CSV ou do CNAB." });
  res.json({ ok: true, ...prepararImportacao(texto, req.body?.formato, req.body?.chaves || []) });
});

router.post("/inteligencia/arquivo/importar", async (req, res) => {
  try {
    const autor = ator(req);
    const resultado = await withWriteTransaction((tx) => importarExtratoConfirmado(tx, {
      confirmado: req.body?.confirmado === true,
      conteudo: req.body?.conteudo,
      formato: req.body?.formato,
      cdbanco: req.body?.cdbanco,
      agencia: req.body?.agencia,
      numconta: req.body?.numconta,
      empresa: Number(req.body?.empresa),
      usuario: autor.idusuario,
      nomeArquivo: req.body?.nomeArquivo,
    }));
    res.json({ ok: true, ...resultado });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.put("/inteligencia/fontes", (req, res) => {
  const entrada = req.body || {};
  if (!entrada.banco || !entrada.conta) return res.status(400).json({ ok: false, erro: "Informe banco e conta." });
  res.json({ ok: true, fontes: salvarFonteExtrato(entrada) });
});

export default router;
