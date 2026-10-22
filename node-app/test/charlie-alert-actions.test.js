import assert from "node:assert/strict";
import test from "node:test";
import { buildAlertRecommendations, recommendationPlan } from "../server/lib/charlie-alert-actions.js";
import { runCharlieTask } from "../server/lib/charlie-task-engine.js";
import { createMemoryStore, findAlertTask, getTask } from "../server/lib/charlie-task-store.js";

const reader = { id: 8, gerencial: false };

function alert(overrides = {}) {
  return {
    id: 12,
    regra: "receber_vencidos",
    categoria: "financeiro",
    gravidade: "critico",
    situacao: "novo",
    atualizadoEm: "2026-10-20T10:00:00.000Z",
    recomendacao: "Priorizar os maiores saldos.",
    evidencias: { total: 48500, quantidade: 8 },
    registros: [{ CODIGO: 21, NOME: "Cliente A", VALOR: 9000 }],
    ...overrides,
  };
}

test("converte alerta em recomendações existentes, autorizadas e priorizadas", () => {
  const recommendations = buildAlertRecommendations(alert(), reader);
  assert.ok(recommendations.length >= 3);
  assert.ok(recommendations.every((item) => item.alertaId === 12));
  assert.ok(recommendations.every((item) => item.prioridade >= 0 && item.prioridade <= 100));
  assert.deepEqual(recommendations.find((item) => item.acao === "financeiro.preparar_cobrancas").parametros.clientes, [21]);
  assert.equal(recommendations.some((item) => item.acao === "financeiro.enviar_cobranca"), false);
});

test("não recomenda ação para ocorrência encerrada e não inventa regra sem mapeamento", () => {
  assert.deepEqual(buildAlertRecommendations(alert({ situacao: "resolvido" }), reader), []);
  assert.deepEqual(buildAlertRecommendations(alert({ regra: "regra_desconhecida" }), reader), []);
});

test("tarefa originada no alerta preserva vínculo estruturado e pode ser deduplicada", async () => {
  const store = createMemoryStore();
  const source = alert();
  const recommendation = buildAlertRecommendations(source, reader)
    .find((item) => item.acao === "financeiro.preparar_cobrancas" && item.parametros.formato !== "excel");
  const rows = [{ CONTROLE: 1, CDCLIENTE: 21, PESSOA: "Cliente A", VENDEDOR: "Ana", EMAIL: "", VENCIMENTO: "2026-09-01", SALDO: 9000, DIAS_ATRASO: 49 }];
  const result = await runCharlieTask(recommendationPlan(source, recommendation), reader, {
    store,
    query: async () => rows,
  });
  assert.equal(result.tarefa.alertaId, source.id);
  assert.equal(result.tarefa.recomendacaoId, recommendation.id);
  assert.equal(getTask(result.tarefa.id, reader.id, { store }).alertaRegra, source.regra);
  assert.equal(findAlertTask(source.id, recommendation.id, reader.id, { store }).id, result.tarefa.id);
});

test("alertas de estoque, margem e comercial usam somente o catálogo", () => {
  const stock = buildAlertRecommendations(alert({ regra: "estoque_minimo", categoria: "estoque" }), reader);
  assert.ok(stock.some((item) => item.acao === "estoque.sugestao_compra"));
  const prices = buildAlertRecommendations(alert({ regra: "margem_preco", categoria: "precos", evidencias: { limite: 20 } }), reader);
  assert.equal(prices.find((item) => item.acao === "produtos.margem_insuficiente").parametros.margem, 20);
  const sales = buildAlertRecommendations(alert({ regra: "clientes_sumidos", categoria: "comercial" }), reader);
  assert.ok(sales.some((item) => item.acao === "comercial.clientes_inativos" && item.parametros.agrupar === "vendedor"));
});

