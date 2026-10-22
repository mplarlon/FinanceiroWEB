import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { planCharlieTask } from "../server/lib/charlie-task-plan.js";
import { exportCharlieTask, runCharlieTask, cancelCharlieTask } from "../server/lib/charlie-task-engine.js";
import { createMemoryStore, getTask, publicTask, saveTask } from "../server/lib/charlie-task-store.js";
import { buildCsv, layoutReportRows } from "../server/lib/table-export.js";

const reader = { id: 8, gerencial: false };

function memory() {
  return { store: createMemoryStore() };
}

function scriptedQuery(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const found = responses.find((item) => item.match.test(sql));
      if (!found) throw new Error(`SQL inesperada: ${sql}`);
      return found.rows;
    },
  };
}

test("entende os relatórios pedidos em linguagem natural", () => {
  assert.equal(planCharlieTask("Quanto vendemos neste mês?"), null);
  assert.equal(planCharlieTask("Tem estoque negativo?"), null);
  assert.equal(planCharlieTask("contas a receber"), null);

  const inadimplentes = planCharlieTask("Charlie, gere um Excel com os clientes inadimplentes.");
  assert.equal(inadimplentes.acao, "financeiro.inadimplencia");
  assert.equal(inadimplentes.parametros.formato, "excel");
  assert.equal(inadimplentes.parametros.dominio, "receber");
  assert.equal(inadimplentes.parametros.agrupar, "cliente");

  const pdf = planCharlieTask("Charlie, faça um PDF com o faturamento deste mês por vendedor.");
  assert.equal(pdf.acao, "relatorios.faturamento_vendedor");
  assert.equal(pdf.parametros.formato, "pdf");
  assert.equal(pdf.parametros.periodo, "mes");

  const parados = planCharlieTask("Charlie, gere um relatório dos produtos sem movimentação há 90 dias.");
  assert.equal(parados.acao, "estoque.sem_movimentacao");
  assert.equal(parados.parametros.dias, 90);

  const compare = planCharlieTask("Charlie, compare o faturamento dos últimos seis meses.");
  assert.equal(compare.acao, "relatorios.faturamento_mensal");
  assert.equal(compare.parametros.meses, 6);

  const margem = planCharlieTask("Charlie, gere uma planilha com os produtos que possuem margem inferior a 15%.");
  assert.equal(margem.acao, "produtos.margem_insuficiente");
  assert.equal(margem.parametros.margem, 15);
  assert.equal(margem.parametros.tabela, undefined);

  const separados = planCharlieTask("Charlie, faça um relatório com os títulos vencidos separados por cliente.");
  assert.equal(separados.acao, "financeiro.titulos_vencidos");
  assert.equal(separados.parametros.agrupar, "cliente");
  assert.equal(separados.parametros.dominio, "receber");

  assert.equal(planCharlieTask("Gere um Excel com as contas a pagar vencidas.").parametros.dominio, "pagar");
  assert.equal(planCharlieTask("Gere um relatório dos títulos próximos do vencimento.").acao, "financeiro.titulos_a_vencer");
  assert.equal(planCharlieTask("Gere um Excel com os recebimentos deste mês.").acao, "financeiro.recebimentos_periodo");
  assert.equal(planCharlieTask("Gere um PDF com os pagamentos deste mês.").acao, "financeiro.pagamentos_periodo");
  assert.equal(planCharlieTask("Gere um relatório de vendas deste mês.").acao, "relatorios.faturamento_periodo");
  assert.equal(planCharlieTask("Gere um Excel do faturamento deste mês por cliente.").acao, "relatorios.faturamento_cliente");
  assert.equal(planCharlieTask("Gere um relatório dos produtos mais vendidos.").parametros.ordem, "mais");
  assert.equal(planCharlieTask("Gere um relatório dos produtos menos vendidos.").parametros.ordem, "menos");
  assert.equal(planCharlieTask("Gere um relatório dos clientes sem compras recentes.").acao, "comercial.clientes_inativos");
  assert.equal(planCharlieTask("Gere um relatório de estoque negativo.").acao, "estoque.negativo");
  assert.equal(planCharlieTask("Gere um comparativo de preços.").acao, "produtos.comparativo_precos");
  assert.equal(planCharlieTask("Gere um relatório das alterações relevantes de custo.").acao, "produtos.alteracao_custo");
});

test("mantém período e filtros enquanto o relatório é refinado", () => {
  const first = planCharlieTask("Gere um relatório de vendas deste mês.");
  assert.equal(first.acao, "relatorios.faturamento_periodo");
  assert.equal(first.parametros.periodo, "mes");
  let context = { tarefa: { acao: first.acao, parametros: first.parametros } };

  const second = planCharlieTask("Agora separe por vendedor.", context);
  assert.equal(second.interpretador, "contexto");
  assert.equal(second.acao, "relatorios.faturamento_vendedor");
  assert.equal(second.parametros.periodo, "mes");
  context = { tarefa: { acao: second.acao, parametros: second.parametros } };

  const third = planCharlieTask("Mostre apenas os cinco maiores.", context);
  assert.equal(third.parametros.limite, 5);
  assert.equal(third.parametros.periodo, "mes");
  assert.equal(third.acao, "relatorios.faturamento_vendedor");
  context = { tarefa: { acao: third.acao, parametros: third.parametros } };

  const fourth = planCharlieTask("Exporte em Excel.", context);
  assert.equal(fourth.parametros.formato, "excel");
  assert.equal(fourth.parametros.limite, 5);
  assert.equal(fourth.parametros.periodo, "mes");
});

test("soma a inadimplência, gera os três formatos e não altera o banco", async () => {
  const db = scriptedQuery([{
    match: /CTARECEBER/,
    rows: [
      { CONTROLE: 1, PESSOA: "Ana José", VENDEDOR: "Lia", SALDO: 10, VENCIMENTO: "2026-01-01", DIAS_ATRASO: 10 },
      { CONTROLE: 2, PESSOA: "Ana José", VENDEDOR: "Lia", SALDO: 5.5, VENCIMENTO: "2026-02-01", DIAS_ATRASO: 5 },
      { CONTROLE: 3, PESSOA: "Beto", VENDEDOR: "Lia", SALDO: 2, VENCIMENTO: "2026-03-01", DIAS_ATRASO: 1 },
    ],
  }]);
  const deps = { ...memory(), query: db.query.bind(db) };
  const result = await runCharlieTask(planCharlieTask("Gere um Excel com os clientes inadimplentes."), reader, deps);
  assert.equal(result.tarefa.status, "concluida");
  assert.equal(result.tarefa.relatorio.nome, "Inadimplência por cliente ou vendedor");
  assert.match(result.tarefa.relatorio.periodo, /Vencidos/);
  assert.equal(result.dados[0].PESSOA, "Ana José");
  assert.equal(result.dados[0].TITULOS, 2);
  assert.equal(result.dados[0].SALDO, 15.5);
  assert.equal(result.dados[1].SALDO, 2);
  assert.match(db.calls[0].sql, /SELECT FIRST/);
  assert.match(db.calls[0].sql, /STATUS=1/);
  assert.doesNotMatch(db.calls[0].sql, /UPDATE|DELETE|INSERT|Ana/);

  const excel = await exportCharlieTask(result.tarefa.id, reader, "excel", deps);
  assert.equal(excel.status, 200);
  assert.match(excel.filename, /\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excel.buffer);
  const sheet = wb.getWorksheet("Resumo");
  assert.equal(sheet.getCell("A1").value, "Inadimplência por cliente ou vendedor");
  assert.match(String(sheet.getCell("A2").value), /Vencidos/);
  assert.equal(sheet.getRow(4).getCell(3).value, 15.5);
  assert.equal(sheet.getRow(4).getCell(3).numFmt, "R$ #,##0.00");
  assert.equal(sheet.getRow(6).getCell(1).value, "Total");
  assert.equal(sheet.getRow(6).getCell(3).value, 17.5);
  assert.ok(wb.getWorksheet("Detalhe"));
  assert.equal(publicTask(getTask(result.tarefa.id, reader.id, deps)).exportacoes, 1);
  assert.equal((await exportCharlieTask(result.tarefa.id, { id: 99 }, "excel", deps)).status, 404);

  const csv = (await exportCharlieTask(result.tarefa.id, reader, "csv", deps)).buffer.toString("utf8");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /;/);
  assert.match(csv, /Ana José/);
  assert.match(csv, /Total/);

  const pdf = await exportCharlieTask(result.tarefa.id, reader, "pdf", deps);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(db.calls.length, 1);
});

test("consulta margem, recebimento e custo com parâmetros e relacionamentos validados", async () => {
  const db = scriptedQuery([
    { match: /PRODUTOPRECO/, rows: [{ CDPRODUTO: 7, PRODUTO: "Cabo", PRECO: 100, CUSTO: 90, IDPRECO: 1 }] },
    { match: /CTARECEBER/, rows: [{ CONTROLE: 4, PESSOA: "Loja", DATA_BAIXA: "2026-10-02", TOTAL: 80 }] },
    { match: /ENTRPRODUTO/, rows: [{ CODIGO: 9, DESCRICAO: "Tinta", CUSTO_ANTERIOR: 10, CUSTO_ATUAL: 13, VARIACAO: 30 }] },
  ]);
  const deps = { ...memory(), query: db.query.bind(db) };

  const margem = await runCharlieTask(
    planCharlieTask("Gere uma planilha com os produtos que possuem margem inferior a 15%."),
    reader,
    deps,
  );
  assert.equal(margem.dados[0].MARGEM, 10);
  assert.match(db.calls[0].sql, /COALESCE\(p\.IDPRECO,1\)/);
  assert.deepEqual(db.calls[0].params, [15]);
  assert.doesNotMatch(db.calls[0].sql, /UPDATE|15%/);

  const recebimento = await runCharlieTask(planCharlieTask("Gere um Excel com os recebimentos deste mês."), reader, deps);
  assert.equal(recebimento.dados[0].TOTAL, 80);
  assert.match(db.calls[1].sql, /STATUS=2/);
  assert.match(db.calls[1].sql, /DTCOB/);
  assert.match(db.calls[1].sql, /EXTRACT\(MONTH FROM t\.DTCOB\)/);
  assert.doesNotMatch(db.calls[1].sql, /UPDATE|DELETE|INSERT/);

  const custo = await runCharlieTask(planCharlieTask("Gere um relatório das alterações relevantes de custo."), reader, deps);
  assert.equal(custo.dados[0].VARIACAO, 30);
  assert.match(db.calls[2].sql, /CUSTOMED_ANTERIOR/);
  assert.match(db.calls[2].sql, /ENTRESTOQUE/);
  assert.match(db.calls[2].sql, /DATEADD\(-30 DAY/);
  assert.deepEqual(db.calls[2].params, [10]);
});

test("não inventa vendedor em contas a pagar", async () => {
  let called = false;
  const result = await runCharlieTask(
    planCharlieTask("Gere um Excel da inadimplência por vendedor das contas a pagar."),
    reader,
    {
      ...memory(),
      query: async () => {
        called = true;
        return [];
      },
    },
  );
  assert.equal(called, false);
  assert.equal(result.tarefa.status, "falhou");
  assert.match(result.resposta, /não têm vendedor/);
  assert.doesNotMatch(result.resposta, /conclu/);
});

test("interrompe consulta longa e cancela exportação sem gravar arquivo", async () => {
  const slow = await runCharlieTask(planCharlieTask("Gere um relatório de estoque negativo."), reader, {
    ...memory(),
    timeoutMs: 20,
    async query() {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return [];
    },
  });
  assert.equal(slow.tarefa.status, "falhou");
  assert.match(slow.resposta, /tempo limite/);

  const deps = memory();
  const task = saveTask({
    usuario: reader.id,
    titulo: "Clientes inadimplentes",
    status: "concluida",
    linhas: [{ PESSOA: "Ana", TITULOS: 1, SALDO: 10 }],
    totalizar: true,
    relatorio: { nome: "Inadimplentes", periodo: "Vencidos", quantidade: 1, formato: "excel", geradoEm: new Date().toISOString() },
  }, deps);
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  let opened;
  const started = new Promise((resolve) => { opened = resolve; });
  const pending = exportCharlieTask(task.id, reader, "excel", {
    ...deps,
    beforeBuild: async () => {
      opened();
      await hold;
    },
  });
  await started;
  const cancelled = cancelCharlieTask(task.id, reader, deps);
  assert.match(cancelled.body.resposta, /exportação/);
  release();
  const exported = await pending;
  assert.equal(exported.status, 499);
  assert.equal(exported.buffer, undefined);
});

test("calcula subtotais sem somar duas vezes e preserva acentos no CSV", () => {
  const laid = layoutReportRows({
    labels: ["Cliente", "Saldo"],
    types: ["texto", "moeda"],
    grupo: 0,
    somar: [1],
    totalizar: true,
    data: [["Ana", 10], ["Ana", 5.5], ["Beto", 2]],
  });
  assert.equal(laid.rows[2][0], "Subtotal Ana");
  assert.equal(laid.rows[2][1], 15.5);
  assert.equal(laid.total[1], 17.5);
  const csv = buildCsv({
    labels: ["Cliente", "Cidade"],
    types: ["texto", "texto"],
    data: [["José", "São Paulo"]],
  }).toString("utf8");
  assert.match(csv, /José/);
  assert.match(csv, /São Paulo/);
  assert.match(csv, /;/);
});
