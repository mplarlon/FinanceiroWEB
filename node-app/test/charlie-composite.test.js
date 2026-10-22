import assert from "node:assert/strict";
import test from "node:test";
import { planCompositeTask, validateCompositePlan } from "../server/lib/charlie-composite-plan.js";
import { retryCompositeTask, runCompositeTask } from "../server/lib/charlie-composite-engine.js";
import { cancelCharlieTask, exportCharlieTask } from "../server/lib/charlie-task-engine.js";
import { createMemoryStore, getTask, recoverInterruptedTasks, saveTask } from "../server/lib/charlie-task-store.js";

const reader = { id: 8, gerencial: false };
const manager = { id: 7, gerencial: true };
const memory = () => ({ store: createMemoryStore() });

test("identifica múltiplas intenções prioritárias e cria planos ordenados", () => {
  const cases = [
    ["Encontre contas vencidas há mais de 30 dias, prepare mensagens de cobrança e gere uma planilha.", ["financeiro.titulos_vencidos", "financeiro.preparar_cobrancas", "relatorios.dados_estruturados"]],
    ["Encontre clientes que reduziram compras nos últimos três meses, organize por vendedor e gere relatório.", ["comercial.reducao_compras", "relatorios.dados_estruturados"]],
    ["Encontre produtos com margem inferior a 15%, calcule preços para atingir 20% e prepare Excel.", ["produtos.margem_insuficiente", "produtos.calcular_preco_margem", "relatorios.dados_estruturados"]],
    ["Encontre produtos abaixo do estoque mínimo, identifique os fornecedores e prepare sugestão de compra.", ["estoque.abaixo_minimo", "estoque.sugestao_compra", "relatorios.dados_estruturados"]],
  ];
  for (const [question, actions] of cases) {
    const plan = planCompositeTask(question);
    assert.equal(plan.tipo, "composta");
    assert.deepEqual(plan.etapas.map((item) => item.acao), actions);
    assert.equal(validateCompositePlan(plan).ok, true);
  }
});

test("rejeita dependência inexistente, ciclo e ação não autorizada", () => {
  const bad = { etapas: [
    { id: "a", acao: "financeiro.titulos_vencidos", parametros: {}, dependencias: ["b"] },
    { id: "b", acao: "financeiro.enviar_cobranca", parametros: {}, dependencias: ["a"] },
  ] };
  const result = validateCompositePlan(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /não está autorizada|cíclica/);
  const missing = validateCompositePlan({ etapas: [{ id: "a", acao: "financeiro.titulos_vencidos", parametros: {}, dependencias: ["x"] }] });
  assert.match(missing.errors.join(" "), /inexistente/);
});

test("transfere dados estruturados, preserva filtros e integra a exportação existente", async () => {
  const deps = memory();
  let queries = 0;
  deps.query = async (sql, params) => {
    queries += 1;
    assert.match(sql, /CTARECEBER/);
    assert.deepEqual(params, []);
    return [{ CDCLIENTE: 9, PESSOA: "Cliente A", VENDEDOR: "Ana", EMAIL: "a@exemplo.com", SALDO: 150, DIAS_ATRASO: 40 }];
  };
  const plan = planCompositeTask("Encontre contas vencidas há mais de 30 dias, prepare mensagens de cobrança e gere Excel.");
  const result = await runCompositeTask(plan, reader, deps);
  assert.equal(result.tarefa.status, "concluida");
  assert.equal(result.tarefa.progresso.concluidas, 3);
  assert.equal(result.dados[0].CLIENTE, "Cliente A");
  assert.equal(queries, 1, "o relatório deve reutilizar o resultado anterior");
  const stored = getTask(result.tarefa.id, reader.id, deps);
  assert.equal(stored.contexto.filtros.dias, 30);
  assert.equal(stored.contexto.resultados.cobrancas.linhas[0].TOTAL, 150);
  const exported = await exportCharlieTask(result.tarefa.id, reader, "csv", deps);
  assert.equal(exported.status, 200);
  assert.match(exported.buffer.toString("utf8"), /Cliente A/);
});

test("falha intermediária preserva resultado e repetição não duplica etapa concluída", async () => {
  const deps = memory();
  let calls = 0;
  deps.query = async () => {
    calls += 1;
    if (calls === 1) return [{ CDPRODUTO: "1", PRODUTO: "Item", PRECO: 10, CUSTO: 9 }];
    throw new Error("consulta não esperada");
  };
  const plan = planCompositeTask("Encontre produtos com margem inferior a 15%, calcule preços para atingir 20% e prepare Excel.");
  const first = await runCompositeTask(plan, reader, deps);
  assert.equal(first.tarefa.status, "concluida");
  assert.equal(calls, 1);

  const task = getTask(first.tarefa.id, reader.id, deps);
  task.etapas[2].status = "falhou";
  task.etapas[2].erro = "Falha simulada no Excel";
  task.status = "concluida_parcial";
  task.podeRepetir = true;
  saveTask(task, deps);
  const retried = await retryCompositeTask(task.id, reader, deps);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.tarefa.status, "concluida");
  assert.equal(calls, 1, "as consultas concluídas não devem ser repetidas");
});

test("controla permissão por etapa e não executa consulta após bloqueio", async () => {
  const plan = planCompositeTask("Encontre produtos com margem inferior a 15%, calcule preços para atingir 20% e prepare Excel.");
  plan.etapas.splice(1, 0, {
    id: "alterar", acao: "produtos.reajuste_precos", nome: "Alterar preços", parametros: { tabela: 70, percentual: 10, limite: 10 },
    dependencias: ["margens"], entradas: [], resultadoEsperado: "alteração", status: "planejada", confirmacao: "explicita", falha: "interromper_dependentes",
  });
  plan.etapas.at(-1).dependencias = ["alterar"];
  let calls = 0;
  const result = await runCompositeTask(plan, reader, { ...memory(), query: async () => { calls += 1; return []; } });
  assert.equal(result.tarefa.status, "concluida_parcial");
  assert.match(result.tarefa.erros.join(" "), /permissão/);
  assert.equal(calls, 1);
});

test("cancelamento e recuperação mantêm histórico das etapas", async () => {
  const deps = memory();
  let release;
  deps.query = () => new Promise((resolve) => { release = resolve; });
  const promise = runCompositeTask(planCompositeTask("Encontre contas vencidas há mais de 30 dias, prepare mensagens e gere Excel."), reader, deps);
  await new Promise((resolve) => setImmediate(resolve));
  const active = deps.store.state.tarefas[0];
  const cancelled = cancelCharlieTask(active.id, reader, deps);
  assert.equal(cancelled.body.tarefa.status, "cancelada");
  release([]);
  const result = await promise;
  assert.equal(result.tarefa.status, "cancelada");

  const interrupted = saveTask({
    usuario: manager.id, composta: true, titulo: "Composta", status: "executando",
    execucaoIniciadaEm: "2020-01-01T00:00:00.000Z", etapas: [{ status: "concluida" }, { status: "executando" }], erros: [],
  }, deps);
  recoverInterruptedTasks(deps, Date.now());
  const recovered = getTask(interrupted.id, manager.id, deps);
  assert.equal(recovered.status, "falhou");
  assert.equal(recovered.quantidadeConcluida, 1);
  assert.equal(recovered.podeRepetir, true);
});

test("preserva contexto conversacional ao refinar tarefa composta", () => {
  const first = planCompositeTask("Encontre contas vencidas, prepare mensagens de cobrança e gere Excel.");
  const second = planCompositeTask("Considere apenas atrasos superiores a 60 dias.", {
    tarefaComposta: { solicitacao: first.solicitacao, parametros: first.parametros },
  });
  assert.equal(second.interpretador, "contexto");
  assert.equal(second.parametros.dias, 60);
  assert.equal(second.parametros.formato, "excel");
  assert.equal(second.etapas[0].parametros.dias, 60);
});
