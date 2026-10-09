import fs from 'node:fs/promises';

const clean = s => s.split(/\r?\n/).filter(x => x.trim()).map(x => x.split('\t').map(v => v.trim()));
const bank = clean(await fs.readFile('D:/Projetos/Dashboard/bradesco_pix.tsv','utf8')).map(p => ({
  item:+p[0], date:p[1], cents:Math.round(Number(p[2])*100), numdoc:p[3], desc:p.slice(4).join(' ')
}));
const titles = clean(await fs.readFile('D:/Projetos/Dashboard/ctareceber_pix.tsv','utf8')).map(p => ({
  title:+p[0], date:p[1], cents:Math.round(Number(p[2])*100), status:+p[3], codpagto:+p[4], tppagto:+p[5]
}));
const day = s => Math.round((new Date(`${s}T12:00:00Z`))/86400000);
let proposed=[];
for (const b of bank) {
  const same=titles.filter(t=>t.cents===b.cents && t.date===b.date);
  if (same.length===1) proposed.push({...b,title:same[0].title,titleDate:same[0].date,rule:'mesmo dia'});
  else if (same.length===0) {
    const bd=day(b.date);
    const future=titles.filter(t=>t.cents===b.cents && day(t.date)>bd && day(t.date)<=bd+30);
    if (future.length===1) proposed.push({...b,title:future[0].title,titleDate:future[0].date,rule:'dia posterior'});
  }
}
const titleCounts=new Map();
for (const m of proposed) titleCounts.set(m.title,(titleCounts.get(m.title)||0)+1);
const collisions=proposed.filter(m=>titleCounts.get(m.title)>1);
const safe=proposed.filter(m=>titleCounts.get(m.title)===1);
const q=s=>String(s??'').replaceAll("'","''");
let sql=`SET AUTODDL OFF;\nSET COUNT ON;\nSET TERM ^;\n`;
for (const m of safe) {
  sql += `EXECUTE BLOCK AS DECLARE VARIABLE MID INTEGER; BEGIN\n`+
    ` INSERT INTO MOV_BANCARIO (CDBANCO,AGENCIA,NUMCONTA,NUMDOC,IDUSUARIO,IDEMPRESA,DESCRICAO,HISTORICO,DTLANCAMENTO,VALOR,TPLANCAMENTO,CDRECEBTO,STATUS,EXTRATO_ITEM,CONTROLE_CTA)\n`+
    ` VALUES (237,'6875','128516-5','${q(m.numdoc)}',1,1,'Conciliacao PIX Bradesco','${q(m.desc)}','${m.date}',${(m.cents/100).toFixed(2)},0,29,0,${m.item},${m.title}) RETURNING CONTROLE INTO :MID;\n`+
    ` UPDATE EXTRATO_ITEM SET MOV_BANCARIO=:MID WHERE CONTROLE=${m.item} AND MOV_BANCARIO IS NULL;\n`+
    ` UPDATE CTARECEBER SET MOV_BANCARIA=:MID WHERE CONTROLE=${m.title} AND IDEMPRESA=1 AND MOV_BANCARIA IS NULL AND STATUS=2;\n`+
    `END^\n`;
}
sql += `SET TERM ;^\nCOMMIT;\nQUIT;\n`;
await fs.writeFile('D:/Projetos/Dashboard/bradesco_pix_mapping.json',JSON.stringify({createdAt:new Date().toISOString(),safe,collisions},null,2));
await fs.writeFile('D:/Projetos/Dashboard/apply_bradesco_pix_mapping.sql',sql);
const itemIds=safe.map(x=>x.item).join(',');
const titleIds=safe.map(x=>x.title).join(',');
const backupSql=`OUTPUT 'D:/Projetos/Dashboard/backup_bradesco_pix_2026-09-29.txt';\nSET LIST ON;\nSELECT * FROM EXTRATO_ITEM WHERE CONTROLE IN (${itemIds}) ORDER BY CONTROLE;\nSELECT * FROM CTARECEBER WHERE CONTROLE IN (${titleIds}) AND IDEMPRESA=1 ORDER BY CONTROLE;\nOUTPUT;\nQUIT;\n`;
await fs.writeFile('D:/Projetos/Dashboard/backup_bradesco_pix.sql',backupSql);
console.log(JSON.stringify({bank:bank.length,proposed:proposed.length,safe:safe.length,collisions:collisions.length,sameDay:safe.filter(x=>x.rule==='mesmo dia').length,future:safe.filter(x=>x.rule==='dia posterior').length,total:safe.reduce((a,x)=>a+x.cents,0)/100}));
