import assert from "node:assert/strict";
import test from "node:test";
import { acbrConnectionError, montarIniNfe } from "../server/lib/acbr-monitor.js";

function itemFiscal(overrides) {
  return {
    CDPRODUTO: "1077", DESCRICAO: "NIPLE ROSCAVEL 1", NCM: "73079900", CFOP: "5102",
    UNID: "UN", QTDPRODUTO: 2, VLUNIT: 7.9, TOTAL: 15.8, CST: "00", PICMS: 20,
    PPIS: 1.65, PCOFINS: 7.6, ORIG: 0, MODBC: 3,
    CST_IBSCBS: "000", CCLASSTRIB: "000001", PIBSUF: 0.1, PIBSMUN: 0, PCBS: 0.9,
    ...overrides,
  };
}

function fonte(itens, nota = {}) {
  const total = itens.reduce((acc, item) => acc + Number(item.TOTAL || 0), 0);
  return {
    nota: {
      IDNF: 330515, NRDOC: "000012883", DTEMISS: new Date("2026-10-31T12:00:00"),
      VLTOTAL: Math.round(total * 100) / 100, SERIE_NFE: 1, TIPOFRETE: 9, OBSERVACAO: "Pedido do cliente",
      ...nota,
    },
    itens,
    emitente: {
      CNPJ: "86760899000166", INSCEST: "123456789", IDMUNICIPIO: "3304557", UF: "RJ",
      NOMEEMPRESA: "EMPRESA", ENDERECO: "RUA", BAIRRO: "CENTRO", MUNICIPIO: "RIO", CEP: "20000000",
    },
    destinatario: {
      CGC: "12345678901", CDMUNICIPIO: "3304557", UF: "RJ", RAZAO: "CLIENTE",
      ENDERECO: "RUA", BAIRRO: "CENTRO", MUNICIPIO: "RIO", CEP: "20000000",
    },
  };
}

function campo(ini, nome) {
  return [...ini.matchAll(new RegExp(`^${nome}=(.*)$`, "gm"))].map(match => match[1]);
}

test("traduz recusa de conexão do ACBr Monitor", () => {
  const error = acbrConnectionError(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3434"), { code: "ECONNREFUSED" }), "127.0.0.1", 3434);
  assert.match(error.message, /ACBr Monitor não está em execução em 127.0.0.1:3434/);
  assert.doesNotMatch(error.message, /ECONNREFUSED/);
});

test("junta devolução do mesmo produto e não gera vCBS negativo", () => {
  const ini = montarIniNfe(fonte([
    itemFiscal({ QTDPRODUTO: 2, VLUNIT: 7.9, TOTAL: 15.8, VCBS: -0.14 }),
    itemFiscal({ QTDPRODUTO: -2, VLUNIT: 7.9, TOTAL: -15.8, VCBS: -0.14 }),
    itemFiscal({ CDPRODUTO: "1330", DESCRICAO: "PRODUTO", QTDPRODUTO: 1, VLUNIT: 100, TOTAL: 100 }),
  ]), { crt: 3 });
  assert.equal(campo(ini, "cProd").includes("1077"), false);
  assert.deepEqual(campo(ini, "qCom"), ["1.0000"]);
  assert.equal(campo(ini, "vProd").some(value => value.startsWith("-")), false);
  assert.equal(campo(ini, "vCBS").some(value => value.startsWith("-")), false);
  assert.equal(campo(ini, "vBC").some(value => value.startsWith("-")), false);
  assert.match(ini, /pCBS=0\.90/);
  assert.match(ini, /pIBSUF=0\.10/);
  assert.match(ini, /vCBS=0\.90/);
  assert.equal(campo(ini, "vNF")[0], "100.00");
  assert.doesNotMatch(ini, /infCpl=\[object Object\]/);
});

test("devolução parcial reduz a quantidade vendida", () => {
  const ini = montarIniNfe(fonte([
    itemFiscal({ QTDPRODUTO: 5, TOTAL: 39.5 }),
    itemFiscal({ QTDPRODUTO: -2, TOTAL: -15.8 }),
  ]), { crt: 3 });
  assert.deepEqual(campo(ini, "qCom"), ["3.0000"]);
  assert.deepEqual(campo(ini, "vProd"), ["23.70", "23.70"]);
  assert.equal(campo(ini, "vNF")[0], "23.70");
  assert.equal(campo(ini, "vCBS").some(value => value.startsWith("-")), false);
});

test("CST 20 informa cBenef e reduz a base do ICMS", () => {
  const ini = montarIniNfe(fonte([
    itemFiscal({
      CST: "20", PICMS: 19, PREDBC: 65, TP_REDUC_BASE: 0, CBENEF: "RJ802164", MOTIV_DESON: 9,
      QTDPRODUTO: 1, VLUNIT: 189.9, TOTAL: 189.9,
    }),
  ]), { crt: 3 });
  assert.equal(campo(ini, "cBenef")[0], "RJ802164");
  assert.equal(campo(ini, "pRedBC")[0], "65.00");
  assert.equal(campo(ini, "vBC")[0], "66.47");
  assert.equal(campo(ini, "vICMS")[0], "12.63");
  assert.equal(campo(ini, "vICMSDeson")[0], "28.95");
  assert.equal(campo(ini, "motDesICMS")[0], "9");
  assert.equal(campo(ini, "vNF")[0], "189.90");
  assert.equal(campo(ini, "vCBS").some(value => value.startsWith("-")), false);
});

test("devolução sem venda correspondente vira desconto e outras despesas entram no total", () => {
  const ini = montarIniNfe(fonte([
    itemFiscal({ CDPRODUTO: "1", QTDPRODUTO: 1, VLUNIT: 100, TOTAL: 100 }),
    itemFiscal({ CDPRODUTO: "2", DESCRICAO: "DEVOLUCAO", QTDPRODUTO: -1, VLUNIT: 10, TOTAL: -10 }),
  ], { VLTOTAL: 140, OUTROS: 50, OBSERVACAO: { blob: true } }), { crt: 3 });
  assert.deepEqual(campo(ini, "cProd"), ["1"]);
  assert.equal(campo(ini, "vProd")[0], "100.00");
  assert.equal(campo(ini, "vDesc").at(-1), "10.00");
  assert.equal(campo(ini, "vOutro").at(-1), "50.00");
  assert.equal(campo(ini, "vNF")[0], "140.00");
  assert.equal(campo(ini, "vPag")[0], "140.00");
  assert.equal(campo(ini, "vCBS").some(value => value.startsWith("-")), false);
  assert.doesNotMatch(ini, /infCpl=/);
});
