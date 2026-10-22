import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

const MAX_ROWS = 2000;
const MAX_COLS = 40;
const TYPES = new Set(["moeda", "data", "numero", "texto"]);

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function fileSlug(title) {
  const slug = String(title || "dados")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "dados";
}

function cellValue(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value.slice(0, 500);
  return String(value).slice(0, 500);
}

export function normalizeTableExport(body = {}) {
  const formato = String(body.formato || "").toLowerCase();
  if (formato !== "excel" && formato !== "pdf") throw fail("Escolha Excel ou PDF.");
  const columns = Array.isArray(body.colunas) ? body.colunas : [];
  const sourceRows = Array.isArray(body.linhas) ? body.linhas : [];
  if (!columns.length || !sourceRows.length) throw fail("Não há dados para exportar.");
  if (columns.length > MAX_COLS || sourceRows.length > MAX_ROWS)
    throw fail(`A planilha aceita até ${MAX_ROWS} linhas e ${MAX_COLS} colunas.`);

  const specs = columns.map((column, index) => {
    if (column && typeof column === "object") {
      const chave = String(column.chave || column.key || index);
      const rotulo = String(column.rotulo || column.label || chave)
        .replace(/[\r\n]+/g, " ")
        .slice(0, 80);
      return { chave, rotulo, tipo: TYPES.has(column.tipo) ? column.tipo : "texto" };
    }
    const chave = String(column).slice(0, 80);
    return { chave, rotulo: chave, tipo: "texto" };
  });
  const data = sourceRows.map((row) =>
    specs.map((spec, index) => cellValue(Array.isArray(row) ? row[index] : row?.[spec.chave])),
  );
  const title = String(body.titulo || "Dados")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120) || "Dados";
  return {
    formato,
    title,
    labels: specs.map((spec) => spec.rotulo),
    types: specs.map((spec) => spec.tipo),
    data,
  };
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function excelText(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function excelCell(value, tipo) {
  if (value == null || value === "") return null;
  if (tipo === "moeda" || tipo === "numero") return asNumber(value) ?? excelText(value);
  if (tipo === "data") return asDate(value) || excelText(value);
  if (typeof value === "number") return value;
  return excelText(value);
}

export function displayCell(value, tipo) {
  if (value == null || value === "") return "";
  if (tipo === "moeda") {
    const amount = asNumber(value);
    return (amount ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (tipo === "data") {
    const date = asDate(value);
    if (date) return date.toLocaleDateString("pt-BR");
  }
  if (tipo === "numero" || typeof value === "number") {
    const amount = asNumber(value);
    if (amount != null) return amount.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
  return excelText(value);
}

function pdfText(value) {
  return String(value ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\u0000-\u00FF]/g, "");
}

const COLUMN_LABELS = {
  CONTROLE: "Controle",
  CODIGO: "Código",
  PESSOA: "Pessoa",
  CLIENTE: "Cliente",
  FORNECEDOR: "Fornecedor",
  VENDEDOR: "Vendedor",
  VENCIMENTO: "Vencimento",
  SALDO: "Saldo",
  TOTAL: "Total",
  DIAS_ATRASO: "Dias de atraso",
  PEDIDOS: "Pedidos",
  TITULOS: "Títulos",
  DATA: "Data",
  DATA_BAIXA: "Data da baixa",
  ANO: "Ano",
  MES: "Mês",
  VARIACAO: "Variação %",
  DESCRICAO: "Descrição",
  PRODUTO: "Produto",
  QUANTIDADE: "Quantidade",
  PRECO: "Preço",
  PRECO_A: "Preço A",
  PRECO_B: "Preço B",
  PRECO_ATUAL: "Preço atual",
  PRECO_NOVO: "Preço novo",
  CUSTO: "Custo",
  CUSTO_ANTERIOR: "Custo anterior",
  CUSTO_ATUAL: "Custo atual",
  DIFERENCA: "Diferença",
  MARGEM: "Margem %",
  ESTOQUE: "Estoque",
  ESTOQUE_ATUAL: "Estoque atual",
  ESTOQUE_MINIMO: "Estoque mínimo",
  SUGESTAO: "Sugestão",
  ULTIMA_COMPRA: "Última compra",
  NOME: "Nome",
  TABELA: "Tabela",
  UNIDADE: "Unidade",
};

const COLUMN_TYPES = {
  TOTAL: "moeda", SALDO: "moeda", PRECO: "moeda", PRECO_A: "moeda", PRECO_B: "moeda",
  PRECO_ATUAL: "moeda", PRECO_NOVO: "moeda", CUSTO: "moeda", CUSTO_ANTERIOR: "moeda",
  CUSTO_ATUAL: "moeda", DIFERENCA: "moeda", VALOR: "moeda",
  VENCIMENTO: "data", ULTIMA_COMPRA: "data", DATA_BAIXA: "data", DATA: "data",
  MARGEM: "numero", VARIACAO: "numero", QUANTIDADE: "numero", PEDIDOS: "numero",
  TITULOS: "numero", DIAS_ATRASO: "numero", ESTOQUE: "numero", ESTOQUE_ATUAL: "numero",
  ESTOQUE_MINIMO: "numero", SUGESTAO: "numero", ANO: "numero", MES: "numero",
};

const SUM_KEYS = new Set(["TOTAL", "SALDO", "PEDIDOS", "TITULOS", "QUANTIDADE", "ESTOQUE", "ESTOQUE_ATUAL", "DIFERENCA", "CUSTO"]);

export function columnsFromRows(rows) {
  const sample = rows?.[0] || {};
  return Object.keys(sample).map((key) => ({
    chave: key,
    rotulo: COLUMN_LABELS[key] || String(key).replaceAll("_", " ").toLocaleLowerCase("pt-BR").replace(/^./, (letter) => letter.toLocaleUpperCase("pt-BR")),
    tipo: COLUMN_TYPES[key] || (typeof sample[key] === "number" ? "numero" : "texto"),
  }));
}

export function summableIndexes(columns) {
  return columns.map((column, index) => (SUM_KEYS.has(column.chave) ? index : -1)).filter((index) => index >= 0);
}

function roundSum(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function layoutReportRows(table) {
  const source = table.data || [];
  let rows = source;
  if (Number.isInteger(table.grupo)) {
    rows = [];
    let current;
    let bucket = [];
    const flush = () => {
      if (!bucket.length) return;
      rows.push(...bucket);
      rows.push(table.labels.map((_, index) => {
        if (index === table.grupo) return `Subtotal ${current ?? ""}`.trim();
        if (table.somar?.includes(index))
          return roundSum(bucket.reduce((sum, row) => sum + (asNumber(row[index]) || 0), 0));
        return null;
      }));
      bucket = [];
    };
    for (const row of source) {
      const key = row[table.grupo];
      if (bucket.length && key !== current) flush();
      current = key;
      bucket.push(row);
    }
    flush();
  }
  const total = table.totalizar
    ? table.labels.map((_, index) => {
      if (index === 0) return "Total";
      if (table.somar?.includes(index))
        return roundSum(source.reduce((sum, row) => sum + (asNumber(row[index]) || 0), 0));
      return null;
    })
    : null;
  return { rows, total };
}

function reportSubtitle(table) {
  const parts = [`${table.data?.length || 0} registro(s)`];
  if (table.periodo) parts.push(String(table.periodo));
  if (table.geradoEm) parts.push(`Gerado em ${table.geradoEm}`);
  if (table.indicadores) parts.push(String(table.indicadores));
  return parts.join(" · ");
}

function sheetName(name, used) {
  const base = String(name || "Dados").replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Dados";
  let next = base;
  let suffix = 2;
  while (used.has(next)) {
    const tail = ` ${suffix}`;
    next = `${base.slice(0, 31 - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(next);
  return next;
}

function stopExport(options) {
  if (options?.shouldStop?.()) {
    const error = new Error("Exportação cancelada.");
    error.status = 499;
    throw error;
  }
}

function paintExcelRow(sheet, values, types) {
  const added = sheet.addRow(values.map((value, index) => excelCell(value, types[index])));
  added.eachCell((cell, col) => {
    const tipo = types[col - 1];
    if (tipo === "moeda" && typeof cell.value === "number") cell.numFmt = 'R$ #,##0.00';
    else if (tipo === "numero" && typeof cell.value === "number") cell.numFmt = "#,##0.00";
    else if (tipo === "data" && cell.value instanceof Date) cell.numFmt = "dd/mm/yyyy";
  });
  return added;
}

function writeExcelSheet(wb, table, usedNames, options) {
  stopExport(options);
  const laid = table.totalizar || Number.isInteger(table.grupo) ? layoutReportRows(table) : { rows: table.data, total: null };
  const sheet = wb.addWorksheet(sheetName(table.name, usedNames));
  const width = Math.max(table.labels.length, 1);
  sheet.mergeCells(1, 1, 1, width);
  sheet.getCell("A1").value = table.title;
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1F3654" } };
  sheet.mergeCells(2, 1, 2, width);
  sheet.getCell("A2").value = reportSubtitle(table);
  sheet.getCell("A2").font = { color: { argb: "FF526079" } };
  const header = sheet.addRow(table.labels);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2167C7" } };
  laid.rows.forEach((row, index) => {
    if (index % 200 === 0) stopExport(options);
    const added = paintExcelRow(sheet, row, table.types);
    if (table.grupo != null && String(row[table.grupo] || "").startsWith("Subtotal")) added.font = { bold: true };
  });
  const lastDataRow = 3 + laid.rows.length;
  if (laid.total) {
    const totalRow = paintExcelRow(sheet, laid.total, table.types);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
      cell.font = { bold: true, color: { argb: "FF1F3654" } };
    });
  }
  table.labels.forEach((label, index) => {
    const samples = table.data.slice(0, 40).map((row) => displayCell(row[index], table.types[index]).length);
    sheet.getColumn(index + 1).width = Math.min(42, Math.max(12, label.length + 2, ...samples));
  });
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: Math.max(3, lastDataRow), column: width },
  };
  sheet.views = [{ state: "frozen", ySplit: 3 }];
}

export async function buildExcel(table, options = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Charlie";
  const used = new Set();
  const sheets = table.abas?.length ? table.abas : [{ ...table, name: table.name || "Dados" }];
  for (const aba of sheets) writeExcelSheet(wb, aba, used, options);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildCsv(table) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const laid = table.totalizar || Number.isInteger(table.grupo) ? layoutReportRows(table) : { rows: table.data, total: null };
  const header = table.labels.map(escape).join(";");
  const lines = laid.rows.map((row) =>
    row.map((value, index) => escape(displayCell(value, table.types[index]))).join(";"),
  );
  if (laid.total)
    lines.push(laid.total.map((value, index) => escape(displayCell(value, table.types[index]))).join(";"));
  return Buffer.from(`\uFEFF${[header, ...lines].join("\r\n")}`, "utf8");
}

function columnWidths(doc, table, pageWidth, fontSize) {
  doc.fontSize(fontSize);
  const sample = table.data.slice(0, 30);
  const raw = table.labels.map((label, index) => {
    doc.font("Helvetica-Bold");
    const header = doc.widthOfString(pdfText(label)) + 10;
    doc.font("Helvetica");
    const cells = sample.map((row) => doc.widthOfString(pdfText(displayCell(row[index], table.types[index])).slice(0, 80)) + 10);
    return Math.min(170, Math.max(36, header, ...cells));
  });
  const sum = raw.reduce((total, width) => total + width, 0) || 1;
  return raw.map((width) => (width * pageWidth) / sum);
}

export function buildPdf(table) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const laid = table.totalizar || Number.isInteger(table.grupo) ? layoutReportRows(table) : { rows: table.data, total: null };
    const margin = 32;
    const pageWidth = doc.page.width - margin * 2;
    const fontSize = table.labels.length > 14 ? 6.5 : table.labels.length > 8 ? 7.5 : 8.5;
    const widths = columnWidths(doc, table, pageWidth, fontSize);
    const bottom = () => doc.page.height - margin - 16;
    let y = margin;

    const paint = (text, x, top, width, height, options = {}) => {
      doc.text(pdfText(text), x, top, { width, height, lineBreak: true, ellipsis: true, ...options });
    };
    const drawHeader = () => {
      const height = fontSize + 10;
      doc.save();
      doc.rect(margin, y, pageWidth, height).fill("#2167c7");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(fontSize);
      let x = margin;
      table.labels.forEach((label, index) => {
        paint(label, x + 3, y + 3, widths[index] - 6, height - 4);
        x += widths[index];
      });
      doc.restore();
      y += height;
    };

    doc.fillColor("#1f3654").font("Helvetica-Bold").fontSize(14).text(pdfText(table.title), margin, y, { width: pageWidth });
    y = doc.y + 2;
    doc.font("Helvetica").fontSize(8).fillColor("#526079").text(pdfText(reportSubtitle(table)), margin, y, { width: pageWidth });
    y = doc.y + 8;
    drawHeader();

    laid.rows.forEach((row, index) => {
      const texts = row.map((value, column) => displayCell(value, table.types[column]));
      doc.font("Helvetica").fontSize(fontSize);
      const measured = texts.map((text, column) => {
        const width = Math.max(8, widths[column] - 6);
        return doc.heightOfString(pdfText(text) || " ", { width }) + 6;
      });
      const height = Math.min(72, Math.max(fontSize + 8, ...measured));
      if (y + height > bottom()) {
        doc.addPage();
        y = margin;
        drawHeader();
      }
      if (index % 2 === 0) doc.rect(margin, y, pageWidth, height).fill("#f5f8fc");
      doc.fillColor("#1f3654").font("Helvetica").fontSize(fontSize);
      let x = margin;
      texts.forEach((text, column) => {
        const numeric = table.types[column] === "moeda" || table.types[column] === "numero" || table.types[column] === "data";
        paint(text, x + 3, y + 3, widths[column] - 6, height - 4, { align: numeric ? "right" : "left" });
        x += widths[column];
      });
      y += height;
    });

    if (laid.total) {
      const texts = laid.total.map((value, column) => displayCell(value, table.types[column]));
      const height = fontSize + 10;
      if (y + height > bottom()) {
        doc.addPage();
        y = margin;
        drawHeader();
      }
      doc.rect(margin, y, pageWidth, height).fill("#e8f0fe");
      doc.fillColor("#1f3654").font("Helvetica-Bold").fontSize(fontSize);
      let x = margin;
      texts.forEach((text, column) => {
        const numeric = table.types[column] === "moeda" || table.types[column] === "numero";
        paint(text, x + 3, y + 3, widths[column] - 6, height - 4, { align: numeric ? "right" : "left" });
        x += widths[column];
      });
    }

    const range = doc.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      doc.switchToPage(page);
      doc.font("Helvetica").fontSize(8).fillColor("#526079").text(
        `Página ${page - range.start + 1} de ${range.count}`,
        margin,
        doc.page.height - 24,
        { width: pageWidth, align: "right", lineBreak: false },
      );
    }
    doc.end();
  });
}
