import test from "node:test";
import assert from "node:assert/strict";
import { suggestForItems } from "../server/lib/reconciliation-match.js";

const receber = (controle, valor, dtvenc) => ({ tipo: "receber", controle, idempresa: 1, valor, dtvenc, nrdoc: String(controle), pessoa: `Cliente ${controle}` });
const pagar = (controle, valor, dtvenc) => ({ tipo: "pagar", controle, idempresa: 1, valor, dtvenc, nrdoc: String(controle), pessoa: `Fornecedor ${controle}` });

test("sugere o único título em aberto com o mesmo valor", () => {
  const [item] = suggestForItems(
    [{ extrato_item: 1, data: "2026-09-01", valor: 260, conciliado: false }],
    [receber(10, 260, "2026-09-03"), pagar(11, 260, "2026-09-01")],
  );
  assert.equal(item.sugestao.status, "unico");
  assert.equal(item.sugestao.tipo, "receber");
  assert.equal(item.sugestao.titulos[0].controle, 10);
});

test("saída procura conta a pagar e ordena pelo vencimento mais próximo", () => {
  const [item] = suggestForItems(
    [{ extrato_item: 2, data: "2026-09-10", valor: -80, conciliado: false }],
    [pagar(1, 80, "2026-08-01"), pagar(2, 80, "2026-09-11"), receber(3, 80, "2026-09-10")],
  );
  assert.equal(item.sugestao.status, "multiplos");
  assert.equal(item.sugestao.tipo, "pagar");
  assert.deepEqual(item.sugestao.titulos.map((title) => title.controle), [2, 1]);
});

test("diferença acima de um centavo não vira sugestão", () => {
  const [item] = suggestForItems(
    [{ extrato_item: 3, data: "2026-09-01", valor: 100, conciliado: false }],
    [receber(4, 100.02, "2026-09-01")],
  );
  assert.equal(item.sugestao.status, "nao_encontrado");
  assert.equal(item.sugestao.titulos.length, 0);
});

test("item já conciliado não recebe sugestão", () => {
  const [item] = suggestForItems(
    [{ extrato_item: 4, data: "2026-09-01", valor: 50, conciliado: true }],
    [receber(5, 50, "2026-09-01")],
  );
  assert.equal(item.sugestao.status, "conciliado");
});
