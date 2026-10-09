import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReleaseRequest } from "../server/routes/pdv.js";

test("normaliza solicitacao por falta de estoque",()=>{
  assert.deepEqual(normalizeReleaseRequest({produto:" 10 ",quantidade:"2"}),{type:"SEM_ESTOQUE",product:"10",quantity:2,note:""});
});

test("rejeita quantidade e tipo de liberacao invalidos",()=>{
  assert.throws(()=>normalizeReleaseRequest({produto:"10",quantidade:0}),/Produto e quantidade/);
  assert.throws(()=>normalizeReleaseRequest({tipo:"OUTRO"}),/Tipo de liberacao/);
});
