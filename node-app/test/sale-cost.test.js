import assert from "node:assert/strict";
import test from "node:test";
import { itemCostSql } from "../server/lib/sale-cost.js";

test("custo da venda usa VLCUSTOREAL quando a coluna existe", () => {
  const columns = new Set(["VLCUSTOREAL", "VLCUSTO", "VLCUSTOMEDIO"]);
  assert.equal(
    itemCostSql(columns, "sp", "p"),
    "COALESCE(sp.VLCUSTOREAL,sp.VLCUSTO,p.VLCUSTOMEDIO,0)",
  );
});

test("custo da venda não cita VLCUSTOREAL quando a coluna não existe", () => {
  const columns = new Set(["VLCUSTO", "VLCUSTOMEDIO"]);
  assert.equal(itemCostSql(columns, "sp", "pr"), "COALESCE(sp.VLCUSTO,pr.VLCUSTOMEDIO,0)");
  assert.equal(itemCostSql(columns, "sp", null), "COALESCE(sp.VLCUSTO,0)");
});
