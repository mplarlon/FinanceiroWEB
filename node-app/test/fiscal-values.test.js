import assert from "node:assert/strict";
import test from "node:test";
import { competence } from "../server/routes/fiscal-values.js";
test("aceita competencias AAAA-MM e MM/AAAA",()=>{assert.deepEqual(competence("2026-09"),{year:2026,month:9});assert.deepEqual(competence("09/2026"),{year:2026,month:9});});
