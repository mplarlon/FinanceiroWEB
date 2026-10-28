import test from "node:test";
import assert from "node:assert/strict";
import { montarAuditoria } from "../server/lib/charlie-sales-audit.js";
import { painelAuditoria } from "../server/lib/charlie-sales-audit-service.js";

test("trilha ausente não vira zero e o texto sensível fica de fora", () => {
  const painel = montarAuditoria({
    ator: { id: 4, gerencial: false },
    arquivos: {
      "ecommerce_intelligence_control.json": {
        actions: {
          a: {
            id: "ACT-1",
            description: "Ajustar preço",
            history: [{ at: "2026-10-02T10:00:00.000Z", event: "approved", actor: 7, result: { phones: "21999990000" } }],
          },
        },
      },
      "ecommerce_marketplace_booster.json": null,
      "charlie-leads.json": {
        auditoria: [
          { id: "l1", em: "2026-10-03T10:00:00.000Z", usuarioId: 9, acao: "consultar_cnpj", detalhe: { cnpj: "12345678000199", telefone: "21999990000" } },
          { id: "l2", em: "2026-10-04T10:00:00.000Z", usuarioId: 4, acao: "atualizar_lead", detalhe: { id: "lead-2", status: "NOVO", saldo: 10 } },
        ],
      },
      "charlie-automations.json": {
        automacoes: [{ id: 1, criadaPor: 4 }, { id: 2, criadaPor: 9 }],
        execucoes: [
          { automacaoId: 1, status: "concluida", fimEm: "2026-10-05T10:00:00.000Z", usuario: 4, resultado: "ligar 21988887777" },
          { automacaoId: 2, status: "concluida", fimEm: "2026-10-05T11:00:00.000Z", usuario: 9, resultado: "segredo" },
        ],
      },
      "charlie_competitor_radar.json": { historico: [{ em: "2026-10-01T10:00:00.000Z", usuario: 4, tipo: "consulta", id: "r1", de: 10, para: 12 }] },
    },
  });
  assert.equal(painel.fontes.find((item) => item.origem === "Anúncios").lida, false);
  assert.equal(painel.fontes.find((item) => item.origem === "Anúncios").eventos, null);
  assert.equal(painel.fontes.find((item) => item.origem === "Comprar de novo").eventos, null);
  assert.equal(painel.itens.some((item) => item.origem === "Contatos" && item.referencia === "l1"), false);
  assert.equal(painel.itens.some((item) => item.referencia === "2"), false);
  assert.equal(painel.itens.find((item) => item.origem === "Contatos").referencia, "lead-2");
  assert.equal(painel.itens.find((item) => item.origem === "Concorrentes").descricao, "de 10 para 12");
  assert.equal(painel.itens[0].origem, "Automações");
  const json = JSON.stringify(painel);
  assert.equal(json.includes("21999990000"), false);
  assert.equal(json.includes("21988887777"), false);
  assert.equal(json.includes("12345678000199"), false);
  assert.equal(json.includes("segredo"), false);
  assert.match(painel.aviso, /Nenhuma trilha foi alterada/);
});

test("whatsapp e recuperação entram na trilha sem telefone nem texto livre", () => {
  const painel = montarAuditoria({
    ator: { id: 1, gerencial: true },
    arquivos: {
      "charlie_whatsapp_sales.json": { itens: [{ id: "w1", em: "2026-10-07T10:00:00.000Z", status: "aguardando", from: "21999990000", texto: "quero o preco" }] },
      "charlie_recovery.json": { acoes: { c1: { acoes: [{ id: "a1", tipo: "resultado", em: "2026-10-07T11:00:00.000Z", resultado: "recuperado", texto: "ligar 21988887777" }] } } },
      "charlie_smart_quotes.json": { orcamentos: [{ id: "o1", em: "2026-10-07T12:00:00.000Z", origem: "texto", texto: "pedido secreto" }] },
    },
  });
  const json = JSON.stringify(painel);
  assert.equal(painel.itens.some((item) => item.origem === "WhatsApp" && item.evento === "aguardando"), true);
  assert.equal(painel.itens.some((item) => item.origem === "Clientes parados" && item.evento === "resultado"), true);
  assert.equal(painel.itens.some((item) => item.origem === "Orçamentos"), true);
  assert.equal(json.includes("21999990000"), false);
  assert.equal(json.includes("21988887777"), false);
  assert.equal(json.includes("pedido secreto"), false);
  assert.equal(json.includes("quero o preco"), false);
});

test("a leitura não grava as trilhas", async () => {
  const arquivos = {
    "ecommerce_intelligence_control.json": { settings: {} },
    "charlie_rebuy.json": { historico: [{ em: "2026-10-06T10:00:00.000Z", usuario: null, tipo: "oportunidade", id: "rb" }] },
  };
  const antes = JSON.stringify(arquivos);
  const painel = await painelAuditoria({}, { ator: { id: 1, gerencial: true }, arquivos });
  assert.equal(JSON.stringify(arquivos), antes);
  assert.equal(painel.fontes.find((item) => item.origem === "Ações da loja").eventos, null);
  assert.equal(painel.itens.find((item) => item.origem === "Comprar de novo").responsavel, null);
  assert.equal(painel.itens.find((item) => item.origem === "Comprar de novo").evento, "oportunidade");
});
