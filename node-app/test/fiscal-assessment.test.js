import assert from "node:assert/strict";
import test from "node:test";
import { fiscalPeriod } from "../server/routes/fiscal-assessment.js";
test("normaliza periodo da apuracao fiscal",()=>assert.deepEqual(fiscalPeriod({data_ini:"2026-09-01",data_fim:"2026-09-30"}),{start:"2026-09-01",end:"2026-09-30"}));
test("rejeita periodo fiscal invalido",()=>assert.throws(()=>fiscalPeriod({data_ini:"ontem"}),/Periodo fiscal invalido/));
