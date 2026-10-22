import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import ExcelJS from "exceljs";
import router from "../server/routes/assistant.js";
import { buildExcel, buildPdf, normalizeTableExport } from "../server/lib/table-export.js";

const payload = {
  formato: "excel",
  titulo: "Risco de ruptura em 30 dias",
  colunas: [
    { chave: "CODIGO", rotulo: "Codigo", tipo: "numero" },
    { chave: "PRODUTO", rotulo: "Produto", tipo: "texto" },
    { chave: "ESTOQUE_ATUAL", rotulo: "Estoque atual", tipo: "numero" },
    { chave: "CUSTO_ESTIMADO", rotulo: "Custo estimado", tipo: "moeda" },
    { chave: "ULTIMA_ENTRADA", rotulo: "Ultima entrada", tipo: "data" },
  ],
  linhas: [
    { CODIGO: 12330, PRODUTO: "FIO FLEXÍVEL", ESTOQUE_ATUAL: -2, CUSTO_ESTIMADO: 58.4, ULTIMA_ENTRADA: "2026-10-13" },
    { CODIGO: 901, PRODUTO: "=2+2", ESTOQUE_ATUAL: -353, CUSTO_ESTIMADO: 0, ULTIMA_ENTRADA: null },
  ],
};

test("rejeita exportação sem formato ou sem linhas", () => {
  assert.throws(() => normalizeTableExport({ formato: "csv", colunas: ["A"], linhas: [[1]] }), /Excel ou PDF/);
  assert.throws(() => normalizeTableExport({ formato: "pdf", colunas: [], linhas: [] }), /Não há dados/);
});

test("gera excel com número, moeda, data e texto sem fórmula", async () => {
  const table = normalizeTableExport(payload);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildExcel(table));
  const sheet = wb.getWorksheet("Dados");
  assert.equal(sheet.getCell("A1").value, "Risco de ruptura em 30 dias");
  assert.equal(sheet.getRow(3).getCell(2).value, "Produto");
  assert.equal(sheet.getRow(4).getCell(3).value, -2);
  assert.equal(sheet.getRow(4).getCell(4).numFmt, "R$ #,##0.00");
  assert.equal(sheet.getRow(4).getCell(5).value instanceof Date, true);
  assert.equal(sheet.getRow(4).getCell(5).value.getFullYear(), 2026);
  assert.equal(sheet.getRow(4).getCell(5).value.getMonth(), 9);
  assert.equal(sheet.getRow(4).getCell(5).value.getDate(), 13);
  assert.equal(sheet.getRow(5).getCell(2).value, "'=2+2");
  assert.equal(sheet.getRow(5).getCell(5).value, null);
});

test("a rota entrega o Excel para download", async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/exportar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /spreadsheetml/);
    assert.match(response.headers.get("content-disposition") || "", /risco-de-ruptura-em-30-dias\.xlsx/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gera pdf da planilha com acentuação", async () => {
  const table = normalizeTableExport({ ...payload, formato: "pdf" });
  table.data = Array.from({ length: 80 }, (_, index) => table.data[index % table.data.length]);
  const pdf = await buildPdf(table);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
});
