import assert from "node:assert/strict";
import test from "node:test";
import { itemCostSql } from "../server/lib/sale-cost.js";

test("custo da venda usa VLCUSTOREAL quando a coluna existe", () => {
  const columns = new Set(["VLCUSTOREAL", "VLCUSTO", "VLCUSTOMEDIO"]);
  assert.equal(
    itemCostSql(columns, "sp", "p"),
    "COALESCE(CASE WHEN sp.VLCUSTOREAL>0 AND (sp.VLUNIT IS NULL OR sp.VLUNIT=0 OR sp.VLCUSTOREAL<=ABS(sp.VLUNIT)*100) THEN sp.VLCUSTOREAL ELSE NULL END,CASE WHEN sp.VLCUSTO>0 AND (sp.VLUNIT IS NULL OR sp.VLUNIT=0 OR sp.VLCUSTO<=ABS(sp.VLUNIT)*100) THEN sp.VLCUSTO ELSE NULL END,CASE WHEN p.VLCUSTOMEDIO>0 THEN p.VLCUSTOMEDIO ELSE NULL END,0)",
  );
});

test("custo da venda não cita VLCUSTOREAL quando a coluna não existe", () => {
  const columns = new Set(["VLCUSTO", "VLCUSTOMEDIO"]);
  assert.equal(itemCostSql(columns, "sp", "pr"), "COALESCE(CASE WHEN sp.VLCUSTO>0 AND (sp.VLUNIT IS NULL OR sp.VLUNIT=0 OR sp.VLCUSTO<=ABS(sp.VLUNIT)*100) THEN sp.VLCUSTO ELSE NULL END,CASE WHEN pr.VLCUSTOMEDIO>0 THEN pr.VLCUSTOMEDIO ELSE NULL END,0)");
  assert.equal(itemCostSql(columns, "sp", null), "COALESCE(CASE WHEN sp.VLCUSTO>0 AND (sp.VLUNIT IS NULL OR sp.VLUNIT=0 OR sp.VLCUSTO<=ABS(sp.VLUNIT)*100) THEN sp.VLCUSTO ELSE NULL END,0)");
});
