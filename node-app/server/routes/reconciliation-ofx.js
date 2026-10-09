import express from "express";
import multer from "multer";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router(),
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });
const tag = (text, name) =>
  text.match(new RegExp(`<${name}>\\s*([^<\\r\\n]+)`, "i"))?.[1]?.trim() ||
  null;
const ofxDate = (value) => {
  const raw = String(value || "").match(/\d{8}/)?.[0];
  return raw
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : null;
};
const money = (value) =>
  Math.round(
    (Number(
      String(value || "0")
        .trim()
        .replace(",", "."),
    ) || 0) * 100,
  ) / 100;
export function parseOfx(text) {
  const source = String(text || ""),
    bank =
      source.match(
        /<BANKACCTFROM>(.*?)(?:<\/BANKACCTFROM>|<BANKTRANLIST>)/is,
      )?.[1] || source,
    balance =
      source.match(/<LEDGERBAL>(.*?)(?:<\/LEDGERBAL>|<\/STMTRS>)/is)?.[1] ||
      source,
    items = [];
  for (const match of source.matchAll(
    /<STMTTRN>(.*?)(?=<STMTTRN>|<\/BANKTRANLIST>)/gis,
  )) {
    const block = match[1],
      amount = money(tag(block, "TRNAMT")),
      description =
        [tag(block, "NAME"), tag(block, "MEMO")].filter(Boolean).join(" ") ||
        "Lancamento OFX";
    items.push({
      tipo: String(tag(block, "TRNTYPE") || "").toUpperCase(),
      data: ofxDate(tag(block, "DTPOSTED")),
      valor: amount,
      fitid: String(tag(block, "FITID") || "").slice(0, 30),
      numdoc: String(
        tag(block, "CHECKNUM") || tag(block, "REFNUM") || "",
      ).slice(0, 30),
      descricao: description.slice(0, 255),
      tp_lancamento: amount >= 0 ? 0 : 1,
    });
  }
  const finalBalance = money(tag(balance, "BALAMT")),
    total =
      Math.round(items.reduce((sum, item) => sum + item.valor, 0) * 100) / 100;
  return {
    bankid: tag(bank, "BANKID"),
    agencia: tag(bank, "BRANCHID"),
    conta: tag(bank, "ACCTID"),
    dt_inicial:
      ofxDate(tag(source, "DTSTART")) ||
      items
        .map((item) => item.data)
        .filter(Boolean)
        .sort()[0] ||
      null,
    dt_final:
      ofxDate(tag(source, "DTEND")) ||
      items
        .map((item) => item.data)
        .filter(Boolean)
        .sort()
        .at(-1) ||
      null,
    saldo_inicial: Math.round((finalBalance - total) * 100) / 100,
    saldo_final: finalBalance,
    total_itens: total,
    itens: items,
  };
}
function decode(buffer) {
  for (const encoding of ["utf8", "windows-1252", "latin1"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {}
  }
  return buffer.toString("latin1");
}
const digits = (value) => String(value || "").replace(/\D/g, "");
const dbDate = (value) =>
  value instanceof Date
    ? value
    : new Date(`${String(value).slice(0, 10)}T12:00:00`);
const accountMatches = (a, b) => {
  a = digits(a);
  b = digits(b);
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
};
const rowsOf = (db, sql, params = []) =>
  db.query ? db.query(sql, params) : query(db, sql, params);
async function inferBank(db, ofx, form) {
  const selected = Number(form.cdbanco || ofx.bankid || 0) || null,
    agency = String(form.agencia || ofx.agencia || "").trim(),
    account = String(form.numconta || ofx.conta || "").trim();
  let rows = [];
  if (account || selected)
    rows = await rowsOf(
      db,
      `SELECT cc.CDBANCO,cc.AGENCIA,cc.NUMCONTA,b.BANCO FROM CONTACORRENTE cc LEFT JOIN BANCO b ON b.CDBANCO=cc.CDBANCO ${selected ? "WHERE cc.CDBANCO=?" : ""} ORDER BY cc.CDBANCO,cc.AGENCIA,cc.NUMCONTA`,
      selected ? [selected] : [],
    );
  let row =
    rows.find((item) => accountMatches(account, item.NUMCONTA)) || rows[0];
  if (!row)
    row = (
      await rowsOf(
        db,
        selected
          ? "SELECT FIRST 1 CDBANCO,AGENCIA,NUMCONTA,BANCO FROM BANCO WHERE CDBANCO=?"
          : "SELECT FIRST 1 CDBANCO,AGENCIA,NUMCONTA,BANCO FROM BANCO ORDER BY CDBANCO",
        selected ? [selected] : [],
      )
    )[0];
  return row
    ? {
        cdbanco: Number(row.CDBANCO),
        agencia: agency || row.AGENCIA,
        numconta: account || row.NUMCONTA,
        nome: row.BANCO,
      }
    : null;
}
function period(form, required = false) {
  const start = String(form.data_ini || form.dt_inicial || "").slice(0, 10),
    end = String(form.data_fim || form.dt_final || "").slice(0, 10);
  if (required && (!start || !end))
    throw Object.assign(
      new Error(
        "Informe a data inicial e a data final do extrato antes de importar.",
      ),
      { status: 400 },
    );
  if (!start || !end) return [null, null];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    start > end
  )
    throw Object.assign(
      new Error("Informe o periodo do extrato em formato valido."),
      { status: 400 },
    );
  return [start, end];
}
async function overlaps(db, bank, start, end) {
  if (!bank || !start || !end) return [];
  return rowsOf(
    db,
    "SELECT CONTROLE,CAST(DTINICIAL AS DATE) AS DT_INI,CAST(DTFINAL AS DATE) AS DT_FIM,CDBANCO,AGENCIA,NUMCONTA FROM CONCILIACAO WHERE CDBANCO=? AND COALESCE(TRIM(AGENCIA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND COALESCE(TRIM(NUMCONTA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND CAST(DTINICIAL AS DATE)<=? AND CAST(DTFINAL AS DATE)>=? ORDER BY DTINICIAL",
    [
      bank.cdbanco,
      bank.agencia || "",
      bank.numconta || "",
      dbDate(end),
      dbDate(start),
    ],
  );
}
async function suggestions(db, items, payment) {
  const result = [];
  for (const item of items) {
    const receive = item.valor >= 0,
      table = receive ? "CTARECEBER" : "CTAPAGAR",
      value = receive
        ? "COALESCE(NULLIF(VLPGLIQ,0),NULLIF(TOTALPG,0),VALOR)"
        : "COALESCE(NULLIF(VLPAGTO,0),NULLIF(TOTAL,0),VALOR)",
      rows = await query(
        db,
        `SELECT FIRST 5 CONTROLE,IDEMPRESA,${value} AS VALOR,DTVENC,NRDOC FROM ${table} WHERE MOV_BANCARIA IS NULL AND STATUS=1 AND ABS(ABS(${value})-?)<=0.01 ${payment ? "AND (CODPAGTO=? OR TPPAGTO=?)" : ""} ORDER BY ABS(CAST(DTVENC AS DATE)-CAST(? AS DATE))`,
        payment
          ? [
              Math.abs(item.valor),
              Number(payment),
              Number(payment),
              dbDate(item.data),
            ]
          : [Math.abs(item.valor), dbDate(item.data)],
      );
    result.push({
      ...item,
      sugestao:
        rows.length === 1
          ? {
              status: "unico",
              tipo: receive ? "receber" : "pagar",
              titulo: rows[0],
            }
          : rows.length
            ? {
                status: "multiplos",
                tipo: receive ? "receber" : "pagar",
                titulos: rows,
              }
            : { status: "nao_encontrado" },
    });
  }
  return result;
}
router.post("/ofx/preview", upload.single("arquivo"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ ok: false, erro: "Envie o arquivo OFX no campo arquivo" });
    const ofx = parseOfx(decode(req.file.buffer)),
      [start, end] = period(req.body),
      result = await withDatabase(async (db) => {
        const bank = await inferBank(db, ofx, req.body),
          filtered = ofx.itens.filter(
            (item) =>
              (!start || item.data >= start) && (!end || item.data <= end),
          ),
          preview = filtered.slice(0, 80),
          existing = await overlaps(db, bank, start, end);
        return {
          ofx: {
            ...ofx,
            itens: preview,
            total_itens_arquivo: ofx.itens.length,
            total_itens_periodo: filtered.length,
            limite_preview: 80,
          },
          banco: bank,
          sugestoes: await suggestions(db, preview, req.body.cdrecebto),
          periodo_alerta: existing.length
            ? {
                duplicado: true,
                erro: "Ja existe uma conciliacao importada para este banco, conta e periodo.",
                existentes: existing,
              }
            : null,
        };
      });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post("/ofx/importar", upload.single("arquivo"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ ok: false, erro: "Envie o arquivo OFX no campo arquivo" });
    const ofx = parseOfx(decode(req.file.buffer)),
      [start, end] = period(req.body, true),
      result = await withWriteTransaction(async (tx) => {
        const adapter = { query: (sql, params) => tx.query(sql, params) },
          bank = await inferBank(adapter, ofx, req.body);
        if (!bank?.cdbanco || !bank.agencia || !bank.numconta)
          throw Object.assign(
            new Error(
              "Informe banco, agencia e conta do extrato antes de importar.",
            ),
            { status: 400 },
          );
        const existing = await overlaps(adapter, bank, start, end),
          force = req.body.forcar === "1" || req.body.forcar === true;
        if (existing.length && !force)
          throw Object.assign(
            new Error(
              "Ja existe uma conciliacao importada para este banco, conta e periodo.",
            ),
            { status: 409, duplicado: true, existentes: existing },
          );
        if (
          force &&
          !(
            req.body.forcar_confirmado === "1" ||
            req.body.forcar_confirmado === true
          )
        )
          throw Object.assign(
            new Error(
              "Confirme explicitamente a importacao forcada antes de continuar.",
            ),
            { status: 400 },
          );
        const company = Number(req.body.idempresa || 1),
          uid = Number(req.body.idusuario || 1),
          filename = String(req.file.originalname || "extrato.ofx").slice(
            0,
            255,
          ),
          nextConc = await tx.singleton(
            "SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM CONCILIACAO",
          ),
          conc = Number(nextConc.ID),
          insertedConc = await tx.query(
            "INSERT INTO CONCILIACAO (CONTROLE,CDBANCO,AGENCIA,NUMCONTA,IDEMPRESA,IDUSUARIO,DESCRICAO,DTINICIAL,DTFINAL,SALDOINICIAL,SALDOFINAL,STATUS,SIST_ALT) VALUES (?,?,?,?,?,?,?, ?,?,?,?,0,'LOCAL') RETURNING CONTROLE",
            [
              conc,
              bank.cdbanco,
              bank.agencia,
              bank.numconta,
              company,
              uid,
              `Importacao OFX ${filename}`.slice(0, 255),
              dbDate(start),
              dbDate(end),
              ofx.saldo_inicial,
              ofx.saldo_final,
            ],
          ),
          nextExt = await tx.singleton(
            "SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM EXTRATO",
          ),
          ext = Number(nextExt.ID);
        await tx.execute(
          "INSERT INTO EXTRATO (CONTROLE,CONCILIACAO,IDUSUARIO,IDEMPRESA,NUMCONTA,DESCRICAO,DTINICIAL,DTFINAL,SALDOINICIAL,SALDOFINAL,STATUS,NUMARQUIVO,NOMEARQUIVO,TPDADOS,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,0,1,?,0,'LOCAL')",
          [
            ext,
            Number(insertedConc[0]?.CONTROLE || conc),
            uid,
            company,
            bank.numconta,
            `${bank.nome || bank.cdbanco} - AG.: ${bank.agencia}`.slice(0, 255),
            dbDate(start),
            dbDate(end),
            ofx.saldo_inicial,
            ofx.saldo_final,
            filename,
          ],
        );
        let nextItem = Number(
            (
              await tx.singleton(
                "SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM EXTRATO_ITEM",
              )
            ).ID,
          ),
          inserted = 0;
        for (const item of ofx.itens.filter(
          (item) => item.data && item.data >= start && item.data <= end,
        )) {
          await tx.execute(
            "INSERT INTO EXTRATO_ITEM (CONTROLE,EXTRATO,DTLANCAMENTO,VALOR,DESCRICAO,TPLANCAMENTO,NUMDOC,STATUS,STATUS_EXT,SIST_ALT) VALUES (?,?,?,?,?,?,?,0,1,'LOCAL')",
            [
              nextItem++,
              ext,
              dbDate(item.data),
              item.valor,
              item.descricao,
              item.tp_lancamento,
              item.numdoc || item.fitid,
            ],
          );
          inserted++;
        }
        return {
          conciliacao: conc,
          extrato: ext,
          inseridos: inserted,
          associados: 0,
          erros_associacao: 0,
          banco: bank,
        };
      });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({
      ok: false,
      duplicado: error.duplicado || false,
      existentes: error.existentes || undefined,
      erro: error.message,
    });
  }
});

export default router;
