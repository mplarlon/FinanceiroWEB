import assert from "node:assert/strict";
import test from "node:test";
import { buildCashFilters } from "../server/routes/cash-control.js";

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
