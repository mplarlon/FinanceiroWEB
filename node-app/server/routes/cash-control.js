import express from "express";
import { query, withDatabase, withWriteTransaction } from "../db.js";

const router = express.Router();
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
const firebirdDate = (value) => {
  const [year, month, day] = String(value)
    .slice(0, 10)
    .split("-")
    .map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};
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

async function ensureCashOpen(tx, company, date, cashes) {
  if (!(await relationExists(tx, "DASH_CAIXA_FECHAMENTO"))) return;
  for (const cash of new Set(cashes.filter(Boolean))) {
    const closing = await tx.singleton(
      "SELECT FIRST 1 IDFECHAMENTO FROM DASH_CAIXA_FECHAMENTO WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?",
      [company, cash, date],
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
        "SELECT CDCAIXA,COALESCE(CAIXA,'Caixa sem nome') AS CAIXA FROM TPCAIXA WHERE COALESCE(INATIVO,0)=0 ORDER BY CDCAIXA",
      ),
      formas = await query(
        db,
        "SELECT CDRECEBTO,COALESCE(RECEBTO,'Forma sem nome') AS FORMA FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY RECEBTO,CDRECEBTO",
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
        `SELECT FIRST ${limit} f.*,cfg.NOMEEMPRESA AS EMPRESA,tc.CAIXA,COALESCE(u.NOMECOMPLETO,u.LOGIN) AS USUARIO FROM DASH_CAIXA_FECHAMENTO f LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA=f.IDEMPRESA LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=f.CDCAIXA LEFT JOIN USUARIOS u ON u.IDUSUARIO=f.USUARIO_ID ${clause} ORDER BY f.DATA_CAIXA DESC,f.FECHADO_EM DESC`,
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
        `SELECT FIRST ${limit} t.*,cfg.NOMEEMPRESA AS EMPRESA,co.CAIXA AS CAIXA_ORIGEM,cd.CAIXA AS CAIXA_DESTINO_NOME,COALESCE(u.NOMECOMPLETO,u.LOGIN) AS USUARIO FROM DASH_CAIXA_TRANSFERENCIA t LEFT JOIN CONFIGURACAO cfg ON cfg.IDEMPRESA=t.IDEMPRESA LEFT JOIN TPCAIXA co ON co.CDCAIXA=t.CAIXA_ANTERIOR LEFT JOIN TPCAIXA cd ON cd.CDCAIXA=t.CAIXA_DESTINO LEFT JOIN USUARIOS u ON u.IDUSUARIO=t.USUARIO_ID ${clause} ORDER BY t.TRANSFERIDO_EM DESC,t.IDTRANSFERENCIA DESC`,
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
    const term = `%${search.toUpperCase()}%`;
    rec.where.push(
      "(UPPER(COALESCE(c.NRDOC,'')) LIKE ? OR UPPER(COALESCE(c.HISTORICO,'')) LIKE ? OR UPPER(COALESCE(cl.CLIENTE,cl.RAZAO,'')) LIKE ?)",
    );
    rec.params.push(term, term, term);
    mov.where.push("UPPER(COALESCE(m.ASSUNTO,'')) LIKE ?");
    mov.params.push(term);
  }
  if (["1", "true", "on"].includes(String(args.nao_carteiras)))
    rec.where.push("UPPER(COALESCE(r.RECEBTO,'')) NOT CONTAINING 'CARTEIRA'");
  if (["1", "true", "on"].includes(String(args.nao_vales)))
    rec.where.push("UPPER(COALESCE(r.RECEBTO,'')) NOT CONTAINING 'VALE'");
  if (origin === "" || origin === "recebimento") {
    parts.push(
      `SELECT c.DTCOB AS DATA_MOVIMENTO,EXTRACT(HOUR FROM COALESCE(c.HORALOG,c.DTCOB)) AS HORA,c.IDEMPRESA,c.CAIXA AS CDCAIXA,tc.CAIXA AS CAIXA,c.CDCAIXAORIGEM,tco.CAIXA AS CAIXA_ORIGEM,'RECEBIMENTO' AS ORIGEM,r.RECEBTO AS FORMA,COALESCE(c.TOTALPG,c.VALOR,0) AS VALOR,cl.CLIENTE AS DESCRICAO,c.NRDOC AS DOCUMENTO,c.PARCELA,c.CONTROLE AS IDMOVIMENTO FROM CTARECEBERCAIXA c LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=c.CAIXA LEFT JOIN TPCAIXA tco ON tco.CDCAIXA=c.CDCAIXAORIGEM LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(c.TPPAGTO,c.CODPAGTO) LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=c.CDCLIENTE WHERE ${rec.where.join(" AND ") || "1=1"}`,
    );
    params.push(...rec.params);
  }
  if (
    (origin === "" || origin === "movimento") &&
    !["1", "true", "on"].includes(String(args.nao_saidas_entradas))
  ) {
    parts.push(
      `SELECT m.DT_MOV AS DATA_MOVIMENTO,EXTRACT(HOUR FROM COALESCE(m.HORALOG,m.DT_MOV)) AS HORA,m.IDEMPRESA,m.CDCAIXA,COALESCE(tc.CAIXA,'Sem caixa') AS CAIXA,m.CDCAIXAORIGEM,COALESCE(tco.CAIXA,'Nao informada') AS CAIXA_ORIGEM,'MOVIMENTO' AS ORIGEM,COALESCE(r.RECEBTO,'Movimento avulso') AS FORMA,COALESCE(m.VALOR,0) AS VALOR,COALESCE(m.ASSUNTO,'Movimento sem historico') AS DESCRICAO,CAST(m.IDMOVCAIXA AS VARCHAR(20)) AS DOCUMENTO,NULL AS PARCELA,m.IDMOVCAIXA AS IDMOVIMENTO FROM MOV_PAGTO m LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=m.CDCAIXA LEFT JOIN TPCAIXA tco ON tco.CDCAIXA=m.CDCAIXAORIGEM LEFT JOIN RECEBTO r ON r.CDRECEBTO=m.CDRECEBTO WHERE ${mov.where.join(" AND ") || "1=1"}`,
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
    if (includePending) {
      // Titulo aberto ainda nao possui necessariamente um caixa de quitacao
      // definitivo. Para que todas as vendas do dia aparecam, o filtro de
      // pendencias respeita empresa e periodo, mas nao elimina o titulo pelo
      // campo CAIXA. O caixa efetivo continua informado na propria linha.
      const pending = buildCashFilters({ ...req.query, caixa: "" }, {
        date: "COALESCE(t.DTMOV,t.DTLOG)",
        company: "t.IDEMPRESA",
        cash: "t.CAIXA",
        origin: "t.CDCAIXAORIGEM",
      });
      pending.where.push("t.STATUS=1");
      const payment = integer(req.query.forma);
      if (payment) {
        pending.where.push("COALESCE(t.TPPAGTO,t.CODPAGTO)=?");
        pending.params.push(payment);
      }
      pendingRows = await query(
        db,
        `SELECT FIRST ${limit} COALESCE(t.DTMOV,t.DTLOG) AS DATA_MOVIMENTO,EXTRACT(HOUR FROM COALESCE(t.HORALOG,t.DTMOV,t.DTLOG)) AS HORA,t.IDEMPRESA,COALESCE(t.CAIXA,t.CDCAIXAORIGEM) AS CDCAIXA,COALESCE(tc.CAIXA,tco.CAIXA,'Sem caixa') AS CAIXA,t.CDCAIXAORIGEM,COALESCE(tco.CAIXA,'Nao informada') AS CAIXA_ORIGEM,'PENDENTE' AS ORIGEM,COALESCE(r.RECEBTO,'A receber') AS FORMA,COALESCE(t.DIVIDA,t.VALOR,0) AS VALOR,COALESCE(cl.CLIENTE,cl.RAZAO,'Cliente nao informado') AS DESCRICAO,t.NRDOC AS DOCUMENTO,t.PARCELA,t.CONTROLE AS IDMOVIMENTO,'Pendente' AS STATUS_MOVIMENTO FROM CTARECEBER t LEFT JOIN TPCAIXA tc ON tc.CDCAIXA=t.CAIXA LEFT JOIN TPCAIXA tco ON tco.CDCAIXA=t.CDCAIXAORIGEM LEFT JOIN RECEBTO r ON r.CDRECEBTO=COALESCE(t.TPPAGTO,t.CODPAGTO) LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=t.CDCLIENTE WHERE ${pending.where.join(" AND ") || "1=1"} ORDER BY COALESCE(t.DTMOV,t.DTLOG) DESC,t.CONTROLE DESC`,
        pending.params,
      );
      movimentos.push(...pendingRows);
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
    resumo.QTD_PENDENTES = pendingRows.length;
    resumo.PENDENTES = pendingRows.reduce(
      (total, row) => total + Number(row.VALOR || 0),
      0,
    );
    // Total operacional que passou pelo caixa: valores ja recebidos e titulos
    // ainda abertos. SALDO continua estritamente financeiro (dinheiro efetivo).
    resumo.TOTAL_PROCESSADO = resumo.ENTRADAS + resumo.PENDENTES;
    resumo.QTD_MOVIMENTOS += pendingRows.length;
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
    const result = await withWriteTransaction(async (tx) => {
      await ensureClosings(tx);
      await ensureOpenings(tx);
      const opening = await tx.singleton(
        "SELECT FIRST 1 IDABERTURA FROM DASH_CAIXA_ABERTURA WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?",
        [company, cash, date],
      );
      if (!opening)
        throw Object.assign(new Error("Abra o caixa antes de realizar o fechamento."), { status: 409 });
      const existing = await tx.singleton(
        "SELECT FIRST 1 IDFECHAMENTO FROM DASH_CAIXA_FECHAMENTO WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?",
        [company, cash, date],
      );
      if (existing)
        throw Object.assign(new Error("Este caixa ja possui fechamento nesta data."), { status: 409 });
      const row =
          (
            await tx.query(
              `SELECT COUNT(*) AS QTD_MOVIMENTOS,SUM(CASE WHEN x.VALOR>=0 THEN x.VALOR ELSE 0 END) AS ENTRADAS,SUM(CASE WHEN x.VALOR<0 THEN ABS(x.VALOR) ELSE 0 END) AS SAIDAS,SUM(x.VALOR) AS SALDO FROM (SELECT COALESCE(c.TOTALPG,c.VALOR,0) AS VALOR FROM CTARECEBERCAIXA c WHERE c.IDEMPRESA=? AND c.CAIXA=? AND c.DTCOB>=? AND c.DTCOB<DATEADD(1 DAY TO CAST(? AS DATE)) AND COALESCE(c.CANCELADO,0)=0 UNION ALL SELECT COALESCE(m.VALOR,0) FROM MOV_PAGTO m WHERE m.IDEMPRESA=? AND m.CDCAIXA=? AND m.DT_MOV>=? AND m.DT_MOV<DATEADD(1 DAY TO CAST(? AS DATE))) x`,
              [company, cash, date, date, company, cash, date, date],
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
          date,
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
    const result = await withWriteTransaction(async (tx) => {
      await ensureOpenings(tx);
      await ensureClosings(tx);
      if (!(await tx.singleton("SELECT FIRST 1 1 AS OK FROM CONFIGURACAO WHERE IDEMPRESA=?", [company])))
        throw Object.assign(new Error("Empresa nao encontrada."), { status: 400 });
      if (!(await tx.singleton("SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0", [cash])))
        throw Object.assign(new Error("Selecione um caixa ativo."), { status: 400 });
      if (await tx.singleton("SELECT FIRST 1 IDFECHAMENTO FROM DASH_CAIXA_FECHAMENTO WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?", [company,cash,date]))
        throw Object.assign(new Error("Este caixa ja foi fechado nesta data."), { status: 409 });
      if (await tx.singleton("SELECT FIRST 1 IDABERTURA FROM DASH_CAIXA_ABERTURA WHERE IDEMPRESA=? AND CDCAIXA=? AND DATA_CAIXA=?", [company,cash,date]))
        throw Object.assign(new Error("Este caixa ja esta aberto nesta data."), { status: 409 });
      let movement = null;
      if (initial > 0) {
        const payment = await tx.singleton("SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY CASE WHEN UPPER(COALESCE(RECEBTO,'')) CONTAINING 'DINHEIRO' THEN 0 ELSE 1 END,CDRECEBTO");
        if (!payment) throw Object.assign(new Error("Nenhuma forma de pagamento ativa foi encontrada."), { status: 400 });
        const inserted = await tx.query("INSERT INTO MOV_PAGTO (IDEMPRESA,CDCAIXA,ASSUNTO,VALOR,DT_MOV,SIST_ALT,CDRECEBTO,HORALOG,CDCAIXAORIGEM) VALUES (?,?,?,?,?,'LOCAL',?,CURRENT_TIMESTAMP,?) RETURNING IDMOVCAIXA", [company,cash,"ABERTURA DE CAIXA",initial,date,payment.CDRECEBTO,cash]);
        movement = Number(inserted[0]?.IDMOVCAIXA);
      }
      const next = await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_CAIXA_ABERTURA AS ID FROM RDB$DATABASE");
      await tx.execute("INSERT INTO DASH_CAIXA_ABERTURA (IDABERTURA,IDEMPRESA,CDCAIXA,DATA_CAIXA,VALOR_INICIAL,OBSERVACAO,USUARIO_ID,ABERTO_EM,IDMOVCAIXA,SIST_ALT) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,'LOCAL')", [Number(next.ID),company,cash,date,initial,note,userId(req),movement]);
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
      await ensureCashOpen(tx, company, date, [cash]);
      const payment = await tx.singleton(
        "SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY CASE WHEN UPPER(COALESCE(RECEBTO,'')) CONTAINING 'DINHEIRO' THEN 0 ELSE 1 END,CDRECEBTO",
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
            date,
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
            date,
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

router.post("/controle-caixa/mover", async (req, res) => {
  try {
    const origin = String(req.body?.origem || "")
        .trim()
        .toUpperCase(),
      movement = integer(req.body?.movimento),
      company = integer(req.body?.empresa),
      current = integer(req.body?.caixa_atual),
      destination = integer(req.body?.caixa_destino);
    if (
      !["RECEBIMENTO", "MOVIMENTO", "PENDENTE"].includes(origin) ||
      !movement ||
      !company ||
      !current ||
      !destination ||
      current === destination
    )
      throw Object.assign(
        new Error("Movimento ou caixa de destino invalido."),
        { status: 400 },
      );
    await withWriteTransaction(async (tx) => {
      await ensureTransfers(tx);
      if (
        !(await tx.singleton(
          "SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0",
          [destination],
        ))
      )
        throw Object.assign(new Error("O caixa de destino nao esta ativo."), {
          status: 400,
        });
      const row =
        origin === "RECEBIMENTO"
          ? await tx.singleton(
              "SELECT c.CAIXA AS CAIXA,CAST(c.DTCOB AS DATE) AS DATA_MOVIMENTO,COALESCE(c.TOTALPG,c.VALOR,0) AS VALOR,COALESCE(cl.CLIENTE,cl.RAZAO,c.HISTORICO,c.NRDOC,'Recebimento') AS DESCRICAO FROM CTARECEBERCAIXA c LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=c.CDCLIENTE WHERE c.CONTROLE=? AND c.IDEMPRESA=? AND COALESCE(c.CANCELADO,0)=0",
              [movement, company],
            )
          : origin === "MOVIMENTO"
            ? await tx.singleton(
              "SELECT CDCAIXA AS CAIXA,CAST(DT_MOV AS DATE) AS DATA_MOVIMENTO,COALESCE(VALOR,0) AS VALOR,COALESCE(ASSUNTO,'Movimento avulso') AS DESCRICAO FROM MOV_PAGTO WHERE IDMOVCAIXA=? AND IDEMPRESA=?",
              [movement, company],
            )
            : await tx.singleton(
              "SELECT t.CAIXA AS CAIXA,CAST(COALESCE(t.DTMOV,t.DTLOG,CURRENT_DATE) AS DATE) AS DATA_MOVIMENTO,COALESCE(t.DIVIDA,t.VALOR,0) AS VALOR,COALESCE(cl.CLIENTE,cl.RAZAO,t.HISTORICO,t.NRDOC,'Parcela pendente') AS DESCRICAO FROM CTARECEBER t LEFT JOIN CLIENTE cl ON cl.CDCLIENTE=t.CDCLIENTE WHERE t.CONTROLE=? AND t.IDEMPRESA=? AND t.STATUS=1",
              [movement, company],
            );
      if (!row)
        throw Object.assign(
          new Error("O registro nao foi encontrado ou foi cancelado."),
          { status: 400 },
        );
      if (Number(row.CAIXA) !== current)
        throw Object.assign(
          new Error(
            "O registro foi alterado por outro usuario. Atualize a tela.",
          ),
          { status: 409 },
        );
      await ensureCashOpen(tx, company, row.DATA_MOVIMENTO, [current, destination]);
      if (origin === "RECEBIMENTO")
        await tx.execute(
          "UPDATE CTARECEBERCAIXA SET CDCAIXAORIGEM=COALESCE(CDCAIXAORIGEM,CAIXA),CAIXA=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND CAIXA=? AND COALESCE(CANCELADO,0)=0",
          [destination, movement, company, current],
        );
      else if (origin === "MOVIMENTO")
        await tx.execute(
          "UPDATE MOV_PAGTO SET CDCAIXAORIGEM=COALESCE(CDCAIXAORIGEM,CDCAIXA),CDCAIXA=?,DTALTER=CURRENT_TIMESTAMP WHERE IDMOVCAIXA=? AND IDEMPRESA=? AND CDCAIXA=?",
          [destination, movement, company, current],
        );
      else
        await tx.execute(
          "UPDATE CTARECEBER SET CDCAIXAORIGEM=COALESCE(CDCAIXAORIGEM,CAIXA),CAIXA=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=? AND CAIXA=? AND STATUS=1",
          [destination, movement, company, current],
        );
      const next = await tx.singleton(
        "SELECT NEXT VALUE FOR GEN_DASH_CAIXA_TRANSF AS ID FROM RDB$DATABASE",
      );
      await tx.execute(
        "INSERT INTO DASH_CAIXA_TRANSFERENCIA (IDTRANSFERENCIA,ORIGEM,IDMOVIMENTO,IDEMPRESA,CAIXA_ANTERIOR,CAIXA_DESTINO,DATA_MOVIMENTO,VALOR,DESCRICAO,USUARIO_ID,TRANSFERIDO_EM,SIST_ALT) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
        [
          next.ID,
          origin,
          movement,
          company,
          current,
          destination,
          row.DATA_MOVIMENTO,
          Number(row.VALOR || 0),
          String(row.DESCRICAO || "").slice(0, 255),
          userId(req),
        ],
      );
    });
    res.json({
      ok: true,
      mensagem: "Registro movido para o caixa de destino com sucesso.",
      movimento: movement,
      caixa_origem: current,
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
    const result = await withWriteTransaction(async (tx) => {
      await ensureTransfers(tx);
      for (const cash of [origin, destination])
        if (!(await tx.singleton("SELECT FIRST 1 1 AS OK FROM TPCAIXA WHERE CDCAIXA=? AND COALESCE(INATIVO,0)=0", [cash])))
          throw Object.assign(new Error(`O caixa ${cash} nao esta ativo.`), { status: 400 });
      await ensureCashOpen(tx, company, date, [origin, destination]);
      const selectedPayment = payment
        ? await tx.singleton("SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE CDRECEBTO=? AND COALESCE(INATIVO,0)=0", [payment])
        : await tx.singleton("SELECT FIRST 1 CDRECEBTO FROM RECEBTO WHERE COALESCE(INATIVO,0)=0 ORDER BY CASE WHEN UPPER(COALESCE(RECEBTO,'')) CONTAINING 'DINHEIRO' THEN 0 ELSE 1 END,CDRECEBTO");
      if (!selectedPayment) throw Object.assign(new Error("Selecione uma forma de pagamento ativa."), { status: 400 });
      const description = `TRANSFERENCIA CAIXA ${origin} PARA ${destination}${note ? ` - ${note}` : ""}`.slice(0, 100);
      const insert = async (cash, value) => {
        const rows = await tx.query(
          "INSERT INTO MOV_PAGTO (IDEMPRESA,CDCAIXA,ASSUNTO,VALOR,DT_MOV,SIST_ALT,CDRECEBTO,HORALOG,CDCAIXAORIGEM) VALUES (?,?,?,?,?,'LOCAL',?,CURRENT_TIMESTAMP,?) RETURNING IDMOVCAIXA",
          [company, cash, description, value, date, selectedPayment.CDRECEBTO, origin],
        );
        return Number(rows[0]?.IDMOVCAIXA);
      };
      const output = await insert(origin, -amount),
        input = await insert(destination, amount),
        next = await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_CAIXA_TRANSF AS ID FROM RDB$DATABASE");
      await tx.execute(
        "INSERT INTO DASH_CAIXA_TRANSFERENCIA (IDTRANSFERENCIA,ORIGEM,IDMOVIMENTO,IDEMPRESA,CAIXA_ANTERIOR,CAIXA_DESTINO,DATA_MOVIMENTO,VALOR,DESCRICAO,USUARIO_ID,TRANSFERIDO_EM,SIST_ALT) VALUES (?,'VALOR',?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,'LOCAL')",
        [next.ID, output, company, origin, destination, date, amount, description, userId(req)],
      );
      return { movimento_saida: output, movimento_entrada: input };
    });
    res.json({ ok: true, ...result, mensagem: "Valor transferido entre os caixas com sucesso." });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

export default router;
