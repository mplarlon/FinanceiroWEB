import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = "D:/Projetos/Dashboard";
const outputDir = `${root}/outputs/pagbank_pendentes_2026-09-25`;
const analysis = JSON.parse(await fs.readFile(`${root}/pagbank_sync_analysis.json`, "utf8"));

const rows = [];
for (const item of analysis.unmatched_bank) {
  rows.push({
    bank: item,
    reason: "Sem correspondência segura no sistema",
    order: null,
    receipt: null,
    systemTime: null,
    differenceMinutes: null,
    currentAuthorization: null,
  });
}
for (const match of analysis.matches) {
  if (match.difference_seconds <= 15 * 60) continue;
  const times = match.system.times || [];
  const bankTime = new Date(match.bank.when.replace(" ", "T"));
  const nearest = times
    .map((x) => new Date(x.replace(" ", "T")))
    .sort((a, b) => Math.abs(a - bankTime) - Math.abs(b - bankTime))[0] || null;
  rows.push({
    bank: match.bank,
    reason: "Possível venda, mas horário acima de 15 minutos",
    order: match.system.order,
    receipt: match.system.receipt,
    systemTime: nearest,
    differenceMinutes: match.difference_seconds / 60,
    currentAuthorization: match.system.old_authorization_max,
  });
}
rows.sort((a, b) => new Date(b.bank.when.replace(" ", "T")) - new Date(a.bank.when.replace(" ", "T")));

if (rows.length !== 1045) throw new Error(`Esperados 1045 registros; encontrados ${rows.length}`);

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Pendentes");
sheet.showGridLines = false;
sheet.tabColor = "#9C6500";

sheet.getRange("A2:M2").merge();
sheet.getRange("A2").values = [["Transações do PagBank não sincronizadas"]];
sheet.getRange("A2").format = { font: { name: "Arial", size: 15, bold: true, color: "#1F2937" } };
sheet.getRange("A3:M3").format.borders = { bottom: { style: "thin", color: "#9CA3AF" } };

sheet.getRange("A5:F5").values = [["Total pendente", 1045, "Sem correspondência", 898, "Horário acima de 15 min", 147]];
sheet.getRange("A5:F5").format = {
  fill: "#FFF4CE",
  font: { name: "Arial", size: 10, bold: true, color: "#7F6000" },
  verticalAlignment: "center",
};
sheet.getRange("B5,D5,F5").format.numberFormat = "#,##0";

const headers = [
  "Data PagBank", "Valor bruto", "Forma", "Parcelamento", "Autorização", "NSU",
  "Cartão", "Motivo", "Pedido possível", "Recebimento", "Horário do sistema",
  "Diferença (min)", "Autorização atual"
];
sheet.getRange("A8:M8").values = [headers];

const matrix = rows.map((row) => [
  new Date(row.bank.when.replace(" ", "T")),
  row.bank.amount / 100,
  row.bank.payment,
  row.bank.installment,
  row.bank.authorization,
  row.bank.nsu,
  row.bank.card,
  row.reason,
  row.order,
  row.receipt,
  row.systemTime,
  row.differenceMinutes,
  row.currentAuthorization,
]);
sheet.getRange(`E9:G${8 + matrix.length}`).format.numberFormat = "@";
sheet.getRange(`M9:M${8 + matrix.length}`).format.numberFormat = "@";
sheet.getRangeByIndexes(8, 0, matrix.length, headers.length).values = matrix;

const table = sheet.tables.add(`A8:M${8 + matrix.length}`, true, "PagBankPendentes");
table.style = "TableStyleMedium2";
table.showBandedRows = true;
table.showFilterButton = true;

sheet.getRange(`A8:M${8 + matrix.length}`).format.font = { name: "Arial", size: 10, color: "#1F2937" };
sheet.getRange("A8:M8").format = {
  fill: "#1F4E78",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
sheet.getRange(`A9:A${8 + matrix.length}`).format.numberFormat = "dd/mm/yyyy hh:mm";
sheet.getRange(`B9:B${8 + matrix.length}`).format.numberFormat = 'R$ #,##0.00';
sheet.getRange(`E9:G${8 + matrix.length}`).format.numberFormat = "@";
sheet.getRange(`I9:J${8 + matrix.length}`).format.numberFormat = "0";
sheet.getRange(`K9:K${8 + matrix.length}`).format.numberFormat = "dd/mm/yyyy hh:mm";
sheet.getRange(`L9:L${8 + matrix.length}`).format.numberFormat = "0.0";
sheet.getRange(`M9:M${8 + matrix.length}`).format.numberFormat = "@";
sheet.getRange(`H9:H${8 + matrix.length}`).conditionalFormats.add("containsText", {
  text: "Sem correspondência",
  format: { fill: "#FCE8E6", font: { color: "#B91C1C" } },
});
sheet.getRange(`H9:H${8 + matrix.length}`).conditionalFormats.add("containsText", {
  text: "horário acima",
  format: { fill: "#FFF4CE", font: { color: "#9C6500" } },
});

const widths = [19, 14, 23, 16, 25, 17, 20, 43, 16, 14, 19, 16, 18];
widths.forEach((width, index) => {
  sheet.getRangeByIndexes(0, index, 8 + matrix.length, 1).format.columnWidth = width;
});
sheet.getRange("A2:M2").format.rowHeight = 25;
sheet.getRange("A8:M8").format.rowHeight = 32;
sheet.freezePanes.freezeRows(8);

workbook.recalculate();
const check = await workbook.inspect({
  kind: "table",
  range: "Pendentes!A2:M14",
  include: "values,formulas",
  tableMaxRows: 14,
  tableMaxCols: 13,
});
console.log(check.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "Pendentes", range: "A1:M20", scale: 1, format: "png" });
await fs.writeFile(`${outputDir}/preview.png`, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/PagBank_1045_nao_sincronizados.xlsx`);
console.log(JSON.stringify({ output: `${outputDir}/PagBank_1045_nao_sincronizados.xlsx`, rows: rows.length }));
