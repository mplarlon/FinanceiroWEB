import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFiscalGuide } from "../server/routes/fiscal-reports.js";

test("normaliza guia fiscal e calcula total",()=>{const guide=normalizeFiscalGuide({competencia:"09/2026",icms_valor:100,fecp_valor:20});assert.equal(guide.competencia_mes,9);assert.equal(guide.competencia_ano,2026);assert.equal(guide.total_valor,120);});
test("rejeita competencia fiscal invalida",()=>assert.throws(()=>normalizeFiscalGuide({competencia:"13/2026"}),/Competencia invalida/));
