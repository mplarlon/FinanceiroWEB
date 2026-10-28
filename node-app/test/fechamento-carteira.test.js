import assert from "node:assert/strict";
import test from "node:test";
import { expressaoColuna } from "../server/routes/fechamento-carteira.js";

test("usa o campo do Automec quando o nome novo nao existe", () => {
  assert.equal(expressaoColuna(["CDVEND", "DTCOB", "TOTALPG"], ["CDVENDEDOR", "CDVEND"]), "cr.CDVEND");
  assert.equal(expressaoColuna(["CDVEND", "DTCOB", "TOTALPG"], ["DTPAGTO", "DTCOB"]), "cr.DTCOB");
});

test("prefere o campo da versao que ja tem o nome pedido", () => {
  assert.equal(expressaoColuna(["CDVENDEDOR", "CDVEND"], ["CDVENDEDOR", "CDVEND"]), "cr.CDVENDEDOR");
  assert.equal(expressaoColuna(["DTPAGTO", "DTCOB"], ["DTPAGTO", "DTCOB"]), "cr.DTPAGTO");
});

test("sem nenhum dos campos a expressao fica nula", () => {
  assert.equal(expressaoColuna(["TOTALPG"], ["CDVENDEDOR", "CDVEND"]), "NULL");
});
