import assert from "node:assert/strict";
import test from "node:test";
import { buildCashFilters, cashExclusion, firebirdDate, openParcelValue, pendingCashFilters, planCashMove, readMoveItems, receivedValue } from "../server/routes/cash-control.js";

test("filtros do controle de caixa sao parametrizados",()=>{
  const result=buildCashFilters({inicio:"2026-10-01",fim:"2026-10-05",empresa:"2",caixa:"3",caixa_origem:"4"});
  assert.equal(result.params[0] instanceof Date,true);
  assert.equal(result.params[1] instanceof Date,true);
  assert.equal(result.params[0].getHours(),0);
  assert.equal(result.params[1].getHours(),0);
  assert.deepEqual(result.params.slice(2),[2,3,4]);
  assert.equal(result.where.some(value=>value.includes("2026-10")),false);
});

test("filtros invalidos nao entram na consulta",()=>{
  const result=buildCashFilters({empresa:"2 OR 1=1",caixa:"x"});
  assert.deepEqual(result.params,[]);
});

test("parcela pendente permanece no caixa atual",()=>{
  const result=pendingCashFilters({empresa:"1",caixa:"4",inicio:"2026-10-01",fim:"2026-10-01"});
  assert.equal(result.where.includes("COALESCE(t.CAIXA,t.CDCAIXAORIGEM)=?"),true);
  assert.deepEqual(result.params.slice(2),[1,4]);
});

test("data enviada ao Firebird e um objeto Date",()=>{
  const day=firebirdDate("2026-10-29");
  assert.equal(day instanceof Date,true);
  assert.equal(typeof day.getFullYear,"function");
  assert.equal(day.getFullYear(),2026);
  assert.equal(day.getMonth(),9);
  assert.equal(day.getDate(),29);
  assert.equal(firebirdDate("29/10/2026"),null);
});

test("parcela quitada atualiza o caixa e o titulo com origem diferente do destino",()=>{
  const steps=planCashMove({
    origin:"RECEBIMENTO",
    movement:10,
    company:1,
    destination:5,
    row:{CAIXA:2,NRPEDIDO:900,PARCELA:1,NRDOC:"900"},
  });
  assert.equal(steps.length,2);
  assert.match(steps[0].sql,/UPDATE CTARECEBERCAIXA/);
  assert.match(steps[1].sql,/UPDATE CTARECEBER /);
  assert.deepEqual(steps[1].params.slice(0,2),[2,5]);
  assert.notEqual(steps[1].params[0],steps[1].params[1]);
  assert.equal(steps[1].params.includes(900),true);
});

test("parcela em aberto tambem sai do caixa lido pelo Automec",()=>{
  const steps=planCashMove({
    origin:"PENDENTE",
    movement:11,
    company:1,
    destination:5,
    row:{CAIXA:2,NRPEDIDO:901,PARCELA:2,NRDOC:"901"},
  });
  assert.match(steps[0].sql,/UPDATE CTARECEBER /);
  assert.match(steps[0].sql,/STATUS=1/);
  assert.match(steps[1].sql,/UPDATE CTARECEBERCAIXA/);
  assert.deepEqual(steps[1].params.slice(0,2),[2,5]);
  assert.match(steps[1].sql,/COALESCE\(CANCELADO,0\)=0/);
});

test("varias parcelas usam o mesmo caixa de destino",()=>{
  const items=readMoveItems({
    caixa_destino:"5",
    itens:[
      {origem:"PENDENTE",movimento:"11",empresa:"1",caixa_atual:"2"},
      {origem:"RECEBIMENTO",movimento:"12",empresa:"1",caixa_atual:"2"},
      {origem:"PENDENTE",movimento:"11",empresa:"1",caixa_atual:"2"},
    ],
  });
  assert.equal(items.length,2);
  assert.deepEqual(items.map((item)=>item.destination),[5,5]);
});

test("transferencia sem destino e recusada",()=>{
  assert.throws(()=>readMoveItems({origem:"PENDENTE",movimento:"1",empresa:"1",caixa_atual:"2",caixa_destino:"2"}),/invalido/);
});

test("parcela em aberto soma o valor da parcela",()=>{
  assert.match(openParcelValue,/COALESCE\(t\.VALOR,0\)<>0 THEN t\.VALOR/);
  assert.equal(openParcelValue.startsWith("COALESCE(t.DIVIDA"),false);
  assert.match(receivedValue,/COALESCE\(c\.TOTALPG,0\)<>0 THEN c\.TOTALPG/);
});

test("marcar para nao exibir tira carteira, vale e devolucao da consulta",()=>{
  const where=cashExclusion({nao_carteiras:"1",nao_vales:"on",nao_devolucoes:"true"});
  assert.equal(where.length,3);
  assert.match(where[0],/NOT IN \(1,8\)/);
  assert.match(where[0],/CARTEIRA/);
  assert.match(where[1],/<>10/);
  assert.match(where[2],/NOT IN \(12,13\)/);
  assert.deepEqual(cashExclusion({}),[]);
});
