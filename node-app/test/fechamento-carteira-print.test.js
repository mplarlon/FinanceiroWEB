import assert from "node:assert/strict";
import test from "node:test";
import {
  dataRelatorio,
  diferencaConta,
  filtroUtilizado,
  htmlContasReceber,
  numeroRelatorio,
  parcelaRelatorio,
  situacaoConta,
} from "../client/src/lib/fechamento-carteira-print.js";

const clientes = [{
  IDEMPRESA: 1,
  EMPRESA: "MATERIAL DE CONSTRUÇÃO ESTRADA BOCA DO MATO LTDA",
  CDCLIENTE: 15628,
  CLIENTE: "MUL TIMEIOS",
  TITULOS: [
    { CLIENTE: "MUL TIMEIOS", NRDOC: "664753", NRPEDIDO: 664753, PARCELA: 1, DTVENC: "2026-10-07", DTMOV: "2026-10-07", DTPAGTO: null, VALOR: 22.89, VALOR_PAGO: 0, STATUS: 1 },
    { CLIENTE: "MUL TIMEIOS", NRDOC: "665692", NRPEDIDO: 665692, PARCELA: 1, DTVENC: "2026-10-15", DTMOV: "2026-10-15", DTPAGTO: null, VALOR: -1.2, VALOR_PAGO: 0, STATUS: 1 },
  ],
}, {
  IDEMPRESA: 1,
  EMPRESA: "MATERIAL DE CONSTRUÇÃO ESTRADA BOCA DO MATO LTDA",
  CDCLIENTE: 20,
  CLIENTE: "A <J MANHAES>",
  TITULOS: [
    { CLIENTE: "A <J MANHAES>", NRDOC: "100", NRPEDIDO: 100, PARCELA: 2, DTVENC: "2026-10-20", DTMOV: "2026-10-20", DTPAGTO: null, VALOR: 10, VALOR_PAGO: 0, STATUS: 1 },
  ],
}];

test("situação, diferença, parcela e datas seguem o relatório do Automec", () => {
  assert.equal(situacaoConta(1), "AB");
  assert.equal(situacaoConta(2), "QT");
  assert.equal(situacaoConta(3), "DV");
  assert.equal(situacaoConta(4), "CA");
  assert.equal(situacaoConta(5), "TR");
  assert.equal(situacaoConta(6), "AC");
  assert.equal(situacaoConta(9), "DE");
  assert.equal(situacaoConta(7), "");
  assert.equal(diferencaConta(0, 22.89), -22.89);
  assert.equal(diferencaConta(0, -1.2), 1.2);
  assert.equal(parcelaRelatorio(1), "01");
  assert.equal(parcelaRelatorio(null), "");
  assert.equal(dataRelatorio("2026-10-07"), "07/10/26");
  assert.equal(dataRelatorio("2026-10-07T03:00:00.000Z", true), "07/10/2026");
  assert.equal(numeroRelatorio(252.17), "252,17");
  assert.equal(numeroRelatorio(-22.89), "-22,89");
  assert.equal(numeroRelatorio(1234.5), "1.234,50");
});

test("o filtro descreve empresa, período e status aberto", () => {
  assert.equal(
    filtroUtilizado({ idempresa: 1, cliente: "15628", dataInicio: "2026-10-01", dataFim: "2026-10-31" }),
    "Filtro Utilizado: Empresa = 1; Cliente = 15628; Emissão >= 01/10/2026; Emissão <= 31/10/2026; Status Aberto",
  );
  assert.equal(filtroUtilizado({ dataInicio: "2026-10-01", dataFim: "2026-10-31" }).includes("Cliente ="), false);
});

test("a impressão reúne os clientes no layout de contas a receber", () => {
  const html = htmlContasReceber({
    clientes,
    dataInicio: "2026-10-01",
    dataFim: "2026-10-31",
    emitidoEm: new Date(2026, 10, 2, 13, 52, 14),
  });
  assert.equal(html.includes("MATERIAL DE CONSTRUÇÃO ESTRADA BOCA DO MATO LTDA"), true);
  assert.equal(html.includes("Contas a Receber"), true);
  assert.equal(html.includes("Nr. Fiscal/Dupl"), true);
  assert.equal(html.includes("Total do Cliente:"), true);
  assert.equal(html.includes("Totais:"), true);
  assert.equal(html.includes(">AB<"), true);
  assert.equal(html.includes("Aberto"), true);
  assert.equal(html.includes("Transferência"), true);
  assert.equal(html.includes("02/11/2026"), true);
  assert.equal(html.includes("13:52:14"), true);
  assert.equal(html.includes(">MUL TIMEIOS<"), true);
  assert.equal(html.split(">MUL TIMEIOS<").length - 1, 1);
  assert.equal(html.includes("664753"), true);
  assert.equal(html.includes(">01<"), true);
  assert.equal(html.includes("07/10/2026"), true);
  assert.equal(html.includes("-22,89"), true);
  assert.equal(html.includes("-1,20"), true);
  assert.equal(html.includes("1,20"), true);
  assert.equal(html.includes("A &lt;J MANHAES&gt;"), true);
  assert.equal(html.includes("Status Aberto"), true);
  assert.equal(html.includes("Cliente = 15628"), true);
  const folhas = html.split('class="relatorio"').slice(1);
  assert.equal(folhas.length, 2);
  assert.equal(folhas[0].includes("MUL TIMEIOS"), true);
  assert.equal(folhas[0].includes("A &lt;J MANHAES&gt;"), false);
  assert.equal(folhas[1].includes("A &lt;J MANHAES&gt;"), true);
  const totais = folhas[0].slice(folhas[0].indexOf('class="totais"'), folhas[0].indexOf("</tbody>"));
  assert.equal(totais.includes(">21,69<"), true);
  assert.equal(totais.includes("-21,69"), true);
});

test("cada cliente sai na própria folha, mesmo em empresas diferentes", () => {
  const html = htmlContasReceber({
    clientes: [
      clientes[0],
      { ...clientes[1], IDEMPRESA: 2, EMPRESA: "OUTRA EMPRESA", CLIENTE: "ANA", TITULOS: [{ ...clientes[1].TITULOS[0], CLIENTE: "ANA" }] },
    ],
    dataInicio: "2026-10-01",
    dataFim: "2026-10-31",
  });
  assert.equal(html.split('class="relatorio"').length - 1, 2);
  assert.equal(html.includes("Empresa = 2"), true);
  assert.equal(html.includes("OUTRA EMPRESA"), true);
});
