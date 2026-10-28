import test from "node:test";
import assert from "node:assert/strict";
import { resumirAutomacoes } from "../server/lib/charlie-automation-center.js";
import { painelAutomacoes } from "../server/lib/charlie-automation-center-service.js";
import { createAutomationMemoryStore } from "../server/lib/charlie-automation-store.js";

test("o resumo não mostra destinatário nem completa horário", () => {
  const painel = resumirAutomacoes([
    {
      id: 3,
      nome: "Estoque baixo",
      status: "ativa",
      modalidade: "programada",
      acao: "estoque.abaixo_minimo",
      agenda: { tipo: "diaria", hora: 7 },
      proximaExecucao: "2026-10-27T10:00:00.000Z",
      politicaConfirmacao: "automatica_leitura",
      objetivo: "Avisar o estoque",
      destinatarios: [{ tipo: "telefone", valor: "21999990000" }],
      parametros: { segredo: "nao-mostrar" },
    },
    { id: 4, nome: "Sem situação", agenda: { tipo: "semanal", hora: 8, minuto: 30 }, status: "aguardando_confirmacao" },
  ]);
  assert.equal(painel.ativas, 1);
  assert.equal(painel.aguardando, 1);
  assert.equal(painel.itens[0].horario, null);
  assert.equal(painel.itens[1].horario, "08:30");
  assert.equal(painel.itens[1].status, "aguardando_confirmacao");
  const json = JSON.stringify(painel);
  assert.equal(json.includes("21999990000"), false);
  assert.equal(json.includes("nao-mostrar"), false);
  assert.match(painel.aviso, /não executada|ou executada/);
});

test("a consulta não grava automação", async () => {
  const store = createAutomationMemoryStore({
    nextId: 2,
    automacoes: [{ id: 1, nome: "Relatório", status: "ativa", criadaPor: 9, acao: "relatorios.faturamento_periodo", destinatarios: [{ valor: "21988887777" }] }],
    execucoes: [],
  });
  const antes = JSON.stringify(store.state);
  const painel = await painelAutomacoes({ store }, { ator: { id: 9, gerencial: false } });
  assert.equal(JSON.stringify(store.state), antes);
  assert.equal(painel.itens.length, 1);
  assert.equal(painel.itens[0].nome, "Relatório");
  assert.equal(JSON.stringify(painel).includes("21988887777"), false);
  const outro = await painelAutomacoes({ store }, { ator: { id: 3, gerencial: false } });
  assert.equal(outro.itens.length, 0);
  assert.ok(outro.lacunas.some((item) => item.includes("Não há automação gravada")));
});
