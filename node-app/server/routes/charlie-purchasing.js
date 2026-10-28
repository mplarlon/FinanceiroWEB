import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";
import { approve, ensureSchema } from "./purchase-replenishment.js";
import { autorizarEmissao, criarSolicitacao, emitirPedido, painelCompras } from "../lib/charlie-smart-purchasing-service.js";

const router = express.Router();

function deps() {
  return { query: (sql, params = []) => withDatabase((db) => query(db, sql, params, { timeoutMs: 20000 })) };
}

function ator(req) {
  const user = req.dashboardSession?.user || {};
  return { id: user.idusuario, gerencial: Boolean(user.permissao_gerencial), company: user.idempresa || null };
}

async function gravarSolicitacao(item, usuario) {
  return withWriteTransaction(async (tx) => {
    await ensureSchema(tx);
    const id = Number((await tx.singleton("SELECT COALESCE(MAX(ID),0)+1 AS ID FROM DASH_COMPRA_SUGESTAO")).ID);
    const total = Math.round(item.quantidade * item.custoUnitario * 100) / 100;
    await tx.execute(
      "INSERT INTO DASH_COMPRA_SUGESTAO (ID,STATUS,OBS,VLTOTAL,CRIADO_EM,CRIADO_POR) VALUES (?,'RASCUNHO',?,?,?,?)",
      [id, `O que comprar ${item.produtoId}`.slice(0, 200), total, new Date(), Number(usuario.id || 0)],
    );
    const itemId = Number((await tx.singleton("SELECT COALESCE(MAX(ID),0)+1 AS ID FROM DASH_COMPRA_SUGESTAO_ITEM")).ID);
    await tx.execute(
      "INSERT INTO DASH_COMPRA_SUGESTAO_ITEM (ID,ID_SUGESTAO,CDPRODUTO,PRODUTO,CDDEPOSITO,IDEMPRESA,CDFORNECEDOR,QTDE_SUGERIDA,VLUNIT_ESTIMADO,VLTOTAL_ESTIMADO) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [itemId, id, String(item.produtoId).slice(0, 10), String(item.nome || "").slice(0, 70), Number(item.depositoId), Number(item.empresaId), Number(item.fornecedorId), item.quantidade, item.custoUnitario, total],
    );
    return { id, pedidoEmitido: false };
  });
}

async function emitirNoErp(idSugestao, usuario) {
  return withWriteTransaction(async (tx) => {
    await ensureSchema(tx);
    return approve(tx, idSugestao, Number(usuario.id || 0));
  });
}

function responder(promessa, res, statusOk = 200) {
  promessa.then(
    (dados) => res.status(statusOk).json({ ok: true, ...dados }),
    (error) => res.status(error.status || 500).json({ ok: false, erro: String(error.message || "Falha na compra.").slice(0, 300) }),
  );
}

router.get("/charlie-purchasing", (req, res) => {
  responder(painelCompras(deps(), ator(req), { janelaDias: req.query.janelaDias }), res);
});

router.post("/charlie-purchasing/autorizacao", (req, res) => {
  responder(autorizarEmissao(req.body || {}, ator(req)), res);
});

router.post("/charlie-purchasing/:id/solicitacao", (req, res) => {
  responder(criarSolicitacao(req.params.id, ator(req), { ...deps(), gravarSolicitacao }, { janelaDias: req.query.janelaDias }), res, 201);
});

router.post("/charlie-purchasing/:id/emitir", (req, res) => {
  responder(emitirPedido(req.params.id, ator(req), { emitirPedido: emitirNoErp }), res);
});

export default router;
