import assert from "node:assert/strict";
import test from "node:test";
import { buildDreHierarchy } from "../server/routes/reports-extra.js";

const account = (description, extra = {}) => ({
  DESCRICAO: description,
  ORDEM: 1,
  DREPAGTO: null,
  DRERECEBTO: null,
  ...extra,
});

test("DRE segue a classificacao do Automec e acumula contas pai", () => {
  const plan = {
    contas: new Map([
      ["1", account("Receita")],
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
    ],
    plan,
    [
      { CDTPDRE: 1, TITULO: "Receitas", CDDRE: 1 },
      { CDTPDRE: 4, TITULO: "Custos Fixos", CDDRE: 4 },
    ],
  );
  assert.deepEqual(
    result.resumo.map((item) => item.total),
    [100, -40],
  );
  assert.equal(
    result.dados.find((item) => item.descricao === "Receita").meses[10],
    100,
  );
  assert.equal(
    result.dados.find((item) => item.descricao === "Despesas").meses[10],
    -40,
  );
  assert.equal(
    result.dados.filter((item) => item.grupo && !item.resultado).length,
    2,
  );
  assert.equal(result.resultado, 60);
});
