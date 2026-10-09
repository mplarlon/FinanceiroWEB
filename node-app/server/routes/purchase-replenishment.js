import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
const int = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Math.trunc(Number(value))
      : null;
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
async function tableColumns(tx, table) {
  return new Set(
    (
      await tx.query(
        "SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME)=?",
        [table],
      )
    ).map((r) => r.NAME),
  );
}
async function ensureSchema(tx) {
  const generators = new Set(
    (
      await tx.query(
        "SELECT TRIM(RDB$GENERATOR_NAME) AS NAME FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME IN ('GEN_DASH_COMPRA_SUGESTAO','GEN_DASH_COMPRA_SUGESTAO_ITEM')",
      )
    ).map((r) => r.NAME),
  );
  if (!generators.has("GEN_DASH_COMPRA_SUGESTAO"))
    await tx.execute("CREATE SEQUENCE GEN_DASH_COMPRA_SUGESTAO");
  if (!generators.has("GEN_DASH_COMPRA_SUGESTAO_ITEM"))
    await tx.execute("CREATE SEQUENCE GEN_DASH_COMPRA_SUGESTAO_ITEM");
  const tables = new Set(
    (
      await tx.query(
        "SELECT TRIM(RDB$RELATION_NAME) AS NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME IN ('DASH_COMPRA_SUGESTAO','DASH_COMPRA_SUGESTAO_ITEM')",
      )
    ).map((r) => r.NAME),
  );
  if (!tables.has("DASH_COMPRA_SUGESTAO"))
    await tx.execute(
      "CREATE TABLE DASH_COMPRA_SUGESTAO (ID BIGINT NOT NULL PRIMARY KEY,STATUS VARCHAR(12) NOT NULL,OBS VARCHAR(200),VLTOTAL NUMERIC(18,2) DEFAULT 0,CRIADO_EM TIMESTAMP NOT NULL,CRIADO_POR INTEGER,APROVADO_EM TIMESTAMP,APROVADO_POR INTEGER,CANCELADO_EM TIMESTAMP,CANCELADO_POR INTEGER)",
    );
  if (!tables.has("DASH_COMPRA_SUGESTAO_ITEM"))
    await tx.execute(
      "CREATE TABLE DASH_COMPRA_SUGESTAO_ITEM (ID BIGINT NOT NULL PRIMARY KEY,ID_SUGESTAO BIGINT NOT NULL,CDPRODUTO VARCHAR(10) NOT NULL,PRODUTO VARCHAR(70),CDDEPOSITO INTEGER,IDEMPRESA INTEGER,CDFORNECEDOR INTEGER,QTDE_SUGERIDA NUMERIC(18,3),VLUNIT_ESTIMADO NUMERIC(18,4),VLTOTAL_ESTIMADO NUMERIC(18,2),CDORDEM_GERADA INTEGER,IDEMPRESA_ORDEM INTEGER)",
    );
}
async function nextId(tx, table, column) {
  return Number(
    (
      await tx.singleton(
        `SELECT COALESCE(MAX(${column}),0)+1 AS ID FROM ${table}`,
      )
    ).ID,
  );
}
async function statusDefault(tx) {
  try {
    return Number(
      (
        await tx.singleton(
          "SELECT FIRST 1 oc.STATUS,COUNT(*) AS QTD FROM ORDEMCOMPRA oc WHERE oc.DATA>=? AND NOT EXISTS (SELECT 1 FROM ENTRESTOQUE ee WHERE ee.CDORDEM=oc.CDORDEM AND ee.IDEMPRESA=oc.IDEMPRESA) GROUP BY oc.STATUS ORDER BY COUNT(*) DESC",
          [new Date(Date.now() - 365 * 86400000)],
        )
      )?.STATUS || 0,
    );
  } catch {
    return 0;
  }
}
async function generator(tx, candidates) {
  for (const name of candidates) {
    if (
      await tx.singleton(
        "SELECT FIRST 1 RDB$GENERATOR_NAME AS NAME FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME)=?",
        [name],
      )
    )
      return name;
  }
  return null;
}
async function syncGenerator(tx, name, target) {
  if (!name || !target) return;
  const current = Number(
    (await tx.singleton(`SELECT GEN_ID(${name},0) AS VALUE FROM RDB$DATABASE`))
      .VALUE || 0,
  );
  if (current < target)
    await tx.singleton(
      `SELECT GEN_ID(${name},${target - current}) AS VALUE FROM RDB$DATABASE`,
    );
}
async function insertAvailable(tx, table, data, columns) {
  const names = Object.keys(data).filter(
    (k) => columns.has(k) && data[k] !== undefined && data[k] !== null,
  );
  await tx.execute(
    `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
    names.map((k) => data[k]),
  );
}
async function approve(tx, idSuggestion, userId) {
  const header = await tx.singleton(
    "SELECT ID,STATUS FROM DASH_COMPRA_SUGESTAO WHERE ID=?",
    [idSuggestion],
  );
  if (!header)
    throw Object.assign(new Error(`Sugestao ${idSuggestion} nao encontrada.`), {
      status: 400,
    });
  if (String(header.STATUS).trim().toUpperCase() !== "RASCUNHO")
    throw Object.assign(
      new Error(
        `Sugestao ${idSuggestion} ja esta com status ${header.STATUS}.`,
      ),
      { status: 400 },
    );
  const items = await tx.query(
    "SELECT ID,CDPRODUTO,PRODUTO,CDDEPOSITO,IDEMPRESA,CDFORNECEDOR,QTDE_SUGERIDA,VLUNIT_ESTIMADO FROM DASH_COMPRA_SUGESTAO_ITEM WHERE ID_SUGESTAO=?",
    [idSuggestion],
  );
  if (!items.length)
    throw Object.assign(
      new Error(`Sugestao ${idSuggestion} nao possui itens.`),
      { status: 400 },
    );
  const ocCols = await tableColumns(tx, "ORDEMCOMPRA"),
    productCols = await tableColumns(tx, "ORDEMCOMPRAPROD"),
    gen = await generator(tx, [
      "GEN_ORDEMCOMPRA",
      "GEN_CDORDEM",
      "GEN_ORDEM_COMPRA",
    ]),
    defaultStatus = await statusDefault(tx),
    groups = new Map();
  for (const item of items) {
    const key = `${item.CDFORNECEDOR}:${item.IDEMPRESA}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const orders = [];
  for (const lines of groups.values()) {
    const supplier = Number(lines[0].CDFORNECEDOR),
      company = Number(lines[0].IDEMPRESA),
      orderId = await nextId(tx, "ORDEMCOMPRA", "CDORDEM"),
      total =
        Math.round(
          lines.reduce(
            (s, l) => s + num(l.QTDE_SUGERIDA) * num(l.VLUNIT_ESTIMADO),
            0,
          ) * 100,
        ) / 100,
      now = new Date();
    await insertAvailable(
      tx,
      "ORDEMCOMPRA",
      {
        CDORDEM: orderId,
        IDEMPRESA: company,
        DATA: now,
        IDUSUARIO: userId,
        CDFORNECEDOR: supplier,
        VLTOTAL: total,
        STATUS: defaultStatus,
        OBS: `Gerado automaticamente pelo Dashboard - Sugestao de compra #${idSuggestion}`.slice(
          0,
          255,
        ),
        DTALTER: now,
        SIST_ALT: "LOCAL",
      },
      ocCols,
    );
    let sequence = 1;
    for (const line of lines) {
      const quantity = num(line.QTDE_SUGERIDA),
        unit = num(line.VLUNIT_ESTIMADO);
      await insertAvailable(
        tx,
        "ORDEMCOMPRAPROD",
        {
          CDORDEM: orderId,
          IDEMPRESA: company,
          CDPRODUTO: line.CDPRODUTO,
          CDDEPOSITO: line.CDDEPOSITO,
          DESCRICAO: line.PRODUTO,
          QTDE: quantity,
          VLUNIT: unit,
          VLCUSTO: unit,
          VLTOT: Math.round(quantity * unit * 100) / 100,
          QTDESUGERIDA: quantity,
          ORDEM: sequence++,
          DTALTER: now,
          SIST_ALT: "LOCAL",
        },
        productCols,
      );
      await tx.execute(
        "UPDATE DASH_COMPRA_SUGESTAO_ITEM SET CDORDEM_GERADA=?,IDEMPRESA_ORDEM=? WHERE ID=?",
        [orderId, company, line.ID],
      );
    }
    await syncGenerator(tx, gen, orderId);
    orders.push({
      cdordem: orderId,
      idempresa: company,
      cdfornecedor: supplier,
      vltotal: total,
      itens: lines.length,
      status_aplicado: defaultStatus,
    });
  }
  await tx.execute(
    "UPDATE DASH_COMPRA_SUGESTAO SET STATUS='APROVADO',APROVADO_EM=?,APROVADO_POR=? WHERE ID=?",
    [new Date(), userId, idSuggestion],
  );
  return orders;
}

router.get("/sugestao", async (req, res) => {
  try {
    const loja = int(req.query.loja),
      deposito = int(req.query.deposito),
      fornecedor = int(req.query.fornecedor),
      consider = req.query.considerar_abertos !== "0",
      limit = Math.max(1, Math.min(int(req.query.limit) || 500, 2000)),
      inner = [],
      innerParams = [];
    if (deposito !== null) {
      inner.push("m.CDDEPOSITO=?");
      innerParams.push(deposito);
    }
    if (loja !== null) {
      inner.push("d.IDEMPRESA=?");
      innerParams.push(loja);
    }
    const open = consider ? "r.QTDE_EM_ABERTO" : "0",
      outer = [
        `(r.ALVO_ESTOQUE-r.QTDEATUAL-${open})>0`,
        `(r.QTDEATUAL<=r.QTDEMINIMA OR (r.QTDEMINIMA=0 AND r.QTDESEGURANCA>0 AND r.QTDEATUAL<=r.QTDESEGURANCA))`,
      ],
      outerParams = [];
    if (fornecedor !== null) {
      outer.push("r.CDFORNECEDOR=?");
      outerParams.push(fornecedor);
    }
    const sql = `SELECT FIRST ${limit} r.CDPRODUTO,r.PRODUTO,r.UNIDADE,r.CDDEPOSITO,r.DEPOSITO,r.IDEMPRESA,r.LOJA,r.QTDEATUAL,r.QTDEMINIMA,r.QTDEMAXIMA,r.QTDESEGURANCA,r.QTDEMEDIA,r.QTDE_EM_ABERTO,r.CDFORNECEDOR,COALESCE(f.FORNECEDOR,f.FANTASIA,'(sem fornecedor cadastrado)') AS FORNECEDOR,r.CUSTO_ESTIMADO,CASE WHEN (r.ALVO_ESTOQUE-r.QTDEATUAL-${open})>0 THEN (r.ALVO_ESTOQUE-r.QTDEATUAL-${open}) ELSE 0 END AS QTDE_SUGERIDA FROM (SELECT p.CDPRODUTO,p.PRODUTO,COALESCE(p.CDUNIDADE,p.CDUNIDVENDA,'UN') AS UNIDADE,m.CDDEPOSITO,COALESCE(d.DEPOSITO,CAST(m.CDDEPOSITO AS VARCHAR(20))) AS DEPOSITO,d.IDEMPRESA,COALESCE(cfg.NOMEEMPRESA,CAST(d.IDEMPRESA AS VARCHAR(20))) AS LOJA,COALESCE(m.QTDEATUAL,0) AS QTDEATUAL,COALESCE(m.QTDEMINIMA,0) AS QTDEMINIMA,COALESCE(m.QTDEMAXIMA,0) AS QTDEMAXIMA,COALESCE(m.QTDESEGURANCA,0) AS QTDESEGURANCA,COALESCE(m.QTDEMEDIA,0) AS QTDEMEDIA,(COALESCE((SELECT SUM(op2.QTDE) FROM ORDEMCOMPRAPROD op2 JOIN ORDEMCOMPRA oc2 ON oc2.CDORDEM=op2.CDORDEM AND oc2.IDEMPRESA=op2.IDEMPRESA WHERE op2.CDPRODUTO=p.CDPRODUTO AND op2.CDDEPOSITO=m.CDDEPOSITO AND UPPER(COALESCE(CAST(oc2.STATUS AS VARCHAR(20)),'')) NOT IN ('C','CANCELADO','9')),0)-COALESCE((SELECT SUM(ep3.QTDE) FROM ENTRPRODUTO ep3 JOIN ENTRESTOQUE ee3 ON ee3.IDENTRADA=ep3.IDENTRADA AND ee3.IDEMPRESA=ep3.IDEMPRESA JOIN ORDEMCOMPRA oc3 ON oc3.CDORDEM=ee3.CDORDEM AND oc3.IDEMPRESA=ee3.IDEMPRESA WHERE ep3.CDPRODUTO=p.CDPRODUTO AND ee3.DTCANCELAMENTO IS NULL AND UPPER(COALESCE(CAST(oc3.STATUS AS VARCHAR(20)),'')) NOT IN ('C','CANCELADO','9') AND EXISTS (SELECT 1 FROM ORDEMCOMPRAPROD op5 WHERE op5.CDORDEM=ee3.CDORDEM AND op5.IDEMPRESA=ee3.IDEMPRESA AND op5.CDPRODUTO=ep3.CDPRODUTO AND op5.CDDEPOSITO=m.CDDEPOSITO)),0)) AS QTDE_EM_ABERTO,COALESCE(p.CDFORNECEDOR,(SELECT FIRST 1 ee4.CDFORNECEDOR FROM ENTRESTOQUE ee4 JOIN ENTRPRODUTO ep4 ON ep4.IDENTRADA=ee4.IDENTRADA AND ep4.IDEMPRESA=ee4.IDEMPRESA WHERE ep4.CDPRODUTO=p.CDPRODUTO AND ee4.DTCANCELAMENTO IS NULL ORDER BY ee4.DTENTRADA DESC)) AS CDFORNECEDOR,COALESCE(NULLIF(p.VLCUSTOMEDIO,0),(SELECT FIRST 1 COALESCE(NULLIF(ep5.VLCUSTO,0),NULLIF(ep5.VLUNIT,0)) FROM ENTRESTOQUE ee5 JOIN ENTRPRODUTO ep5 ON ep5.IDENTRADA=ee5.IDENTRADA AND ep5.IDEMPRESA=ee5.IDEMPRESA WHERE ep5.CDPRODUTO=p.CDPRODUTO AND ee5.DTCANCELAMENTO IS NULL ORDER BY ee5.DTENTRADA DESC),0) AS CUSTO_ESTIMADO,CASE WHEN COALESCE(m.QTDEMAXIMA,0)>0 THEN m.QTDEMAXIMA WHEN COALESCE(m.QTDEMINIMA,0)>0 THEN m.QTDEMINIMA*2 WHEN COALESCE(m.QTDESEGURANCA,0)>0 THEN m.QTDESEGURANCA*2 ELSE 0 END AS ALVO_ESTOQUE FROM PRODUTO p JOIN MOVIMENTO m ON m.CDPRODUTO=p.CDPRODUTO LEFT JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA=d.IDEMPRESA WHERE (p.INATIVO=0 OR p.INATIVO IS NULL) AND (p.INATIVOCOMPRA=0 OR p.INATIVOCOMPRA IS NULL)${inner.length ? ` AND ${inner.join(" AND ")}` : ""}) r LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=r.CDFORNECEDOR WHERE ${outer.join(" AND ")} ORDER BY QTDE_SUGERIDA DESC`,
      safeSql = sql
        .replace(
          "COALESCE(d.DEPOSITO,CAST(m.CDDEPOSITO AS VARCHAR(20)))",
          "d.DEPOSITO",
        )
        .replace(
          "COALESCE(cfg.NOMEEMPRESA,CAST(d.IDEMPRESA AS VARCHAR(20)))",
          "cfg.NOMEEMPRESA",
        ),
      items = await withDatabase((db) =>
        query(db, safeSql, [...innerParams, ...outerParams]),
      ),
      value = items.reduce(
        (s, i) => s + num(i.QTDE_SUGERIDA) * num(i.CUSTO_ESTIMADO),
        0,
      );
    res.json({
      ok: true,
      itens: items,
      resumo: {
        itens_a_comprar: items.length,
        valor_sugerido: Math.round(value * 100) / 100,
        fornecedores_envolvidos: new Set(
          items.map((i) => i.CDFORNECEDOR).filter((v) => v !== null),
        ).size,
        depositos_envolvidos: new Set(
          items.map((i) => i.CDDEPOSITO).filter((v) => v !== null),
        ).size,
        considerando_pedidos_abertos: consider,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.post("/sugestao/gerar", async (req, res) => {
  try {
    const input = req.body?.itens || [];
    if (!input.length)
      return res.status(400).json({
        ok: false,
        erro: "Informe ao menos um item para gerar a sugestao de compra.",
      });
    const userId = Number(req.dashboardSession?.user?.idusuario || 1),
      result = await withWriteTransaction(async (tx) => {
        await ensureSchema(tx);
        const lines = input
          .map((item) => ({
            cdproduto: String(item.cdproduto || "").trim(),
            produto: String(item.produto || "").slice(0, 70),
            cddeposito: int(item.cddeposito),
            idempresa: int(item.idempresa),
            cdfornecedor: int(item.cdfornecedor),
            qtde: num(item.qtde),
            vlunit: num(item.vlunit),
          }))
          .filter((item) => item.cdproduto && item.qtde > 0);
        if (!lines.length)
          throw Object.assign(
            new Error(
              "Nenhum item valido informado (produto e quantidade sao obrigatorios).",
            ),
            { status: 400 },
          );
        if (lines.some((l) => l.cdfornecedor === null))
          throw Object.assign(
            new Error(
              "Todos os itens precisam ter um fornecedor definido antes de gerar o pedido.",
            ),
            { status: 400 },
          );
        if (lines.some((l) => l.idempresa === null || l.cddeposito === null))
          throw Object.assign(
            new Error("Todos os itens precisam ter loja e deposito definidos."),
            { status: 400 },
          );
        const id = await nextId(tx, "DASH_COMPRA_SUGESTAO", "ID"),
          total =
            Math.round(lines.reduce((s, l) => s + l.qtde * l.vlunit, 0) * 100) /
            100;
        await tx.execute(
          "INSERT INTO DASH_COMPRA_SUGESTAO (ID,STATUS,OBS,VLTOTAL,CRIADO_EM,CRIADO_POR) VALUES (?,'RASCUNHO',?,?,?,?)",
          [
            id,
            String(req.body?.observacao || "")
              .trim()
              .slice(0, 200) || null,
            total,
            new Date(),
            userId,
          ],
        );
        for (const line of lines) {
          const itemId = await nextId(tx, "DASH_COMPRA_SUGESTAO_ITEM", "ID");
          await tx.execute(
            "INSERT INTO DASH_COMPRA_SUGESTAO_ITEM (ID,ID_SUGESTAO,CDPRODUTO,PRODUTO,CDDEPOSITO,IDEMPRESA,CDFORNECEDOR,QTDE_SUGERIDA,VLUNIT_ESTIMADO,VLTOTAL_ESTIMADO) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
              itemId,
              id,
              line.cdproduto,
              line.produto,
              line.cddeposito,
              line.idempresa,
              line.cdfornecedor,
              line.qtde,
              line.vlunit,
              Math.round(line.qtde * line.vlunit * 100) / 100,
            ],
          );
        }
        const orders = req.body?.confirmar ? await approve(tx, id, userId) : [];
        return {
          ok: true,
          id_sugestao: id,
          status: req.body?.confirmar ? "APROVADO" : "RASCUNHO",
          itens: lines.length,
          valor_total: total,
          pedidos_gerados: orders,
        };
      });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});
router.get("/sugestao/rascunhos", async (req, res) => {
  try {
    const status = String(req.query.status || "RASCUNHO")
        .trim()
        .toUpperCase(),
      rows = await withWriteTransaction(async (tx) => {
        await ensureSchema(tx);
        const base =
          "SELECT s.ID,s.STATUS,s.OBS,s.VLTOTAL,s.CRIADO_EM,s.CRIADO_POR,s.APROVADO_EM,(SELECT COUNT(*) FROM DASH_COMPRA_SUGESTAO_ITEM i WHERE i.ID_SUGESTAO=s.ID) AS QTD_ITENS FROM DASH_COMPRA_SUGESTAO s";
        return tx.query(
          status === "TODOS"
            ? `${base} ORDER BY s.CRIADO_EM DESC`
            : `${base} WHERE s.STATUS=? ORDER BY s.CRIADO_EM DESC`,
          status === "TODOS" ? [] : [status],
        );
      });
    res.json({ ok: true, rascunhos: rows });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
router.get("/sugestao/rascunhos/:id", async (req, res) => {
  try {
    const result = await withWriteTransaction(async (tx) => {
      await ensureSchema(tx);
      const header = await tx.singleton(
        "SELECT * FROM DASH_COMPRA_SUGESTAO WHERE ID=?",
        [Number(req.params.id)],
      );
      if (!header)
        throw Object.assign(new Error("Sugestao nao encontrada."), {
          status: 404,
        });
      const itens = await tx.query(
        "SELECT i.*,COALESCE(f.FORNECEDOR,f.FANTASIA,'(sem fornecedor)') AS FORNECEDOR_NOME FROM DASH_COMPRA_SUGESTAO_ITEM i LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=i.CDFORNECEDOR WHERE i.ID_SUGESTAO=?",
        [Number(req.params.id)],
      );
      return { ok: true, sugestao: header, itens };
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});
router.post("/sugestao/rascunhos/:id/aprovar", async (req, res) => {
  try {
    const id = Number(req.params.id),
      orders = await withWriteTransaction(async (tx) => {
        await ensureSchema(tx);
        return approve(
          tx,
          id,
          Number(req.dashboardSession?.user?.idusuario || 1),
        );
      });
    res.json({ ok: true, id_sugestao: id, pedidos_gerados: orders });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});
router.post("/sugestao/rascunhos/:id/cancelar", async (req, res) => {
  try {
    const id = Number(req.params.id),
      result = await withWriteTransaction(async (tx) => {
        await ensureSchema(tx);
        const current = await tx.singleton(
          "SELECT STATUS FROM DASH_COMPRA_SUGESTAO WHERE ID=?",
          [id],
        );
        if (
          !current ||
          String(current.STATUS).trim().toUpperCase() !== "RASCUNHO"
        )
          throw Object.assign(
            new Error(
              "Sugestao nao encontrada ou ja nao esta mais como rascunho.",
            ),
            { status: 400 },
          );
        await tx.execute(
          "UPDATE DASH_COMPRA_SUGESTAO SET STATUS='CANCELADO',CANCELADO_EM=?,CANCELADO_POR=? WHERE ID=? AND STATUS='RASCUNHO'",
          [new Date(), Number(req.dashboardSession?.user?.idusuario || 1), id],
        );
        return { ok: true, id_sugestao: id };
      });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

export { ensureSchema, int, num };
export default router;
