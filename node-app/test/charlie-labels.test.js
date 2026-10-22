import test from "node:test";
import assert from "node:assert/strict";
import { applyAlertNames } from "../server/lib/charlie-labels.js";
import { presentBehavioralAlert } from "../server/lib/charlie-behavioral-risk-engine.js";

test("duplicidade financeira mostra código e nome do cliente", () => {
  const [alert] = applyAlertNames([{
    id: 11,
    titulo: "Possível duplicidade financeira",
    descricao: "2 títulos possuem documento, pessoa, parcela, valor e vencimento coincidentes. A duplicidade ainda precisa ser confirmada.",
    narrativa: "2 títulos coincidem em documento, pessoa, parcela, valor e vencimento. Duplicidade não confirmada.",
    registros: [{ CODIGO: "758932,758934", NOME: "CTARECEBER", VALOR: null }],
    evidencias: {
      entity: "CTARECEBER",
      records: [
        { domain: "receber", id: 1, partyId: 19062, document: "000012762", installment: 1, amount: 32.8 },
        { domain: "receber", id: 2, partyId: 19062, document: "000012762", installment: 1, amount: 32.8 },
      ],
    },
  }], { clients: new Map([["19062", "OFICINA LESTE"]]), products: new Map(), suppliers: new Map() });
  assert.equal(alert.registros.length, 1);
  assert.equal(alert.registros[0].CODIGO, 19062);
  assert.equal(alert.registros[0].NOME, "OFICINA LESTE");
  assert.match(alert.descricao, /cliente 19062 - OFICINA LESTE/);
  assert.match(alert.narrativa, /cliente 19062 - OFICINA LESTE/);
  assert.doesNotMatch(alert.descricao, /CTARECEBER/);
});

test("alteração de preço mostra código e nome do produto", () => {
  const [named] = applyAlertNames([{
    id: 12,
    evidencias: {
      auditCategory: "riscos_comportamentais",
      events: [0, 1].map((index) => ({ type: "price_change", entity: "PRODUTOPRECO", recordId: "1:70:UN", previous: { price: 10 }, next: { price: 11 }, actor: { id: 7, name: "" }, occurredAt: new Date(Date.parse("2026-10-21T12:36:51.150Z") + index * 60000).toISOString() })),
      criteria: { anomaly: { evaluable: true, anomalous: false, samples: 8 }, burst: { detected: true, count: 2 } },
      baseline: { median: 10, samples: 8 },
    },
    registros: [{ CODIGO: "1:70:UN", NOME: "PRODUTOPRECO" }],
  }], { products: new Map([["1", "PARAFUSO SEXTAVADO"]]), clients: new Map(), suppliers: new Map(), users: new Map([["7", "DENISE"]]) });
  const alert = presentBehavioralAlert(named);
  assert.match(alert.descricao, /produto 1 - PARAFUSO SEXTAVADO, tabela 70, UN/);
  assert.match(alert.descricao, /por DENISE/);
  assert.doesNotMatch(alert.descricao, /usuário 7/);
  assert.match(alert.registros[0].NOME, /Produto 1 - PARAFUSO SEXTAVADO/);
  assert.match(alert.registros[0].NOME, /DENISE/);
  assert.doesNotMatch(alert.registros[0].NOME, /usuário 7/);
});
