import express from "express";
import multer from "multer";
import { withDatabase, withWriteTransaction, query } from "../db.js";
import { readJsonConfig } from "../lib/json-config.js";

const router = express.Router(),
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
  });
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
function csvRows(text) {
  const lines = String(text)
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(Boolean),
    delimiter =
      (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length
        ? ";"
        : ",",
    parse = (line) => {
      const values = [];
      let value = "",
        quoted = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && quoted && line[i + 1] === '"') {
          value += '"';
          i++;
        } else if (char === '"') quoted = !quoted;
        else if (char === delimiter && !quoted) {
          values.push(value.trim());
          value = "";
        } else value += char;
      }
      values.push(value.trim());
      return values;
    },
    headers = parse(lines.shift());
  return lines.map((line) =>
    Object.fromEntries(
      headers.map((header, index) => [
        normalize(header),
        parse(line)[index] || "",
      ]),
    ),
  );
}
const field = (row, ...names) => {
    for (const name of names) {
      const value = row[normalize(name)];
      if (value !== undefined && value !== "") return value;
    }
    return "";
  },
  money = (value) => {
    const raw = String(value || "")
      .replace(/R\$\s?/gi, "")
      .trim();
    return (
      Math.round(
        (Number(
          raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw,
        ) || 0) * 100,
      ) / 100
    );
  },
  date = (value) => {
    const match = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return match
      ? `${match[3]}-${match[2]}-${match[1]}`
      : String(value || "").slice(0, 10) || null;
  };
export function parseCardCsv(text, acquirer = "pagbank") {
  const result = [];
  for (const row of csvRows(text)) {
    const status = field(
      row,
      "Status",
      "Status da transação",
      "Status do pagamento da venda",
    );
    if (status && !/(APROV|PAGA|PAGO|CONFIRM)/i.test(status)) continue;
    const gross = money(
        field(
          row,
          "Valor bruto da transação",
          "Valor bruto da parcela",
          "Valor bruto",
          "Valor da venda",
          "Valor venda",
        ),
      ),
      fee = money(
        field(row, "Valor da taxa (MDR)", "Valor da taxa", "Taxa", "MDR"),
      ),
      net = money(
        field(
          row,
          "Valor líquido da parcela/transação",
          "Valor liquido da parcela/transacao",
          "Valor líquido",
          "Valor liquido",
        ),
      );
    if (!gross && !net) continue;
    const actualGross = gross || Math.round((net + fee) * 100) / 100,
      actualNet = net || Math.round((gross - fee) * 100) / 100,
      saleDate = date(
        field(
          row,
          "Data da venda",
          "Data",
          "Data da transação",
          "Data transacao",
        ),
      ),
      payDate = date(
        field(
          row,
          "Data efetiva do pagamento da venda",
          "Data prevista de pagamento da venda",
          "Data pagamento",
        ),
      );
    result.push({
      adquirente: acquirer,
      data: saleDate || payDate,
      data_venda: saleDate,
      data_pagamento: payDate,
      bandeira: field(row, "Bandeira"),
      forma_pagamento:
        field(row, "Produto", "Forma de pagamento", "Modalidade") ||
        field(row, "Tipo de cartão", "Tipo cartao"),
      parcela: field(row, "Parcelas", "Parcela").replace(/^[-0]$/, "") || "",
      valor_bruto: actualGross,
      valor_taxa: fee,
      valor_liquido: actualNet,
      taxa_pct: actualGross ? Math.round((fee / actualGross) * 10000) / 100 : 0,
      nsu: field(row, "Comprovante de venda", "NSU", "NSU da transação"),
      autorizacao: field(
        row,
        "Código de autorização",
        "Codigo de autorizacao",
        "Autorização",
      ),
      num_cartao: field(
        row,
        "Número do cartão",
        "Numero do cartao",
        "Cartão",
        "Cartao",
      ),
      pedido: field(row, "Código do pedido", "Codigo do pedido", "Pedido"),
      codigo_pagamento: field(
        row,
        "Código de pagamento",
        "Codigo de pagamento",
      ),
    });
  }
  return result;
}
async function ensureSchema(tx) {
  if (
    !(await tx.singleton(
      "SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME)='GEN_CONCILIACAOCARTAO_ID'",
    ))
  )
    await tx.execute("CREATE SEQUENCE GEN_CONCILIACAOCARTAO_ID");
  if (
    !(await tx.singleton(
      "SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME)='GEN_CONCILIACAOCARTAO_LOTE'",
    ))
  )
    await tx.execute("CREATE SEQUENCE GEN_CONCILIACAOCARTAO_LOTE");
  if (
    !(await tx.singleton(
      "SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)='CONCILIACAOCARTAO'",
    ))
  )
    await tx.execute(
      "CREATE TABLE CONCILIACAOCARTAO (ID BIGINT NOT NULL PRIMARY KEY,IDCARTAO BIGINT,IDEMPRESA INTEGER,CONTROLE_CTA INTEGER,VALOR_BRUTO NUMERIC(18,2),VALOR_TAXA NUMERIC(18,2),VALOR_LIQUIDO NUMERIC(18,2),RETENCAO_ANTERIOR NUMERIC(18,2),RETENCAO_NOVA NUMERIC(18,2),BANDEIRA VARCHAR(50),FORMA_PAGAMENTO VARCHAR(50),PARCELA VARCHAR(20),DTCONCILIACAO DATE,NSU VARCHAR(50),AUTORIZACAO VARCHAR(50),NUM_CARTAO VARCHAR(30),STATUS VARCHAR(20))",
    );
}
router.post("/cartao/preview", upload.single("arquivo"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ ok: false, erro: "Envie o CSV no campo arquivo" });
    const acquirer = String(
        req.body?.adquirente || req.body?.origem || "pagbank",
      )
        .trim()
        .toLowerCase(),
      transactions = parseCardCsv(req.file.buffer.toString("utf8"), acquirer);
    if (!transactions.length)
      return res.status(400).json({
        ok: false,
        erro: "Nenhuma transacao de cartao encontrada no CSV.",
      });
    const mappings =
        readJsonConfig("cartao_depara.json", { mapeamentos: {} }).mapeamentos ||
        {},
      analyzed = await withDatabase(async (db) => {
        const list = [];
        for (const tx of transactions) {
          const start = new Date(`${tx.data}T12:00:00`),
            end = new Date(start);
          start.setDate(start.getDate() - 7);
          end.setDate(end.getDate() + 7);
          const params = [tx.valor_bruto, start, end],
            order = tx.pedido
              ? "CASE WHEN TRIM(COALESCE(CAST(t.NRPEDIDO AS VARCHAR(30)),t.NRDOC,''))=? THEN 0 ELSE 1 END,"
              : "";
          if (tx.pedido) params.push(tx.pedido);
          const candidates = await query(
            db,
            `SELECT FIRST 20 t.CONTROLE,t.IDEMPRESA,COALESCE(NULLIF(t.VLPGLIQ,0),NULLIF(t.TOTALPG,0),t.VALOR) AS VALOR,t.CODPAGTO,r.RECEBTO AS FORMA_PAGAMENTO,COALESCE(t.RETENCAO,0) AS RETENCAO FROM CTARECEBER t LEFT JOIN RECEBTO r ON r.CDRECEBTO=t.CODPAGTO WHERE t.MOV_BANCARIA IS NULL AND ABS(COALESCE(NULLIF(t.VLPGLIQ,0),NULLIF(t.TOTALPG,0),t.VALOR)-?)<=0.01 AND CAST(t.DTVENC AS DATE) BETWEEN ? AND ? ORDER BY ${order} t.DTVENC`,
            params,
          );
          const selected = candidates.length === 1 ? candidates : [],
            key = [tx.adquirente, tx.forma_pagamento, tx.bandeira, tx.parcela]
              .map(normalize)
              .join("|"),
            mapped = mappings[key] || {},
            system = selected[0];
          list.push({
            ...tx,
            ctareceber: system || null,
            ctareceber_lista: selected,
            match: Boolean(selected.length),
            retencao_sistema:
              selected.reduce(
                (sum, item) => sum + Number(item.RETENCAO || 0),
                0,
              ) ||
              system?.RETENCAO ||
              null,
            diferenca_taxa: system
              ? Math.round(
                  (tx.valor_taxa - Number(system.RETENCAO || 0)) * 100,
                ) / 100
              : null,
            forma_diverge: Boolean(
              mapped.cdrecebto &&
              system?.CODPAGTO &&
              String(mapped.cdrecebto) !== String(system.CODPAGTO),
            ),
            cdrecebto_sugerido: mapped.cdrecebto || null,
            recebto_sugerido: mapped.descricao || "",
            forma_pagamento_sistema: system?.FORMA_PAGAMENTO || "",
          });
        }
        return list;
      });
    res.json({
      ok: true,
      adquirente: acquirer,
      transacoes: analyzed,
      totais: {
        qtd: analyzed.length,
        qtd_matched: analyzed.filter((tx) => tx.match).length,
        qtd_sem_match: analyzed.filter((tx) => !tx.match).length,
        qtd_forma_diverge: analyzed.filter((tx) => tx.forma_diverge).length,
        total_bruto:
          Math.round(analyzed.reduce((s, tx) => s + tx.valor_bruto, 0) * 100) /
          100,
        total_taxa:
          Math.round(analyzed.reduce((s, tx) => s + tx.valor_taxa, 0) * 100) /
          100,
        total_liquido:
          Math.round(
            analyzed.reduce((s, tx) => s + tx.valor_liquido, 0) * 100,
          ) / 100,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post("/cartao/aprovar", async (req, res) => {
  const items = req.body?.itens || [];
  if (!items.length)
    return res
      .status(400)
      .json({ ok: false, erro: "Envie itens para aprovar" });
  try {
    const result = await withWriteTransaction(async (tx) => {
      await ensureSchema(tx);
      const batch = Number(
          (
            await tx.singleton(
              "SELECT NEXT VALUE FOR GEN_CONCILIACAOCARTAO_LOTE AS ID FROM RDB$DATABASE",
            )
          ).ID,
        ),
        approved = [],
        errors = [];
      for (const item of items) {
        try {
          const control = Number(item.controle),
            company = Number(item.idempresa || 1),
            card = item.tx || {},
            fee = Number(item.taxa_pagbank ?? card.valor_taxa ?? 0),
            gross = Number(card.valor_bruto || 0),
            net = Number(card.valor_liquido || gross - fee),
            previous = await tx.singleton(
              "SELECT COALESCE(RETENCAO,0) AS RETENCAO FROM CTARECEBER WHERE CONTROLE=? AND IDEMPRESA=?",
              [control, company],
            );
          if (!previous) throw new Error("Titulo nao encontrado.");
          const correct = Number(
            item.cdrecebto_correto || card.cdrecebto_correto || 0,
          );
          if (correct)
            await tx.execute(
              "UPDATE CTARECEBER SET CODPAGTO=? WHERE CONTROLE=? AND IDEMPRESA=?",
              [correct, control, company],
            );
          const id = Number(
            (
              await tx.singleton(
                "SELECT NEXT VALUE FOR GEN_CONCILIACAOCARTAO_ID AS ID FROM RDB$DATABASE",
              )
            ).ID,
          );
          await tx.execute(
            "INSERT INTO CONCILIACAOCARTAO (ID,IDCARTAO,IDEMPRESA,CONTROLE_CTA,VALOR_BRUTO,VALOR_TAXA,VALOR_LIQUIDO,RETENCAO_ANTERIOR,RETENCAO_NOVA,BANDEIRA,FORMA_PAGAMENTO,PARCELA,DTCONCILIACAO,NSU,AUTORIZACAO,NUM_CARTAO,STATUS) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'APROVADO')",
            [
              id,
              batch,
              company,
              control,
              gross,
              fee,
              net,
              previous.RETENCAO,
              Number(card.retencao_sistema || fee),
              String(card.bandeira || "").slice(0, 50),
              String(card.forma_pagamento || "").slice(0, 50),
              String(card.parcela || 1),
              card.data || null,
              String(card.nsu || "").slice(0, 50),
              String(card.autorizacao || "").slice(0, 50),
              String(card.num_cartao || "").slice(0, 30),
            ],
          );
          await tx.execute(
            "UPDATE CTARECEBER SET RETENCAO=?,VLPGLIQ=? WHERE CONTROLE=? AND IDEMPRESA=?",
            [Number(card.retencao_sistema || fee), net, control, company],
          );
          approved.push({
            controle: control,
            idempresa: company,
            forma_corrigida: Boolean(correct),
          });
        } catch (error) {
          errors.push({ controle: item.controle, erro: error.message });
        }
      }
      return {
        aprovados: approved.length,
        erros: errors.length,
        detalhe_aprovados: approved,
        detalhe_erros: errors,
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
export default router;
