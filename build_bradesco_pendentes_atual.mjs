import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const raw=await fs.readFile('D:/Projetos/Dashboard/bradesco_pendentes_atual.tsv','utf8');
const category=d=>{const u=d.toUpperCase(); if(u.includes('CIELO'))return'CIELO'; if(u.includes('PIX'))return'PIX'; if(/TARIF|IOF|JUROS/.test(u))return'TARIFAS/JUROS'; if(/BOLETO|COBRANCA/.test(u))return'BOLETOS/COBRANCA'; if(/CDB|APLIC|RESG/.test(u))return'APLICACAO/RESGATE'; return'OUTROS';};
const rows=raw.split(/\r?\n/).filter(x=>x.trim()).map(l=>{const p=l.split('\t').map(x=>x.trim()); const d=p.slice(5).join(' '); return[+p[0],new Date(`${p[1]}T12:00:00`),p[2],+p[3],category(d),p[4]||'',d];});
const cats=[...new Set(rows.map(x=>x[4]))];
const summary=cats.map(c=>{const r=rows.filter(x=>x[4]===c);return[c,r.length,r.filter(x=>x[2]==='ENTRADA').reduce((a,x)=>a+x[3],0),r.filter(x=>x[2]==='SAIDA').reduce((a,x)=>a+x[3],0)];});
for(const x of summary){x[2]=Math.round(x[2]*100)/100;x[3]=Math.round(x[3]*100)/100;}
summary.sort((a,b)=>(b[2]+b[3])-(a[2]+a[3]));
const total=['Total',rows.length,Math.round(summary.reduce((a,x)=>a+x[2],0)*100)/100,Math.round(summary.reduce((a,x)=>a+x[3],0)*100)/100];
const dir='D:/Projetos/Dashboard/outputs/reconciliacao_setembro_2026'; const path=`${dir}/Bradesco_pendencias_atualizadas_ate_28-09-2026.xlsx`;
const wb=Workbook.create(); const sh=wb.worksheets.add('Bradesco pendente'); sh.showGridLines=false; sh.tabColor='#9E1B32';
sh.getRange('A2:G2').values=[['Bradesco — lançamentos ainda sem conciliação até 28/09/2026','','','','','','']];
sh.getRange('A4:D4').values=[['Categoria','Quantidade','Entradas (R$)','Saídas (R$)']];
sh.getRangeByIndexes(4,0,summary.length+1,4).values=[...summary,total];
const start=summary.length+7;
sh.getRangeByIndexes(start-1,0,1,7).values=[['Controle','Data','Tipo','Valor (R$)','Categoria','Documento','Descrição']];
sh.getRangeByIndexes(start,0,rows.length,7).values=rows;
sh.tables.add(`A${start}:G${start+rows.length}`,true,'BradescoPendencias').style='TableStyleMedium2';
sh.getRange('A2:G2').format.font={name:'Arial',size:15,bold:true,color:'#1F1F1F'}; sh.getRange('A3:G3').format.borders={bottom:{style:'thin',color:'#1F4E78'}};
for(const r of [sh.getRange('A4:D4'),sh.getRange(`A${start}:G${start}`)]){r.format.fill='#1F4E78';r.format.font={name:'Arial',size:10,bold:true,color:'#FFFFFF'};r.format.horizontalAlignment='center';}
sh.getRange(`A5:D${summary.length+5}`).format.font={name:'Arial',size:10,color:'#1F1F1F'}; sh.getRange(`A${summary.length+5}:D${summary.length+5}`).format.font={name:'Arial',size:10,bold:true,color:'#1F1F1F'};
sh.getRange(`C5:D${summary.length+5}`).format.numberFormat='R$ #,##0.00';
sh.getRange(`A${start+1}:G${start+rows.length}`).format.font={name:'Arial',size:9,color:'#1F1F1F'}; sh.getRange(`B${start+1}:B${start+rows.length}`).format.numberFormat='dd/mm/yyyy'; sh.getRange(`D${start+1}:D${start+rows.length}`).format.numberFormat='R$ #,##0.00';
for(const [col,w] of [['A',13],['B',13],['C',12],['D',16],['E',22],['F',18],['G',68]])sh.getRange(`${col}:${col}`).format.columnWidth=w;
sh.freezePanes.freezeRows(start);
wb.recalculate(); await fs.mkdir(dir,{recursive:true}); const prev=await wb.render({sheetName:'Bradesco pendente',range:`A1:G${Math.min(start+15,start+rows.length)}`,scale:1.1,format:'png'}); await fs.writeFile(`${dir}/preview_bradesco_pendencias.png`,new Uint8Array(await prev.arrayBuffer()));
console.log((await wb.inspect({kind:'table',range:`Bradesco pendente!A2:G${start+5}`,include:'values,formulas',tableMaxRows:20,tableMaxCols:8})).ndjson); console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'formula errors'})).ndjson);
const out=await SpreadsheetFile.exportXlsx(wb);await out.save(path);console.log(JSON.stringify({path,count:rows.length,summary,total}));
