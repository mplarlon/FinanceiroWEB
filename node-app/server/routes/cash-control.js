import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
// A conexão vai em UTF8. Cadastros antigos estão em NONE e um acento, misturado
// com literal da conexão em COALESCE ou UPPER, aborta a leitura com "Malformed string".
const legacyText = (expression, size) =>
  `CAST(CAST(${expression} AS VARCHAR(${size}) CHARACTER SET OCTETS) AS VARCHAR(${size}) CHARACTER SET NONE)`;
const legacyLiteral = (value) => {
  const text = String(value).replaceAll("'", "''");
  return `CAST('${text}' AS VARCHAR(${Math.max(text.length, 1)}) CHARACTER SET NONE)`;
};
const legacyValue = (...parts) => {
  const sql = parts.map((part) =>
    Array.isArray(part) ? legacyText(part[0], part[1]) : legacyLiteral(part),
  );
  return sql.length === 1 ? sql[0] : `COALESCE(${sql.join(",")})`;
};
const moneyFormOrder = `ORDER BY CASE WHEN UPPER(${legacyValue(["RECEBTO", 50], "")}) CONTAINING ${legacyLiteral("DINHEIRO")} THEN 0 ELSE 1 END,CDRECEBTO`;
const integer = (value) =>
  /^\d+$/.test(String(value ?? "")) ? Number(value) : null;
const bounded = (value, fallback, max) =>
  Math.max(1, Math.min(max, integer(value) ?? fallback));
const run = (fn) => async (req, res) => {
  try {
    res.json(await withDatabase((db) => fn(db, req)));
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
};
async function tableExists(db, name) {
  return Boolean(
    (
      await query(
        db,
        "SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)=? AND COALESCE(RDB$SYSTEM_FLAG,0)=0",
        [name],
      )
    )[0],
  );
}
const userId = (req) => Number(req.dashboardSession?.user?.idusuario || 1);
const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T12:00:00`).valueOf());
// O driver chama getFullYear no parâmetro. Texto derruba abertura, fechamento e transferência.
export function firebirdDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
}
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
async function relationExists(tx, name) {
  return Boolean(
    await tx.singleton(
      "SELECT 1 AS OK FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME)=? AND COALESCE(RDB$SYSTEM_FLAG,0)=0",
      [name],
    ),
  );
}
async function sequenceExists(tx, name) {
  return Boolean(
    await tx.singleton(
      "SELECT 1 AS OK FROM RDB$GENERATORS WHERE TRIM(RDB$GENERATOR_NAME)=?",
      [name],
    ),
  );
}
async function ensureClosings(tx) {
  if (!(await sequenceExists(tx, "GEN_DASH_CAIXA_FECHAMENTO")))
    await tx.execute("CREATE SEQUENCE GEN_DASH_CAIXA_FECHAMENTO");
  if (!(await relationExists(tx, "DASH_CAIXA_FECHAMENTO")))
    await tx.execute(
      "CREATE TABLE DASH_CAIXA_FECHAMENTO (IDFECHAMENTO BIGINT NOT NULL PRIMARY KEY,IDEMPRESA INTEGER NOT NULL,CDCAIXA INTEGER NOT NULL,DATA_CAIXA DATE NOT NULL,ENTRADAS NUMERIC(18,2) NOT NULL,SAIDAS NUMERIC(18,2) NOT NULL,SALDO_SISTEMA NUMERIC(18,2) NOT NULL,VALOR_CONTADO NUMERIC(18,2) NOT NULL,DIFERENCA NUMERIC(18,2) NOT NULL,QTD_MOVIMENTOS INTEGER NOT NULL,OBSERVACAO VARCHAR(500),USUARIO_ID INTEGER,FECHADO_EM TIMESTAMP NOT NULL,SIST_ALT VARCHAR(7) NOT NULL)",
    );
}
async function ensureOpenings(tx) {
  if (!(await sequenceExists(tx, "GEN_DASH_CAIXA_ABERTURA")))
    await tx.execute("CREATE SEQUENCE GEN_DASH_CAIXA_ABERTURA");
  if (!(await relationExists(tx, "DASH_CAIXA_ABERTURA")))
    await tx.execute(
      "CREATE TABLE DASH_CAIXA_ABERTURA (IDABERTURA BIGINT NOT NULL PRIMARY KEY,IDEMPRESA INTEGER NOT NULL,CDCAIXA INTEGER NOT NULL,DATA_CAIXA DATE NOT NULL,VALOR_INICIAL NUMERIC(18,2) NOT NULL,OBSERVACAO VARCHAR(500),USUARIO_ID INTEGER,ABERTO_EM TIMESTAMP NOT NULL,IDMOVCAIXA INTEGER,SIST_ALT VARCHAR(7) NOT NULL)",
    );
}
async function ensureTransfers(tx) {
  if (!(await sequenceExists(tx, "GEN_DASH_CAIXA_TRANSF")))
    await tx.execute("CREATE SEQUENCE GEN_DASH_CAIXA_TRANSF");
  if (!(await relationExists(tx, "DASH_CAIXA_TRANSFERENCIA")))
    await tx.execute(
      "CREATE TABLE DASH_CAIXA_TRANSFERENCIA (IDTRANSFERENCIA BIGINT NOT NULL PRIMARY KEY,ORIGEM VARCHAR(12) NOT NULL,IDMOVIMENTO INTEGER NOT NULL,IDEMPRESA INTEGER NOT NULL,CAIXA_ANTERIOR INTEGER NOT NULL,CAIXA_DESTINO INTEGER NOT NULL,DATA_MOVIMENTO DATE,VALOR NUMERIC(18,2) NOT NULL,DESCRICAO VARCHAR(255),USUARIO_ID INTEGER,TRANSFERIDO_EM TIMESTAMP NOT NULL,SIST_ALT VARCHAR(7) NOT NULL)",
    );
}
// O Firebird não enxerga tabela nem sequência criadas na mesma transação do INSERT.
async function prepareCashSchema() {
  await withWriteTransaction(async (tx) => {
    await ensureClosings(tx);
    await ensureOpenings(tx);
    await ensureTransfers(tx);
  });
}

async function ensureCashOpen(tx, company, date, cashes) {
  const day = firebirdDate(date);
  if (!day)
    throw Object.assign(new Error("Data do movimento invalida."), { status: 400 });
  if (!(await relationExists(tx, "DASH_CAIXA_FECHAMENTO"))) return;
  for (const cash of new Set(cashes.filter(Boolean))) {
    const closing = await tx.singleton(
      "SELECT FIRST 1 IDFECHAMENTO FROM DASH_CAIXA_FECHAMENTO WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?",
      [company, cash, day],
    );
    if (closing)
      throw Object.assign(
        new Error(`O caixa ${cash} ja esta fechado nesta data.`),
        { status: 409 },
      );
  }
}

export function buildCashFilters(
  args,
  aliases = {
    date: "c.DTCOB",
    company: "c.IDEMPRESA",
    cash: "c.CAIXA",
    origin: "c.CDCAIXAORIGEM",
  },
) {
  const where = [],
    params = [];
  const start = String(args.inicio || "")
      .trim()
      .slice(0, 10),
    end = String(args.fim || "")
      .trim()
      .slice(0, 10);
  if (start) {
    where.push(`${aliases.date}>=?`);
    params.push(firebirdDate(start));
  }
  if (end) {
    where.push(`${aliases.date}<DATEADD(1 DAY TO ?)`);
    params.push(firebirdDate(end));
  }
  for (const [name, column] of [
    ["empresa", aliases.company],
    ["caixa", aliases.cash],
  ]) {
    const value = integer(args[name]);
    if (value !== null) {
      where.push(`${column}=?`);
      params.push(value);
    }
  }
  const origin = integer(args.caixa_origem);
  if (origin !== null) {
    where.push(`COALESCE(${aliases.origin},${aliases.cash})=?`);
    params.push(origin);
  }
  return { where, params };
}
export function pendingCashFilters(args) {
  return buildCashFilters(args, {
    date: "COALESCE(t.DTMOV,t.DTLOG)",
    company: "t.IDEMPRESA",
    cash: "COALESCE(t.CAIXA,t.CDCAIXAORIGEM)",
    origin: "t.CDCAIXAORIGEM",
  });
}
const flagged = (args, name) =>
  ["1", "true", "on"].includes(String(args?.[name] ?? "").trim().toLowerCase());
// No PDV, DIVIDA repete o total do pedido em cada parcela. O caixa usa o valor da parcela.
export const openParcelValue =
  "CASE WHEN COALESCE(t.VALOR,0)<>0 THEN t.VALOR ELSE COALESCE(t.DIVIDA,0) END";
export const receivedValue =
  "CASE WHEN COALESCE(c.TOTALPG,0)<>0 THEN c.TOTALPG ELSE COALESCE(c.VALOR,0) END";
export function cashExclusion(args, alias = "r") {
  const where = [];
  const tipo = `COALESCE(${alias}.TPRECEBTO,0)`;
  const nome = `UPPER(${legacyValue([`${alias}.RECEBTO`, 50], "")})`;
  if (flagged(args, "nao_carteiras"))
    where.push(
      `${tipo} NOT IN (1,8) AND ${nome} NOT CONTAINING ${legacyLiteral("CARTEIRA")}`,
    );
  if (flagged(args, "nao_vales"))
    where.push(`${tipo}<>10 AND ${nome} NOT CONTAINING ${legacyLiteral("VALE")}`);
  if (flagged(args, "nao_devolucoes"))
    where.push(
      `${tipo} NOT IN (12,13) AND ${nome} NOT CONTAINING ${legacyLiteral("DEVOL")}`,
    );
  return where;
}

function siblingCashStep(table, cashColumn, row, company, source, destination, extra = "") {
  const pedido = Number(row.NRPEDIDO);
  const where = ["IDEMPRESA=?", `${cashColumn}=?`];
  const params = [source, destination, company, source];
  if (Number.isFinite(pedido) && pedido > 0) {
    where.push("NRPEDIDO=?");
    params.push(pedido);
  } else if (String(row.NRDOC || "").trim()) {
    where.push("NRDOC=?");
    params.push(String(row.NRDOC).trim());
  } else return null;
  if (row.PARCELA != null && row.PARCELA !== "") {
    where.push("PARCELA=?");
    params.push(Number(row.PARCELA));
  }
  return {
    sql: `UPDATE ${table} SET CDCAIXAORIGEM=?,${cashColumn}=?,DTALTER=CURRENT_TIMESTAMP WHERE ${where.join(" AND ")}${extra}`,
    params,
  };
}

// O Automec lê o controle de caixa em CTARECEBERCAIXA e o recebimento de contas em CTARECEBER.
// A transferência grava o caixa de saída em CDCAIXAORIGEM e o destino em CAIXA, nas duas tabelas.
export function planCashMove({ origin, movement, company, destination, row }) {
  const source = Number(row.CAIXA);
  if (origin === "RECEBIMENTO") {
    return [
      {
        sql: "UPDATE CTARECEBERCAIXA SET CDCAIXAORIGEM=?,CAIXA=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND CAIXA=? AND COALESCE(CANCELADO,0)=0",
        params: [source, destination, movement, company, source],
      },
      siblingCashStep("CTARECEBER", "CAIXA", row, company, source, destination),
    ].filter(Boolean);
  }
  if (origin === "MOVIMENTO") {
    return [
      {
        sql: "UPDATE MOV_PAGTO SET CDCAIXAORIGEM=?,CDCAIXA=?,DTALTER=CURRENT_TIMESTAMP WHERE IDMOVCAIXA=? AND IDEMPRESA=? AND CDCAIXA=?",
        params: [source, destination, movement, company, source],
      },
    ];
  }
  return [
    {
      sql: "UPDATE CTARECEBER SET CDCAIXAORIGEM=?,CAIXA=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND CAIXA=? AND STATUS=1",
      params: [source, destination, movement, company, source],
    },
    siblingCashStep(
      "CTARECEBERCAIXA",
      "CAIXA",
      row,
      company,
      source,
      destination,
      " AND COALESCE(CANCELADO,0)=0",
    ),
  ].filter(Boolean);
}

export function readMoveItems(body) {
  const raw = Array.isArray(body?.itens) && body.itens.length ? body.itens : [body];
  if (raw.length > 200)
    throw Object.assign(new Error("Selecione no maximo 200 registros por vez."), { status: 400 });
  const seen = new Set();
  const items = [];
  for (const [index, item] of raw.entries()) {
    const origin = String(item?.origem || "").trim().toUpperCase();
    const movement = integer(item?.movimento);
    const company = integer(item?.empresa ?? body?.empresa);
    const current = integer(item?.caixa_atual);
    const destination = integer(item?.caixa_destino ?? body?.caixa_destino);
    if (
      !["RECEBIMENTO", "MOVIMENTO", "PENDENTE"].includes(origin) ||
      !movement ||
      !company ||
      !current ||
      !destination ||
      current === destination
    )
      throw Object.assign(
        new Error(`Registro ${index + 1} invalido para transferencia.`),
        { status: 400 },
      );
    const key = `${origin}:${company}:${movement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ origin, movement, company, current, destination });
  }
  return items;
}
async function daily(db, company, cash, date) {
  const day = firebirdDate(date),
    row =
      (
        await query(
          db,
          `SELECT COUNT(*) AS QTD_MOVIMENTOS,SUM(CASE WHEN x.VALOR>=0 THEN x.VALOR ELSE 0 END) AS ENTRADAS,SUM(CASE WHEN x.VALOR<0 THEN ABS(x.VALOR) ELSE 0 END) AS SAIDAS,SUM(x.VALOR) AS SALDO FROM (SELECT COALESCE(c.TOTALPG,c.VALOR,0) AS VALOR FROM CTARECEBERCAIXA c WHERE c.IDEMPRESA=? AND c.CAIXA=? AND c.DTCOB>=? AND c.DTCOB<DATEADD(1 DAY TO ?) AND COALESCE(c.CANCELADO,0)=0 UNION ALL SELECT COALESCE(m.VALOR,0) FROM MOV_PAGTO m WHERE m.IDEMPRESA=? AND m.CDCAIXA=? AND m.DT_MOV>=? AND m.DT_MOV<DATEADD(1 DAY TO ?)) x`,
          [company, cash, day, day, company, cash, day, day],
        )
      )[0] || {};
  return {
    QTD_MOVIMENTOS: Number(row.QTD_MOVIMENTOS || 0),
    ENTRADAS: Number(row.ENTRADAS || 0),
    SAIDAS: Number(row.SAIDAS || 0),
    SALDO: Number(row.SALDO || 0),
  };
}

router.get(
  "/controle-caixa/opcoes",
  run(async (db) => {
    const empresas = await query(
        db,
        "SELECT IDEMPRESA,NOMEEMPRESA AS EMPRESA FROM CONFIGURACAO ORDER BY IDEMPRESA",
      ),
      caixas = await query(
        db,
        `SELECT CDCAIXA,${legacyValue(["CAIXA", 50], "Caixa sem nome")} AS CAIXA FROM TPCAIXA WHERE COALESCE(INATIVO,0)=0 ORDER BY CDCAIXA`,
      ),
      formas = await query(
        db,
        `SELECT CDRECEBTO,${legacyValue(["RECEBTO", 50], "Forma sem nome")} AS FORMA FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY 2,CDRECEBTO`,
      );
    return { ok: true, empresas, caixas, formas };
  }),
);
router.get(
  "/controle-caixa/apuracao",
  run(async (db, req) => {
    const company = integer(req.query.empresa),
      cash = integer(req.query.caixa),
      date = String(req.query.data || "").slice(0, 10);
    if (!company || !cash || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw Object.assign(new Error("Informe empresa, caixa e data valida."), {
        status: 400,
      });
    return { ok: true, apuracao: await daily(db, company, cash, date) };
  }),
);
router.get(
  "/controle-caixa/fechamentos",
  run(async (db, req) => {
    if (!(await tableExists(db, "DASH_CAIXA_FECHAMENTO")))
      return { ok: true, fechamentos: [] };
    const where = [],
      params = [],
      company = integer(req.query.empresa),
      cash = integer(req.query.caixa),
      limit = bounded(req.query.limite, 50, 200);
    if (company) {
      where.push("f.IDEMPRESA=?");
      params.push(company);
    }
    if (cash) {
      where.push("f.CDCAIXA=?");
      params.push(cash);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return {
      ok: true,
      fechamentos: await query(
        db,
        `SELECT FIRST ${limit} f.*,${legacyValue(["cfg.NOMEEMPRESA", 60])} AS EMPRESA,${legacyValue(["tc.CAIXA", 50])} AS CAIXA,${legacyValue(["u.NOMECOMPLETO", 50], ["u.LOGIN", 15])} AS USUARIO FROM DASH_CAIXA_FECHAMENTO f LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA=f.IDEMPRESA LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=f.CDCAIXA LEFT JOIN USUARIOS u ON u.IDUSUARIO=f.USUARIO_ID ${clause} ORDER BY f.DATA_CAIXA DESC,f.FECHADO_EM DESC`,
        params,
      ),
    };
  }),
);
router.get(
  "/controle-caixa/transferencias",
  run(async (db, req) => {
    if (!(await tableExists(db, "DASH_CAIXA_TRANSFERENCIA")))
      return { ok: true, transferencias: [] };
    const where = [],
      params = [],
      company = integer(req.query.empresa),
      cash = integer(req.query.caixa),
      limit = bounded(req.query.limite, 200, 500);
    if (company) {
      where.push("t.IDEMPRESA=?");
      params.push(company);
    }
    if (cash) {
      where.push("(t.CAIXA_ANTERIOR=? OR t.CAIXA_DESTINO=?)");
      params.push(cash, cash);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return {
      ok: true,
      transferencias: await query(
        db,
        `SELECT FIRST ${limit} t.*,${legacyValue(["cfg.NOMEEMPRESA", 60])} AS EMPRESA,${legacyValue(["co.CAIXA", 50])} AS CAIXA_ORIGEM,${legacyValue(["cd.CAIXA", 50])} AS CAIXA_DESTINO_NOME,${legacyValue(["u.NOMECOMPLETO", 50], ["u.LOGIN", 15])} AS USUARIO FROM DASH_CAIXA_TRANSFERENCIA t LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA=t.IDEMPRESA LEFT JOIN TPCAIXA co ON co.CDCAIXA=t.CAIXA_ANTERIOR LEFT JOIN TPCAIXA cd ON cd.CDCAIXA=t.CAIXA_DESTINO LEFT JOIN USUARIOS u ON u.IDUSUARIO=t.USUARIO_ID ${clause} ORDER BY t.TRANSFERIDO_EM DESC,t.IDTRANSFERENCIA DESC`,
        params,
      ),
    };
  }),
);

function unionParts(args) {
  const origin = String(args.origem || "")
      .trim()
      .toLowerCase(),
    rec = buildCashFilters(args),
    mov = buildCashFilters(args, {
      date: "m.DT_MOV",
      company: "m.IDEMPRESA",
      cash: "m.CDCAIXA",
      origin: "m.CDCAIXAORIGEM",
    }),
    parts = [],
    params = [];
  rec.where.push("COALESCE(c.CANCELADO,0)=0");
  const payment = integer(args.forma);
  if (payment) {
    rec.where.push("COALESCE(c.TPPAGTO,c.CODPAGTO)=?");
    rec.params.push(payment);
    mov.where.push("m.CDRECEBTO=?");
    mov.params.push(payment);
  }
  const search = String(args.busca || "").trim();
  if (search) {
    const needle = legacyLiteral(search.toUpperCase().slice(0, 60));
    rec.where.push(
      `(UPPER(${legacyValue(["c.NRDOC", 15], "")}) CONTAINING ${needle} OR UPPER(${legacyValue(["c.HISTORICO", 255], "")}) CONTAINING ${needle} OR UPPER(${legacyValue(["cl.CLIENTE", 100], ["cl.RAZAO", 100], "")}) CONTAINING ${needle})`,
    );
    mov.where.push(
      `UPPER(${legacyValue(["m.ASSUNTO", 100], "")}) CONTAINING ${needle}`,
    );
  }
  rec.where.push(...cashExclusion(args));
  if (origin === "" || origin === "recebimento") {
    parts.push(
      `SELECT c.DTCOB AS DATA_MOVIMENTO,EXTRACT(HOUR FROM COALESCE(c.HORALOG,c.DTCOB)) AS HORA,c.IDEMPRESA,c.CAIXA AS CDCAIXA,${legacyValue(["tc.CAIXA", 50])} AS CAIXA,c.CDCAIXAORIGEM,${legacyValue(["tco.CAIXA", 50])} AS CAIXA_ORIGEM,'RECEBIMENTO' AS ORIGEM,${legacyValue(["r.RECEBTO", 50])} AS FORMA,${receivedValue} AS VALOR,${legacyValue(["cl.CLIENTE", 100])} AS DESCRICAO,${legacyValue(["c.NRDOC", 15])} AS DOCUMENTO,c.NRPEDIDO AS PEDIDO,c.PARCELA,c.CONTROLE AS IDMOVIMENTO FROM CTARECEBERCAIXA c LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=c.CAIXA LEFT JOIN TPCAIXA tco ON tco.CDCAIXA=c.CDCAIXAORIGEM LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(c.TPPAGTO,c.CODPAGTO) LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=c.CDCLIENTE WHERE ${rec.where.join(" AND ") || "1=1"}`,
    );
    params.push(...rec.params);
  }
  if (
    (origin === "" || origin === "movimento") &&
    !flagged(args, "nao_saidas_entradas")
  ) {
    parts.push(
      `SELECT m.DT_MOV AS DATA_MOVIMENTO,EXTRACT(HOUR FROM COALESCE(m.HORALOG,m.DT_MOV)) AS HORA,m.IDEMPRESA,m.CDCAIXA,${legacyValue(["tc.CAIXA", 50], "Sem caixa")} AS CAIXA,m.CDCAIXAORIGEM,${legacyValue(["tco.CAIXA", 50], "Nao informada")} AS CAIXA_ORIGEM,'MOVIMENTO' AS ORIGEM,${legacyValue(["r.RECEBTO", 50], "Movimento avulso")} AS FORMA,COALESCE(m.VALOR,0) AS VALOR,${legacyValue(["m.ASSUNTO", 100], "Movimento sem historico")} AS DESCRICAO,CAST(m.IDMOVCAIXA AS VARCHAR(20)) AS DOCUMENTO,CAST(NULL AS INTEGER) AS PEDIDO,NULL AS PARCELA,m.IDMOVCAIXA AS IDMOVIMENTO FROM MOV_PAGTO m LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=m.CDCAIXA LEFT JOIN TPCAIXA tco ON tco.CDCAIXA=m.CDCAIXAORIGEM LEFT JOIN RECEBTO r ON r.CDRECEBTO=m.CDRECEBTO WHERE ${mov.where.join(" AND ") || "1=1"}`,
    );
    params.push(...mov.params);
  }
  return { parts, params };
}
router.get(
  "/controle-caixa",
  run(async (db, req) => {
    const limit = bounded(req.query.limite, 500, 1000),
      requested = String(req.query.origem || "").toLowerCase(),
      origins = requested ? [requested] : ["recebimento", "movimento"],
      summarySql = `COUNT(*) AS QTD_MOVIMENTOS,SUM(CASE WHEN x.VALOR>=0 THEN x.VALOR ELSE 0 END) AS ENTRADAS,SUM(CASE WHEN x.VALOR<0 THEN ABS(x.VALOR) ELSE 0 END) AS SAIDAS,SUM(x.VALOR) AS SALDO`,
      summaries = [],
      dailyRows = [],
      movimentos = [];
    for (const origem of origins) {
      const { parts, params } = unionParts({ ...req.query, origem });
      if (!parts.length) continue;
      const part = parts[0];
      summaries.push(
        (await query(db, `SELECT ${summarySql} FROM (${part}) x`, params))[0] ||
          {},
      );
      dailyRows.push(
        ...(await query(
          db,
          `SELECT CAST(x.DATA_MOVIMENTO AS DATE) AS DIA,${summarySql.slice(summarySql.indexOf("SUM"))} FROM (${part}) x GROUP BY CAST(x.DATA_MOVIMENTO AS DATE) ORDER BY DIA`,
          params,
        )),
      );
      movimentos.push(
        ...(await query(
          db,
          `SELECT FIRST ${limit} x.* FROM (${part}) x ORDER BY x.DATA_MOVIMENTO DESC,x.IDMOVIMENTO DESC`,
          params,
        )),
      );
    }
    const includePending = !requested || requested === "pendente";
    let pendingRows = [];
    let pendingTotal = { qtd: 0, valor: 0 };
    if (includePending) {
      // A parcela pendente fica no caixa atual. Depois da transferencia,
      // ela sai do filtro do caixa anterior e passa a aparecer no destino.
      const pending = pendingCashFilters(req.query);
      pending.where.push("t.STATUS=1");
      pending.where.push(...cashExclusion(req.query));
      const payment = integer(req.query.forma);
      if (payment) {
        pending.where.push("COALESCE(t.TPPAGTO,t.CODPAGTO)=?");
        pending.params.push(payment);
      }
      const start = String(req.query.inicio || "").trim().slice(0, 10);
      const end = String(req.query.fim || "").trim().slice(0, 10);
      if (validDate(start) && validDate(end)) {
        pending.where.push(
          "NOT EXISTS (SELECT 1 FROM CTARECEBERCAIXA cx WHERE cx.IDEMPRESA=t.IDEMPRESA AND cx.NRPEDIDO=t.NRPEDIDO AND cx.PARCELA=t.PARCELA AND COALESCE(cx.CANCELADO,0)=0 AND COALESCE(cx.NRPEDIDO,0)<>0 AND cx.DTCOB>=? AND cx.DTCOB<DATEADD(1 DAY TO ?))",
        );
        pending.params.push(firebirdDate(start), firebirdDate(end));
      }
      const pendingFrom = `FROM CTARECEBER t LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=t.CAIXA LEFT JOIN TPCAIXA tco ON tco.CDCAIXA=t.CDCAIXAORIGEM LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(t.TPPAGTO,t.CODPAGTO) LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=t.CDCLIENTE WHERE ${pending.where.join(" AND ") || "1=1"}`;
      const pendingSummary =
        (
          await query(
            db,
            `SELECT COUNT(*) AS QTD,SUM(${openParcelValue}) AS TOTAL ${pendingFrom}`,
            pending.params,
          )
        )[0] || {};
      pendingRows = await query(
        db,
        `SELECT FIRST ${limit} COALESCE(t.DTMOV,t.DTLOG) AS DATA_MOVIMENTO,EXTRACT(HOUR FROM COALESCE(t.HORALOG,t.DTMOV,t.DTLOG)) AS HORA,t.IDEMPRESA,COALESCE(t.CAIXA,t.CDCAIXAORIGEM) AS CDCAIXA,${legacyValue(["tc.CAIXA", 50], ["tco.CAIXA", 50], "Sem caixa")} AS CAIXA,t.CDCAIXAORIGEM,${legacyValue(["tco.CAIXA", 50], "Nao informada")} AS CAIXA_ORIGEM,'PENDENTE' AS ORIGEM,${legacyValue(["r.RECEBTO", 50], "A receber")} AS FORMA,${openParcelValue} AS VALOR,${legacyValue(["cl.CLIENTE", 100], ["cl.RAZAO", 100], "Cliente nao informado")} AS DESCRICAO,${legacyValue(["t.NRDOC", 15])} AS DOCUMENTO,t.NRPEDIDO AS PEDIDO,t.PARCELA,t.CONTROLE AS IDMOVIMENTO,'Pendente' AS STATUS_MOVIMENTO ${pendingFrom} ORDER BY COALESCE(t.DTMOV,t.DTLOG) DESC,t.CONTROLE DESC`,
        pending.params,
      );
      movimentos.push(...pendingRows);
      pendingTotal = {
        qtd: Number(pendingSummary.QTD || 0),
        valor: Number(pendingSummary.TOTAL || 0),
      };
    }
    const resumo = summaries.reduce(
        (total, row) => ({
          QTD_MOVIMENTOS:
            total.QTD_MOVIMENTOS + Number(row.QTD_MOVIMENTOS || 0),
          ENTRADAS: total.ENTRADAS + Number(row.ENTRADAS || 0),
          SAIDAS: total.SAIDAS + Number(row.SAIDAS || 0),
          SALDO: total.SALDO + Number(row.SALDO || 0),
        }),
        { QTD_MOVIMENTOS: 0, ENTRADAS: 0, SAIDAS: 0, SALDO: 0 },
      ),
      byDay = new Map();
    resumo.QTD_PENDENTES = pendingTotal.qtd;
    resumo.PENDENTES = pendingTotal.valor;
    // Total operacional que passou pelo caixa: valores ja recebidos e titulos
    // ainda abertos. SALDO continua estritamente financeiro (dinheiro efetivo).
    resumo.TOTAL_PROCESSADO = resumo.ENTRADAS + resumo.PENDENTES;
    resumo.QTD_MOVIMENTOS += pendingTotal.qtd;
    for (const row of movimentos) {
      if (!row.STATUS_MOVIMENTO)
        row.STATUS_MOVIMENTO =
          row.ORIGEM === "RECEBIMENTO"
            ? "Recebido"
            : Number(row.VALOR || 0) < 0
              ? "Saída"
              : "Entrada";
    }
    for (const row of dailyRows) {
      const key = new Date(row.DIA).toISOString().slice(0, 10),
        current = byDay.get(key) || {
          DIA: row.DIA,
          ENTRADAS: 0,
          SAIDAS: 0,
          SALDO: 0,
        };
      current.ENTRADAS += Number(row.ENTRADAS || 0);
      current.SAIDAS += Number(row.SAIDAS || 0);
      current.SALDO += Number(row.SALDO || 0);
      byDay.set(key, current);
    }
    const diario = [...byDay.values()].sort(
      (a, b) => new Date(a.DIA) - new Date(b.DIA),
    );
    movimentos.sort(
      (a, b) =>
        new Date(b.DATA_MOVIMENTO) - new Date(a.DATA_MOVIMENTO) ||
        Number(b.IDMOVIMENTO) - Number(a.IDMOVIMENTO),
    );
    movimentos.length = Math.min(movimentos.length, limit);
    return { ok: true, resumo, diario, movimentos, limite: limit };
  }),
);
router.get(
  "/controle-caixa/analises",
  run(async (db, req) => {
    const requested = String(req.query.origem || "").toLowerCase(),
      origins = requested ? [requested] : ["recebimento", "movimento"],
      fields = ["FORMA", "CAIXA", "HORA"],
      grouped = Object.fromEntries(fields.map((field) => [field, new Map()]));
    for (const origem of origins) {
      const { parts, params } = unionParts({ ...req.query, origem });
      if (!parts.length) continue;
      const rows = await query(
        db,
        `SELECT FIRST 1000 x.* FROM (${parts[0]}) x ORDER BY x.DATA_MOVIMENTO DESC`,
        params,
      );
      for (const field of fields) {
        for (const row of rows) {
          const key = String(row[field] ?? ""),
            current = grouped[field].get(key) || {
              [field]: row[field],
              ATENDIMENTOS: 0,
              ENTRADAS: 0,
              SAIDAS: 0,
              SALDO: 0,
            };
          const value = Number(row.VALOR || 0);
          current.ATENDIMENTOS += 1;
          current.ENTRADAS += value >= 0 ? value : 0;
          current.SAIDAS += value < 0 ? Math.abs(value) : 0;
          current.SALDO += value;
          grouped[field].set(key, current);
        }
      }
    }
    const result = (field) =>
        [...grouped[field].values()].sort((a, b) =>
          String(a[field] ?? "").localeCompare(String(b[field] ?? "")),
        ),
      por_forma = result("FORMA"),
      por_caixa = result("CAIXA"),
      por_hora = result("HORA");
    return { ok: true, por_forma, por_caixa, por_hora };
  }),
);

router.post("/controle-caixa/fechar", async (req, res) => {
  try {
    const company = integer(req.body?.empresa),
      cash = integer(req.body?.caixa),
      date = String(req.body?.data || "").slice(0, 10),
      counted = Number(req.body?.valor_contado),
      note = String(req.body?.observacao || "")
        .trim()
        .slice(0, 500);
    if (
      !company ||
      !cash ||
      !validDate(date) ||
      !Number.isFinite(counted) ||
      counted < 0
    )
      throw Object.assign(
        new Error("Informe empresa, caixa, data e o valor contado."),
        { status: 400 },
      );
    if (date > today())
      throw Object.assign(new Error("Nao e possivel fechar uma data futura."), {
        status: 400,
      });
    const day = firebirdDate(date);
    await prepareCashSchema();
    const result = await withWriteTransaction(async (tx) => {
      await ensureClosings(tx);
      await ensureOpenings(tx);
      const opening = await tx.singleton(
        "SELECT FIRST 1 IDABERTURA FROM DASH_CAIXA_ABERTURA WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?",
        [company, cash, day],
      );
      if (!opening)
        throw Object.assign(new Error("Abra o caixa antes de realizar o fechamento."), { status: 409 });
      const existing = await tx.singleton(
        "SELECT FIRST 1 IDFECHAMENTO FROM DASH_CAIXA_FECHAMENTO WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?",
        [company, cash, day],
      );
      if (existing)
        throw Object.assign(new Error("Este caixa ja possui fechamento nesta data."), { status: 409 });
      const row =
          (
            await tx.query(
              `SELECT COUNT(*) AS QTD_MOVIMENTOS,SUM(CASE WHEN x.VALOR>=0 THEN x.VALOR ELSE 0 END) AS ENTRADAS,SUM(CASE WHEN x.VALOR<0 THEN ABS(x.VALOR) ELSE 0 END) AS SAIDAS,SUM(x.VALOR) AS SALDO FROM (SELECT COALESCE(c.TOTALPG,c.VALOR,0) AS VALOR FROM CTARECEBERCAIXA c WHERE c.IDEMPRESA=? AND c.CAIXA=? AND c.DTCOB>=? AND c.DTCOB<DATEADD(1 DAY TO CAST(? AS DATE)) AND COALESCE(c.CANCELADO,0)=0 UNION ALL SELECT COALESCE(m.VALOR,0) FROM MOV_PAGTO m WHERE m.IDEMPRESA=? AND m.CDCAIXA=? AND m.DT_MOV>=? AND m.DT_MOV<DATEADD(1 DAY TO CAST(? AS DATE))) x`,
              [company, cash, day, day, company, cash, day, day],
            )
          )[0] || {},
        summary = {
          QTD_MOVIMENTOS: Number(row.QTD_MOVIMENTOS || 0),
          ENTRADAS: Number(row.ENTRADAS || 0),
          SAIDAS: Number(row.SAIDAS || 0),
          SALDO: Number(row.SALDO || 0),
        },
        difference = Math.round((counted - summary.SALDO) * 100) / 100,
        next = await tx.singleton(
          "SELECT NEXT VALUE FOR GEN_DASH_CAIXA_FECHAMENTO AS ID FROM RDB$DATABASE",
        );
      await tx.execute(
        "INSERT INTO DASH_CAIXA_FECHAMENTO (IDFECHAMENTO,IDEMPRESA,CDCAIXA,DATA_CAIXA,ENTRADAS,SAIDAS,SALDO_SISTEMA,VALOR_CONTADO,DIFERENCA,QTD_MOVIMENTOS,OBSERVACAO,USUARIO_ID,FECHADO_EM,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
        [
          Number(next.ID),
          company,
          cash,
          day,
          summary.ENTRADAS,
          summary.SAIDAS,
          summary.SALDO,
          counted,
          difference,
          summary.QTD_MOVIMENTOS,
          note,
          userId(req),
        ],
      );
      return { id: Number(next.ID), summary, difference };
    });
    res.json({
      ok: true,
      idfechamento: result.id,
      apuracao: result.summary,
      valor_contado: counted,
      diferenca: result.difference,
      mensagem: `Caixa fechado com sucesso. Diferenca: R$ ${result.difference.toFixed(2)}.`,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/controle-caixa/abrir", async (req, res) => {
  try {
    const company = integer(req.body?.empresa),
      cash = integer(req.body?.caixa),
      date = String(req.body?.data || "").slice(0, 10),
      initial = Math.round(Number(req.body?.valor_inicial || 0) * 100) / 100,
      note = String(req.body?.observacao || "").trim().slice(0, 500);
    if (!company || !cash || !validDate(date) || !Number.isFinite(initial) || initial < 0)
      throw Object.assign(new Error("Informe empresa, caixa, data e um valor inicial valido."), { status: 400 });
    if (date > today())
      throw Object.assign(new Error("Nao e possivel abrir uma data futura."), { status: 400 });
    const day = firebirdDate(date);
    await prepareCashSchema();
    const result = await withWriteTransaction(async (tx) => {
      await ensureOpenings(tx);
      await ensureClosings(tx);
      if (!(await tx.singleton("SELECT FIRST 1 1 AS OK FROM CONFIGURACAO WHERE IDEMPRESA=?", [company])))
        throw Object.assign(new Error("Empresa nao encontrada."), { status: 400 });
      if (!(await tx.singleton("SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0", [cash])))
        throw Object.assign(new Error("Selecione um caixa ativo."), { status: 400 });
      if (await tx.singleton("SELECT FIRST 1 IDFECHAMENTO FROM DASH_CAIXA_FECHAMENTO WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?", [company,cash,day]))
        throw Object.assign(new Error("Este caixa ja foi fechado nesta data."), { status: 409 });
      if (await tx.singleton("SELECT FIRST 1 IDABERTURA FROM DASH_CAIXA_ABERTURA WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?", [company,cash,day]))
        throw Object.assign(new Error("Este caixa ja esta aberto nesta data."), { status: 409 });
      let movement = null;
      if (initial > 0) {
        const payment = await tx.singleton(`SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ${moneyFormOrder}`);
        if (!payment) throw Object.assign(new Error("Nenhuma forma de pagamento ativa foi encontrada."), { status: 400 });
        const inserted = await tx.query("INSERT INTO MOV_PAGTO (IDEMPRESA,CDCAIXA,ASSUNTO,VALOR,DT_MOV,SIST_ALT,CDRECEBTO,HORALOG,CDCAIXAORIGEM) VALUES (?,?,?,?,?,'LOCAL',?,CURRENT_TIMESTAMP,?) RETURNING IDMOVCAIXA", [company,cash,"ABERTURA DE CAIXA",initial,day,payment.CDRECEBTO,cash]);
        movement = Number(inserted[0]?.IDMOVCAIXA);
      }
      const next = await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_CAIXA_ABERTURA AS ID FROM RDB$DATABASE");
      await tx.execute("INSERT INTO DASH_CAIXA_ABERTURA (IDABERTURA,IDEMPRESA,CDCAIXA,DATA_CAIXA,VALOR_INICIAL,OBSERVACAO,USUARIO_ID,ABERTO_EM,IDMOVCAIXA,SIST_ALT) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,'LOCAL')", [Number(next.ID),company,cash,day,initial,note,userId(req),movement]);
      return { id: Number(next.ID), movement };
    });
    res.json({ ok:true,idabertura:result.id,movimento_caixa:result.movement,mensagem:`Caixa aberto com sucesso com saldo inicial de R$ ${initial.toFixed(2)}.` });
  } catch (error) {
    res.status(error.status || 500).json({ ok:false,erro:error.message });
  }
});

router.post("/controle-caixa/movimentar", async (req, res) => {
  try {
    const operation = String(req.body?.operacao || "")
        .trim()
        .toLowerCase(),
      company = integer(req.body?.empresa),
      cash = integer(req.body?.caixa),
      amount = Math.round(Number(req.body?.valor) * 100) / 100,
      date = String(req.body?.data || "").slice(0, 10),
      note = String(req.body?.historico || "").trim();
    if (
      !["suprimento", "sangria"].includes(operation) ||
      !company ||
      !cash ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !validDate(date)
    )
      throw Object.assign(
        new Error(
          "Informe operacao, empresa, caixa, data e um valor maior que zero.",
        ),
        { status: 400 },
      );
    if (date > today())
      throw Object.assign(
        new Error("A data do movimento nao pode ser futura."),
        { status: 400 },
      );
    const day = firebirdDate(date);
    const result = await withWriteTransaction(async (tx) => {
      if (
        !(await tx.singleton(
          "SELECT FIRST 1 1 AS OK FROM CONFIGURACAO WHERE IDEMPRESA=?",
          [company],
        ))
      )
        throw Object.assign(new Error("Empresa nao encontrada."), {
          status: 400,
        });
      if (
        !(await tx.singleton(
          "SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0",
          [cash],
        ))
      )
        throw Object.assign(new Error("Selecione um caixa ativo."), {
          status: 400,
        });
      await ensureCashOpen(tx, company, day, [cash]);
      const payment = await tx.singleton(
        `SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ${moneyFormOrder}`,
      );
      if (!payment)
        throw Object.assign(
          new Error("Nenhuma forma de pagamento ativa foi encontrada."),
          { status: 400 },
        );
      const subject =
          `${operation === "sangria" ? "SANGRIA" : "SUPRIMENTO"}${note ? ` - ${note}` : ""}`.slice(
            0,
            100,
          ),
        inserted = await tx.query(
          "INSERT INTO MOV_PAGTO (IDEMPRESA,CDCAIXA,ASSUNTO,VALOR,DT_MOV,SIST_ALT,CDRECEBTO,HORALOG,CDCAIXAORIGEM) VALUES (?,?,?,?,?,'LOCAL',?,CURRENT_TIMESTAMP,?) RETURNING IDMOVCAIXA",
          [
            company,
            cash,
            subject,
            (operation === "sangria" ? -1 : 1) * amount,
            day,
            payment.CDRECEBTO,
            cash,
          ],
        ),
        cashMovement = Number(inserted[0]?.IDMOVCAIXA),
        response = {
          movimento_caixa: cashMovement,
          movimento_bancario: null,
          tesouraria_criada: false,
        };
      if (operation === "sangria") {
        let bank = await tx.singleton(
          "SELECT FIRST 1 CDBANCO FROM BANCO WHERE UPPER(TRIM(BANCO))='TESOURARIA'",
        );
        if (!bank) {
          bank = await tx.singleton(
            "SELECT COALESCE(MAX(CDBANCO),0)+1 AS CDBANCO FROM BANCO",
          );
          await tx.execute(
            "INSERT INTO BANCO (CDBANCO,BANCO,EMITEBOLETO,NUMCONTA,AGENCIA,NUMARQUIVO,SIST_ALT,PADRAOLOJA) VALUES (?,'TESOURARIA',0,'CAIXA','TES',1,'LOCAL',0)",
            [bank.CDBANCO],
          );
          response.tesouraria_criada = true;
        }
        const next = await tx.singleton(
          "SELECT COALESCE(MAX(CONTROLE),0)+1 AS ID FROM MOV_BANCARIO",
        );
        await tx.execute(
          "INSERT INTO MOV_BANCARIO (CONTROLE,CDBANCO,AGENCIA,NUMCONTA,NUMDOC,IDUSUARIO,IDEMPRESA,DESCRICAO,HISTORICO,DTLANCAMENTO,VALOR,TPLANCAMENTO,CDRECEBTO,STATUS,CONTROLE_CTA,SIST_ALT) VALUES (?,?,'TES','CAIXA',?,?,?,?,?,?,?,0,?,0,?,'LOCAL')",
          [
            next.ID,
            bank.CDBANCO,
            `SANGRIA-${cashMovement}`,
            userId(req),
            company,
            "Sangria recebida na Tesouraria",
            note.slice(0, 255),
            day,
            amount,
            payment.CDRECEBTO,
            cashMovement,
          ],
        );
        response.movimento_bancario = Number(next.ID);
      }
      return response;
    });
    const action = operation === "sangria" ? "retirado do" : "adicionado ao";
    res.json({
      ok: true,
      ...result,
      mensagem: `Valor de R$ ${amount.toFixed(2)} ${action} caixa com sucesso.${operation === "sangria" ? " A sangria foi enviada para a Tesouraria." : ""}`,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

async function loadMoveRow(tx, item) {
  if (item.origin === "RECEBIMENTO")
    return tx.singleton(
      `SELECT c.CAIXA AS CAIXA,CAST(c.DTCOB AS DATE) AS DATA_MOVIMENTO,COALESCE(c.TOTALPG,c.VALOR,0) AS VALOR,c.NRPEDIDO,c.PARCELA,${legacyValue(["c.NRDOC", 15])} AS NRDOC,${legacyValue(["cl.CLIENTE", 100], ["cl.RAZAO", 100], ["c.HISTORICO", 255], ["c.NRDOC", 15], "Recebimento")} AS DESCRICAO FROM CTARECEBERCAIXA c LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=c.CDCLIENTE WHERE c.CONTROLE=? AND c.IDEMPRESA=? AND COALESCE(c.CANCELADO,0)=0`,
      [item.movement, item.company],
    );
  if (item.origin === "MOVIMENTO")
    return tx.singleton(
      `SELECT CDCAIXA AS CAIXA,CAST(DT_MOV AS DATE) AS DATA_MOVIMENTO,COALESCE(VALOR,0) AS VALOR,${legacyValue(["ASSUNTO", 100], "Movimento avulso")} AS DESCRICAO FROM MOV_PAGTO WHERE IDMOVCAIXA=? AND IDEMPRESA=?`,
      [item.movement, item.company],
    );
  return tx.singleton(
    `SELECT t.CAIXA AS CAIXA,COALESCE(CAST(t.DTMOV AS DATE),CAST(t.DTLOG AS DATE),CURRENT_DATE) AS DATA_MOVIMENTO,COALESCE(t.DIVIDA,t.VALOR,0) AS VALOR,t.NRPEDIDO,t.PARCELA,${legacyValue(["t.NRDOC", 15])} AS NRDOC,${legacyValue(["cl.CLIENTE", 100], ["cl.RAZAO", 100], ["t.HISTORICO", 255], ["t.NRDOC", 15], "Parcela pendente")} AS DESCRICAO FROM CTARECEBER t LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=t.CDCLIENTE WHERE t.CONTROLE=? AND t.IDEMPRESA=? AND t.STATUS=1`,
    [item.movement, item.company],
  );
}

router.post("/controle-caixa/mover", async (req, res) => {
  try {
    const items = readMoveItems(req.body);
    await prepareCashSchema();
    await withWriteTransaction(async (tx) => {
      await ensureTransfers(tx);
      for (const destination of new Set(items.map((item) => item.destination))) {
        if (
          !(await tx.singleton(
            "SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0",
            [destination],
          ))
        )
          throw Object.assign(new Error("O caixa de destino nao esta ativo."), {
            status: 400,
          });
      }
      for (const item of items) {
        const row = await loadMoveRow(tx, item);
        if (!row)
          throw Object.assign(
            new Error("O registro nao foi encontrado ou foi cancelado."),
            { status: 400 },
          );
        if (Number(row.CAIXA) !== item.current)
          throw Object.assign(
            new Error("O registro foi alterado por outro usuario. Atualize a tela."),
            { status: 409 },
          );
        const movementDate = firebirdDate(row.DATA_MOVIMENTO);
        await ensureCashOpen(tx, item.company, movementDate, [item.current, item.destination]);
        for (const step of planCashMove({ ...item, row }))
          await tx.execute(step.sql, step.params);
        const next = await tx.singleton(
          "SELECT NEXT VALUE FOR GEN_DASH_CAIXA_TRANSF AS ID FROM RDB$DATABASE",
        );
        await tx.execute(
          "INSERT INTO DASH_CAIXA_TRANSFERENCIA (IDTRANSFERENCIA,ORIGEM,IDMOVIMENTO,IDEMPRESA,CAIXA_ANTERIOR,CAIXA_DESTINO,DATA_MOVIMENTO,VALOR,DESCRICAO,USUARIO_ID,TRANSFERIDO_EM,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
          [
            next.ID,
            item.origin,
            item.movement,
            item.company,
            item.current,
            item.destination,
            movementDate,
            Number(row.VALOR || 0),
            String(row.DESCRICAO || "").slice(0, 255),
            userId(req),
          ],
        );
      }
    });
    const destination = items[0]?.destination;
    res.json({
      ok: true,
      mensagem:
        items.length === 1
          ? "Registro movido para o caixa de destino com sucesso."
          : `${items.length} registros movidos para o caixa de destino com sucesso.`,
      movidos: items.length,
      caixa_destino: destination,
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/controle-caixa/transferir-valor", async (req, res) => {
  try {
    const company = integer(req.body?.empresa),
      origin = integer(req.body?.caixa_origem),
      destination = integer(req.body?.caixa_destino),
      payment = integer(req.body?.forma),
      date = String(req.body?.data || "").slice(0, 10),
      amount = Math.round(Number(req.body?.valor) * 100) / 100,
      note = String(req.body?.historico || "").trim().slice(0, 180);
    if (!company || !origin || !destination || origin === destination || !validDate(date) || !Number.isFinite(amount) || amount <= 0)
      throw Object.assign(new Error("Informe empresa, caixas diferentes, data e valor maior que zero."), { status: 400 });
    if (date > today())
      throw Object.assign(new Error("A data da transferencia nao pode ser futura."), { status: 400 });
    const day = firebirdDate(date);
    await prepareCashSchema();
    const result = await withWriteTransaction(async (tx) => {
      await ensureTransfers(tx);
      for (const cash of [origin, destination])
        if (!(await tx.singleton("SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0", [cash])))
          throw Object.assign(new Error(`O caixa ${cash} nao esta ativo.`), { status: 400 });
      await ensureCashOpen(tx, company, day, [origin, destination]);
      const selectedPayment = payment
        ? await tx.singleton("SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE CDRECEBTO=? AND COALESCE(INATIVO,0)=0", [payment])
        : await tx.singleton(`SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ${moneyFormOrder}`);
      if (!selectedPayment) throw Object.assign(new Error("Selecione uma forma de pagamento ativa."), { status: 400 });
      const description = `TRANSFERENCIA CAIXA ${origin} PARA ${destination}${note ? ` - ${note}` : ""}`.slice(0, 100);
      const insert = async (cash, value) => {
        const rows = await tx.query(
          "INSERT INTO MOV_PAGTO (IDEMPRESA,CDCAIXA,ASSUNTO,VALOR,DT_MOV,SIST_ALT,CDRECEBTO,HORALOG,CDCAIXAORIGEM) VALUES (?,?,?,?,?,'LOCAL',?,CURRENT_TIMESTAMP,?) RETURNING IDMOVCAIXA",
          [company, cash, description, value, day, selectedPayment.CDRECEBTO, origin],
        );
        return Number(rows[0]?.IDMOVCAIXA);
      };
      const output = await insert(origin, -amount),
        input = await insert(destination, amount),
        next = await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_CAIXA_TRANSF AS ID FROM RDB$DATABASE");
      await tx.execute(
        "INSERT INTO DASH_CAIXA_TRANSFERENCIA (IDTRANSFERENCIA,ORIGEM,IDMOVIMENTO,IDEMPRESA,CAIXA_ANTERIOR,CAIXA_DESTINO,DATA_MOVIMENTO,VALOR,DESCRICAO,USUARIO_ID,TRANSFERIDO_EM,SIST_ALT) VALUES (?,'VALOR',?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
        [next.ID, output, company, origin, destination, day, amount, description, userId(req)],
      );
      return { movimento_saida: output, movimento_entrada: input };
    });
    res.json({ ok: true, ...result, mensagem: "Valor transferido entre os caixas com sucesso." });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

export default router;
