import assert from "node:assert/strict";
import test from "node:test";
import { int, num } from "../server/routes/purchase-replenishment.js";
test("normaliza números da sugestão de compras",()=>{assert.equal(int("12.9"),12);assert.equal(int(""),null);assert.equal(num("10.25"),10.25);assert.equal(num("x"),0)});
