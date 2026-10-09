import express from "express";
import { query, withDatabase } from "../db.js";
import {
  getCharlieConversation,
  hideCharlieConversation,
  listCharlieConversations,
  renameCharlieConversation,
  saveCharlieTurn,
} from "../lib/charlie-history.js";
import {
  improveAnswerWithOllama,
  interpretWithOllama,
} from "../lib/charlie-ai.js";
import { getOllamaStatus } from "../lib/ollama.js";

const router = express.Router();
const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function detectIntent(question) {
  const p = normalize(question),
    limit = Math.max(
      1,
      Math.min(50, Number(p.match(/\btop\s+(\d+)/)?.[1] || 10)),
    );
  if (
    p.includes("abrir o dia") ||
    p.includes("abertura do dia") ||
    p.includes("bom dia charlie")
  )
    return { type: "abertura_dia" };
  if (
    p.includes("o que voce sabe") ||
    p.includes("o que sabe fazer") ||
    p.includes("como pode ajudar")
  )
    return { type: "ajuda" };
  if (p.includes("estoque") && p.includes("negativ"))
    return { type: "estoque_negativo" };
  if (p.includes("estoque") && (p.includes("baixo") || p.includes("minimo")))
    return { type: "estoque_baixo", limit };
  if (p.includes("saldo") && (p.includes("banco") || p.includes("conta")))
    return { type: "saldo_bancos" };
  if ((p.includes("contas") || p.includes("titulos")) && p.includes("receber"))
    return { type: "contas_receber" };
  if ((p.includes("contas") || p.includes("titulos")) && p.includes("pagar"))
    return { type: "contas_pagar" };
  if (p.includes("produto") && (p.includes("vendid") || p.includes("top")))
    return { type: "produtos", limit };
  if (
    p.includes("vendedor") &&
    (p.includes("venda") || p.includes("faturamento"))
  )
    return { type: "vendedores", limit };
  if (
    p.includes("cliente") &&
    (p.includes("maior") || p.includes("top") || p.includes("compr"))
  )
    return { type: "clientes", limit };
  if (p.includes("caixa")) return { type: "caixa" };
  if (
    ["venda", "vendas", "faturamento", "receita", "ticket"].some((term) =>
      p.includes(term),
    )
  )
    return { type: "vendas" };
  return null;
}
async function answer(db, question, selectedIntent) {
  const intent = selectedIntent || detectIntent(question);
  if (!intent)
    return {
      resposta:
        'Nao consegui identificar com seguranca o indicador desejado. Informe o assunto, por exemplo: "vendas", "estoque baixo", "saldo dos bancos" ou "contas a receber".',
      intencao: null,
      dados: [],
      sugestoes: [
        "vendas deste mes",
        "top 10 produtos vendidos",
        "contas a receber",
      ],
    };
  let data = [],
    response = "";
  if (intent.type === "ajuda") {
    response =
      "Posso consultar vendas, rankings de produtos, vendedores e clientes, estoque baixo ou negativo, contas a pagar e receber, saldos bancarios e caixa. Tambem posso abrir o dia com um resumo dos principais indicadores.";
  } else if (intent.type === "abertura_dia") {
    const sales = await query(
      db,
      "SELECT COUNT(DISTINCT se.NRPEDIDO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA WHERE CAST(se.DTSAIDA AS DATE)=CURRENT_DATE AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0",
    );
    const receivable = await query(
      db,
      "SELECT COUNT(*) AS QTD,SUM(COALESCE(VALOR,0)) AS TOTAL FROM CTARECEBER WHERE STATUS=1 AND DTVENC<CURRENT_DATE",
    );
    const payable = await query(
      db,
      "SELECT COUNT(*) AS QTD,SUM(COALESCE(VALOR,0)) AS TOTAL FROM CTAPAGAR WHERE STATUS=1 AND DTVENC<CURRENT_DATE",
    );
    const stock = await query(
      db,
      "SELECT COUNT(*) AS QTD FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE m.QTDEATUAL<=m.QTDEMINIMA AND m.QTDEMINIMA>0 AND COALESCE(p.INATIVO,0)=0",
    );
    data = [
      {
        INDICADOR: "Vendas de hoje",
        QTD: sales[0]?.QTD || 0,
        TOTAL: sales[0]?.TOTAL || 0,
      },
      {
        INDICADOR: "Contas a receber vencidas",
        QTD: receivable[0]?.QTD || 0,
        TOTAL: receivable[0]?.TOTAL || 0,
      },
      {
        INDICADOR: "Contas a pagar vencidas",
        QTD: payable[0]?.QTD || 0,
        TOTAL: payable[0]?.TOTAL || 0,
      },
      {
        INDICADOR: "Produtos com estoque baixo",
        QTD: stock[0]?.QTD || 0,
        TOTAL: null,
      },
    ];
    response = `Abertura do dia: ${Number(sales[0]?.QTD || 0)} venda(s), ${money(sales[0]?.TOTAL)} faturados; ${Number(receivable[0]?.QTD || 0)} conta(s) a receber vencida(s), somando ${money(receivable[0]?.TOTAL)}; ${Number(payable[0]?.QTD || 0)} conta(s) a pagar vencida(s), somando ${money(payable[0]?.TOTAL)}; ${Number(stock[0]?.QTD || 0)} produto(s) com estoque baixo.`;
  } else if (intent.type === "estoque_negativo") {
    data = await query(
      db,
      "SELECT FIRST 20 m.CDPRODUTO AS CODIGO,p.PRODUTO AS DESCRICAO,m.QTDEATUAL AS ESTOQUE FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE m.QTDEATUAL<0 AND COALESCE(p.INATIVO,0)=0 ORDER BY m.QTDEATUAL",
    );
    response = `Produtos com estoque negativo: ${data.length}.`;
  } else if (intent.type === "estoque_baixo") {
    data = await query(
      db,
      `SELECT FIRST ${intent.limit} m.CDPRODUTO AS CODIGO,p.PRODUTO AS DESCRICAO,m.QTDEATUAL AS ESTOQUE_ATUAL,m.QTDEMINIMA AS ESTOQUE_MINIMO FROM MOVIMENTO m JOIN PRODUTO p ON p.CDPRODUTO=m.CDPRODUTO WHERE m.QTDEATUAL<=m.QTDEMINIMA AND m.QTDEMINIMA>0 AND COALESCE(p.INATIVO,0)=0 ORDER BY (m.QTDEATUAL-m.QTDEMINIMA)`,
    );
    response = `Produtos com estoque baixo: ${data.length}.`;
  } else if (intent.type === "saldo_bancos") {
    data = await query(
      db,
      "SELECT FIRST 20 b.BANCO AS NOME_BANCO,mb.CDBANCO,mb.NUMCONTA,SUM(mb.VALOR) AS SALDO FROM MOV_BANCARIO mb LEFT JOIN BANCO b ON b.CDBANCO=mb.CDBANCO GROUP BY b.BANCO,mb.CDBANCO,mb.NUMCONTA ORDER BY SALDO DESC",
    );
    data = data.map((row) => ({
      BANCO: `${row.NOME_BANCO || `Banco ${row.CDBANCO}`} / ${row.NUMCONTA || "Sem conta"}`,
      SALDO: row.SALDO,
    }));
    response = `Saldo consolidado: ${money(data.reduce((sum, row) => sum + Number(row.SALDO || 0), 0))}.`;
  } else if (intent.type.startsWith("contas_")) {
    const table = intent.type === "contas_receber" ? "CTARECEBER" : "CTAPAGAR";
    data = await query(
      db,
      `SELECT CASE WHEN STATUS=1 AND DTVENC<CURRENT_DATE THEN 'VENCIDO' WHEN STATUS=1 THEN 'ABERTO' ELSE 'PAGO' END AS STATUS,COUNT(*) AS QTD,SUM(COALESCE(VALOR,0)) AS TOTAL FROM ${table} GROUP BY 1 ORDER BY 1`,
    );
    response = `Resumo de contas a ${intent.type === "contas_receber" ? "receber" : "pagar"}: ${data.map((row) => `${row.STATUS}: ${row.QTD} (${money(row.TOTAL)})`).join("; ")}.`;
  } else if (intent.type === "caixa") {
    data = await query(
      db,
      `SELECT r.RECEBTO AS FORMA_PAGAMENTO,
        COUNT(*) AS QTD_LANCAMENTOS,
        SUM(COALESCE(c.TOTALPG,c.VALOR,0)) AS TOTAL_RECEBIDO
       FROM CTARECEBERCAIXA c
       LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(c.TPPAGTO,c.CODPAGTO)
       WHERE CAST(c.DTCOB AS DATE)=CURRENT_DATE AND COALESCE(c.CANCELADO,0)=0
       GROUP BY r.RECEBTO
       ORDER BY TOTAL_RECEBIDO DESC`,
    );
    data = data.map((row) => ({
      FORMA_PAGAMENTO: row.FORMA_PAGAMENTO || "Não informada",
      QTD_LANCAMENTOS: Number(row.QTD_LANCAMENTOS || 0),
      TOTAL_RECEBIDO:
        Math.round(Number(row.TOTAL_RECEBIDO || 0) * 100) / 100,
    }));
    const total = data.reduce((sum, row) => sum + row.TOTAL_RECEBIDO, 0),
      lancamentos = data.reduce((sum, row) => sum + row.QTD_LANCAMENTOS, 0);
    response = `Caixa hoje: ${money(total)} em ${lancamentos} lançamento(s), distribuídos em ${data.length} forma(s) de pagamento.`;
  } else {
    const dimensions = {
      produtos: [
        "sp.CDPRODUTO AS CODIGO,COALESCE(p.PRODUTO,sp.DESCRICAO) AS NOME,SUM(sp.QTDPRODUTO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL",
        "LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO",
        "sp.CDPRODUTO,p.PRODUTO,sp.DESCRICAO",
      ],
      vendedores: [
        "se.CDVENDEDOR AS CODIGO,v.VENDEDOR AS NOME,COUNT(DISTINCT se.NRPEDIDO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL",
        "LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=se.CDVENDEDOR",
        "se.CDVENDEDOR,v.VENDEDOR",
      ],
      clientes: [
        "se.CDCLIENTE AS CODIGO,COALESCE(c.CLIENTE,se.CLIENTE) AS NOME,COUNT(DISTINCT se.NRPEDIDO) AS QTD,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL",
        "LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE",
        "se.CDCLIENTE,c.CLIENTE,se.CLIENTE",
      ],
    };
    if (dimensions[intent.type]) {
      const [dims, join, group] = dimensions[intent.type];
      data = await query(
        db,
        `SELECT FIRST ${intent.limit} ${dims} FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA ${join} WHERE CAST(se.DTSAIDA AS DATE)>=DATEADD(-30 DAY TO CURRENT_DATE) AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0 GROUP BY ${group} ORDER BY TOTAL DESC`,
      );
      response = `Ranking dos ultimos 30 dias: ${data.map((row, index) => `${index + 1}. ${row.NOME} - ${money(row.TOTAL)}`).join("; ")}.`;
    } else {
      data = await query(
        db,
        "SELECT COUNT(DISTINCT se.NRPEDIDO) AS QTD_VENDAS,SUM(COALESCE(sp.SUBTOTAL,sp.TOTAL,sp.QTDPRODUTO*sp.VLUNIT,0)) AS TOTAL FROM SAIDAESTOQUE se JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA WHERE CAST(se.DTSAIDA AS DATE)=CURRENT_DATE AND se.DTCANCELAMENTO IS NULL AND COALESCE(sp.STATUSSE,0)=0",
      );
      response = `Vendas hoje: ${money(data[0]?.TOTAL)} em ${Number(data[0]?.QTD_VENDAS || 0)} pedido(s).`;
    }
  }
  return { resposta: response, intencao: intent, dados: data };
}
router.get("/conversas", (req, res) => {
  const user = req.dashboardSession?.user?.idusuario;
  res.json({ ok: true, conversas: listCharlieConversations(user) });
});
router.get("/ollama/status", async (_req, res) => {
  res.json({ ok: true, ...(await getOllamaStatus()) });
});
router.get("/conversas/:id", (req, res) => {
  const result = getCharlieConversation(
    req.dashboardSession?.user?.idusuario,
    req.params.id,
  );
  if (!result)
    return res
      .status(404)
      .json({ ok: false, erro: "Conversa nao encontrada." });
  res.json({ ok: true, ...result });
});
router.patch("/conversas/:id", (req, res) => {
  try {
    const title = renameCharlieConversation(
      req.dashboardSession?.user?.idusuario,
      req.params.id,
      req.body?.titulo,
    );
    if (!title)
      return res
        .status(404)
        .json({ ok: false, erro: "Conversa nao encontrada." });
    res.json({ ok: true, titulo: title });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.delete("/conversas/:id", (req, res) => {
  const hidden = hideCharlieConversation(
    req.dashboardSession?.user?.idusuario,
    req.params.id,
  );
  res
    .status(hidden ? 200 : 404)
    .json(
      hidden
        ? { ok: true, oculto: true }
        : { ok: false, erro: "Conversa nao encontrada." },
    );
});
router.post("/perguntar", async (req, res) => {
  const question = String(
    req.body?.pergunta || req.body?.mensagem || "",
  ).trim();
  if (!question)
    return res
      .status(400)
      .json({ ok: false, erro: 'Informe a pergunta no campo "pergunta".' });
  try {
    const started = Date.now();
    const intent = await interpretWithOllama(question, detectIntent(question));
    const result = await withDatabase((db) => answer(db, question, intent));
    const improved = await improveAnswerWithOllama(question, result);
    if (improved) result.resposta = improved;
    const suggestions = result.sugestoes?.length
      ? result.sugestoes
      : [
          "vendas de hoje",
          "estoque baixo",
          "contas a receber",
          "saldo dos bancos",
        ];
    const alerts =
      result.intencao?.type === "estoque_negativo" && result.dados.length
        ? [
            {
              tipo: "critico",
              texto: `${result.dados.length} produto(s) com estoque negativo.`,
            },
          ]
        : [];
    const conversationId = saveCharlieTurn(
      req.dashboardSession?.user?.idusuario,
      req.body?.contexto?.conversaId,
      question,
      { ...result, sugestoes: suggestions, alertas: alerts },
      Date.now() - started,
    );
    res.json({
      ok: true,
      pergunta: question,
      ...result,
      sugestoes: suggestions,
      alertas: alerts,
      colunas: result.dados?.[0] ? Object.keys(result.dados[0]) : [],
      conversaId: conversationId,
      pergunta_interpretada: question,
      interpretador: result.intencao?.interpretador || "regras",
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
export { answer };
export default router;
