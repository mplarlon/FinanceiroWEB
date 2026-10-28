import express from "express";
import { query, withDatabase } from "../db.js";
import { ITEM_SEM_SQL, ITEM_VALOR_SQL, valorJanela, valorLido } from "../lib/charlie-sale-value.js";
const router = express.Router();
const run = (sql) => async (req, res) => {
  try {
    res.json({
      ok: true,
      dados: await withDatabase((db) => query(db, sql(req))),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
};
const PEDIDO_VALOR = "CASE WHEN VLTOTAL IS NOT NULL THEN VLTOTAL END";
const PEDIDO_SEM = "CASE WHEN VLTOTAL IS NULL THEN 1 ELSE 0 END";
const vender = (sql, campos, janela = false) => async (req, res) => {
  try {
    const dados = await withDatabase((db) => query(db, sql(req)));
    res.json({
      ok: true,
      dados: dados.map((row) => {
        const next = { ...row };
        delete next.SEM;
        for (const campo of campos) {
          next[campo] = janela ? valorJanela(row[campo], row.SEM) : valorLido(row[campo], row.SEM);
        }
        return next;
      }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
};
const days = (req) => Math.max(1, Math.min(1460, Number(req.query.dias || 30)));
const limit = (req) =>
  Math.max(1, Math.min(100, Number(req.query.limite || 20)));
router.get(
  "/vendas/resumo",
  async (req, res) => {
    try {
      const [row] = await withDatabase((db) => query(db, `SELECT
 SUM(CASE WHEN CAST(DTSAIDA AS DATE)=CURRENT_DATE THEN ${PEDIDO_VALOR} END) HOJE,
 SUM(CASE WHEN CAST(DTSAIDA AS DATE)=CURRENT_DATE THEN ${PEDIDO_SEM} ELSE 0 END) SEM_HOJE,
 COUNT(CASE WHEN CAST(DTSAIDA AS DATE)=CURRENT_DATE THEN 1 END) QTD_HOJE,
 SUM(CASE WHEN EXTRACT(MONTH FROM DTSAIDA)=EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM DTSAIDA)=EXTRACT(YEAR FROM CURRENT_DATE) THEN ${PEDIDO_VALOR} END) MES_ATUAL,
 SUM(CASE WHEN EXTRACT(MONTH FROM DTSAIDA)=EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM DTSAIDA)=EXTRACT(YEAR FROM CURRENT_DATE) THEN ${PEDIDO_SEM} ELSE 0 END) SEM_MES,
 SUM(CASE WHEN EXTRACT(MONTH FROM DTSAIDA)=EXTRACT(MONTH FROM DATEADD(-31 DAY TO CURRENT_DATE)) AND EXTRACT(YEAR FROM DTSAIDA)=EXTRACT(YEAR FROM DATEADD(-31 DAY TO CURRENT_DATE)) THEN ${PEDIDO_VALOR} END) MES_ANTERIOR,
 SUM(CASE WHEN EXTRACT(MONTH FROM DTSAIDA)=EXTRACT(MONTH FROM DATEADD(-31 DAY TO CURRENT_DATE)) AND EXTRACT(YEAR FROM DTSAIDA)=EXTRACT(YEAR FROM DATEADD(-31 DAY TO CURRENT_DATE)) THEN ${PEDIDO_SEM} ELSE 0 END) SEM_ANTERIOR,
 AVG(${PEDIDO_VALOR}) TICKET_MEDIO, SUM(${PEDIDO_SEM}) SEM_TICKET
 FROM SAIDAESTOQUE WHERE DTCANCELAMENTO IS NULL AND DTSAIDA>=DATEADD(-365 DAY TO CURRENT_DATE)`));
      const atual = row || {};
      res.json({
        ok: true,
        dados: [{
          HOJE: valorJanela(atual.HOJE, atual.SEM_HOJE),
          QTD_HOJE: atual.QTD_HOJE,
          MES_ATUAL: valorJanela(atual.MES_ATUAL, atual.SEM_MES),
          MES_ANTERIOR: valorJanela(atual.MES_ANTERIOR, atual.SEM_ANTERIOR),
          TICKET_MEDIO: Number(atual.SEM_TICKET) > 0 ? null : valorJanela(atual.TICKET_MEDIO, 0),
        }],
      });
    } catch (e) {
      res.status(500).json({ ok: false, erro: e.message });
    }
  },
);
router.get(
  "/vendas/faturamento-diario",
  vender(
    (
      req,
    ) => `SELECT CAST(DTSAIDA AS DATE) DIA,COUNT(*) QTD_VENDAS,SUM(${PEDIDO_VALOR}) TOTAL,SUM(${PEDIDO_SEM}) SEM
 FROM SAIDAESTOQUE WHERE DTCANCELAMENTO IS NULL AND DTSAIDA>=DATEADD(-${days(req)} DAY TO CURRENT_DATE) GROUP BY CAST(DTSAIDA AS DATE) ORDER BY DIA`,
    ["TOTAL"],
  ),
);
router.get(
  "/vendas/faturamento-mensal",
  vender(
    () => `SELECT FIRST 12 EXTRACT(YEAR FROM DTSAIDA) ANO,EXTRACT(MONTH FROM DTSAIDA) MES,
 COUNT(*) QTD_VENDAS,SUM(${PEDIDO_VALOR}) TOTAL,SUM(${PEDIDO_SEM}) SEM FROM SAIDAESTOQUE WHERE DTCANCELAMENTO IS NULL
 AND DTSAIDA>=DATEADD(-12 MONTH TO CURRENT_DATE) GROUP BY EXTRACT(YEAR FROM DTSAIDA),EXTRACT(MONTH FROM DTSAIDA) ORDER BY ANO,MES`,
    ["TOTAL"],
  ),
);
router.get(
  "/vendas/produtos-mais-vendidos",
  vender(
    (req) => `SELECT FIRST ${limit(req)}
 COALESCE(p.PRODUTO,sp.DESCRICAO) DESCRICAO,SUM(COALESCE(sp.QTDPRODUTO,0)) QTD_TOTAL,
 SUM(${ITEM_VALOR_SQL}) TOTAL,SUM(${ITEM_SEM_SQL}) SEM FROM SAIDAPRODUTO sp
 JOIN SAIDAESTOQUE s ON s.NRPEDIDO=sp.NRPEDIDO AND s.IDEMPRESA=sp.IDEMPRESA LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
 WHERE s.DTSAIDA>=DATEADD(-${days(req)} DAY TO CURRENT_DATE) AND s.DTCANCELAMENTO IS NULL
 GROUP BY COALESCE(p.PRODUTO,sp.DESCRICAO) ORDER BY QTD_TOTAL DESC`,
    ["TOTAL"],
  ),
);
router.get(
  "/vendas/por-vendedor",
  vender(
    (req) => `SELECT FIRST 20 COALESCE(v.VENDEDOR,'Sem vendedor') VENDEDOR,
 COUNT(*) QTD_VENDAS,SUM(${PEDIDO_VALOR}) TOTAL,SUM(${PEDIDO_SEM}) SEM,
 AVG(${PEDIDO_VALOR}) TICKET_MEDIO FROM SAIDAESTOQUE s
 LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=s.CDVENDEDOR WHERE s.DTSAIDA>=DATEADD(-${days(req)} DAY TO CURRENT_DATE)
 AND s.DTCANCELAMENTO IS NULL GROUP BY COALESCE(v.VENDEDOR,'Sem vendedor') ORDER BY TOTAL DESC`,
    ["TOTAL", "TICKET_MEDIO"],
  ),
);
router.get(
  "/vendas/por-forma-pagamento",
  vender(
    (
      req,
    ) => `SELECT FIRST 20 COALESCE(r.RECEBTO,'Nao informado') FORMA_PAGAMENTO,COUNT(*) QTD,
 SUM(${PEDIDO_VALOR}) TOTAL,SUM(${PEDIDO_SEM}) SEM FROM SAIDAESTOQUE s LEFT JOIN RECEBTO r ON r.CDRECEBTO=s.CDRECEBTO
 WHERE s.DTSAIDA>=DATEADD(-${days(req)} DAY TO CURRENT_DATE) AND s.DTCANCELAMENTO IS NULL
 GROUP BY COALESCE(r.RECEBTO,'Nao informado') ORDER BY TOTAL DESC`,
    ["TOTAL"],
  ),
);
router.get(
  "/estoque/resumo",
  run(
    () => `SELECT COUNT(*) TOTAL_PRODUTOS,SUM(CASE WHEN m.QTDEATUAL>0 THEN 1 ELSE 0 END) COM_ESTOQUE,
 SUM(CASE WHEN m.QTDEATUAL<=0 THEN 1 ELSE 0 END) SEM_ESTOQUE,SUM(CASE WHEN m.QTDEATUAL<0 THEN 1 ELSE 0 END) ESTOQUE_NEGATIVO,
 SUM(m.QTDEATUAL*COALESCE(p.VLCUSTOMEDIO,0)) VALOR_TOTAL FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
 WHERE p.INATIVO IS NULL OR p.INATIVO=0`,
  ),
);
router.get(
  "/estoque/baixo",
  run(
    (
      req,
    ) => `SELECT FIRST ${Math.max(1, Math.min(500, Number(req.query.limite || 50)))} m.CDPRODUTO CODIGO,p.PRODUTO DESCRICAO,
 m.QTDEATUAL ESTOQUE_ATUAL,m.QTDEMINIMA ESTOQUE_MINIMO,p.VLCUSTOMEDIO VLCUSTO FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO
 WHERE (p.INATIVO IS NULL OR p.INATIVO=0) AND m.QTDEMINIMA>0 AND m.QTDEATUAL<=m.QTDEMINIMA ORDER BY (m.QTDEATUAL-m.QTDEMINIMA)`,
  ),
);
router.get(
  "/estoque/negativos",
  run(
    () => `SELECT m.CDPRODUTO CODIGO,p.PRODUTO DESCRICAO,m.QTDEATUAL ESTOQUE,p.VLCUSTOMEDIO VLCUSTO
 FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE (p.INATIVO IS NULL OR p.INATIVO=0) AND m.QTDEATUAL<0 ORDER BY m.QTDEATUAL`,
  ),
);
export default router;
