import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { query, withDatabase, withWriteTransaction } from "../db.js";
import { readJsonConfig } from "../lib/json-config.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});
const fiscalTables = [
  "FISCAL_REGRA_OPERACAO",
  "FISCAL_REGRA_OPERACAO_HIST",
  "FISCAL_REVISAO_ITEM",
  "DASHBOARD_LOGIN_AUDIT",
  "FISCAL_GUIA_CONTABIL",
  "FISCAL_XML_ENTRADA_ITEM",
  "FISCAL_CONTABIL",
];
const fiscalColumns = {
  CONFIGURACAO: ["TOLERANCIA_FISCAL", "INDUSTRIA"],
  CTAPAGAR: [
    "ABATE_PIS_COFINS",
    "BASE_PIS_COFINS_ABATE",
    "PIS_ALIQ_ABATE",
    "COFINS_ALIQ_ABATE",
    "GERA_CREDITO_PIS_COFINS",
    "OBS_FISCAL_ABATE",
    "STATUS_FISCAL_ABATE",
    "MOTIVO_REVISAO_ABATE",
  ],
};
const fiscalDdl = {
  FISCAL_REGRA_OPERACAO: `CREATE TABLE FISCAL_REGRA_OPERACAO (IDREGRA INTEGER NOT NULL PRIMARY KEY,IDEMPRESA INTEGER NOT NULL,CFOP VARCHAR(10),TIPO_NOTA_COD CHAR(1),TIPO_NOTA_DESC VARCHAR(20),CST_ICMS VARCHAR(5),CSOSN VARCHAR(5),CST_PIS VARCHAR(10),CST_COFINS VARCHAR(10),CST_IPI VARCHAR(10),TIPO_OPERACAO VARCHAR(40),GERA_CREDITO_ICMS INTEGER DEFAULT 0,GERA_DEBITO_ICMS INTEGER DEFAULT 0,ICMS_INFORMATIVO INTEGER DEFAULT 0,ICMS_ST INTEGER DEFAULT 0,GERA_CREDITO_PIS INTEGER DEFAULT 0,GERA_DEBITO_PIS INTEGER DEFAULT 0,PIS_INFORMATIVO INTEGER DEFAULT 0,GERA_CREDITO_COFINS INTEGER DEFAULT 0,GERA_DEBITO_COFINS INTEGER DEFAULT 0,COFINS_INFORMATIVO INTEGER DEFAULT 0,GERA_CREDITO_IPI INTEGER DEFAULT 0,GERA_DEBITO_IPI INTEGER DEFAULT 0,IPI_INFORMATIVO INTEGER DEFAULT 0,ENTRA_APURACAO INTEGER DEFAULT 0,ISENTO INTEGER DEFAULT 0,NAO_TRIBUTADO INTEGER DEFAULT 0,SUSPENSO INTEGER DEFAULT 0,EXIGE_REVISAO INTEGER DEFAULT 1,PRIORIDADE INTEGER DEFAULT 0,ATIVO INTEGER DEFAULT 1,ORIGEM_REGRA VARCHAR(30),OBSERVACAO VARCHAR(1000),USUARIO_ULT_ALT INTEGER,DT_ULT_ALT TIMESTAMP)`,
  FISCAL_REGRA_OPERACAO_HIST: `CREATE TABLE FISCAL_REGRA_OPERACAO_HIST (IDHIST INTEGER NOT NULL PRIMARY KEY,IDREGRA INTEGER,IDEMPRESA INTEGER,ACAO VARCHAR(30),DADOS_ANTES BLOB SUB_TYPE TEXT,DADOS_DEPOIS BLOB SUB_TYPE TEXT,USUARIO_ID INTEGER,USUARIO_LOGIN VARCHAR(60),DATA_HORA TIMESTAMP,IP_ORIGEM VARCHAR(50),MOTIVO VARCHAR(1000))`,
  FISCAL_REVISAO_ITEM: `CREATE TABLE FISCAL_REVISAO_ITEM (ID_REVISAO INTEGER NOT NULL PRIMARY KEY,NFE_PRODUTO_ID INTEGER,CHAVE VARCHAR(60) NOT NULL,POSIC INTEGER NOT NULL,CPROD VARCHAR(50) NOT NULL,IDEMPRESA INTEGER,STATUS_ANTERIOR VARCHAR(30),STATUS_NOVO VARCHAR(30),ENTRA_APURACAO INTEGER DEFAULT 0,USUARIO_ID INTEGER,USUARIO_LOGIN VARCHAR(60),DATA_HORA TIMESTAMP,IP_ORIGEM VARCHAR(50),OBSERVACAO VARCHAR(1000),MOTIVO_ALTERACAO VARCHAR(1000),ICMS_BASE_ORIGINAL DOUBLE PRECISION,ICMS_BASE_CALCULADA DOUBLE PRECISION,ICMS_BASE_CORRIGIDA DOUBLE PRECISION,ICMS_ALIQ_ORIGINAL DOUBLE PRECISION,ICMS_ALIQ_CALCULADA DOUBLE PRECISION,ICMS_ALIQ_CORRIGIDA DOUBLE PRECISION,ICMS_VALOR_ORIGINAL DOUBLE PRECISION,ICMS_VALOR_CALCULADO DOUBLE PRECISION,ICMS_VALOR_CORRIGIDO DOUBLE PRECISION,ICMS_ST_BASE_ORIGINAL DOUBLE PRECISION,ICMS_ST_BASE_CALCULADA DOUBLE PRECISION,ICMS_ST_BASE_CORRIGIDA DOUBLE PRECISION,ICMS_ST_ALIQ_ORIGINAL DOUBLE PRECISION,ICMS_ST_ALIQ_CALCULADA DOUBLE PRECISION,ICMS_ST_ALIQ_CORRIGIDA DOUBLE PRECISION,ICMS_ST_VALOR_ORIGINAL DOUBLE PRECISION,ICMS_ST_VALOR_CALCULADO DOUBLE PRECISION,ICMS_ST_VALOR_CORRIGIDO DOUBLE PRECISION,PIS_BASE_ORIGINAL DOUBLE PRECISION,PIS_BASE_CALCULADA DOUBLE PRECISION,PIS_BASE_CORRIGIDA DOUBLE PRECISION,PIS_ALIQ_ORIGINAL DOUBLE PRECISION,PIS_ALIQ_CALCULADA DOUBLE PRECISION,PIS_ALIQ_CORRIGIDA DOUBLE PRECISION,PIS_VALOR_ORIGINAL DOUBLE PRECISION,PIS_VALOR_CALCULADO DOUBLE PRECISION,PIS_VALOR_CORRIGIDO DOUBLE PRECISION,COFINS_BASE_ORIGINAL DOUBLE PRECISION,COFINS_BASE_CALCULADA DOUBLE PRECISION,COFINS_BASE_CORRIGIDA DOUBLE PRECISION,COFINS_ALIQ_ORIGINAL DOUBLE PRECISION,COFINS_ALIQ_CALCULADA DOUBLE PRECISION,COFINS_ALIQ_CORRIGIDA DOUBLE PRECISION,COFINS_VALOR_ORIGINAL DOUBLE PRECISION,COFINS_VALOR_CALCULADO DOUBLE PRECISION,COFINS_VALOR_CORRIGIDO DOUBLE PRECISION,IPI_BASE_ORIGINAL DOUBLE PRECISION,IPI_BASE_CALCULADA DOUBLE PRECISION,IPI_BASE_CORRIGIDA DOUBLE PRECISION,IPI_ALIQ_ORIGINAL DOUBLE PRECISION,IPI_ALIQ_CALCULADA DOUBLE PRECISION,IPI_ALIQ_CORRIGIDA DOUBLE PRECISION,IPI_VALOR_ORIGINAL DOUBLE PRECISION,IPI_VALOR_CALCULADO DOUBLE PRECISION,IPI_VALOR_CORRIGIDO DOUBLE PRECISION)`,
  DASHBOARD_LOGIN_AUDIT: `CREATE TABLE DASHBOARD_LOGIN_AUDIT (IDAUDIT INTEGER NOT NULL PRIMARY KEY,LOGIN_INFORMADO VARCHAR(60),IDUSUARIO INTEGER,EVENTO VARCHAR(30),SUCESSO INTEGER DEFAULT 0,MOTIVO VARCHAR(500),IP_ORIGEM VARCHAR(50),DATA_HORA TIMESTAMP)`,
  FISCAL_GUIA_CONTABIL: `CREATE TABLE FISCAL_GUIA_CONTABIL (IDGUIA INTEGER NOT NULL PRIMARY KEY,IDEMPRESA INTEGER NOT NULL,COMPETENCIA_ANO INTEGER NOT NULL,COMPETENCIA_MES INTEGER NOT NULL,TIPO_GUIA VARCHAR(80),RECEITA VARCHAR(120),ICMS_VALOR DOUBLE PRECISION DEFAULT 0,FECP_VALOR DOUBLE PRECISION DEFAULT 0,JUROS_VALOR DOUBLE PRECISION DEFAULT 0,MULTA_VALOR DOUBLE PRECISION DEFAULT 0,TOTAL_VALOR DOUBLE PRECISION DEFAULT 0,VENCIMENTO DATE,PAGAMENTO DATE,NUMERO_DOCUMENTO VARCHAR(80),NOSSO_NUMERO VARCHAR(80),CODIGO_BARRAS VARCHAR(120),ORIGEM_ARQUIVO VARCHAR(500),TEXTO_EXTRAIDO BLOB SUB_TYPE TEXT,USUARIO_ID INTEGER,USUARIO_LOGIN VARCHAR(60),DATA_HORA TIMESTAMP)`,
  FISCAL_XML_ENTRADA_ITEM: `CREATE TABLE FISCAL_XML_ENTRADA_ITEM (IDXMLITEM INTEGER NOT NULL PRIMARY KEY,IDEMPRESA INTEGER,IDENTRADA INTEGER,CHAVE VARCHAR(60) NOT NULL,POSIC INTEGER,CPROD VARCHAR(60),CODIGOXML VARCHAR(60),NITEM INTEGER,XPROD VARCHAR(500),NCM VARCHAR(15),CFOP VARCHAR(10),VPROD DOUBLE PRECISION DEFAULT 0,ICMS_BASE DOUBLE PRECISION DEFAULT 0,ICMS_ALIQ DOUBLE PRECISION DEFAULT 0,ICMS_VALOR DOUBLE PRECISION DEFAULT 0,ICMS_ST_BASE DOUBLE PRECISION DEFAULT 0,ICMS_ST_ALIQ DOUBLE PRECISION DEFAULT 0,ICMS_ST_VALOR DOUBLE PRECISION DEFAULT 0,FCP_BASE DOUBLE PRECISION DEFAULT 0,FCP_ALIQ DOUBLE PRECISION DEFAULT 0,FCP_VALOR DOUBLE PRECISION DEFAULT 0,FCP_ST_BASE DOUBLE PRECISION DEFAULT 0,FCP_ST_ALIQ DOUBLE PRECISION DEFAULT 0,FCP_ST_VALOR DOUBLE PRECISION DEFAULT 0,PIS_BASE DOUBLE PRECISION DEFAULT 0,PIS_ALIQ DOUBLE PRECISION DEFAULT 0,PIS_VALOR DOUBLE PRECISION DEFAULT 0,COFINS_BASE DOUBLE PRECISION DEFAULT 0,COFINS_ALIQ DOUBLE PRECISION DEFAULT 0,COFINS_VALOR DOUBLE PRECISION DEFAULT 0,IPI_BASE DOUBLE PRECISION DEFAULT 0,IPI_ALIQ DOUBLE PRECISION DEFAULT 0,IPI_VALOR DOUBLE PRECISION DEFAULT 0,XML_ENCONTRADO INTEGER DEFAULT 1,XML_PATH VARCHAR(500),DATA_IMPORTACAO TIMESTAMP)`,
  FISCAL_CONTABIL: `CREATE TABLE FISCAL_CONTABIL (IDCONTABIL INTEGER NOT NULL PRIMARY KEY,ORIGEM VARCHAR(30) NOT NULL,IDEMPRESA INTEGER,IDENTRADA INTEGER,NFE_PRODUTO_ID INTEGER,CHAVE VARCHAR(60) NOT NULL,POSIC INTEGER NOT NULL,CPROD VARCHAR(60) NOT NULL,CFOP_ORIGINAL VARCHAR(10),CFOP_CONTABIL VARCHAR(10),USO_CONSUMO INTEGER DEFAULT 0,ATIVO INTEGER DEFAULT 1,OBSERVACAO VARCHAR(1000),USUARIO_ID INTEGER,USUARIO_LOGIN VARCHAR(60),DATA_HORA TIMESTAMP,IP_ORIGEM VARCHAR(50))`,
};
const fiscalSequences = {
  FISCAL_REGRA_OPERACAO: "GEN_FISCAL_REGRA_OPERACAO_ID",
  FISCAL_REGRA_OPERACAO_HIST: "GEN_FISCAL_REGRA_OPERACAO_H_ID",
  FISCAL_REVISAO_ITEM: "GEN_FISCAL_REVISAO_ITEM_ID",
  DASHBOARD_LOGIN_AUDIT: "GEN_DASHBOARD_LOGIN_AUDIT_ID",
  FISCAL_GUIA_CONTABIL: "GEN_FISCAL_GUIA_CONTABIL_ID",
  FISCAL_XML_ENTRADA_ITEM: "GEN_FISCAL_XML_ENTRADA_ITEM_ID",
  FISCAL_CONTABIL: "GEN_FISCAL_CONTABIL_ID",
};
async function fiscalExists(tx, kind, name) {
  const [table, field] =
    kind === "sequence"
      ? ["RDB$GENERATORS", "RDB$GENERATOR_NAME"]
      : ["RDB$RELATIONS", "RDB$RELATION_NAME"];
  return Boolean(
    await tx.singleton(`SELECT 1 AS OK FROM ${table} WHERE TRIM(${field})=?`, [
      name,
    ]),
  );
}
async function ensureFiscalSchema(tx) {
  const changes = [];
  for (const [table, ddl] of Object.entries(fiscalDdl))
    if (!(await fiscalExists(tx, "table", table))) {
      await tx.execute(ddl);
      changes.push(`created table ${table}`);
    }
  for (const sequence of Object.values(fiscalSequences))
    if (!(await fiscalExists(tx, "sequence", sequence))) {
      await tx.execute(`CREATE SEQUENCE ${sequence}`);
      changes.push(`created sequence ${sequence}`);
    }
  const columnTypes = {
    CONFIGURACAO: {
      TOLERANCIA_FISCAL: "DOUBLE PRECISION",
      INDUSTRIA: "INTEGER DEFAULT 0",
    },
    CTAPAGAR: {
      ABATE_PIS_COFINS: "INTEGER DEFAULT 0",
      BASE_PIS_COFINS_ABATE: "DOUBLE PRECISION",
      PIS_ALIQ_ABATE: "DOUBLE PRECISION",
      COFINS_ALIQ_ABATE: "DOUBLE PRECISION",
      GERA_CREDITO_PIS_COFINS: "INTEGER DEFAULT 0",
      OBS_FISCAL_ABATE: "VARCHAR(1000)",
      STATUS_FISCAL_ABATE: "VARCHAR(20)",
      MOTIVO_REVISAO_ABATE: "VARCHAR(1000)",
    },
  };
  for (const [table, columns] of Object.entries(columnTypes)) {
    if (!(await fiscalExists(tx, "table", table))) {
      changes.push(`skipped missing table ${table}`);
      continue;
    }
    const existing = new Set(
      (
        await tx.query(
          "SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME)=?",
          [table],
        )
      ).map((row) => row.NAME),
    );
    for (const [column, type] of Object.entries(columns))
      if (!existing.has(column)) {
        await tx.execute(`ALTER TABLE ${table} ADD ${column} ${type}`);
        changes.push(`added column ${table}.${column}`);
      }
  }
  return changes;
}
const run = (fn) => async (req, res) => {
  try {
    res.json(await withDatabase((db) => fn(db, req)));
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
};

const ruleTextFields = Object.freeze({
  CFOP: 10,
  TIPO_NOTA_COD: 1,
  TIPO_NOTA_DESC: 20,
  CST_ICMS: 5,
  CSOSN: 5,
  CST_PIS: 10,
  CST_COFINS: 10,
  CST_IPI: 10,
  TIPO_OPERACAO: 40,
  ORIGEM_REGRA: 30,
  OBSERVACAO: 1000,
});
const ruleIntegerFields = new Set([
  "IDEMPRESA",
  "GERA_CREDITO_ICMS",
  "GERA_DEBITO_ICMS",
  "ICMS_INFORMATIVO",
  "ICMS_ST",
  "GERA_CREDITO_PIS",
  "GERA_DEBITO_PIS",
  "PIS_INFORMATIVO",
  "GERA_CREDITO_COFINS",
  "GERA_DEBITO_COFINS",
  "COFINS_INFORMATIVO",
  "GERA_CREDITO_IPI",
  "GERA_DEBITO_IPI",
  "IPI_INFORMATIVO",
  "ENTRA_APURACAO",
  "ISENTO",
  "NAO_TRIBUTADO",
  "SUSPENSO",
  "EXIGE_REVISAO",
  "PRIORIDADE",
  "ATIVO",
]);
const returnCfops = new Set([
    "1201",
    "1202",
    "1203",
    "1204",
    "1410",
    "1411",
    "1414",
    "1415",
    "2201",
    "2202",
    "2203",
    "2204",
    "2410",
    "2411",
    "2414",
    "2415",
    "5201",
    "5202",
    "5208",
    "5209",
    "5410",
    "5411",
    "5412",
    "5413",
    "6201",
    "6202",
    "6208",
    "6209",
    "6410",
    "6411",
    "6412",
    "6413",
  ]),
  transferCfops = new Set([
    "1151",
    "1152",
    "1408",
    "1409",
    "2151",
    "2152",
    "2408",
    "2409",
    "5151",
    "5152",
    "5408",
    "5409",
    "6151",
    "6152",
    "6408",
    "6409",
  ]),
  remittanceCfops = new Set([
    "1901",
    "1902",
    "1903",
    "1904",
    "2901",
    "2902",
    "2903",
    "2904",
    "5901",
    "5902",
    "5903",
    "5904",
    "6901",
    "6902",
    "6903",
    "6904",
  ]),
  saleCfops = new Set([
    "5101",
    "5102",
    "5103",
    "5104",
    "5105",
    "5106",
    "5401",
    "5402",
    "5403",
    "5405",
    "6101",
    "6102",
    "6103",
    "6104",
    "6105",
    "6106",
    "6401",
    "6402",
    "6403",
    "6404",
  ]),
  purchaseCfops = new Set([
    "1101",
    "1102",
    "1111",
    "1113",
    "1116",
    "1120",
    "1401",
    "1403",
    "1406",
    "2101",
    "2102",
    "2111",
    "2113",
    "2116",
    "2120",
    "2401",
    "2403",
    "2406",
  ]),
  stCodes = new Set(["10", "30", "60", "70", "201", "202", "203", "500"]);
export function fiscalRuleDefaults(cfop, type, cst, csosn) {
  const code = String(cfop || "")
      .replace(/\D/g, "")
      .slice(0, 4),
    note = String(type || "").trim(),
    tax = String(csosn || cst || "").trim(),
    st =
      stCodes.has(tax) ||
      ["5401", "5402", "5403", "5405", "6401", "6402", "6403", "6404"].includes(
        code,
      ),
    data = {
      TIPO_OPERACAO: "OUTRA",
      GERA_CREDITO_ICMS: 0,
      GERA_DEBITO_ICMS: 0,
      ICMS_INFORMATIVO: 1,
      ICMS_ST: st ? 1 : 0,
      GERA_CREDITO_PIS: 0,
      GERA_DEBITO_PIS: 0,
      PIS_INFORMATIVO: 1,
      GERA_CREDITO_COFINS: 0,
      GERA_DEBITO_COFINS: 0,
      COFINS_INFORMATIVO: 1,
      GERA_CREDITO_IPI: 0,
      GERA_DEBITO_IPI: 0,
      IPI_INFORMATIVO: 1,
      ENTRA_APURACAO: 0,
      EXIGE_REVISAO: 1,
      PRIORIDADE: tax ? 10 : 5,
      ORIGEM_REGRA: "CARGA_INICIAL",
      OBSERVACAO:
        "Regra criada automaticamente. Revisar antes de fechar apuracao.",
    };
  if (returnCfops.has(code)) {
    Object.assign(data, {
      TIPO_OPERACAO: "DEVOLUCAO",
      ENTRA_APURACAO: 1,
      EXIGE_REVISAO: 0,
      ICMS_INFORMATIVO: 0,
      PIS_INFORMATIVO: 0,
      COFINS_INFORMATIVO: 0,
    });
    Object.assign(
      data,
      note === "0"
        ? { GERA_DEBITO_ICMS: 1, GERA_DEBITO_PIS: 1, GERA_DEBITO_COFINS: 1 }
        : { GERA_CREDITO_ICMS: 1, GERA_CREDITO_PIS: 1, GERA_CREDITO_COFINS: 1 },
    );
  } else if (transferCfops.has(code))
    Object.assign(data, { TIPO_OPERACAO: "TRANSFERENCIA" });
  else if (remittanceCfops.has(code))
    Object.assign(data, { TIPO_OPERACAO: "REMESSA" });
  else if (saleCfops.has(code) || (note === "1" && /^[567]/.test(code)))
    Object.assign(data, {
      TIPO_OPERACAO: "VENDA",
      GERA_DEBITO_ICMS: st ? 0 : 1,
      ICMS_INFORMATIVO: 0,
      GERA_DEBITO_PIS: 1,
      PIS_INFORMATIVO: 0,
      GERA_DEBITO_COFINS: 1,
      COFINS_INFORMATIVO: 0,
      ENTRA_APURACAO: 1,
      EXIGE_REVISAO: 0,
    });
  else if (purchaseCfops.has(code) || (note === "0" && /^[123]/.test(code)))
    Object.assign(data, {
      TIPO_OPERACAO: "COMPRA",
      GERA_CREDITO_ICMS: st ? 0 : 1,
      ICMS_INFORMATIVO: 0,
      GERA_CREDITO_PIS: 1,
      PIS_INFORMATIVO: 0,
      GERA_CREDITO_COFINS: 1,
      COFINS_INFORMATIVO: 0,
      ENTRA_APURACAO: 1,
      EXIGE_REVISAO: 0,
    });
  return data;
}

export function sanitizeFiscalRule(input = {}) {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key.toUpperCase(), value]),
  );
  const clean = {};
  for (const [field, size] of Object.entries(ruleTextFields)) {
    if (!(field in normalized)) continue;
    const value = normalized[field];
    clean[field] =
      value === null || value === undefined || String(value).trim() === ""
        ? null
        : String(value).trim().slice(0, size);
  }
  for (const field of ruleIntegerFields) {
    if (!(field in normalized)) continue;
    const value = normalized[field];
    if (value === null || value === undefined || value === "")
      clean[field] = null;
    else {
      const parsed = Number(value);
      if (!Number.isInteger(parsed))
        throw Object.assign(new Error(`${field} deve ser inteiro.`), {
          status: 400,
        });
      clean[field] = parsed;
    }
  }
  return clean;
}

const ruleUser = (req) => ({
  id: Number(req.dashboardSession?.user?.idusuario || 0) || null,
  login: String(req.dashboardSession?.user?.login || "").slice(0, 60) || null,
});
async function addRuleHistory(
  tx,
  req,
  { id, company, action, before = null, after = null, reason },
) {
  const hist = await tx.singleton(
    "SELECT NEXT VALUE FOR GEN_FISCAL_REGRA_OPERACAO_H_ID AS ID FROM RDB$DATABASE",
  );
  const user = ruleUser(req);
  await tx.execute(
    `INSERT INTO FISCAL_REGRA_OPERACAO_HIST
    (IDHIST,IDREGRA,IDEMPRESA,ACAO,DADOS_ANTES,DADOS_DEPOIS,USUARIO_ID,USUARIO_LOGIN,DATA_HORA,IP_ORIGEM,MOTIVO)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      Number(hist.ID),
      id,
      company,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      user.id,
      user.login,
      new Date(),
      String(req.ip || "").slice(0, 50),
      String(reason || "").slice(0, 1000),
    ],
  );
}

router.get(
  "/regras",
  run(async (db, req) => {
    const where = ["1=1"],
      params = [];
    const company = Number(req.query.idempresa);
    if (Number.isInteger(company) && company > 0) {
      where.push("r.IDEMPRESA=?");
      params.push(company);
    }
    if (String(req.query.cfop || "").trim()) {
      where.push("TRIM(r.CFOP)=?");
      params.push(String(req.query.cfop).trim());
    }
    if (["0", "1"].includes(String(req.query.tipo_nota ?? ""))) {
      where.push("TRIM(r.TIPO_NOTA_COD)=?");
      params.push(String(req.query.tipo_nota));
    }
    if (["0", "1"].includes(String(req.query.ativo ?? ""))) {
      where.push("COALESCE(r.ATIVO,1)=?");
      params.push(Number(req.query.ativo));
    }
    const dados = await query(
      db,
      `SELECT FIRST 500 r.*,
    c.NOMEEMPRESA AS EMPRESA
    FROM FISCAL_REGRA_OPERACAO r LEFT JOIN CONFIGURACAO c ON c.IDEMPRESA=r.IDEMPRESA
    WHERE ${where.join(" AND ")} ORDER BY r.IDEMPRESA,r.CFOP,r.TIPO_NOTA_COD,r.CST_ICMS,r.CSOSN`,
      params,
    );
    return { ok: true, dados, total: dados.length };
  }),
);

router.post("/regras", async (req, res) => {
  try {
    const payload = sanitizeFiscalRule(req.body);
    if (!payload.IDEMPRESA || !payload.CFOP)
      return res
        .status(400)
        .json({ ok: false, erro: "Informe IDEMPRESA e CFOP." });
    payload.ATIVO ??= 1;
    payload.ORIGEM_REGRA ??= "MANUAL";
    const user = ruleUser(req),
      now = new Date();
    const id = await withWriteTransaction(async (tx) => {
      const next = await tx.singleton(
        "SELECT NEXT VALUE FOR GEN_FISCAL_REGRA_OPERACAO_ID AS ID FROM RDB$DATABASE",
      );
      const ruleId = Number(next.ID),
        values = {
          IDREGRA: ruleId,
          ...payload,
          USUARIO_ULT_ALT: user.id,
          DT_ULT_ALT: now,
        };
      const fields = Object.keys(values);
      await tx.execute(
        `INSERT INTO FISCAL_REGRA_OPERACAO (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
        fields.map((field) => values[field]),
      );
      await addRuleHistory(tx, req, {
        id: ruleId,
        company: payload.IDEMPRESA,
        action: "CRIACAO",
        after: values,
        reason: "Criacao manual",
      });
      return ruleId;
    });
    res.status(201).json({ ok: true, idregra: id });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.put("/regras/:ruleId", async (req, res) => {
  try {
    const id = Number(req.params.ruleId),
      payload = sanitizeFiscalRule(req.body);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({ ok: false, erro: "Regra invalida." });
    if (!Object.keys(payload).length)
      return res
        .status(400)
        .json({ ok: false, erro: "Nenhum campo valido para atualizar." });
    const reason = req.body?.MOTIVO || req.body?.motivo || "Alteracao manual",
      user = ruleUser(req);
    const found = await withWriteTransaction(async (tx) => {
      const before = await tx.singleton(
        "SELECT * FROM FISCAL_REGRA_OPERACAO WHERE IDREGRA=?",
        [id],
      );
      if (!before) return false;
      const values = {
          ...payload,
          USUARIO_ULT_ALT: user.id,
          DT_ULT_ALT: new Date(),
        },
        fields = Object.keys(values);
      await tx.execute(
        `UPDATE FISCAL_REGRA_OPERACAO SET ${fields.map((field) => `${field}=?`).join(",")} WHERE IDREGRA=?`,
        [...fields.map((field) => values[field]), id],
      );
      const after = await tx.singleton(
        "SELECT * FROM FISCAL_REGRA_OPERACAO WHERE IDREGRA=?",
        [id],
      );
      await addRuleHistory(tx, req, {
        id,
        company: Number(before.IDEMPRESA),
        action: "ALTERACAO",
        before,
        after,
        reason,
      });
      return true;
    });
    if (!found)
      return res.status(404).json({ ok: false, erro: "Regra nao encontrada." });
    res.json({ ok: true, idregra: id });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.post("/regras/:ruleId/inativar", async (req, res) => {
  try {
    const id = Number(req.params.ruleId),
      user = ruleUser(req);
    if (!Number.isInteger(id) || id < 1)
      return res.status(400).json({ ok: false, erro: "Regra invalida." });
    const found = await withWriteTransaction(async (tx) => {
      const before = await tx.singleton(
        "SELECT * FROM FISCAL_REGRA_OPERACAO WHERE IDREGRA=?",
        [id],
      );
      if (!before) return false;
      await tx.execute(
        "UPDATE FISCAL_REGRA_OPERACAO SET ATIVO=0,USUARIO_ULT_ALT=?,DT_ULT_ALT=? WHERE IDREGRA=?",
        [user.id, new Date(), id],
      );
      const after = await tx.singleton(
        "SELECT * FROM FISCAL_REGRA_OPERACAO WHERE IDREGRA=?",
        [id],
      );
      await addRuleHistory(tx, req, {
        id,
        company: Number(before.IDEMPRESA),
        action: "INATIVACAO",
        before,
        after,
        reason: req.body?.motivo || "Inativacao manual",
      });
      return true;
    });
    if (!found)
      return res.status(404).json({ ok: false, erro: "Regra nao encontrada." });
    res.json({ ok: true, idregra: id });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

router.get(
  "/options",
  run(async (db) => {
    const empresas = await query(
      db,
      `SELECT c.IDEMPRESA AS ID,c.NOMEEMPRESA AS NOME,c.CNPJ,c.UF FROM CONFIGURACAO c ORDER BY c.IDEMPRESA`,
    );
    const cfops = await query(
      db,
      `SELECT FIRST 500 q.CFOP AS ID, q.CFOP AS NOME FROM (
      SELECT TRIM(i.CFOP) AS CFOP FROM NFE_PRODUTO i
        WHERE i.CFOP IS NOT NULL AND TRIM(i.CFOP) <> '' GROUP BY TRIM(i.CFOP)
      UNION SELECT TRIM(ep.CFOP_CONTABIL) AS CFOP FROM ENTRPRODUTO ep
        WHERE ep.CFOP_CONTABIL IS NOT NULL AND TRIM(ep.CFOP_CONTABIL) <> '' GROUP BY TRIM(ep.CFOP_CONTABIL)
      UNION SELECT TRIM(fc.CFOP_CONTABIL) AS CFOP FROM FISCAL_CONTABIL fc
        WHERE COALESCE(fc.ATIVO, 1) = 1 AND fc.CFOP_CONTABIL IS NOT NULL
        AND TRIM(fc.CFOP_CONTABIL) <> '' GROUP BY TRIM(fc.CFOP_CONTABIL)
      ) q ORDER BY q.CFOP`,
    );
    const csts = await query(
      db,
      `SELECT FIRST 300 q.CST AS ID, q.CST AS NOME FROM (
      SELECT COALESCE(NULLIF(TRIM(i.CST_ICMS), ''), NULLIF(TRIM(i.CSOSN), '')) AS CST
      FROM NFE_PRODUTO i WHERE COALESCE(NULLIF(TRIM(i.CST_ICMS), ''), NULLIF(TRIM(i.CSOSN), '')) IS NOT NULL
      GROUP BY COALESCE(NULLIF(TRIM(i.CST_ICMS), ''), NULLIF(TRIM(i.CSOSN), ''))
      UNION SELECT TRIM(CAST(ep.CST_CONTABIL AS VARCHAR(5))) AS CST FROM ENTRPRODUTO ep
      WHERE ep.CST_CONTABIL IS NOT NULL GROUP BY TRIM(CAST(ep.CST_CONTABIL AS VARCHAR(5)))) q ORDER BY q.CST`,
    );
    return {
      ok: true,
      empresas,
      cfops,
      csts,
      tipos_nota: [
        { ID: "", NOME: "Todas" },
        { ID: "0", NOME: "Entrada" },
        { ID: "1", NOME: "Saida" },
      ],
      origens: [
        { ID: "", NOME: "Todas" },
        { ID: "NFE", NOME: "NF-e" },
        { ID: "ENTRESTOQUE", NOME: "Entradas" },
        { ID: "CTAPAGAR", NOME: "Despesas" },
      ],
      status: [
        "OK",
        "DIVERGENTE",
        "REVISAR",
        "XML NAO ENCONTRADO",
        "INFORMATIVO",
        "CANCELADA",
      ],
    };
  }),
);

router.get(
  "/migrations/status",
  run(async (db) => {
    const tableRows = await query(
      db,
      `SELECT TRIM(RDB$RELATION_NAME) AS NOME FROM RDB$RELATIONS
    WHERE COALESCE(RDB$SYSTEM_FLAG,0)=0`,
    );
    const existingTables = new Set(tableRows.map((row) => row.NOME));
    const columnRows = await query(
      db,
      `SELECT TRIM(RDB$RELATION_NAME) AS TABELA,
    TRIM(RDB$FIELD_NAME) AS COLUNA FROM RDB$RELATION_FIELDS`,
    );
    const existingColumns = new Set(
      columnRows.map((row) => `${row.TABELA}.${row.COLUNA}`),
    );
    return {
      ok: true,
      tables: Object.fromEntries(
        fiscalTables.map((table) => [table, existingTables.has(table)]),
      ),
      columns: Object.fromEntries(
        Object.entries(fiscalColumns).map(([table, columns]) => [
          table,
          Object.fromEntries(
            columns.map((column) => [
              column,
              existingColumns.has(`${table}.${column}`),
            ]),
          ),
        ]),
      ),
    };
  }),
);
router.post("/migrations/apply", async (_req, res) => {
  try {
    const changes = await withWriteTransaction(ensureFiscalSchema);
    res.json({
      ok: true,
      changes,
      total_changes: changes.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});
router.post("/regras/carga-inicial", async (req, res) => {
  try {
    const limit = Math.max(
        100,
        Math.min(Number(req.body?.limite || 5000), 50000),
      ),
      user = ruleUser(req),
      result = await withWriteTransaction(async (tx) => {
        await ensureFiscalSchema(tx);
        const combos = [
            ...(await tx.query(
              `SELECT FIRST ${limit} i.IDEMPRESA,TRIM(n.TPNF) AS TIPO_NOTA_COD,TRIM(i.CFOP) AS CFOP,NULLIF(TRIM(i.CST_ICMS),'') AS CST_ICMS,NULLIF(TRIM(i.CSOSN),'') AS CSOSN,NULLIF(TRIM(i.CST_PIS),'') AS CST_PIS,NULLIF(TRIM(i.CST_COFINS),'') AS CST_COFINS,NULLIF(TRIM(i.CST_IPI),'') AS CST_IPI FROM NFE_PRODUTO i JOIN NFE n ON n.CHAVE=i.CHAVE WHERE i.IDEMPRESA IS NOT NULL AND i.CFOP IS NOT NULL AND TRIM(i.CFOP)<>'' GROUP BY i.IDEMPRESA,TRIM(n.TPNF),TRIM(i.CFOP),NULLIF(TRIM(i.CST_ICMS),''),NULLIF(TRIM(i.CSOSN),''),NULLIF(TRIM(i.CST_PIS),''),NULLIF(TRIM(i.CST_COFINS),''),NULLIF(TRIM(i.CST_IPI),'') ORDER BY i.IDEMPRESA,TRIM(i.CFOP)`,
            )),
            ...(await tx.query(
              `SELECT FIRST ${limit} ep.IDEMPRESA,'0' AS TIPO_NOTA_COD,TRIM(ep.CFOP_CONTABIL) AS CFOP,NULLIF(TRIM(CAST(ep.CST_CONTABIL AS VARCHAR(5))),'') AS CST_ICMS,CAST(NULL AS VARCHAR(5)) AS CSOSN,CAST(NULL AS VARCHAR(10)) AS CST_PIS,CAST(NULL AS VARCHAR(10)) AS CST_COFINS,CAST(NULL AS VARCHAR(10)) AS CST_IPI FROM ENTRPRODUTO ep JOIN ENTRESTOQUE ee ON ee.IDENTRADA=ep.IDENTRADA AND ee.IDEMPRESA=ep.IDEMPRESA WHERE ep.IDEMPRESA IS NOT NULL AND ep.CFOP_CONTABIL IS NOT NULL AND TRIM(ep.CFOP_CONTABIL)<>'' GROUP BY ep.IDEMPRESA,TRIM(ep.CFOP_CONTABIL),NULLIF(TRIM(CAST(ep.CST_CONTABIL AS VARCHAR(5))),'') ORDER BY ep.IDEMPRESA,TRIM(ep.CFOP_CONTABIL)`,
            )),
          ],
          existingRows = await tx.query(
            "SELECT IDEMPRESA,COALESCE(TRIM(CFOP),'') AS CFOP,COALESCE(TRIM(TIPO_NOTA_COD),'') AS TIPO_NOTA_COD,COALESCE(TRIM(CST_ICMS),'') AS CST_ICMS,COALESCE(TRIM(CSOSN),'') AS CSOSN FROM FISCAL_REGRA_OPERACAO",
          ),
          existing = new Set(
            existingRows.map((row) =>
              [
                row.IDEMPRESA,
                row.CFOP,
                row.TIPO_NOTA_COD,
                row.CST_ICMS,
                row.CSOSN,
              ].join("|"),
            ),
          );
        let created = 0,
          skipped = 0;
        for (const row of combos) {
          const key = [
            row.IDEMPRESA,
            row.CFOP || "",
            row.TIPO_NOTA_COD || "",
            row.CST_ICMS || "",
            row.CSOSN || "",
          ].join("|");
          if (existing.has(key)) {
            skipped++;
            continue;
          }
          const defaults = fiscalRuleDefaults(
              row.CFOP,
              row.TIPO_NOTA_COD,
              row.CST_ICMS,
              row.CSOSN,
            ),
            next = await tx.singleton(
              "SELECT NEXT VALUE FOR GEN_FISCAL_REGRA_OPERACAO_ID AS ID FROM RDB$DATABASE",
            ),
            values = {
              IDREGRA: next.ID,
              IDEMPRESA: row.IDEMPRESA,
              CFOP: String(row.CFOP).slice(0, 10),
              TIPO_NOTA_COD:
                String(row.TIPO_NOTA_COD || "").slice(0, 1) || null,
              TIPO_NOTA_DESC:
                row.TIPO_NOTA_COD === "0"
                  ? "ENTRADA"
                  : row.TIPO_NOTA_COD === "1"
                    ? "SAIDA"
                    : "INDEFINIDO",
              CST_ICMS: row.CST_ICMS,
              CSOSN: row.CSOSN,
              CST_PIS: row.CST_PIS,
              CST_COFINS: row.CST_COFINS,
              CST_IPI: row.CST_IPI,
              ...defaults,
              ATIVO: 1,
              USUARIO_ULT_ALT: user.id,
              DT_ULT_ALT: new Date(),
            },
            fields = Object.keys(values);
          await tx.execute(
            `INSERT INTO FISCAL_REGRA_OPERACAO (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
            fields.map((field) => values[field]),
          );
          existing.add(key);
          created++;
        }
        return { created, skipped, processed: combos.length };
      });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

export function normalizeFiscalGuide(input = {}) {
  let month = Number(input.competencia_mes),
    year = Number(input.competencia_ano);
  if ((!month || !year) && input.competencia) {
    const parts = String(input.competencia).trim().split(/[/-]/).map(Number);
    if (parts.length === 2) [month, year] = parts;
  }
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 2000
  )
    throw Object.assign(new Error("Competencia invalida."), { status: 400 });
  const money = (name) => {
      const value = Number(input[name] || 0);
      if (!Number.isFinite(value))
        throw Object.assign(new Error(`${name} invalido.`), { status: 400 });
      return value;
    },
    guide = {
      idempresa: Number(input.idempresa || 1),
      competencia_mes: month,
      competencia_ano: year,
      tipo_guia: String(input.tipo_guia || "ICMS/FECP")
        .trim()
        .slice(0, 80),
      receita: String(
        input.receita || "ICMS/FECP Operacoes Proprias - Apuracao",
      )
        .trim()
        .slice(0, 120),
      icms_valor: money("icms_valor"),
      fecp_valor: money("fecp_valor"),
      juros_valor: money("juros_valor"),
      multa_valor: money("multa_valor"),
      total_valor: money("total_valor"),
      vencimento: input.vencimento || null,
      pagamento: input.pagamento || null,
      numero_documento:
        String(input.numero_documento || "").slice(0, 80) || null,
      nosso_numero: String(input.nosso_numero || "").slice(0, 80) || null,
      codigo_barras: String(input.codigo_barras || "").slice(0, 120) || null,
      origem_arquivo: String(input.origem_arquivo || "").slice(0, 500) || null,
      texto_extraido: String(input.texto_extraido || ""),
    };
  if (!guide.total_valor)
    guide.total_valor =
      Math.round(
        (guide.icms_valor +
          guide.fecp_valor +
          guide.juros_valor +
          guide.multa_valor) *
          100,
      ) / 100;
  return guide;
}
const brMoney = (value) =>
  Number(
    String(value || "")
      .replace(/\./g, "")
      .replace(",", "."),
  ) || 0;
const brDate = (value) => {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};
export function parseDarjText(text = "") {
  const clean = String(text).replace(/[ \t]+/g, " "),
    result = {
      tipo_guia: "ICMS/FECP",
      receita: "ICMS/FECP Operacoes Proprias - Apuracao",
      icms_valor: 0,
      fecp_valor: 0,
      juros_valor: 0,
      multa_valor: 0,
      total_valor: 0,
      vencimento: null,
      pagamento: null,
      numero_documento: null,
      nosso_numero: null,
      codigo_barras: null,
      competencia_ano: null,
      competencia_mes: null,
      texto_extraido: String(text),
    };
  const comp = clean.match(
    /Per[ií]odo de Refer[eê]ncia:\s*(\d{1,2})\/(\d{4})/i,
  );
  if (comp) {
    result.competencia_mes = Number(comp[1]);
    result.competencia_ano = Number(comp[2]);
  }
  const dates = clean.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];
  if (dates.length) {
    result.vencimento = brDate(dates[0]);
    result.pagamento = brDate(dates.at(-1));
  }
  result.nosso_numero =
    clean.match(/Nosso N[uú]mero:\s*([0-9]+)/i)?.[1] || null;
  result.numero_documento = clean.match(/\b(\d{9})\b/)?.[1] || null;
  result.codigo_barras =
    clean.match(/(\d{11}-\d\s+\d{11}-\d\s+\d{11}-\d\s+\d{11}-\d)/)?.[1] || null;
  const values = (
      clean.match(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d+,\d{2}\b/g) || []
    ).map(brMoney),
    total = Math.max(0, ...values);
  outer: for (let i = 0; i < values.length; i++)
    for (let j = i + 1; j < values.length; j++)
      if (Math.abs(values[i] + values[j] - total) < 0.02) {
        result.icms_valor = values[i];
        result.fecp_valor = values[j];
        result.total_valor = total;
        break outer;
      }
  result.total_valor ||=
    Math.round((result.icms_valor + result.fecp_valor) * 100) / 100;
  return result;
}
router.get(
  "/guias",
  run(async (db, req) => {
    const date = String(
        req.query.data_ini || new Date().toISOString().slice(0, 10),
      ),
      year = Number(date.slice(0, 4)),
      month = Number(date.slice(5, 7)),
      company = Number(req.query.idempresa || 1),
      row =
        (
          await query(
            db,
            "SELECT FIRST 1 IDGUIA,IDEMPRESA,COMPETENCIA_ANO,COMPETENCIA_MES,TIPO_GUIA,RECEITA,ICMS_VALOR AS ICMS,FECP_VALOR AS FECP,JUROS_VALOR AS JUROS,MULTA_VALOR AS MULTA,TOTAL_VALOR AS TOTAL,VENCIMENTO,PAGAMENTO,NUMERO_DOCUMENTO,NOSSO_NUMERO,CODIGO_BARRAS,ORIGEM_ARQUIVO,DATA_HORA FROM FISCAL_GUIA_CONTABIL WHERE IDEMPRESA=? AND COMPETENCIA_ANO=? AND COMPETENCIA_MES=? ORDER BY IDGUIA DESC",
            [company, year, month],
          )
        )[0] || null;
    return { ok: true, tem_guia: Boolean(row), guia: row };
  }),
);
router.post("/guias", async (req, res) => {
  try {
    const guide = normalizeFiscalGuide(req.body),
      user = ruleUser(req),
      saved = await withWriteTransaction(async (tx) => {
        const existing = await tx.singleton(
            "SELECT FIRST 1 IDGUIA FROM FISCAL_GUIA_CONTABIL WHERE IDEMPRESA=? AND COMPETENCIA_ANO=? AND COMPETENCIA_MES=? AND COALESCE(TIPO_GUIA,'')=? ORDER BY IDGUIA DESC",
            [
              guide.idempresa,
              guide.competencia_ano,
              guide.competencia_mes,
              guide.tipo_guia,
            ],
          ),
          values = [
            guide.idempresa,
            guide.competencia_ano,
            guide.competencia_mes,
            guide.tipo_guia,
            guide.receita,
            guide.icms_valor,
            guide.fecp_valor,
            guide.juros_valor,
            guide.multa_valor,
            guide.total_valor,
            guide.vencimento,
            guide.pagamento,
            guide.numero_documento,
            guide.nosso_numero,
            guide.codigo_barras,
            guide.origem_arquivo,
            guide.texto_extraido,
            user.id,
            user.login,
            new Date(),
          ];
        let id;
        if (existing) {
          id = Number(existing.IDGUIA);
          await tx.execute(
            "UPDATE FISCAL_GUIA_CONTABIL SET IDEMPRESA=?,COMPETENCIA_ANO=?,COMPETENCIA_MES=?,TIPO_GUIA=?,RECEITA=?,ICMS_VALOR=?,FECP_VALOR=?,JUROS_VALOR=?,MULTA_VALOR=?,TOTAL_VALOR=?,VENCIMENTO=?,PAGAMENTO=?,NUMERO_DOCUMENTO=?,NOSSO_NUMERO=?,CODIGO_BARRAS=?,ORIGEM_ARQUIVO=?,TEXTO_EXTRAIDO=?,USUARIO_ID=?,USUARIO_LOGIN=?,DATA_HORA=? WHERE IDGUIA=?",
            [...values, id],
          );
        } else {
          const next = await tx.singleton(
            "SELECT NEXT VALUE FOR GEN_FISCAL_GUIA_CONTABIL_ID AS ID FROM RDB$DATABASE",
          );
          id = Number(next.ID);
          await tx.execute(
            "INSERT INTO FISCAL_GUIA_CONTABIL (IDGUIA,IDEMPRESA,COMPETENCIA_ANO,COMPETENCIA_MES,TIPO_GUIA,RECEITA,ICMS_VALOR,FECP_VALOR,JUROS_VALOR,MULTA_VALOR,TOTAL_VALOR,VENCIMENTO,PAGAMENTO,NUMERO_DOCUMENTO,NOSSO_NUMERO,CODIGO_BARRAS,ORIGEM_ARQUIVO,TEXTO_EXTRAIDO,USUARIO_ID,USUARIO_LOGIN,DATA_HORA) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [id, ...values],
          );
        }
        return { idguia: id, ...guide };
      });
    res.json({ ok: true, guia: saved });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post(
  "/guias/importar-pdf",
  upload.single("arquivo"),
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ ok: false, erro: "Envie o PDF da guia." });
      const parsed = parseDarjText((await pdfParse(req.file.buffer)).text);
      if (
        !parsed.competencia_mes ||
        !parsed.competencia_ano ||
        !parsed.total_valor
      )
        return res.status(422).json({
          ok: false,
          erro: "Nao foi possivel extrair competencia e valores do PDF. Preencha manualmente.",
          extraido: parsed,
        });
      req.body = {
        ...parsed,
        idempresa: Number(req.body?.idempresa || 1),
        origem_arquivo: req.file.originalname,
      };
      const guide = normalizeFiscalGuide(req.body),
        user = ruleUser(req),
        saved = await withWriteTransaction(async (tx) => {
          const existing = await tx.singleton(
            "SELECT FIRST 1 IDGUIA FROM FISCAL_GUIA_CONTABIL WHERE IDEMPRESA=? AND COMPETENCIA_ANO=? AND COMPETENCIA_MES=? AND COALESCE(TIPO_GUIA,'')=? ORDER BY IDGUIA DESC",
            [
              guide.idempresa,
              guide.competencia_ano,
              guide.competencia_mes,
              guide.tipo_guia,
            ],
          );
          let id = Number(existing?.IDGUIA || 0);
          const values = [
            guide.idempresa,
            guide.competencia_ano,
            guide.competencia_mes,
            guide.tipo_guia,
            guide.receita,
            guide.icms_valor,
            guide.fecp_valor,
            guide.juros_valor,
            guide.multa_valor,
            guide.total_valor,
            guide.vencimento,
            guide.pagamento,
            guide.numero_documento,
            guide.nosso_numero,
            guide.codigo_barras,
            guide.origem_arquivo,
            guide.texto_extraido,
            user.id,
            user.login,
            new Date(),
          ];
          if (id)
            await tx.execute(
              "UPDATE FISCAL_GUIA_CONTABIL SET IDEMPRESA=?,COMPETENCIA_ANO=?,COMPETENCIA_MES=?,TIPO_GUIA=?,RECEITA=?,ICMS_VALOR=?,FECP_VALOR=?,JUROS_VALOR=?,MULTA_VALOR=?,TOTAL_VALOR=?,VENCIMENTO=?,PAGAMENTO=?,NUMERO_DOCUMENTO=?,NOSSO_NUMERO=?,CODIGO_BARRAS=?,ORIGEM_ARQUIVO=?,TEXTO_EXTRAIDO=?,USUARIO_ID=?,USUARIO_LOGIN=?,DATA_HORA=? WHERE IDGUIA=?",
              [...values, id],
            );
          else {
            const next = await tx.singleton(
              "SELECT NEXT VALUE FOR GEN_FISCAL_GUIA_CONTABIL_ID AS ID FROM RDB$DATABASE",
            );
            id = Number(next.ID);
            await tx.execute(
              "INSERT INTO FISCAL_GUIA_CONTABIL (IDGUIA,IDEMPRESA,COMPETENCIA_ANO,COMPETENCIA_MES,TIPO_GUIA,RECEITA,ICMS_VALOR,FECP_VALOR,JUROS_VALOR,MULTA_VALOR,TOTAL_VALOR,VENCIMENTO,PAGAMENTO,NUMERO_DOCUMENTO,NOSSO_NUMERO,CODIGO_BARRAS,ORIGEM_ARQUIVO,TEXTO_EXTRAIDO,USUARIO_ID,USUARIO_LOGIN,DATA_HORA) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [id, ...values],
            );
          }
          return { idguia: id, ...guide };
        });
      res.json({ ok: true, guia: saved });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, erro: error.message });
    }
  },
);
router.get("/valores-fiscais/email-config", (_req, res) => {
  try {
    const cfg = readJsonConfig("email_config.json", {}),
      missing = [
        "smtp_host",
        "smtp_user",
        "smtp_password",
        "destinatario",
      ].filter((key) => !String(cfg[key] || "").trim());
    if (missing.length)
      return res.json({
        ok: false,
        configurado: false,
        erro: `Preencha no email_config.json os campos: ${missing.join(", ")}`,
      });
    res.json({
      ok: true,
      configurado: true,
      destinatario: cfg.destinatario,
      remetente: cfg.remetente || cfg.smtp_user,
    });
  } catch (error) {
    res.json({ ok: false, configurado: false, erro: error.message });
  }
});
router.post("/contabil-revisao", async (req, res) => {
  try {
    const payload = req.body || {},
      items =
        Array.isArray(payload.ITENS) && payload.ITENS.length
          ? payload.ITENS
          : [payload],
      key = String(payload.CHAVE || "")
        .trim()
        .slice(0, 60),
      cfop = String(payload.CFOP_CONTABIL || "")
        .trim()
        .slice(0, 10);
    if (!key || !cfop)
      return res
        .status(400)
        .json({ ok: false, erro: "Campos obrigatorios: CHAVE, CFOP_CONTABIL" });
    const user = ruleUser(req),
      saved = await withWriteTransaction(async (tx) => {
        let count = 0;
        for (const item of items) {
          const origin = String(item.ORIGEM || payload.ORIGEM || "")
              .trim()
              .slice(0, 30),
            position = Number(item.POSIC),
            product = String(item.CPROD || "")
              .trim()
              .slice(0, 60);
          if (!origin || !Number.isInteger(position) || !product)
            throw Object.assign(
              new Error("ORIGEM, POSIC e CPROD sao obrigatorios."),
              { status: 400 },
            );
          await tx.execute(
            "UPDATE FISCAL_CONTABIL SET ATIVO=0 WHERE ORIGEM=? AND CHAVE=? AND POSIC=? AND CPROD=? AND COALESCE(ATIVO,1)=1",
            [origin, key, position, product],
          );
          const next = await tx.singleton(
            "SELECT NEXT VALUE FOR GEN_FISCAL_CONTABIL_ID AS ID FROM RDB$DATABASE",
          );
          await tx.execute(
            "INSERT INTO FISCAL_CONTABIL (IDCONTABIL,ORIGEM,IDEMPRESA,IDENTRADA,NFE_PRODUTO_ID,CHAVE,POSIC,CPROD,CFOP_ORIGINAL,CFOP_CONTABIL,USO_CONSUMO,ATIVO,OBSERVACAO,USUARIO_ID,USUARIO_LOGIN,DATA_HORA,IP_ORIGEM) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)",
            [
              next.ID,
              origin,
              item.IDEMPRESA || payload.IDEMPRESA || null,
              item.IDENTRADA || payload.IDENTRADA || null,
              item.NFE_PRODUTO_ID || payload.NFE_PRODUTO_ID || null,
              key,
              position,
              product,
              String(item.CFOP_ORIGINAL || payload.CFOP_ORIGINAL || "").slice(
                0,
                10,
              ) || null,
              cfop,
              payload.USO_CONSUMO ? 1 : 0,
              String(payload.OBSERVACAO || "").slice(0, 1000) || null,
              user.id,
              user.login,
              new Date(),
              String(req.ip || "").slice(0, 50),
            ],
          );
          count++;
        }
        return count;
      });
    res.json({ ok: true, salvos: saved });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});
router.post("/revisao-item", async (req, res) => {
  try {
    const payload = req.body || {},
      required = ["CHAVE", "POSIC", "CPROD", "STATUS_NOVO"].filter(
        (field) =>
          payload[field] === null ||
          payload[field] === undefined ||
          payload[field] === "",
      );
    if (required.length)
      return res.status(400).json({
        ok: false,
        erro: `Campos obrigatorios: ${required.join(", ")}`,
      });
    const numeric = [
        "ICMS_BASE_ORIGINAL",
        "ICMS_BASE_CALCULADA",
        "ICMS_BASE_CORRIGIDA",
        "ICMS_ALIQ_ORIGINAL",
        "ICMS_ALIQ_CALCULADA",
        "ICMS_ALIQ_CORRIGIDA",
        "ICMS_VALOR_ORIGINAL",
        "ICMS_VALOR_CALCULADO",
        "ICMS_VALOR_CORRIGIDO",
        "ICMS_ST_BASE_ORIGINAL",
        "ICMS_ST_BASE_CALCULADA",
        "ICMS_ST_BASE_CORRIGIDA",
        "ICMS_ST_ALIQ_ORIGINAL",
        "ICMS_ST_ALIQ_CALCULADA",
        "ICMS_ST_ALIQ_CORRIGIDA",
        "ICMS_ST_VALOR_ORIGINAL",
        "ICMS_ST_VALOR_CALCULADO",
        "ICMS_ST_VALOR_CORRIGIDO",
        "PIS_BASE_ORIGINAL",
        "PIS_BASE_CALCULADA",
        "PIS_BASE_CORRIGIDA",
        "PIS_ALIQ_ORIGINAL",
        "PIS_ALIQ_CALCULADA",
        "PIS_ALIQ_CORRIGIDA",
        "PIS_VALOR_ORIGINAL",
        "PIS_VALOR_CALCULADO",
        "PIS_VALOR_CORRIGIDO",
        "COFINS_BASE_ORIGINAL",
        "COFINS_BASE_CALCULADA",
        "COFINS_BASE_CORRIGIDA",
        "COFINS_ALIQ_ORIGINAL",
        "COFINS_ALIQ_CALCULADA",
        "COFINS_ALIQ_CORRIGIDA",
        "COFINS_VALOR_ORIGINAL",
        "COFINS_VALOR_CALCULADO",
        "COFINS_VALOR_CORRIGIDO",
        "IPI_BASE_ORIGINAL",
        "IPI_BASE_CALCULADA",
        "IPI_BASE_CORRIGIDA",
        "IPI_ALIQ_ORIGINAL",
        "IPI_ALIQ_CALCULADA",
        "IPI_ALIQ_CORRIGIDA",
        "IPI_VALOR_ORIGINAL",
        "IPI_VALOR_CALCULADO",
        "IPI_VALOR_CORRIGIDO",
      ],
      status = String(payload.STATUS_NOVO).trim().slice(0, 30),
      user = ruleUser(req),
      fields = {
        NFE_PRODUTO_ID: payload.NFE_PRODUTO_ID || null,
        CHAVE: String(payload.CHAVE).slice(0, 60),
        POSIC: Number(payload.POSIC),
        CPROD: String(payload.CPROD).slice(0, 50),
        IDEMPRESA: payload.IDEMPRESA || null,
        STATUS_ANTERIOR:
          String(payload.STATUS_ANTERIOR || "").slice(0, 30) || null,
        STATUS_NOVO: status,
        ENTRA_APURACAO: ["APROVADO", "CORRIGIDO", "OK"].includes(status)
          ? 1
          : 0,
        USUARIO_ID: user.id,
        USUARIO_LOGIN: user.login,
        DATA_HORA: new Date(),
        IP_ORIGEM: String(req.ip || "").slice(0, 50),
        OBSERVACAO: String(payload.OBSERVACAO || "").slice(0, 1000) || null,
        MOTIVO_ALTERACAO:
          String(payload.MOTIVO_ALTERACAO || "").slice(0, 1000) || null,
      };
    for (const name of numeric)
      if (
        payload[name] !== null &&
        payload[name] !== undefined &&
        payload[name] !== ""
      ) {
        const value = Number(payload[name]);
        if (!Number.isFinite(value))
          throw Object.assign(new Error(`${name} invalido.`), { status: 400 });
        fields[name] = value;
      }
    await withWriteTransaction(async (tx) => {
      const next = await tx.singleton(
          "SELECT NEXT VALUE FOR GEN_FISCAL_REVISAO_ITEM_ID AS ID FROM RDB$DATABASE",
        ),
        names = Object.keys(fields);
      await tx.execute(
        `INSERT INTO FISCAL_REVISAO_ITEM (ID_REVISAO,${names.join(",")}) VALUES (?,${names.map(() => "?").join(",")})`,
        [next.ID, ...names.map((name) => fields[name])],
      );
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, erro: error.message });
  }
});

export default router;
