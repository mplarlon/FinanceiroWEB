import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";
import { readJsonConfig, writeJsonConfig } from "../lib/json-config.js";
import { suggestForItems } from "../lib/reconciliation-match.js";

const router = express.Router();
const run = (fn) => async (req, res) => {
  try {
    res.json(await withDatabase((db) => fn(db, req)));
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
};

router.get(
  "/formas-pagamento",
  run(async (db) => ({
    ok: true,
    dados: await query(
      db,
      `SELECT
  r.CDRECEBTO,r.RECEBTO,r.TPRECEBTO,r.CDGRUPO,gr.GRUPO,r.CCUSTO,r.INATIVO
  FROM RECEBTO r LEFT JOIN GRUPORECEBTO gr ON gr.CDGRUPO=r.CDGRUPO
  WHERE r.INATIVO IS NULL OR r.INATIVO=0 ORDER BY r.RECEBTO`,
    ),
  })),
);

router.get(
  "/centros-custo",
  run(async (db) => ({
    ok: true,
    dados: await query(
      db,
      "SELECT CCUSTO,CENTROCUSTO FROM CENTROCUSTO ORDER BY CENTROCUSTO",
    ),
  })),
);

router.get(
  "/contas-bancarias",
  run(async (db) => ({
    ok: true,
    dados: await query(
      db,
      `SELECT DISTINCT
  CDBANCO,BANCO,AGENCIA,NUMCONTA FROM (
    SELECT cc.CDBANCO,b.BANCO,cc.AGENCIA,cc.NUMCONTA
    FROM CONTACORRENTE cc LEFT JOIN BANCO b ON b.CDBANCO=cc.CDBANCO
    UNION SELECT b.CDBANCO,b.BANCO,b.AGENCIA,b.NUMCONTA FROM BANCO b)
  WHERE CDBANCO IS NOT NULL AND AGENCIA IS NOT NULL AND NUMCONTA IS NOT NULL
  ORDER BY CDBANCO,AGENCIA,NUMCONTA`,
    ),
  })),
);

router.get(
  "/plano-contas",
  run(async (db) => {
    const contas = await query(
      db,
      "SELECT CDCONTA,CONTA FROM CONTAS ORDER BY CONTA",
    );
    const subcontas = await query(
      db,
      "SELECT CDSUBCONTA,CDCONTA,SUBCONTA FROM SUBCONTAS ORDER BY CDCONTA,SUBCONTA",
    );
    const subsubcontas = await query(
      db,
      "SELECT CDSUBSUBCONTA,CDSUBCONTA,CDCONTA,SUBSUBCONTA FROM SUBSUBCONTAS ORDER BY CDCONTA,CDSUBCONTA,SUBSUBCONTA",
    );
    const subsubsubcontas = await query(
      db,
      "SELECT CDSUBSUBSUBCONTA,CDSUBSUBCONTA,CDSUBCONTA,CDCONTA,SUBSUBSUBCONTA FROM SUBSUBSUBCONTAS ORDER BY CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,SUBSUBSUBCONTA",
    );
    return { ok: true, contas, subcontas, subsubcontas, subsubsubcontas };
  }),
);

router.get(
  "/pessoas",
  run(async (db, req) => {
    const tipo = String(req.query.tipo || "receber").toLowerCase();
    const receiving = tipo === "receber";
    const table = receiving ? "CLIENTE" : "FORNECEDOR";
    const pk = receiving ? "CDCLIENTE" : "CDFORNECEDOR";
    const name = receiving ? "CLIENTE" : "FORNECEDOR";
    const limit = Math.max(1, Math.min(100, Number(req.query.limite || 50)));
    const q = String(req.query.q || "").trim();
    const fieldRows = await query(
      db,
      `SELECT TRIM(RDB$FIELD_NAME) AS NOME FROM RDB$RELATION_FIELDS
    WHERE TRIM(RDB$RELATION_NAME)=?`,
      [table],
    );
    const fields = new Set(fieldRows.map((row) => row.NOME));
    const docColumn = [
      "CGC",
      "CPF",
      "CNPJ",
      "CPFCNPJ",
      "CPF_CNPJ",
      "CGCCPF",
    ].find((column) => fields.has(column));
    const docExpr = docColumn ? `p.${docColumn}` : "CAST(NULL AS VARCHAR(20))";
    const where = [`p.${name} IS NOT NULL`],
      params = [];
    if (q) {
      const digits = q.replace(/\D/g, "");
      if (digits && docColumn) {
        where.push(
          `(UPPER(p.${name}) CONTAINING UPPER(?) OR CAST(${docExpr} AS VARCHAR(30)) CONTAINING ?)`,
        );
        params.push(q, digits);
      } else {
        where.push(`UPPER(p.${name}) CONTAINING UPPER(?)`);
        params.push(q);
      }
    }
    const dados = await query(
      db,
      `SELECT FIRST ${limit} p.${pk} AS ID,p.${name} AS NOME,${docExpr} AS CPFCNPJ
    FROM ${table} p WHERE ${where.join(" AND ")} ORDER BY p.${name}`,
      params,
    );
    return { ok: true, dados };
  }),
);

async function tableExists(db, table) {
  return Boolean(
    (
      await query(
        db,
        `SELECT 1 AS OK FROM RDB$RELATIONS
    WHERE TRIM(RDB$RELATION_NAME)=? AND COALESCE(RDB$SYSTEM_FLAG,0)=0`,
        [table],
      )
    )[0],
  );
}

router.get(
  "/cartao/lotes",
  run(async (db) => {
    if (!(await tableExists(db, "CONCILIACAOCARTAO")))
      return { ok: true, dados: [] };
    const dados = await query(
      db,
      `SELECT FIRST 100 IDCARTAO,
    MIN(CAST(DTCONCILIACAO AS DATE)) AS DATA_INICIAL,
    MAX(CAST(DTCONCILIACAO AS DATE)) AS DATA_FINAL,COUNT(*) AS QTD_REGISTROS,
    SUM(VALOR_BRUTO) AS TOTAL_BRUTO,SUM(VALOR_TAXA) AS TOTAL_TAXA,
    SUM(VALOR_LIQUIDO) AS TOTAL_LIQUIDO,SUM(VALOR_LIQUIDO) AS TOTAL_REPASSE
    FROM CONCILIACAOCARTAO WHERE IDCARTAO IS NOT NULL GROUP BY IDCARTAO ORDER BY IDCARTAO DESC`,
    );
    return { ok: true, dados };
  }),
);

router.get(
  "/cartao/historico",
  run(async (db, req) => {
    const numero = String(req.query.num_cartao || "").trim();
    if (!numero || !(await tableExists(db, "CONCILIACAOCARTAO")))
      return { ok: true, resumo: [] };
    const resumo = await query(
      db,
      `SELECT FIRST 20 c.CDCLIENTE,c.CLIENTE,cr.NRPEDIDO,cr.NRDOC,cr.NRDOC2,
    MAX(cc.DTCONCILIACAO) AS ULTIMA_DATA,MAX(cr.CONTROLE) AS ULTIMO_CONTROLE,
    MAX(cc.VALOR_BRUTO) AS VALOR_ULTIMO,COUNT(*) AS QTD FROM CONCILIACAOCARTAO cc
    JOIN CTARECEBER cr ON cr.CONTROLE=cc.CONTROLE_CTA AND (cr.IDEMPRESA=cc.IDEMPRESA OR cc.IDEMPRESA IS NULL)
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=cr.CDCLIENTE WHERE cc.NUM_CARTAO=?
    GROUP BY c.CDCLIENTE,c.CLIENTE,cr.NRPEDIDO,cr.NRDOC,cr.NRDOC2
    ORDER BY MAX(cc.DTCONCILIACAO) DESC`,
      [numero],
    );
    return { ok: true, resumo };
  }),
);

router.get(
  "/itens-pendentes",
  run(async (db, req) => {
    const where = ["ei.MOV_BANCARIO IS NULL"],
      params = [];
    const dataIni = String(req.query.data_ini || "").trim(),
      dataFim = String(req.query.data_fim || "").trim();
    const banco = Number(req.query.cdbanco || 0),
      conta = String(req.query.numconta || "").trim();
    const texto = String(req.query.texto || "").trim();
    const limite = Math.max(1, Math.min(1000, Number(req.query.limite || 200)));
    if (dataIni && dataFim) {
      where.push("CAST(ei.DTLANCAMENTO AS DATE) BETWEEN ? AND ?");
      params.push(
        new Date(`${dataIni.slice(0, 10)}T12:00:00`),
        new Date(`${dataFim.slice(0, 10)}T12:00:00`),
      );
    }
    if (banco) {
      where.push("c.CDBANCO=?");
      params.push(banco);
    }
    if (conta) {
      where.push("UPPER(e.NUMCONTA) CONTAINING UPPER(?)");
      params.push(conta);
    }
    if (texto) {
      where.push("UPPER(ei.DESCRICAO) CONTAINING UPPER(?)");
      params.push(texto);
    }
    const dados = await query(
      db,
      `SELECT FIRST ${limite} ei.CONTROLE AS EXTRATO_ITEM,ei.EXTRATO,
    ei.DTLANCAMENTO AS DATA,ei.VALOR,ei.TPLANCAMENTO AS TIPO_LANCAMENTO,
    ei.DESCRICAO AS HISTORICO,e.NUMCONTA,c.CDBANCO FROM EXTRATO_ITEM ei
    JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO
    WHERE ${where.join(" AND ")} ORDER BY ei.DTLANCAMENTO DESC`,
      params,
    );
    const transferPattern =
      /TRANSF|PIX\s*(REM|DES|ENV|RECEB|CRED|DEB)|TED\b|APLICAC|RESGATE|ENTRE\s+CONTAS/i;
    return {
      ok: true,
      dados: dados.map((item) => ({
        ...item,
        EH_TRANSFERENCIA: transferPattern.test(String(item.HISTORICO || "")),
      })),
    };
  }),
);

router.get(
  "/titulos",
  run(async (db, req) => {
    const type =
        String(req.query.tipo || "receber").toLowerCase() === "pagar"
          ? "pagar"
          : "receber",
      receive = type === "receber",
      table = receive ? "CTARECEBER" : "CTAPAGAR",
      personTable = receive ? "CLIENTE" : "FORNECEDOR",
      personPk = receive ? "CDCLIENTE" : "CDFORNECEDOR",
      personName = receive ? "CLIENTE" : "FORNECEDOR",
      documentColumn = receive ? "NRPEDIDO" : "NOTAFISCAL",
      value = receive
        ? "COALESCE(t.VALOR,t.DIVIDA,0)"
        : "COALESCE(t.VALOR,t.TOTAL,0)",
      where = ["t.DTVENC IS NOT NULL"],
      params = [],
      limit = Math.max(1, Math.min(Number(req.query.limite || 300), 300)),
      cardId = Number(
        req.query.cartao_id || req.query.conciliacaocartao_id || 0,
      ),
      document = String(req.query.documento || "").trim();
    if (!document && !cardId) where.push("t.MOV_BANCARIA IS NULL");
    const start = String(req.query.data_ini || "").slice(0, 10),
      end = String(req.query.data_fim || "").slice(0, 10),
      date = String(req.query.data || "").slice(0, 10),
      tolerance = Math.max(0, Number(req.query.tolerancia_dias || 0));
    if (!cardId && start && end) {
      where.push("CAST(t.DTVENC AS DATE) BETWEEN ? AND ?");
      params.push(new Date(`${start}T12:00:00`), new Date(`${end}T12:00:00`));
    } else if (!cardId && date) {
      const base = new Date(`${date}T12:00:00`),
        a = new Date(base),
        b = new Date(base);
      a.setDate(a.getDate() - tolerance);
      b.setDate(b.getDate() + tolerance);
      where.push("CAST(t.DTVENC AS DATE) BETWEEN ? AND ?");
      params.push(a, b);
    }
    if (
      req.query.ignorar_valor !== "1" &&
      req.query.valor !== undefined &&
      req.query.valor !== ""
    ) {
      const amount = Math.abs(Number(req.query.valor)),
        margin = Math.max(Math.round(amount * 0.001 * 100) / 100, 0.01);
      where.push(`ABS(${value}) BETWEEN ? AND ?`);
      params.push(
        Math.round((amount - margin) * 100) / 100,
        Math.round((amount + margin) * 100) / 100,
      );
    }
    const payment = Number(req.query.cdrecebto || 0);
    if (payment) {
      where.push("(t.CODPAGTO=? OR t.TPPAGTO=?)");
      params.push(payment, payment);
    }
    const personId = Number(req.query.pessoa_id || 0),
      person = String(req.query.pessoa || "").trim();
    if (personId) {
      where.push(`t.${personPk}=?`);
      params.push(personId);
    } else if (person) {
      where.push(`UPPER(p.${personName}) CONTAINING UPPER(?)`);
      params.push(person);
    }
    if (document) {
      where.push(
        "(UPPER(TRIM(COALESCE(t.NRDOC,''))) CONTAINING UPPER(?) OR UPPER(TRIM(COALESCE(t.NRDOC2,''))) CONTAINING UPPER(?)" +
          (receive
            ? " OR UPPER(TRIM(COALESCE(t.NOSSONUMERO,''))) CONTAINING UPPER(?)"
            : "") +
          ")",
      );
      params.push(document, document, ...(receive ? [document] : []));
    }
    let cardJoin = "",
      cardFields =
        ",NULL AS CONCILIACAOCARTAO_ID,NULL AS IDCARTAO,NULL AS CARTAO_BANDEIRA,NULL AS CARTAO_TAXA,NULL AS CARTAO_VALOR_LIQUIDO,NULL AS CARTAO_RETENCAO,NULL AS CARTAO_STATUS";
    if (receive && (await tableExists(db, "CONCILIACAOCARTAO"))) {
      cardJoin = `${cardId ? "JOIN" : "LEFT JOIN"} CONCILIACAOCARTAO cc ON cc.CONTROLE_CTA=t.CONTROLE AND (cc.IDEMPRESA=t.IDEMPRESA OR cc.IDEMPRESA IS NULL)`;
      cardFields =
        ",cc.ID AS CONCILIACAOCARTAO_ID,cc.IDCARTAO,cc.BANDEIRA AS CARTAO_BANDEIRA,cc.VALOR_TAXA AS CARTAO_TAXA,cc.VALOR_LIQUIDO AS CARTAO_VALOR_LIQUIDO,COALESCE(cc.RETENCAO_NOVA,cc.VALOR_TAXA) AS CARTAO_RETENCAO,cc.STATUS AS CARTAO_STATUS";
      if (cardId) {
        where.push("(cc.IDCARTAO=? OR cc.ID=?)");
        params.push(cardId, cardId);
      }
    }
    const dados = await query(
      db,
      `SELECT FIRST ${limit} CAST('${type}' AS VARCHAR(10)) AS TIPO,t.CONTROLE,t.IDEMPRESA,t.${documentColumn} AS DOCUMENTO,CAST(t.DTVENC AS DATE) AS DTMOV,${value} AS VALOR,t.CODPAGTO,r.RECEBTO AS FORMA_PAGAMENTO,p.${personName} AS PESSOA,p.CGC AS PESSOA_CPFCNPJ,t.MOV_BANCARIA,t.NRDOC,t.NRDOC2${receive ? ",t.NOSSONUMERO,t.RETENCAO" : ""}${cardFields} FROM ${table} t LEFT JOIN RECEBTO r ON r.CDRECEBTO=t.CODPAGTO LEFT JOIN ${personTable} p ON p.${personPk}=t.${personPk} ${cardJoin} WHERE ${where.join(" AND ")} ORDER BY CAST(t.DTVENC AS DATE) DESC,ABS(${value}) DESC`,
      params,
    );
    return { ok: true, dados };
  }),
);

router.get(
  "/listar-periodos",
  run(async (db, req) => {
    const banco = Number(req.query.cdbanco || 0),
      status = String(req.query.status || "abertos").toLowerCase();
    const where = banco ? "WHERE c.CDBANCO=?" : "";
    let dados = await query(
      db,
      `SELECT c.CONTROLE,c.CDBANCO,b.BANCO AS NOME_BANCO,c.AGENCIA,c.NUMCONTA,
    c.DTINICIAL,c.DTFINAL,
    COUNT(i.CONTROLE) AS TOTAL_ITENS,SUM(CASE WHEN i.MOV_BANCARIO IS NOT NULL THEN 1 ELSE 0 END) AS ITENS_CONCILIADOS
    FROM CONCILIACAO c LEFT JOIN BANCO b ON b.CDBANCO=c.CDBANCO
    LEFT JOIN EXTRATO e ON e.CONCILIACAO=c.CONTROLE LEFT JOIN EXTRATO_ITEM i ON i.EXTRATO=e.CONTROLE
    ${where} GROUP BY c.CONTROLE,c.CDBANCO,b.BANCO,c.AGENCIA,c.NUMCONTA,
    c.DTINICIAL,c.DTFINAL
    ORDER BY c.DTINICIAL DESC,c.CONTROLE DESC`,
      banco ? [banco] : [],
    );
    if (status === "finalizados")
      dados = dados.filter(
        (row) =>
          Number(row.TOTAL_ITENS) > 0 &&
          Number(row.ITENS_CONCILIADOS) >= Number(row.TOTAL_ITENS),
      );
    else if (["abertos", "pendentes", "nao_finalizados"].includes(status))
      dados = dados.filter(
        (row) =>
          !Number(row.TOTAL_ITENS) ||
          Number(row.ITENS_CONCILIADOS) < Number(row.TOTAL_ITENS),
      );
    return { ok: true, dados };
  }),
);

router.get("/periodo/:controle", async (req, res) => {
  const controle = Number(req.params.controle);
  if (!controle)
    return res
      .status(400)
      .json({ ok: false, erro: "Informe o período da conciliação." });
  try {
    const detail = await withDatabase(async (db) => {
      const periodo = (
        await query(
          db,
          `SELECT c.CONTROLE, c.CDBANCO, b.BANCO AS NOME_BANCO, c.AGENCIA, c.NUMCONTA,
                  CAST(c.DTINICIAL AS DATE) AS DTINICIAL, CAST(c.DTFINAL AS DATE) AS DTFINAL,
                  c.SALDOINICIAL, c.SALDOFINAL
           FROM CONCILIACAO c LEFT JOIN BANCO b ON b.CDBANCO=c.CDBANCO
           WHERE c.CONTROLE=?`,
          [controle],
        )
      )[0];
      if (!periodo) return null;
      const rows = await query(
        db,
        `SELECT ei.CONTROLE AS EXTRATO_ITEM, CAST(ei.DTLANCAMENTO AS DATE) AS DATA,
                ei.VALOR, ei.DESCRICAO AS HISTORICO, ei.MOV_BANCARIO
         FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO
         WHERE e.CONCILIACAO=?
         ORDER BY ei.DTLANCAMENTO, ei.CONTROLE`,
        [controle],
      );
      const receber = await query(
        db,
        `SELECT t.CONTROLE, t.IDEMPRESA,
                COALESCE(NULLIF(t.VLPGLIQ,0), NULLIF(t.TOTALPG,0), t.VALOR) AS VALOR,
                CAST(t.DTVENC AS DATE) AS DTVENC, TRIM(t.NRDOC) AS NRDOC, t.PARCELA,
                TRIM(COALESCE(c.RAZAO, c.CLIENTE)) AS PESSOA
         FROM CTARECEBER t LEFT JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE
         WHERE t.MOV_BANCARIA IS NULL AND t.STATUS=1`,
      );
      const pagar = await query(
        db,
        `SELECT t.CONTROLE, t.IDEMPRESA,
                COALESCE(NULLIF(t.VLPAGTO,0), NULLIF(t.TOTAL,0), t.VALOR) AS VALOR,
                CAST(t.DTVENC AS DATE) AS DTVENC, TRIM(t.NRDOC) AS NRDOC, t.PARCELA,
                TRIM(f.FORNECEDOR) AS PESSOA
         FROM CTAPAGAR t LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=t.CDFORNECEDOR
         WHERE t.MOV_BANCARIA IS NULL AND t.STATUS=1`,
      );
      const itens = suggestForItems(
        rows.map((row) => ({
          extrato_item: Number(row.EXTRATO_ITEM),
          data: row.DATA,
          valor: Number(row.VALOR) || 0,
          historico: row.HISTORICO ? String(row.HISTORICO).trim() : "",
          conciliado: row.MOV_BANCARIO != null,
        })),
        [...receber, ...pagar].map((row, index) => ({
          tipo: index < receber.length ? "receber" : "pagar",
          controle: Number(row.CONTROLE),
          idempresa: Number(row.IDEMPRESA),
          valor: Number(row.VALOR) || 0,
          dtvenc: row.DTVENC,
          nrdoc: row.NRDOC ? String(row.NRDOC).trim() : "",
          parcela: row.PARCELA == null ? null : Number(row.PARCELA),
          pessoa: row.PESSOA ? String(row.PESSOA).trim() : "",
        })),
      );
      return {
        periodo: {
          controle: Number(periodo.CONTROLE),
          banco: periodo.NOME_BANCO || `Banco ${periodo.CDBANCO}`,
          agencia: periodo.AGENCIA,
          numconta: periodo.NUMCONTA,
          dtinicial: periodo.DTINICIAL,
          dtfinal: periodo.DTFINAL,
          saldo_inicial: Number(periodo.SALDOINICIAL) || 0,
          saldo_final: Number(periodo.SALDOFINAL) || 0,
          total_itens: itens.length,
          conciliados: itens.filter((item) => item.conciliado).length,
          sugestoes_unicas: itens.filter((item) => item.sugestao.status === "unico").length,
        },
        itens,
      };
    });
    if (!detail)
      return res.status(404).json({ ok: false, erro: "Período não encontrado." });
    res.json({ ok: true, ...detail });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

router.get(
  "/ultima-data-por-banco",
  run(async (db) => ({
    ok: true,
    dados: await query(
      db,
      `SELECT
  c.CDBANCO,b.BANCO,c.AGENCIA,c.NUMCONTA,MAX(c.DTFINAL) AS ULTIMA_DATA
  FROM CONCILIACAO c LEFT JOIN BANCO b ON b.CDBANCO=c.CDBANCO
  GROUP BY c.CDBANCO,b.BANCO,c.AGENCIA,c.NUMCONTA ORDER BY ULTIMA_DATA DESC NULLS LAST`,
    ),
  })),
);

router.post("/deletar-periodo", async (req, res) => {
  const control = Number(req.body?.controle);
  if (!control)
    return res
      .status(400)
      .json({ ok: false, erro: "Informe o controle do periodo" });
  if (req.body?.confirmado !== true)
    return res
      .status(400)
      .json({ ok: false, erro: "Confirmacao nao recebida" });
  try {
    const result = await withWriteTransaction(async (tx) => {
      const period = await tx.singleton(
        "SELECT FIRST 1 CONTROLE,CDBANCO,DTINICIAL,DTFINAL FROM CONCILIACAO WHERE CONTROLE=?",
        [control],
      );
      if (!period)
        throw Object.assign(new Error(`Periodo ${control} nao encontrado`), {
          status: 404,
        });
      const count = await tx.singleton(
        "SELECT COUNT(*) AS TOTAL FROM EXTRATO_ITEM i JOIN EXTRATO e ON e.CONTROLE=i.EXTRATO WHERE e.CONCILIACAO=?",
        [control],
      );
      await tx.execute(
        "DELETE FROM EXTRATO_ITEM WHERE EXTRATO IN (SELECT CONTROLE FROM EXTRATO WHERE CONCILIACAO=?)",
        [control],
      );
      await tx.execute("DELETE FROM EXTRATO WHERE CONCILIACAO=?", [control]);
      await tx.execute("DELETE FROM CONCILIACAO WHERE CONTROLE=?", [control]);
      let audited = false;
      try {
        if (
          !(await tx.singleton(
            "SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)='BOCADO_LOG_EXCLUSAO'",
          ))
        ) {
          await tx.execute(
            "CREATE TABLE BOCADO_LOG_EXCLUSAO (ID INTEGER NOT NULL PRIMARY KEY,DTHORA TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,TABELA VARCHAR(50),CONTROLE INTEGER,DESCRICAO VARCHAR(500),USUARIO VARCHAR(100),IP_ORIGEM VARCHAR(50))",
          );
          await tx.execute("CREATE SEQUENCE SEQ_BOCADO_LOG_EXCLUSAO");
        }
        await tx.execute(
          "INSERT INTO BOCADO_LOG_EXCLUSAO (ID,DTHORA,TABELA,CONTROLE,DESCRICAO,USUARIO,IP_ORIGEM) VALUES (NEXT VALUE FOR SEQ_BOCADO_LOG_EXCLUSAO,CURRENT_TIMESTAMP,'CONCILIACAO',?,?,?,?)",
          [
            `Exclusao periodo CONCILIACAO #${control} banco ${period.CDBANCO} de ${period.DTINICIAL} a ${period.DTFINAL}`.slice(
              0,
              500,
            ),
            String(req.get("X-Usuario") || "SISTEMA").slice(0, 100),
            String(req.ip || "").slice(0, 50),
          ],
        );
        audited = true;
      } catch {
        /* audit is best effort, matching legacy behavior */
      }
      return {
        itens_deletados: Number(count?.TOTAL || 0),
        historico_gravado: audited,
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

async function statementItem(db, id) {
  return (
    (
      await query(
        db,
        `SELECT FIRST 1 ei.CONTROLE,ei.DTLANCAMENTO AS DATA,ei.VALOR,ei.DESCRICAO,ei.MOV_BANCARIO,c.CDBANCO,c.AGENCIA,COALESCE(c.NUMCONTA,e.NUMCONTA) AS NUMCONTA,e.IDEMPRESA FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO WHERE ei.CONTROLE=?`,
        [id],
      )
    )[0] || null
  );
}
router.get("/transferencia/espelho", async (req, res) => {
  try {
    const id = Number(req.query.extrato_item),
      tolerance = Math.max(0, Number(req.query.tolerancia || 2));
    if (!id)
      return res.status(400).json({ ok: false, erro: "Informe extrato_item" });
    const result = await withDatabase(async (db) => {
      const item = await statementItem(db, id);
      if (!item)
        throw Object.assign(new Error("EXTRATO_ITEM nao encontrado"), {
          status: 404,
        });
      const date = new Date(`${String(item.DATA).slice(0, 10)}T12:00:00`),
        start = new Date(date),
        end = new Date(date);
      start.setDate(start.getDate() - tolerance);
      end.setDate(end.getDate() + tolerance);
      const dados = await query(
        db,
        `SELECT FIRST 20 ei.CONTROLE AS EXTRATO_ITEM,ei.DTLANCAMENTO AS DATA,ei.VALOR,ei.DESCRICAO AS HISTORICO,c.CDBANCO,c.AGENCIA,COALESCE(c.NUMCONTA,e.NUMCONTA) AS NUMCONTA,COALESCE(b.BANCO,'') AS BANCO_NOME FROM EXTRATO_ITEM ei JOIN EXTRATO e ON e.CONTROLE=ei.EXTRATO LEFT JOIN CONCILIACAO c ON c.CONTROLE=e.CONCILIACAO LEFT JOIN BANCO b ON b.CDBANCO=c.CDBANCO WHERE ei.MOV_BANCARIO IS NULL AND ei.CONTROLE<>? AND ABS(ei.VALOR-?)<0.01 AND CAST(ei.DTLANCAMENTO AS DATE) BETWEEN ? AND ? AND (c.CDBANCO IS DISTINCT FROM ? OR COALESCE(c.NUMCONTA,e.NUMCONTA) IS DISTINCT FROM ?) ORDER BY ABS(CAST(ei.DTLANCAMENTO AS DATE)-CAST(? AS DATE)),ei.CONTROLE`,
        [
          id,
          -Number(item.VALOR),
          start,
          end,
          item.CDBANCO,
          item.NUMCONTA,
          date,
        ],
      );
      return {
        item: {
          extrato_item: Number(item.CONTROLE),
          valor: Number(item.VALOR),
          cdbanco: item.CDBANCO,
          agencia: item.AGENCIA,
          numconta: item.NUMCONTA,
        },
        dados,
      };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.route("/verificar-unificar-conta").get(unifyAccount).post(unifyAccount);
async function unifyAccount(req, res) {
  const source = req.method === "GET" ? req.query : req.body || {},
    bank = Number(source.cdbanco),
    newBank = Number(source.cdbanco_nova || bank),
    agency = String(source.agencia || "").trim(),
    newAgency = String(source.agencia_nova || agency).trim(),
    oldAccount = String(source.conta_antiga || "").trim(),
    newAccount = String(source.conta_nova || "").trim();
  if (!bank || !oldAccount || !newAccount)
    return res
      .status(400)
      .json({ ok: false, erro: "Informe cdbanco, conta_antiga e conta_nova" });
  if (oldAccount === newAccount)
    return res.status(400).json({ ok: false, erro: "As contas sao iguais" });
  try {
    const action = async (db) => {
      const destination = await (db.singleton
        ? db.singleton(
            "SELECT FIRST 1 CDBANCO,AGENCIA,NUMCONTA FROM (SELECT CDBANCO,AGENCIA,NUMCONTA FROM CONCILIACAO UNION SELECT CDBANCO,AGENCIA,NUMCONTA FROM BANCO UNION SELECT CDBANCO,AGENCIA,NUMCONTA FROM CONTACORRENTE) X WHERE CDBANCO=? AND COALESCE(TRIM(AGENCIA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND COALESCE(TRIM(NUMCONTA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'')",
            [newBank, newAgency, newAccount],
          )
        : query(
            db,
            "SELECT FIRST 1 CDBANCO,AGENCIA,NUMCONTA FROM (SELECT CDBANCO,AGENCIA,NUMCONTA FROM CONCILIACAO UNION SELECT CDBANCO,AGENCIA,NUMCONTA FROM BANCO UNION SELECT CDBANCO,AGENCIA,NUMCONTA FROM CONTACORRENTE) X WHERE CDBANCO=? AND COALESCE(TRIM(AGENCIA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND COALESCE(TRIM(NUMCONTA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'')",
            [newBank, newAgency, newAccount],
          ).then((rows) => rows[0]));
      if (!destination)
        throw Object.assign(
          new Error("Conta de destino nao encontrada para este banco/agencia."),
          { status: 404 },
        );
      const periods = async (b, a, c) =>
        (db.query ? db.query : (sql, p) => query(db, sql, p))(
          "SELECT CONTROLE,CAST(DTINICIAL AS DATE) AS DTINICIAL,CAST(DTFINAL AS DATE) AS DTFINAL FROM CONCILIACAO WHERE CDBANCO=? AND COALESCE(TRIM(AGENCIA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND COALESCE(TRIM(NUMCONTA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') ORDER BY DTINICIAL",
          [b, a, c],
        );
      const oldPeriods = await periods(bank, agency, oldAccount),
        newPeriods = await periods(newBank, newAgency, newAccount),
        overlaps = [];
      for (const old of oldPeriods)
        for (const current of newPeriods)
          if (
            String(old.DTINICIAL).slice(0, 10) <=
              String(current.DTFINAL).slice(0, 10) &&
            String(old.DTFINAL).slice(0, 10) >=
              String(current.DTINICIAL).slice(0, 10)
          )
            overlaps.push({
              periodo_antiga: `${String(old.DTINICIAL).slice(0, 10)} a ${String(old.DTFINAL).slice(0, 10)}`,
              periodo_nova: `${String(current.DTINICIAL).slice(0, 10)} a ${String(current.DTFINAL).slice(0, 10)}`,
            });
      if (req.method === "GET")
        return {
          sobreposicoes: overlaps,
          periodos_antiga: oldPeriods.length,
          periodos_nova: newPeriods.length,
        };
      await db.execute(
        "UPDATE CONCILIACAO SET CDBANCO=?,AGENCIA=?,NUMCONTA=? WHERE CDBANCO=? AND COALESCE(TRIM(AGENCIA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND COALESCE(TRIM(NUMCONTA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'')",
        [newBank, newAgency, newAccount, bank, agency, oldAccount],
      );
      await db.execute(
        "UPDATE MOV_BANCARIO SET CDBANCO=?,AGENCIA=?,NUMCONTA=? WHERE CDBANCO=? AND COALESCE(TRIM(AGENCIA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'') AND COALESCE(TRIM(NUMCONTA),'')=COALESCE(TRIM(CAST(? AS VARCHAR(50))),'')",
        [newBank, newAgency, newAccount, bank, agency, oldAccount],
      );
      return {
        periodos_migrados: oldPeriods.length,
        atualizados: { CONCILIACAO: oldPeriods.length, MOV_BANCARIO: null },
      };
    };
    const result =
      req.method === "GET"
        ? await withDatabase(action)
        : await withWriteTransaction(action);
    res.json({ ok: true, ...result });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ ok: false, erro: `Erro ao unificar contas: ${error.message}` });
  }
}

// prettier-ignore -- the route inventory scanner recognizes this literal chain.
router.route("/cartao/depara")
  .get(
    run(async (db) => {
      const data = readJsonConfig("cartao_depara.json", {
        mapeamentos: {},
        combos_conhecidos: [],
      });
      const formas = await query(
        db,
        `SELECT CDRECEBTO,RECEBTO FROM RECEBTO
    WHERE INATIVO IS NULL OR INATIVO=0 ORDER BY RECEBTO`,
      );
      return {
        ok: true,
        formas_sistema: formas
          .filter((f) => f.CDRECEBTO !== null)
          .map((f) => ({
            cdrecebto: Number(f.CDRECEBTO),
            descricao: f.RECEBTO || "",
          })),
        combos_conhecidos: [
          ...new Set([
            ...(data.combos_conhecidos || []),
            ...Object.keys(data.mapeamentos || {}),
          ]),
        ].sort(),
        mapeamentos: data.mapeamentos || {},
      };
    }),
  )
  .post((req, res) => {
    const data = readJsonConfig("cartao_depara.json", {
      mapeamentos: {},
      combos_conhecidos: [],
    });
    data.mapeamentos = req.body?.mapeamentos || {};
    writeJsonConfig("cartao_depara.json", data);
    res.json({
      ok: true,
      mapeamentos_salvos: Object.keys(data.mapeamentos).length,
    });
  });

export default router;
