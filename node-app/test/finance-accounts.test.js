import assert from "node:assert/strict";
import test from "node:test";
import {
  agreementInput,
  agreementStatusSql,
  buildAccountFilters,
  completeAccountInput,
  firebirdDate,
  financeStatusLabel,
  accountEditPlan,
  automaticDocumentNumber,
  newAccountInput,
  paymentFormAllowed,
  settlementInput,
  includeAccountProducts,
} from "../server/routes/finance-accounts.js";

test("numero automatico segue maquina, sequencia do dia e data", () => {
  assert.equal(
    automaticDocumentNumber({
      type: "receber",
      count: 0,
      machine: "01",
      date: "2026-10-20",
    }),
    "01120102026",
  );
  assert.equal(
    automaticDocumentNumber({
      type: "pagar",
      count: 3,
      machine: "",
      date: new Date(2026, 9, 20),
    }),
    "420102026",
  );
  assert.equal(
    automaticDocumentNumber({
      type: "receber",
      count: 0,
      machine: "MAQUINALONGA",
      date: "2026-10-20",
    }).length,
    15,
  );
});

test("alteracao de conta aberta lista somente os campos modificados", () => {
  const current = {
    STATUS: 1, NRDOC: "A", PARCELA: 1, DTVENC: "2026-10-20", VALOR: 10,
    HISTORICO: "", CODPAGTO: 1, CAIXA: 1, CCUSTO: null, CDCONTA: "",
    CDSUBCONTA: null, CDSUBSUBCONTA: "", CDSUBSUBSUBCONTA: null,
  };
  const same = accountEditPlan("receber", current, {
    documento: "A", parcela: 1, vencimento: "2026-10-20", valor: "10.00",
    historico: "", forma_pagamento: 1, caixa: 1,
  });
  assert.deepEqual(same.changes, []);
  const changed = accountEditPlan("receber", current, {
    documento: "B", parcela: 1, vencimento: "2026-11-01", valor: 10,
    historico: "", forma_pagamento: 4, caixa: 1,
  });
  assert.deepEqual(changed.changes, ["NRDOC", "DTVENC", "CODPAGTO", "TPPAGTO"]);
  assert.equal(changed.message, "NRDOC;DTVENC;CODPAGTO;TPPAGTO;");
  assert.equal(changed.values.TPPAGTO, 4);
  assert.throws(
    () => accountEditPlan("receber", { ...current, STATUS: 2 }, {
      documento: "B", parcela: 1, vencimento: "2026-10-20", valor: 10,
    }),
    /aberto/,
  );
  const supplier = accountEditPlan("pagar", {
    ...current, CDCAIXA: 1, NOTAFISCAL: "NF", CDFORNECEDOR: 8,
  }, {
    documento: "A", nota: "NF", parcela: 1, vencimento: "2026-10-20", valor: 10,
    historico: "", forma_pagamento: 1, caixa: 1, pessoa_id: 9,
  });
  assert.deepEqual(supplier.changes, ["CDFORNECEDOR"]);
});

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

test("parcelas iguais dividem o total e avancam o intervalo em dias", () => {
  const input = newAccountInput({
    tipo: "pagar",
    idempresa: 1,
    pessoa_id: 2,
    documento: "NF1",
    vencimento: "2026-01-31",
    valor: 100,
    quantidade: 3,
    intervalo: 30,
    iguais: true,
  });
  assert.deepEqual(
    input.parcels.map((parcel) => parcel.valor),
    [33.33, 33.33, 33.34],
  );
  assert.deepEqual(
    input.parcels.map((parcel) => parcel.vencimento),
    ["2026-01-31", "2026-03-02", "2026-04-01"],
  );
});

test("intervalo de 30 dias com dia fixo repete o dia do mes", () => {
  const input = newAccountInput({
    tipo: "receber",
    idempresa: 1,
    pessoa_id: 2,
    documento: "NF1",
    vencimento: "2024-01-31",
    valor: 90,
    quantidade: 3,
    dia_fixo: true,
    iguais: true,
  });
  assert.deepEqual(
    input.parcels.map((parcel) => parcel.vencimento),
    ["2024-01-31", "2024-02-29", "2024-03-31"],
  );
  assert.equal(input.parcels[0].valor, 30);
});

test("parcelas diferentes aceitam vencimentos e valores proprios", () => {
  assert.throws(
    () =>
      newAccountInput({
        tipo: "receber",
        idempresa: 1,
        pessoa_id: 2,
        documento: "NF1",
        vencimento: "2026-01-31",
        valor: 100,
        iguais: false,
        parcelas: [
          { vencimento: "2026-01-31", valor: 40 },
          { vencimento: "2026-03-15", valor: 40 },
        ],
      }),
    /soma/i,
  );
  const input = newAccountInput({
    tipo: "receber",
    idempresa: 1,
    pessoa_id: 2,
    documento: "NF1",
    vencimento: "2026-01-31",
    valor: 100,
    iguais: false,
    parcelas: [
      { vencimento: "2026-01-31", valor: 25 },
      { vencimento: "2026-02-20", valor: 75 },
    ],
  });
  assert.equal(input.parcels[1].vencimento, "2026-02-20");
  assert.equal(input.parcels[1].valor, 75);
  assert.equal(input.parcels[1].parcela, 2);
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

test("quitacao exige data e forma, e deixa o caixa opcional", () => {
  const input = settlementInput({
    data_pagamento: "2026-10-20",
    forma_pagamento: "4",
    desconto: "1,5",
  });
  assert.equal(input.payment, 4);
  assert.equal(input.cash, null);
  assert.equal(input.paymentDate.getDate(), 20);
  assert.throws(
    () => settlementInput({ data_pagamento: "2026-10-20" }),
    /forma de pagamento/i,
  );
  assert.throws(
    () => settlementInput({ forma_pagamento: 4 }),
    /data da quitacao/i,
  );
});

test("acordo exige vencimento, forma e caixa", () => {
  const input = agreementInput({
    data_inicial: "2026-11-01",
    forma_pagamento: "8",
    caixa: "2",
  });
  assert.equal(input.payment, 8);
  assert.equal(input.cash, 2);
  assert.throws(
    () => agreementInput({ data_inicial: "2026-11-01", forma_pagamento: 8 }),
    /caixa/i,
  );
  assert.throws(
    () => agreementInput({ data_inicial: "2026-11-01", caixa: 2 }),
    /forma de pagamento/i,
  );
});

test("forma de pagamento segue a liberacao do Automec em receber e pagar", () => {
  const receber = { SAIR_RECEBTO: -1, SAIR_PAGTO: 0, STATUS: 1, STATUS_PAGTO: 3 };
  const pagar = { SAIR_RECEBTO: 0, SAIR_PAGTO: -1, STATUS: 3, STATUS_PAGTO: 1 };
  assert.equal(paymentFormAllowed(receber, "receber", "quitar"), receber);
  assert.equal(paymentFormAllowed(pagar, "pagar", "acordo"), pagar);
  assert.throws(
    () => paymentFormAllowed(receber, "pagar", "quitar"),
    /contas a pagar/i,
  );
  assert.throws(
    () => paymentFormAllowed({ ...receber, STATUS: 3 }, "receber", "quitar"),
    /devolucao/i,
  );
  assert.equal(
    paymentFormAllowed({ ...receber, STATUS: 3 }, "receber", "acordo").STATUS,
    3,
  );
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
      "t.STATUSVALE IN (1,2) AND t.EHFUNCIONARIO=-1",
    ),
  );
  assert.ok(
    buildAccountFilters("pagar", {}).where.includes(
      "COALESCE(t.STATUSVALE,0) NOT IN (1,2)",
    ),
  );
  assert.equal(
    buildAccountFilters("pagar", { vale: "todos" }).where.some((value) =>
      value.includes("STATUSVALE"),
    ),
    false,
  );
  assert.equal(
    buildAccountFilters("receber", { vale: "vales_funcionarios" }).where.some(
      (value) => value.includes("STATUSVALE"),
    ),
    false,
  );
});

test("contas a receber não traz produtos até o usuário pedir", () => {
  assert.equal(includeAccountProducts("receber", {}), false);
  assert.equal(includeAccountProducts("receber", { produtos: "0" }), false);
  assert.equal(includeAccountProducts("receber", { produtos: "1" }), true);
  assert.equal(includeAccountProducts("pagar", {}), true);
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
