import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validAiSummary } from "../server/lib/charlie-ai.js";
import { parseFinancialDate } from "../server/lib/finance-assistant.js";
import { assertMonitorSql, PAYABLE_EXCLUDES_VALE } from "../server/lib/charlie-monitor.js";
import {
  DEFAULT_MONITOR_SETTINGS,
  buildCompanySummary,
  buildFindings,
  normalizeMonitorSettings,
  silentCustomers,
} from "../server/lib/charlie-monitor-rules.js";
import {
  acquireMonitorLock,
  reduceMonitorAlerts,
  releaseMonitorLock,
  userCanSeeCategory,
} from "../server/lib/charlie-monitor-store.js";
import { resolveConversationIntent } from "../server/routes/assistant.js";

const now = "2026-10-20T15:00:00.000Z";
const settings = DEFAULT_MONITOR_SETTINGS;

test("regras financeiras usam só os totais recebidos", () => {
  const findings = buildFindings({
    receber: { total: 42500, titulos: 12, clientes: 8, top: [{ CODIGO: 1, NOME: "A", VALOR: 20000, QTD: 2 }], top3: 30000, recorrentes: 0, duplicidades: [], anterior: 30000 },
  }, settings);
  const overdue = findings.find((item) => item.regra === "receber_vencidos");
  assert.equal(overdue.gravidade, "critico");
  assert.match(overdue.descricao, /42\.500,00/);
  assert.match(overdue.descricao, /8 cliente/);
  assert.equal(findings.some((item) => item.regra === "receber_aumento"), true);
  const hidden = buildFindings({ receber: { total: 500, titulos: 1, clientes: 1, top: [], top3: 500, duplicidades: [] } }, {
    ...settings,
    limites: { ...settings.limites, receberVencidoMinimo: 10000 },
  });
  assert.equal(hidden.some((item) => item.regra === "receber_vencidos"), false);
});

test("monitoramento de contas a pagar desconsidera vale", () => {
  const source = fs.readFileSync(new URL("../server/lib/charlie-monitor.js", import.meta.url), "utf8");
  const queries = source.split("FROM CTAPAGAR").length - 1;
  const filters = source.split("${PAYABLE_EXCLUDES_VALE}").length - 1;
  assert.equal(queries, 8);
  assert.equal(filters, queries);
  assert.equal(PAYABLE_EXCLUDES_VALE, "COALESCE(t.STATUSVALE,0) NOT IN (1,2)");
  assertMonitorSql(`SELECT 1 FROM CTAPAGAR t WHERE t.STATUS=1 AND ${PAYABLE_EXCLUDES_VALE}`);
});

test("duplicidade permanece possível e caixa separa saldo de títulos", () => {
  const findings = buildFindings({
    receber: { total: 0, titulos: 0, clientes: 0, top: [], top3: 0, duplicidades: [{ CODIGO: 1, NOME: "A", DOCUMENTO: "10", PARCELA: 1, VALOR: 50, QTD: 2 }] },
    caixa: { saldo: 1000, receber: 200, pagar: 5000 },
  }, settings);
  assert.match(findings.find((item) => item.regra === "receber_duplicidade").descricao, /possível duplicidade/i);
  const cash = findings.find((item) => item.regra === "fluxo_caixa");
  assert.match(cash.descricao, /saldo bancário confirmado/i);
  assert.match(cash.descricao, /não valores já depositados/i);
  assert.equal(cash.evidencias.projetadoTitulos, 1000 + 200 - 5000);
});

test("cliente sumido usa intervalo e não inventa causa", () => {
  const rows = silentCustomers([
    { ID: 1, NOME: "Oficina", PEDIDOS: 4, SPAN: 45, DIAS_SEM: 45 },
    { ID: 2, NOME: "Recente", PEDIDOS: 4, SPAN: 45, DIAS_SEM: 10 },
  ], settings);
  assert.deepEqual(rows.map((row) => row.ID), [1]);
  const findings = buildFindings({ vendas: { atual: 0, anterior: 0, bruto: 0, desconto: 0, vendedores: [], produtos: [], margemBaixa: [], clientesSumidos: rows } }, settings);
  assert.match(findings.find((item) => item.regra === "clientes_sumidos").descricao, /não o motivo/);
});

test("alertas abertos são atualizados, encerrados e reabertos sem duplicar", () => {
  const finding = buildFindings({ receber: { total: 12000, titulos: 2, clientes: 1, top: [], top3: 12000, duplicidades: [], recorrentes: 0, anterior: null } }, settings)
    .find((item) => item.regra === "receber_vencidos");
  const created = reduceMonitorAlerts([], [finding], ["receber_vencidos"], now, settings);
  const updated = reduceMonitorAlerts(created, [{ ...finding, descricao: `${finding.descricao} Conferido.` }], ["receber_vencidos"], now, settings);
  assert.equal(updated.length, 1);
  assert.match(updated[0].descricao, /Conferido/);
  const resolved = reduceMonitorAlerts(updated, [], ["receber_vencidos"], now, settings);
  assert.equal(resolved[0].situacao, "resolvido");
  const reopened = reduceMonitorAlerts(resolved, [finding], ["receber_vencidos"], now, settings);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].situacao, "novo");
  assert.equal(reopened[0].reincidencias, 1);
  const discarded = [{ ...created[0], situacao: "descartado" }];
  const kept = reduceMonitorAlerts(discarded, [finding], ["receber_vencidos"], now, { ...settings, reabrirDescartados: false });
  assert.equal(kept[0].situacao, "descartado");
  assert.equal(kept.filter((item) => item.regra === "receber_vencidos").length, 1);
});

test("monitor desligado não encerra o alerta anterior", () => {
  const [alert] = reduceMonitorAlerts([], [{ regra: "estoque_negativo", categoria: "estoque", gravidade: "critico", titulo: "Negativo", descricao: "1 produto.", recomendacao: "Conferir.", registros: [], evidencias: {} }], ["estoque_negativo"], now, settings);
  const kept = reduceMonitorAlerts([alert], [], [], now, settings);
  assert.equal(kept[0].situacao, "novo");
});

test("notificação respeita a lista de usuários", () => {
  const restricted = { notificados: [7] };
  assert.equal(userCanSeeCategory({ notificados: [] }, 3), true);
  assert.equal(userCanSeeCategory(restricted, 7), true);
  assert.equal(userCanSeeCategory(restricted, 3), false);
});

test("resumo só repete fatos da análise", () => {
  const findings = buildFindings({
    receber: { total: 42500, titulos: 12, clientes: 8, top: [], top3: 0, duplicidades: [], recorrentes: 0 },
    vendas: { atual: 1500, anterior: 1000, bruto: 0, desconto: 0, vendedores: [], produtos: [], margemBaixa: [], clientesSumidos: [] },
  }, settings).map((item, index) => ({ ...item, id: index + 1, situacao: "novo" }));
  const when = new Date("2026-10-20T18:40:00.000Z");
  const summary = buildCompanySummary(findings, when.toISOString(), when);
  const label = when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const source = `${label}\n${findings.map((item) => `${item.titulo} ${item.descricao}`).join("\n")}`;
  assert.equal(validAiSummary(summary.texto, source), true);
  const hour = when.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  assert.match(summary.texto, new RegExp(greeting));
  assert.match(summary.texto, /Financeiro/);
  assert.equal(validAiSummary(`${summary.texto} O caixa ficará negativo em 999999.`, source), false);
});

test("resumo inclui auditoria e alertas abertos sem data de análise", () => {
  const summary = buildCompanySummary([
    { id: 1, situacao: "novo", categoria: "auditoria", gravidade: "atencao", titulo: "Preço alterado", descricao: "Conferir a tabela.", atualizadoEm: "2026-10-22T12:00:00.000Z" },
  ], null, new Date("2026-10-22T15:00:00.000Z"));
  assert.equal(summary.total, 1);
  assert.equal(summary.grupos[0].rotulo, "Auditoria");
  assert.equal(summary.analiseEm, "2026-10-22T12:00:00.000Z");
  assert.match(summary.texto, /Preço alterado/);
});

test("limites configurados são limitados à faixa segura", () => {
  const next = normalizeMonitorSettings({ intervaloMinutos: 1, limites: { quedaVendasPercentual: 15, receberVencidoMinimo: 10000 } });
  assert.equal(next.intervaloMinutos, 15);
  assert.equal(next.limites.quedaVendasPercentual, 15);
  assert.equal(next.limites.receberVencidoMinimo, 10000);
});

test("monitoramento recusa alteração de banco", () => {
  assert.equal(assertMonitorSql(" select * from CTARECEBER "), "select * from CTARECEBER");
  assert.throws(() => assertMonitorSql("UPDATE CTARECEBER SET VALOR=0"), /leitura/);
  assert.throws(() => assertMonitorSql("SELECT * FROM CTARECEBER; DELETE FROM CTARECEBER"), /leitura/);
});

test("acompanhamento mantém tarefa e problema em estados independentes", () => {
  const [created] = reduceMonitorAlerts([], [{
    regra: "estoque_minimo", categoria: "estoque", gravidade: "atencao", titulo: "Estoque baixo",
    descricao: "1 produto.", recomendacao: "Preparar compra.", registros: [], evidencias: {},
  }], ["estoque_minimo"], now, settings);
  created.situacao = "acao_preparada";
  const tracked = reduceMonitorAlerts([created], [{
    regra: "estoque_minimo", categoria: "estoque", gravidade: "atencao", titulo: "Estoque baixo",
    descricao: "1 produto.", recomendacao: "Preparar compra.", registros: [], evidencias: {},
  }], ["estoque_minimo"], now, settings);
  assert.equal(tracked[0].situacao, "acao_preparada");
  assert.equal(tracked[0].regra, "estoque_minimo");
  const resolved = reduceMonitorAlerts(tracked, [], ["estoque_minimo"], now, settings);
  assert.equal(resolved[0].situacao, "resolvido");
});

test("duas estações não executam o monitoramento juntas", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charlie-lock-"));
  const first = acquireMonitorLock(directory, 60_000);
  assert.ok(first);
  assert.equal(acquireMonitorLock(directory, 60_000), null);
  releaseMonitorLock(directory, first.owner);
  const second = acquireMonitorLock(directory, 60_000);
  assert.ok(second);
  releaseMonitorLock(directory, second.owner);
});

test("investigação do alerta aceita o recorte do mês", () => {
  const conversation = {
    messages: [{
      role: "assistant",
      text: "Os lançamentos coincidem em cliente, documento, parcela e valor.",
      data: [{ NOME: "A", DOCUMENTO: "10" }],
      intent: { type: "alerta_monitor", alertaId: 4, domain: "receber", statusTitulo: "vencido" },
    }],
  };
  const why = resolveConversationIntent(null, conversation, "Charlie, por que você identificou essa duplicidade?");
  assert.equal(why.type, "alerta_monitor");
  assert.equal(why.explain, true);
  assert.equal(why.interpretador, "contexto");
  const filtered = resolveConversationIntent(null, conversation, "Mostre apenas os lançamentos deste mês");
  assert.equal(filtered.type, "financeiro_titulos");
  assert.equal(filtered.domain, "receber");
  assert.equal(filtered.status, "vencido");
  assert.deepEqual(filtered.date, parseFinancialDate("Mostre apenas os lançamentos deste mês"));
});
