import assert from "node:assert/strict";
import test from "node:test";
import {
  agreementStatusSql,
  buildAccountFilters,
  completeAccountInput,
  firebirdDate,
  financeStatusLabel,
  newAccountInput,
} from "../server/routes/finance-accounts.js";

test("valida e normaliza novo titulo financeiro", () => {
  const input = newAccountInput({
    tipo: "receber",
    idempresa: "1",
    pessoa_id: "25",
    documento: "  DOC-100  ",
    parcela: "2",
    vencimento: "2026-10-31",
    valor: "125.456",
    historico: " Mensalidade ",
  });
  assert.equal(input.type, "receber");
  assert.equal(input.company, 1);
  assert.equal(input.person, 25);
  assert.equal(input.document, "DOC-100");
  assert.equal(input.installment, 2);
  assert.equal(input.amount, 125.46);
  assert.equal(input.history, "Mensalidade");
});

test("completa novo titulo com os mesmos padroes operacionais do Automec", () => {
  const completed = completeAccountInput(
    newAccountInput({
      tipo: "receber", idempresa: 1, pessoa_id: 2, vencimento: "2026-10-31",
      documento: "X", valor: 10, forma_pagamento: 7,
    }),
    { CDGRUPO: 4, CCUSTO: 1, CDCONTA: "2", CDSUBCONTA: "16" },
  );
  assert.equal(completed.cash, 1);
  assert.equal(completed.receiptGroup, 4);
  assert.equal(completed.costCenter, 1);
  assert.equal(completed.account, "2");
  assert.equal(completed.subaccount, "16");
});

test("rejeita novo titulo sem dados obrigatorios", () => {
  assert.throws(
    () => newAccountInput({ tipo: "pagar", idempresa: 1 }),
    /fornecedor/i,
  );
  assert.throws(
    () => newAccountInput({ tipo: "receber", idempresa: 1, pessoa_id: 2, vencimento: "2026-10-31", documento: "X", valor: 0 }),
    /maior que zero/i,
  );
});

test("filtros financeiros usam parametros e preservam a semantica de receber", () => {
  const result = buildAccountFilters("receber", {
    loja: "2",
    cliente: "8",
    status: "vencido",
    busca: " ACME ",
  });
  assert.deepEqual(result.params, [2, 8, "%ACME%", "%ACME%", "%ACME%"]);
  assert.ok(result.where.includes("t.STATUS=1"));
  assert.ok(result.where.every((fragment) => !fragment.includes("ACME")));
});

test("filtros de data entregam objetos Date ao driver Firebird", () => {
  const result = buildAccountFilters("receber", {
    data_inicio: "2026-10-01",
    data_fim: "2026-10-31",
  });
  assert.equal(result.params.length, 2);
  assert.ok(result.params.every((value) => value instanceof Date));
  assert.equal(result.params[0].getFullYear(), 2026);
  assert.equal(result.params[0].getMonth(), 9);
  assert.equal(firebirdDate("data-invalida"), null);
});

test("acordo preserva a data operacional usada pelo Automec", () => {
  assert.match(agreementStatusSql("receber"), /DTCOB=\?/);
  assert.match(agreementStatusSql("pagar"), /DTPAGTO=\?/);
  assert.match(agreementStatusSql("receber"), /STATUS=6/);
});

test("status financeiros seguem as constantes do Automec", () => {
  assert.equal(financeStatusLabel(1, "2026-10-01", "2026-10-05"), "Vencido");
  assert.equal(financeStatusLabel(1, "2026-10-05", "2026-10-05"), "Aberto");
  assert.equal(financeStatusLabel(2), "Quitado");
  assert.equal(financeStatusLabel(3), "Devolucao");
  assert.equal(financeStatusLabel(5), "Transferencia");
  assert.equal(financeStatusLabel(6), "Acordo");
  assert.equal(financeStatusLabel(9), "Excluido");
});

test("filtro de vales fica restrito a contas a pagar", () => {
  assert.ok(
    buildAccountFilters("pagar", { vale: "vales_funcionarios" }).where.includes(
      "t.STATUSVALE IS NOT NULL AND t.EHFUNCIONARIO=-1",
    ),
  );
  assert.equal(
    buildAccountFilters("receber", { vale: "vales_funcionarios" }).where.some(
      (value) => value.includes("STATUSVALE"),
    ),
    false,
  );
});

test("filtros avancados do Automec sao parametrizados", () => {
  const receber = buildAccountFilters("receber", {
    banco: "2", caixa: "3", vendedor: "4", pedido: "99",
    historico: "teste", cheque: "123", conta: "5", subconta: "6",
  });
  assert.ok(receber.where.some((item) => item.includes("CHEQUES")));
  assert.ok(receber.where.includes("t.CDCONTA=?"));
  assert.ok(receber.params.includes("%TESTE%"));
  assert.equal(receber.where.some((item) => item.includes("123")), false);

  const pagar = buildAccountFilters("pagar", {
    tipo_documento: "2", com_boleto: "sim", danfe: "nao",
    valor_pago: "125,50", emissao_inicio: "2026-10-01",
  });
  assert.ok(pagar.where.includes("t.CDDOCUMENTO=?"));
  assert.ok(pagar.where.includes("t.COMBOLETO=-1"));
  assert.ok(pagar.params.some((item) => item instanceof Date));
});
