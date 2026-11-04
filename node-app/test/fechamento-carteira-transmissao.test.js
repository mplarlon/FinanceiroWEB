import assert from "node:assert/strict";
import test from "node:test";
import { linhasRevisao, notasParaRetransmitir } from "../client/src/lib/fechamento-carteira-transmissao.js";
import { montarConsultaPendentes } from "../server/routes/fechamento-carteira.js";

test("retransmite só nota pendente ou com erro", () => {
  const linhas = [
    { idnf: 1, status: "autorizada" },
    { idnf: 2, status: "pendente" },
    { idnf: 3, status: "erro" },
    { idnf: 4, status: "transmitindo" },
  ];
  assert.deepEqual(notasParaRetransmitir(linhas).map((linha) => linha.idnf), [2, 3]);
  assert.deepEqual(notasParaRetransmitir(null), []);
});

test("notas pendentes do fechamento entram na revisão ainda sem autorização", () => {
  assert.deepEqual(linhasRevisao([
    { IDNF: 9, IDEMPRESA: 1, NRDOC: " 000000123 ", CLIENTE: "A", TOTAL: 10 },
  ]), [{
    idnf: 9, idempresa: 1, nrdoc: "000000123", cliente: "A", total: 10, status: "pendente", motivo: "",
  }]);
});

test("a consulta das pendentes exige nota não emitida ligada ao título do fechamento", () => {
  const { sql, params } = montarConsultaPendentes({
    dataIni: "2026-11-01", dataFim: "2026-11-03", idempresa: 2, cliente: "silva",
  });
  assert.match(sql, /COALESCE\(n\.NFE_EMITIDA, 0\) = 0/);
  assert.match(sql, /COALESCE\(n\.NFE_CANCELADA, 0\) = 0/);
  assert.match(sql, /COALESCE\(cr\.ACORDO_NF, 0\) = 1/);
  assert.match(sql, /n\.IDEMPRESA = \?/);
  assert.equal(params.length, 6);
  assert.equal(params[2], 2);
  assert.deepEqual(params.slice(3), ["silva", "silva", "silva"]);
});

test("período invertido não monta a consulta das pendentes", () => {
  assert.throws(
    () => montarConsultaPendentes({ dataIni: "2026-11-03", dataFim: "2026-11-01" }),
    /Data inicial/,
  );
});
