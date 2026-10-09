import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'D:/Projetos/Dashboard/pendencias_setembro_raw.tsv';
const outputDir = 'D:/Projetos/Dashboard/outputs/reconciliacao_setembro_2026';
const outputPath = `${outputDir}/Pendencias_conciliacao_01-28_setembro_2026.xlsx`;

const raw = await fs.readFile(inputPath, 'utf8');
const rows = raw.split(/\r?\n/).filter(x => x.trim()).map(line => {
  const p = line.split('\t').map(x => x.trim());
  return {
    controle: Number(p[0]), extrato: Number(p[1]), banco: p[2],
    data: new Date(`${p[3]}T12:00:00`), tipo: p[4], valor: Number(p[5]),
    documento: p[6] || '', descricao: p.slice(7).join(' ').trim()
  };
});

const bankOrder = ['Bradesco - AG.: 6875', 'Sicredi - AG.: 4501', 'Caixa OCR 2026-09'];
const summary = bankOrder.map(banco => {
  const r = rows.filter(x => x.banco === banco);
  return [banco.replace(' - AG.: 6875','').replace(' - AG.: 4501','').replace(' OCR 2026-09',''), r.length,
    r.filter(x => x.tipo === 'ENTRADA').length,
    Math.round(r.filter(x => x.tipo === 'ENTRADA').reduce((a,x)=>a+x.valor,0) * 100) / 100,
    r.filter(x => x.tipo === 'SAIDA').length,
    Math.round(r.filter(x => x.tipo === 'SAIDA').reduce((a,x)=>a+x.valor,0) * 100) / 100];
});
const totals = ['Total', rows.length, summary.reduce((a,x)=>a+x[2],0), Math.round(summary.reduce((a,x)=>a+x[3],0)*100)/100, summary.reduce((a,x)=>a+x[4],0), Math.round(summary.reduce((a,x)=>a+x[5],0)*100)/100];

const wb = Workbook.create();
const sum = wb.worksheets.add('Resumo');
const det = wb.worksheets.add('Pendências');
sum.showGridLines = false; det.showGridLines = false;
sum.tabColor = '#1F4E78';

sum.getRange('A2:F2').values = [['Conciliação bancária pendente — 01 a 28/09/2026','','','','','']];
sum.getRange('A4:F4').values = [['Banco','Itens pendentes','Entradas (qtd.)','Entradas (R$)','Saídas (qtd.)','Saídas (R$)']];
sum.getRange('A5:F8').values = [...summary, totals];
sum.getRange('A10:F10').values = [['Observação','','','','','']];
sum.getRange('A11:F12').values = [[
  'Relação baseada em EXTRATO_ITEM sem MOV_BANCARIO até 28/09/2026. As 472 duplicidades exatas do Bradesco foram removidas antes deste relatório.','','','','',''
],['Cada linha da aba Pendências representa um lançamento bancário ainda sem vínculo no Miautomec.','','','','','']];
sum.mergeCells('A11:F11');
sum.mergeCells('A12:F12');

const headers = [['Controle','Extrato','Banco','Data','Tipo','Valor (R$)','Documento','Descrição']];
det.getRange('A1:H1').values = headers;
det.getRangeByIndexes(1,0,rows.length,8).values = rows.map(x => [x.controle,x.extrato,x.banco,x.data,x.tipo,x.valor,x.documento,x.descricao]);
det.tables.add(`A1:H${rows.length+1}`, true, 'PendenciasTable').style = 'TableStyleMedium2';

const title = sum.getRange('A2:F2');
title.format.font = { name:'Arial', size:15, bold:true, color:'#1F1F1F' };
title.format.rowHeight = 26;
sum.getRange('A3:F3').format.borders = { bottom:{style:'thin',color:'#1F4E78'} };
for (const range of [sum.getRange('A4:F4'), det.getRange('A1:H1')]) {
  range.format.fill = '#1F4E78';
  range.format.font = { name:'Arial', size:10, bold:true, color:'#FFFFFF' };
  range.format.horizontalAlignment = 'center';
  range.format.verticalAlignment = 'center';
}
sum.getRange('A5:F8').format.font = { name:'Arial', size:10, color:'#1F1F1F' };
sum.getRange('A8:F8').format.font = { name:'Arial', size:10, bold:true, color:'#1F1F1F' };
sum.getRange('A8:F8').format.borders = { top:{style:'double',color:'#1F4E78'} };
sum.getRange('B5:C8').format.numberFormat = '#,##0';
sum.getRange('D5:D8').format.numberFormat = 'R$ #,##0.00';
sum.getRange('E5:E8').format.numberFormat = '#,##0';
sum.getRange('F5:F8').format.numberFormat = 'R$ #,##0.00';
sum.getRange('A10:F10').format.fill = '#D9EAF7';
sum.getRange('A10:F10').format.font = { name:'Arial', size:10, bold:true, color:'#1F1F1F' };
sum.getRange('A11:A12').format.font = { name:'Arial', size:9, italic:true, color:'#555555' };
sum.getRange('A11:F12').format.wrapText = true;
sum.getRange('A11:F12').format.rowHeight = 24;
sum.getRange('A1:F12').format.font.name = 'Arial';
sum.getRange('A:A').format.columnWidth = 28;
sum.getRange('B:C').format.columnWidth = 16;
sum.getRange('D:F').format.columnWidth = 18;

det.getRange(`A2:H${rows.length+1}`).format.font = { name:'Arial', size:9, color:'#1F1F1F' };
det.getRange(`A2:B${rows.length+1}`).format.numberFormat = '0';
det.getRange(`D2:D${rows.length+1}`).format.numberFormat = 'dd/mm/yyyy';
det.getRange(`F2:F${rows.length+1}`).format.numberFormat = 'R$ #,##0.00';
det.getRange(`A1:H${rows.length+1}`).format.verticalAlignment = 'center';
det.getRange(`D2:G${rows.length+1}`).format.horizontalAlignment = 'center';
det.getRange('A:A').format.columnWidth = 12;
det.getRange('B:B').format.columnWidth = 10;
det.getRange('C:C').format.columnWidth = 24;
det.getRange('D:D').format.columnWidth = 13;
det.getRange('E:E').format.columnWidth = 12;
det.getRange('F:F').format.columnWidth = 16;
det.getRange('G:G').format.columnWidth = 18;
det.getRange('H:H').format.columnWidth = 62;
det.freezePanes.freezeRows(1);

wb.recalculate();
await fs.mkdir(outputDir, {recursive:true});
const preview = await wb.render({sheetName:'Resumo', range:'A1:F12', scale:1.5, format:'png'});
await fs.writeFile(`${outputDir}/preview_resumo.png`, new Uint8Array(await preview.arrayBuffer()));
const check = await wb.inspect({kind:'table', range:'Resumo!A2:F12', include:'values,formulas', tableMaxRows:20, tableMaxCols:8});
console.log(check.ndjson);
const errors = await wb.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options:{useRegex:true,maxResults:100}, summary:'final formula error scan'});
console.log(errors.ndjson);
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(JSON.stringify({outputPath, rows:rows.length, summary, totals}));
