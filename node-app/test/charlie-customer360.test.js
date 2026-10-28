import test from "node:test";
import assert from "node:assert/strict";
import { montarFichas } from "../server/lib/charlie-customer360.js";
import { painelCliente } from "../server/lib/charlie-customer360-service.js";

test("a ficha não completa receita nem transforma lead encerrado em pendência", () => {
  const painel = montarFichas({
    vendas: [
      { clienteId: 10, nome: "Oficina Azul", vendedor: "Ana", ultimaCompra: "2026-10-01", pedidos: 2, receita: null, telefone: "21999990000" },
      { clienteId: 11, nome: "Casa Nova", ultimaCompra: "2026-09-01", pedidos: 1, receita: 80 },
    ],
    orcamentos: [
      { clienteId: 10, abertos: 1, valor: 40, ultimo: "2026-10-20" },
      { clienteId: 12, nome: "Só orçamento", abertos: 1, valor: null, ultimo: "2026-10-18" },
    ],
    leads: [
      { clienteId: 11, status: "CONVERTIDO", nome: "Casa Nova" },
      { clienteId: 13, status: "NEGOCIACAO", nome: "Lead vivo" },
      { clienteId: 14, status: "", nome: "Lead sem status" },
    ],
  });
  const azul = painel.itens.find((item) => item.clienteId === 10);
  assert.equal(azul.receita, null);
  assert.equal(azul.orcamentosAbertos, 1);
  assert.equal(azul.valorOrcamentos, 40);
  assert.equal(azul.pendencia, "Orçamento em aberto");
  assert.equal(JSON.stringify(painel).includes("21999990000"), false);
  assert.equal(JSON.stringify(painel).toLowerCase().includes("whatsapp"), false);
  assert.equal(JSON.stringify(painel).toLowerCase().includes("ligar"), false);
  const casa = painel.itens.find((item) => item.clienteId === 11);
  assert.equal(casa.receita, 80);
  assert.equal(casa.pendencia, "Sem pendência registrada");
  const soOrcamento = painel.itens.find((item) => item.clienteId === 12);
  assert.equal(soOrcamento.pedidos, 0);
  assert.equal(soOrcamento.receita, 0);
  assert.equal(soOrcamento.valorOrcamentos, null);
  const lead = painel.itens.find((item) => item.clienteId === 13);
  assert.equal(lead.pendencia, "Lead registrado: NEGOCIACAO");
  assert.equal(lead.pedidos, 0);
  const semStatus = painel.itens.find((item) => item.clienteId === 14);
  assert.equal(semStatus.pendencia, "Lead registrado sem situação");
  assert.match(painel.aviso, /Nenhum cadastro foi gravado/);
});

test("orçamento não consultado não vira zero", () => {
  const painel = montarFichas({
    vendas: [{ clienteId: 1, nome: "Cliente", pedidos: 1, receita: 10, ultimaCompra: "2026-01-01" }],
    orcamentos: null,
    leads: [],
  });
  assert.equal(painel.itens[0].orcamentosAbertos, null);
  assert.equal(painel.itens[0].pendencia, null);
  assert.ok(painel.lacunas.some((item) => item.includes("orçamentos não foram consultados")));
});

test("a consulta não grava a ficha", async () => {
  const sql = [];
  const painel = await painelCliente({
    query: async (texto) => {
      sql.push(texto);
      if (/\b(insert|update|delete)\b/i.test(texto)) throw new Error("gravação");
      if (texto.includes("FROM SAIDAESTOQUE")) {
        return [{ CDCLIENTE: 7, NOME: "Cliente", VENDEDOR: null, ULTIMA: "2026-10-02", PEDIDOS: 1, RECEITA: 15, SEM_RECEITA: 1 }];
      }
      return [{ CDCLIENTE: 7, NOME: "Cliente", ABERTOS: 2, ULTIMO: "2026-10-03", VALOR: 9, SEM_VALOR: 0 }];
    },
  }, { leads: [] });
  assert.equal(sql.some((item) => /\b(insert|update|delete)\b/i.test(item)), false);
  assert.ok(sql[0].indexOf("COUNT(*)") < sql[0].indexOf("LEFT JOIN CLIENTE"));
  assert.ok(sql[1].indexOf("COUNT(*)") < sql[1].indexOf("LEFT JOIN CLIENTE"));
  assert.equal(painel.itens[0].receita, null);
  assert.equal(painel.itens[0].orcamentosAbertos, 2);
  assert.equal(painel.itens[0].valorOrcamentos, 9);
  assert.equal(painel.itens[0].pendencia, "Orçamento em aberto");
  assert.equal(painel.itens[0].vendedor, null);
});
