import assert from "node:assert/strict";
import test from "node:test";
import { planAutomation, nextExecution } from "../server/lib/charlie-automation-plan.js";
import { executeAutomation, runDueAutomations } from "../server/lib/charlie-automation-engine.js";
import { createAutomationMemoryStore, getAutomation, listAutomationExecutions, saveAutomation } from "../server/lib/charlie-automation-store.js";
import { createMemoryStore } from "../server/lib/charlie-task-store.js";

const manager = { id: 7, gerencial: true, ativo: true };

test("interpreta rotina semanal e mantém prévia aguardando confirmação", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const result = planAutomation("Toda segunda-feira, às 8h, gere um relatório de títulos vencidos em Excel", manager, { now });
  assert.equal(result.ok, true);
  assert.equal(result.automacao.status, "aguardando_confirmacao");
  assert.equal(result.automacao.acao, "financeiro.inadimplencia");
  assert.equal(result.automacao.agenda.tipo, "semanal");
  assert.deepEqual(result.automacao.agenda.diasSemana, [1]);
  assert.equal(result.automacao.agenda.hora, 8);
  assert.ok(Date.parse(result.automacao.proximaExecucao) > now.getTime());
});

test("não inventa horário essencial ausente", () => {
  const result = planAutomation("Todos os dias gere um relatório das contas a receber", manager);
  assert.equal(result.ok, false);
  assert.match(result.pergunta, /horário/i);
});

test("rotina de escrita exige aprovação em cada execução", () => {
  const result = planAutomation("Todo dia 5 às 8h atualize os preços da tabela 70 em 2%", manager);
  assert.equal(result.ok, true);
  assert.equal(result.automacao.politicaConfirmacao, "confirmar_cada_execucao");
});

test("condição financeira vira regra numérica verificável", () => {
  const result = planAutomation("Quando um cliente acumular mais de R$ 10.000 em títulos vencidos, avise o financeiro", manager);
  assert.equal(result.ok, true);
  assert.equal(result.automacao.modalidade, "condicional");
  assert.equal(result.automacao.condicao.tipo, "soma_maior_que");
  assert.equal(result.automacao.condicao.valor, 10000);
});

test("cálculo de próxima execução respeita dia semanal e fuso", () => {
  const result = nextExecution({ tipo: "semanal", diasSemana: [1], hora: 8, minuto: 0 }, new Date("2026-10-20T12:00:00Z"), "America/Sao_Paulo");
  assert.equal(result, "2026-10-26T11:00:00.000Z");
});

test("executor evita duplicidade para o mesmo horário agendado", async () => {
  const store = createAutomationMemoryStore();
  const taskStore = createMemoryStore();
  const item = saveAutomation({
    nome: "Estoque baixo", objetivo: "teste", status: "ativa", modalidade: "condicional",
    acao: "estoque.abaixo_minimo", parametros: { limite: 100, formato: "nenhum", sugerir: "nao" },
    agenda: { tipo: "condicional", intervaloMinutos: 15 }, fusoHorario: "America/Sao_Paulo",
    criadaPor: 7, proximaExecucao: "2026-10-20T12:00:00.000Z",
  }, { store });
  const deps = {
    automationStore: store,
    taskStore,
    resolveUser: () => manager,
    query: async () => [{ CODIGO: 1, DESCRICAO: "Produto", ESTOQUE: 0, MINIMO: 2 }],
  };
  const first = await executeAutomation(item, deps, { scheduledAt: "2026-10-20T12:00:00.000Z" });
  const second = await executeAutomation(item, deps, { scheduledAt: "2026-10-20T12:00:00.000Z" });
  assert.notEqual(first.status, "duplicada");
  assert.equal(second.status, "duplicada");
  assert.ok(listAutomationExecutions(item.id, { automationStore: store }).length >= 1);
});

test("responsável inativo pausa a automação", async () => {
  const store = createAutomationMemoryStore();
  const item = saveAutomation({
    nome: "Relatório", status: "ativa", modalidade: "programada", acao: "financeiro.inadimplencia",
    parametros: { dominio: "receber", dias: 1, comparacao: "maior_ou_igual", agrupar: "cliente", limite: 20, formato: "nenhum" },
    agenda: { tipo: "diaria", hora: 8, minuto: 0 }, fusoHorario: "America/Sao_Paulo", criadaPor: 7,
    proximaExecucao: "2026-10-20T11:00:00.000Z",
  }, { store });
  const result = await executeAutomation(item, { store, resolveUser: () => ({ id: 7, ativo: false }) });
  assert.equal(result.status, "bloqueada");
  assert.equal(getAutomation(item.id, { store }).status, "pausada");
});
