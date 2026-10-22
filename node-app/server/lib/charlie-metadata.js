import fs from "node:fs";
import path from "node:path";
import { dataDir, schemaFile } from "../config.js";
import { query, withReadOnlyDatabase } from "../db.js";

const CACHE = "charlie-schema-cache.json";
const FIELD_TYPES = {
  7: "SHORT", 8: "LONG", 10: "FLOAT", 12: "DATE", 13: "TIME", 14: "CHAR",
  16: "INT64", 27: "DOUBLE", 35: "TIMESTAMP", 37: "VARYING", 261: "BLOB",
};
let memory;
let nextRefreshAt = 0;

function cachePath() {
  return path.join(dataDir, CACHE);
}

function inferPurpose(name, meta) {
  const value = name.toUpperCase();
  const rules = [
    [/^(ENTR|ENTRADA)|COMPRA|ORDEMCOMPRA/, "compras, recebimentos e entrada de mercadorias"],
    [/^(SAIDA|VENDA)|PEDIDO|NOTAFISCAL/, "vendas, pedidos, faturamento e saída de mercadorias"],
    [/PRODUTO|ESTOQUE|MOVIMENTO|CURVA_ABC/, "cadastro, saldo e movimentação de produtos/estoque"],
    [/CTAPAGAR|PAGAMENTO|PAGAR|DESPESA/, "contas a pagar e desembolsos financeiros"],
    [/CTARECEBER|RECEBIMENTO|RECEBER/, "contas a receber e ingressos financeiros"],
    [/BANCO|CAIXA|CONTA|MOVFIN/, "tesouraria, bancos, caixa e movimentação financeira"],
    [/CLIENTE/, "cadastro e relacionamento com clientes"],
    [/FORNECEDOR/, "cadastro e relacionamento com fornecedores"],
    [/VENDEDOR|COMISSAO/, "equipe comercial, vendas e comissões"],
    [/FUNCIONARIO|FOLHA|PONTO/, "recursos humanos e funcionários"],
    [/NFE|NFCE|CTE|FISCAL|IMPOSTO|TRIBUT/, "documentos e obrigações fiscais"],
    [/CONFIG|PARAM|USUARIO|PERMIS/, "configuração e controle do sistema"],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1]
    || (meta.categoria && meta.categoria !== "outros" ? meta.categoria : "apoio operacional do ERP");
}

function buildMap(parsed) {
  const tables = parsed?.tabelas || {};
  return new Map(Object.entries(tables).map(([name, meta]) => {
    const upper = name.toUpperCase();
    return [upper, {
      name: upper,
      purpose: inferPurpose(upper, meta),
      category: meta.categoria || "outros",
      rowCount: Number(meta.total_registros || 0),
      view: Boolean(meta.view),
      columns: (meta.colunas || []).map((column) => ({
        name: String(column.nome).toUpperCase(),
        type: column.tipo || column.tipo_num,
        required: Boolean(column.nao_nulo),
        description: column.descricao || "",
        domain: column.dominio || "",
      })),
      pk: (meta.pk || []).map((item) => String(item).trim().toUpperCase()),
      fk: (meta.fk || []).map((item) => ({
        column: String(item.coluna_origem || "").trim().toUpperCase(),
        table: String(item.tabela_destino || "").trim().toUpperCase(),
        target: String(item.coluna_destino || "").trim().toUpperCase(),
      })).filter((item) => item.column && item.table),
    }];
  }));
}

function readSchemaFile() {
  return JSON.parse(fs.readFileSync(schemaFile, "utf8"));
}

function loadRaw() {
  const file = cachePath();
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8"));
      if (cached?.fonte === "firebird" && Number(cached.total_tabelas || 0) > 100) return cached;
    } catch { /* o schema.json continua válido */ }
  }
  return readSchemaFile();
}

export function clearCatalogCache() {
  memory = null;
}

export function getCatalog() {
  if (!memory) memory = buildMap(loadRaw());
  return memory;
}

export function catalogSummary() {
  const file = cachePath();
  const cached = fs.existsSync(file);
  return {
    tabelas: getCatalog().size,
    fonte: cached ? "firebird" : "schema.json",
    atualizado_em: cached ? fs.statSync(file).mtime.toISOString() : null,
  };
}

function text(value) {
  if (value == null) return "";
  const raw = Buffer.isBuffer(value) ? value.toString("latin1") : String(value);
  return raw.replace(/\s+/g, " ").trim();
}

export async function refreshFirebirdCatalog(db) {
  const previous = readSchemaFile();
  let columns;
  try {
    columns = await query(db, `
      SELECT TRIM(rf.RDB$RELATION_NAME) AS RELACAO,
             TRIM(rf.RDB$FIELD_NAME) AS CAMPO,
             f.RDB$FIELD_TYPE AS TIPO_NUM,
             COALESCE(rf.RDB$NULL_FLAG, 0) AS NAO_NULO,
             TRIM(rf.RDB$FIELD_SOURCE) AS DOMINIO,
             CAST(rf.RDB$DESCRIPTION AS VARCHAR(160)) AS DESCRICAO,
             CASE WHEN r.RDB$VIEW_BLR IS NULL THEN 0 ELSE 1 END AS EH_VIEW
      FROM RDB$RELATION_FIELDS rf
      JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
      WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
      ORDER BY rf.RDB$RELATION_NAME, rf.RDB$FIELD_POSITION
    `);
  } catch {
    columns = await query(db, `
      SELECT TRIM(rf.RDB$RELATION_NAME) AS RELACAO,
             TRIM(rf.RDB$FIELD_NAME) AS CAMPO,
             f.RDB$FIELD_TYPE AS TIPO_NUM,
             COALESCE(rf.RDB$NULL_FLAG, 0) AS NAO_NULO,
             TRIM(rf.RDB$FIELD_SOURCE) AS DOMINIO,
             CAST(NULL AS VARCHAR(10)) AS DESCRICAO,
             CASE WHEN r.RDB$VIEW_BLR IS NULL THEN 0 ELSE 1 END AS EH_VIEW
      FROM RDB$RELATION_FIELDS rf
      JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
      JOIN RDB$RELATIONS r ON r.RDB$RELATION_NAME = rf.RDB$RELATION_NAME
      WHERE COALESCE(r.RDB$SYSTEM_FLAG, 0) = 0
      ORDER BY rf.RDB$RELATION_NAME, rf.RDB$FIELD_POSITION
    `);
  }
  const primaryKeys = await query(db, `
    SELECT TRIM(rc.RDB$RELATION_NAME) AS RELACAO, TRIM(seg.RDB$FIELD_NAME) AS CAMPO
    FROM RDB$RELATION_CONSTRAINTS rc
    JOIN RDB$INDEX_SEGMENTS seg ON seg.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
    WHERE rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY'
    ORDER BY rc.RDB$RELATION_NAME, seg.RDB$FIELD_POSITION
  `);
  const foreignKeys = await query(db, `
    SELECT TRIM(rc.RDB$RELATION_NAME) AS ORIGEM,
           TRIM(seg.RDB$FIELD_NAME) AS COLUNA,
           TRIM(pk.RDB$RELATION_NAME) AS DESTINO,
           TRIM(seg2.RDB$FIELD_NAME) AS COLUNA_DESTINO
    FROM RDB$RELATION_CONSTRAINTS rc
    JOIN RDB$REF_CONSTRAINTS refc ON refc.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
    JOIN RDB$RELATION_CONSTRAINTS pk ON pk.RDB$CONSTRAINT_NAME = refc.RDB$CONST_NAME_UQ
    JOIN RDB$INDEX_SEGMENTS seg ON seg.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
    JOIN RDB$INDEX_SEGMENTS seg2 ON seg2.RDB$INDEX_NAME = pk.RDB$INDEX_NAME
      AND seg2.RDB$FIELD_POSITION = seg.RDB$FIELD_POSITION
    WHERE rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY'
  `);
  const tables = {};
  for (const row of columns) {
    const name = text(row.RELACAO).toUpperCase();
    if (!name || name.startsWith("RDB$") || name.startsWith("MON$")) continue;
    if (!tables[name]) {
      tables[name] = {
        nome: name,
        categoria: previous.tabelas?.[name]?.categoria || "outros",
        total_registros: Number(previous.tabelas?.[name]?.total_registros || 0),
        view: Number(row.EH_VIEW || 0) === 1,
        colunas: [],
        pk: [],
        fk: [],
      };
    }
    const domain = text(row.DOMINIO).toUpperCase();
    tables[name].colunas.push({
      nome: text(row.CAMPO).toUpperCase(),
      tipo: FIELD_TYPES[Number(row.TIPO_NUM)] || String(row.TIPO_NUM || ""),
      nao_nulo: Number(row.NAO_NULO || 0) === 1,
      descricao: text(row.DESCRICAO),
      dominio: domain.startsWith("RDB$") ? "" : domain,
    });
  }
  for (const row of primaryKeys) {
    const table = tables[text(row.RELACAO).toUpperCase()];
    const column = text(row.CAMPO).toUpperCase();
    if (table && column && !table.pk.includes(column)) table.pk.push(column);
  }
  for (const row of foreignKeys) {
    const table = tables[text(row.ORIGEM).toUpperCase()];
    if (!table) continue;
    table.fk.push({
      coluna_origem: text(row.COLUNA).toUpperCase(),
      tabela_destino: text(row.DESTINO).toUpperCase(),
      coluna_destino: text(row.COLUNA_DESTINO).toUpperCase(),
    });
  }
  const payload = {
    fonte: "firebird",
    banco: previous.banco || "",
    gerado_em: new Date().toISOString(),
    total_tabelas: Object.keys(tables).length,
    tabelas: tables,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const target = cachePath();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload));
  fs.renameSync(temporary, target);
  clearCatalogCache();
  return catalogSummary();
}

export function ensureFreshCatalog() {
  try {
    const file = cachePath();
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 24 * 60 * 60 * 1000) return;
  } catch { /* tenta atualizar */ }
  if (Date.now() < nextRefreshAt) return;
  nextRefreshAt = Date.now() + 10 * 60 * 1000;
  withReadOnlyDatabase((db) => refreshFirebirdCatalog(db))
    .catch((error) => {
      if (String(process.env.CHARLIE_AI_LOG_ERRORS || "0") === "1")
        console.warn(`[charlie-metadata] ${error.message}`);
    });
}
