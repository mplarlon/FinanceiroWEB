import fs from "node:fs";
import express from "express";
import { query, withDatabase } from "../db.js";
import { schemaFile } from "../config.js";

const router = express.Router();
const run = fn => async (req, res) => {
  try { res.json(await withDatabase(db => fn(db, req))); }
  catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
};

router.get("/schema/tabelas", (_req, res) => {
  try {
    if (!fs.existsSync(schemaFile)) return res.status(404).json({ ok: false, erro: "schema.json nao encontrado" });
    const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
    const resumo = Object.entries(schema.tabelas || {}).map(([nome, info]) => ({
      nome, categoria: info.categoria, total_registros: info.total_registros,
      total_colunas: (info.colunas || []).length, pk: info.pk, fk_count: (info.fk || []).length
    })).sort((a, b) => a.nome.localeCompare(b.nome));
    res.json(resumo);
  } catch (error) { res.status(500).json({ ok: false, erro: error.message }); }
});

router.get("/clientes/busca", run(async (db, req) => {
  const termo = String(req.query.q || "").trim();
  if (!termo) return { ok: true, clientes: [] };
  const upper = termo.toUpperCase();
  const clientes = await query(db, `SELECT FIRST 50 c.CDCLIENTE AS ID,
    COALESCE(c.CLIENTE, c.RAZAO) AS NOME
    FROM CLIENTE c WHERE (c.INATIVO = 0 OR c.INATIVO IS NULL) AND (
      UPPER(COALESCE(c.CLIENTE, '')) CONTAINING ? OR
      UPPER(COALESCE(c.RAZAO, '')) CONTAINING ? OR
      CAST(c.CDCLIENTE AS VARCHAR(20)) CONTAINING ?)
    ORDER BY CASE
      WHEN UPPER(COALESCE(c.CLIENTE, c.RAZAO, '')) = ? THEN 0
      WHEN UPPER(COALESCE(c.CLIENTE, c.RAZAO, '')) STARTING WITH ? THEN 1 ELSE 2 END,
      COALESCE(c.CLIENTE, c.RAZAO)`, [upper, upper, termo, upper, upper]);
  return { ok: true, clientes };
}));

router.get("/debug", run(async db => {
  const tables = ["SAIDAESTOQUE", "SAIDAPRODUTO", "CTARECEBER", "CTAPAGAR", "MOV_BANCARIO",
    "EXTRATO_ITEM", "MOVIMENTO", "PRODUTO", "ENTRESTOQUE", "CLIENTE", "VENDEDOR"];
  const contagens = {};
  for (const table of tables) {
    try { contagens[table] = Number((await query(db, `SELECT COUNT(*) AS TOTAL FROM ${table}`))[0]?.TOTAL || 0); }
    catch (error) { contagens[table] = `ERRO: ${error.message}`; }
  }
  return { ok: true, contagens };
}));

router.get("/debug/busca-cpfcnpj", run(async (db, req) => {
  const doc = String(req.query.doc || "").replace(/\D/g, "");
  const nome = String(req.query.nome || "").trim();
  const resultado = {};
  for (const table of ["CLIENTE", "FORNECEDOR"]) {
    const fields = await query(db, `SELECT TRIM(RDB$FIELD_NAME) AS NOME FROM RDB$RELATION_FIELDS
      WHERE TRIM(RDB$RELATION_NAME) = ? ORDER BY RDB$FIELD_POSITION`, [table]);
    const colunas = fields.map(row => row.NOME);
    const buscas = {};
    for (const column of ["CGC", "CPF", "CNPJ", "CPFCNPJ", "CPF_CNPJ", "NRCPF", "NRCNPJ", "DOCUMENTO", "CGCCPF"]) {
      if (!colunas.includes(column)) continue;
      try {
        buscas[column] = (await query(db, `SELECT FIRST 3 ${column} AS VALOR FROM ${table}
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(${column},'.',''),'-',''),'/',''),' ','') = ?`, [doc])).map(row => row.VALOR);
      } catch (error) { buscas[column] = `ERRO: ${error.message}`; }
    }
    resultado[table] = { colunas, buscas };
  }
  if (nome) {
    for (const [table, pk, nameColumn] of [["CLIENTE", "CDCLIENTE", "CLIENTE"], ["FORNECEDOR", "CDFORNECEDOR", "FORNECEDOR"]]) {
      resultado[`${table}_por_nome`] = (await query(db, `SELECT FIRST 5 ${pk} AS ID, ${nameColumn} AS NOME, CGC
        FROM ${table} WHERE UPPER(${nameColumn}) LIKE UPPER(?)`, [`%${nome}%`])).map(row => ({ id: row.ID, nome: row.NOME, cgc: row.CGC }));
    }
  }
  return { doc, resultado };
}));

export default router;
