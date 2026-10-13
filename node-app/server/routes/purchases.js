import express from "express";
import { query, withDatabase } from "../db.js";
const router = express.Router(),
  run = (fn) => async (req, res) => {
    try {
      res.json(await withDatabase((db) => fn(db, req)));
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message });
    }
  };
function f(req) {
  const d = Math.max(1, Math.min(1460, Number(req.query.dias || 30))),
    today = new Date();
  today.setHours(0, 0, 0, 0);
  let start = req.query.data_inicio
      ? new Date(`${String(req.query.data_inicio).slice(0, 10)}T00:00:00`)
      : null,
    endInclusive = req.query.data_fim
      ? new Date(`${String(req.query.data_fim).slice(0, 10)}T00:00:00`)
      : new Date(today);
  if (!start) {
    start = new Date(endInclusive);
    start.setDate(start.getDate() - d + 1);
  }
  if (endInclusive < start) [start, endInclusive] = [endInclusive, start];
  const end = new Date(endInclusive);
  end.setDate(end.getDate() + 1);
  return {
    d,
    start,
    end,
    where: "ee.DTENTRADA>=? AND ee.DTENTRADA<? AND ee.DTCANCELAMENTO IS NULL",
    params: [start, end],
  };
}
router.get(
  "/options",
  run(async (db) => ({
    ok: true,
    cache_ttl: 120,
    lojas: await query(
      db,
      `SELECT FIRST 100 IDEMPRESA ID,NOMEEMPRESA NOME FROM CONFIGURACAO ORDER BY IDEMPRESA`,
    ),
    fornecedores: await query(
      db,
      `SELECT FIRST 500 CDFORNECEDOR ID,COALESCE(FORNECEDOR,FANTASIA) NOME FROM FORNECEDOR ORDER BY FORNECEDOR`,
    ),
    produtos: await query(
      db,
      `SELECT FIRST 500 CDPRODUTO ID,PRODUTO NOME FROM PRODUTO WHERE INATIVO=0 OR INATIVO IS NULL ORDER BY PRODUTO`,
    ),
    grupos: await query(
      db,
      `SELECT FIRST 250 CDGRUPO ID,GRUPOS NOME FROM GRUPOS ORDER BY GRUPOS`,
    ),
    compradores: await query(
      db,
      `SELECT FIRST 200 CDVENDEDOR ID,VENDEDOR NOME FROM VENDEDOR ORDER BY VENDEDOR`,
    ),
    tipos_entrada: [
      { ID: "normal", NOME: "Normal" },
      { ID: "com_pedido", NOME: "Com pedido vinculado" },
      { ID: "sem_pedido", NOME: "Sem pedido vinculado" },
      { ID: "transferencia", NOME: "Transferencia" },
    ],
  })),
);
router.get("/views", (_q, res) =>
  res.json({
    ok: true,
    arquivo: "purchase_dashboard_views.sql",
    views: [
      "VW_DASH_COMPRAS_ITENS",
      "VW_DASH_COMPRAS_DIA",
      "VW_DASH_COMPRAS_PRODUTO",
      "VW_DASH_COMPRAS_FORNECEDOR",
    ],
  }),
);
router.get(
  "/summary",
  run(async (db, req) => {
    const x = f(req),
      k =
        (
          await query(
            db,
            `SELECT SUM(COALESCE(ep.VLTOT,ep.QTDE*ep.VLUNIT,0)) TOTAL_COMPRADO,
 SUM(COALESCE(ep.QTDE,0)) QTD_COMPRADA,COUNT(DISTINCT CAST(ee.IDENTRADA AS VARCHAR(20))||'-'||CAST(ee.IDEMPRESA AS VARCHAR(20))) QTD_ENTRADAS,
 SUM(CASE WHEN ee.CDORDEM IS NULL THEN 1 ELSE 0 END) ENTRADAS_SEM_PEDIDO FROM ENTRPRODUTO ep
 JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA WHERE ${x.where}`,
            x.params,
          )
        )[0] || {};
    const estoque =
      (
        await query(
          db,
          `SELECT SUM(COALESCE(m.QTDEATUAL,0)*COALESCE(
   (SELECT FIRST 1 pp.VLCUSTO FROM PRODUTOPRECO pp
    WHERE pp.CDPRODUTO=p.CDPRODUTO
      AND pp.IDPRECO=COALESCE(p.IDPRECO,1)
      AND TRIM(pp.CDUNIDADE)=TRIM(COALESCE(NULLIF(p.CDUNIDVENDA,''),NULLIF(p.CDUNIDADE,''),'UN'))
      AND COALESCE(pp.VLCUSTO,0)>0
    ORDER BY pp.IDPRECO),0)) VALOR_ESTOQUE,
 SUM(CASE WHEN COALESCE(m.QTDEATUAL,0)<=COALESCE(m.QTDEMINIMA,0) THEN 1 ELSE 0 END) ABAIXO_MINIMO
 FROM PRODUTO p
 JOIN MOVIMENTO m ON m.CDPRODUTO=p.CDPRODUTO
 JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0 AND d.CDDEPOSITO<>3
 WHERE p.INATIVO=0 OR p.INATIVO IS NULL`,
        )
      )[0] || {};
    const kpis = {
      total_comprado: Number(k.TOTAL_COMPRADO || 0),
      quantidade_comprada: Number(k.QTD_COMPRADA || 0),
      numero_entradas: Number(k.QTD_ENTRADAS || 0),
      entradas_sem_pedido: Number(k.ENTRADAS_SEM_PEDIDO || 0),
      estoque_valor: Number(estoque.VALOR_ESTOQUE || 0),
      estoque_abaixo_minimo: Number(estoque.ABAIXO_MINIMO || 0),
    };
    return { ok: true, cache_ttl: 120, kpis, alertas: [] };
  }),
);
router.get(
  "/charts",
  run(async (db, req) => {
    const x = f(req),
      limit = Math.max(5, Math.min(50, Number(req.query.limite || 15)));
    const diario = await query(
      db,
      `SELECT CAST(ee.DTENTRADA AS DATE) DIA,COUNT(DISTINCT ee.IDENTRADA) ENTRADAS,
 SUM(COALESCE(ep.VLTOT,ep.QTDE*ep.VLUNIT,0)) TOTAL,SUM(COALESCE(ep.QTDE,0)) QTD FROM ENTRPRODUTO ep
 JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA WHERE ${x.where} GROUP BY CAST(ee.DTENTRADA AS DATE) ORDER BY DIA`,
      x.params,
    );
    const fornecedores = await query(
      db,
      `SELECT FIRST ${limit} ee.CDFORNECEDOR ID,COALESCE(fr.FORNECEDOR,fr.FANTASIA) FORNECEDOR,
 COUNT(DISTINCT ee.IDENTRADA) ENTRADAS,SUM(COALESCE(ep.QTDE,0)) QTD,SUM(COALESCE(ep.VLTOT,ep.QTDE*ep.VLUNIT,0)) TOTAL
 FROM ENTRPRODUTO ep JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA
 LEFT JOIN FORNECEDOR fr ON fr.CDFORNECEDOR=ee.CDFORNECEDOR WHERE ${x.where} GROUP BY ee.CDFORNECEDOR,fr.FORNECEDOR,fr.FANTASIA ORDER BY TOTAL DESC`,
      x.params,
    );
    const produtos = await query(
      db,
      `SELECT FIRST ${limit} ep.CDPRODUTO CODIGO,COALESCE(p.PRODUTO,ep.DESCRICAO,ep.CDPRODUTO) PRODUTO,
 SUM(COALESCE(ep.QTDE,0)) QTD,SUM(COALESCE(ep.VLTOT,ep.QTDE*ep.VLUNIT,0)) TOTAL FROM ENTRPRODUTO ep
 JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA LEFT JOIN PRODUTO p ON p.CDPRODUTO=ep.CDPRODUTO
 WHERE ${x.where} GROUP BY ep.CDPRODUTO,p.PRODUTO,ep.DESCRICAO ORDER BY TOTAL DESC`,
      x.params,
    );
    return {
      ok: true,
      cache_ttl: 120,
      diario,
      fornecedores,
      fornecedores_qtd: fornecedores,
      produtos,
      produtos_qtd: produtos,
      alertas: [],
    };
  }),
);
export default router;
