import assert from "node:assert/strict";
import test from "node:test";
import { buildDreHierarchy, drePaidExpression } from "../server/routes/reports-extra.js";

const account = (description, extra = {}) => ({
  DESCRICAO: description,
  ORDEM: 1,
  DREPAGTO: null,
  DRERECEBTO: null,
  ...extra,
});

test("DRE mostra a conta mais especifica e separa parcela sem conta para identificar", () => {
  const plan = {
    contas: new Map([
      ["1", account("Receita", { DRERECEBTO: 1 })],
      ["3", account("Despesas")],
    ]),
    subcontas: new Map([
      ["1|2", account("PIX", { DRERECEBTO: 1 })],
      ["3|22", account("Internet", { DREPAGTO: 4 })],
    ]),
    subsubcontas: new Map(),
    subsubsubcontas: new Map(),
  };
  const result = buildDreHierarchy(
    [
      {
        CD: "1",
        SCD: "2",
        SSCD: "X",
        SSSCD: "X",
        MES: 10,
        VL: 100,
        ORIGEM: "receber",
      },
      {
        CD: "3",
        SCD: "22",
        SSCD: "X",
        SSSCD: "X",
        MES: 10,
        VL: -40,
        ORIGEM: "pagar",
      },
      {
        CD: "1",
        SCD: "X",
        SSCD: "X",
        SSSCD: "X",
        MES: 10,
        VL: 15,
        ORIGEM: "receber",
      },
      {
        CD: "X",
        SCD: "X",
        SSCD: "X",
        SSSCD: "X",
        MES: 10,
        VL: 999,
        ORIGEM: "receber",
      },
    ],
    plan,
    [
      { CDTPDRE: 1, TITULO: "Receitas", CDDRE: 1 },
      { CDTPDRE: 4, TITULO: "Custos Fixos", CDDRE: 4 },
    ],
  );
  assert.deepEqual(
    result.resumo.map((item) => item.total),
    [115, -40, 999],
  );
  assert.equal(result.dados.find((item) => item.descricao === "PIX").meses[10], 100);
  assert.equal(result.dados.find((item) => item.descricao === "Receita").meses[10], 15);
  assert.equal(
    result.dados.find((item) => item.descricao === "Despesas"),
    undefined,
  );
  assert.equal(
    result.dados.find((item) => item.descricao === "Internet").meses[10],
    -40,
  );
  assert.equal(
    result.dados.filter((item) => item.grupo && !item.resultado).length,
    3,
  );
  assert.equal(
    result.dados.some((item) => item.descricao === "Receitas a identificar"),
    true,
  );
  assert.equal(result.resultado, 1074);
});

test("DRE envia conta de nivel sem classificacao para identificar", () => {
  const plan = {
    contas: new Map([
      ["1", account("Receita")],
      ["3", account("Despesas", { DREPAGTO: 4 })],
    ]),
    subcontas: new Map([
      ["1|120", account("Carteira")],
      ["3|22", account("Internet")],
    ]),
    subsubcontas: new Map(),
    subsubsubcontas: new Map(),
  };
  const result = buildDreHierarchy(
    [
      { CD: "1", SCD: "X", SSCD: "X", SSSCD: "X", MES: 10, VL: 15, ORIGEM: "receber" },
      { CD: "1", SCD: "120", SSCD: "X", SSSCD: "X", MES: 10, VL: 40, ORIGEM: "receber" },
      { CD: "3", SCD: "22", SSCD: "X", SSSCD: "X", MES: 10, VL: -40, ORIGEM: "pagar" },
    ],
    plan,
    [{ CDTPDRE: 4, TITULO: "Custos Fixos", CDDRE: 4 }],
  );
  assert.equal(result.dados.find((item) => item.descricao === "Receita").meses[10], 15);
  assert.equal(result.dados.find((item) => item.descricao === "Carteira").meses[10], 40);
  assert.equal(result.dados.find((item) => item.descricao === "Despesas"), undefined);
  assert.equal(result.dados.find((item) => item.descricao === "Internet").meses[10], -40);
  assert.equal(result.dados.find((item) => item.descricao === "Receitas a identificar" && item.grupo).meses[10], 55);
  assert.equal(result.dados.find((item) => item.descricao === "Despesas a identificar" && item.grupo).meses[10], -40);
  assert.equal(result.resultado, 15);
});

test("DRE usa o valor pago da parcela", () => {
  assert.equal(drePaidExpression("receber"), "COALESCE(t.TOTALPG,0)");
  assert.equal(drePaidExpression("pagar"), "COALESCE(t.VLPAGTO,0)");
});
