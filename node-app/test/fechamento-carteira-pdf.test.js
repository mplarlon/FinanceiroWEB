import assert from "node:assert/strict";
import test from "node:test";
import { abrirPdfsAutorizados, htmlStatusPdf, urlPdfNota } from "../client/src/lib/fechamento-carteira-pdf.js";

function janela(escritos) {
  return {
    closed: false,
    document: {
      open() {},
      write(html) { escritos.push(html); },
      close() {},
    },
    location: { replace(url) { escritos.push(`pdf:${url}`); } },
    close() { escritos.push("fechar"); },
  };
}

test("a URL do DANFE leva a nota, a empresa e o número", () => {
  assert.equal(
    urlPdfNota({ idnf: 10, idempresa: 2, nrdoc: "554/1" }),
    "/api/fiscal/nfe/10/pdf?idempresa=2&nrdoc=554%2F1"
  );
});

test("a mensagem da janela escapa o número da nota", () => {
  const html = htmlStatusPdf("NF <1>", "Gerando o PDF da NF <1>...");
  assert.match(html, /NF &lt;1&gt;/);
  assert.doesNotMatch(html, /<1>/);
});

test("abre a janela no clique, antes de buscar o PDF", async () => {
  const ordem = [];
  const escritos = [];
  const resultado = await abrirPdfsAutorizados([
    { status: "autorizada", idnf: 10, idempresa: 2, nrdoc: "554" },
    { status: "pendente", idnf: 11, idempresa: 2, nrdoc: "555" },
  ], {
    abrir() {
      ordem.push("abrir");
      return janela(escritos);
    },
    async buscar(url) {
      ordem.push(`buscar:${url}`);
      return {
        ok: true,
        headers: { get: () => "application/pdf" },
        blob: async () => "arquivo",
        json: async () => ({}),
      };
    },
    criarUrl: () => "blob:danfe",
  });

  assert.equal(resultado.abertas, 1);
  assert.equal(resultado.bloqueado, false);
  assert.deepEqual(resultado.erros, []);
  assert.deepEqual(ordem, [
    "abrir",
    "buscar:/api/fiscal/nfe/10/pdf?idempresa=2&nrdoc=554",
  ]);
  assert.match(escritos[0], /Gerando o PDF da NF 554/);
  assert.equal(escritos.at(-1), "pdf:blob:danfe");
});

test("não busca o PDF quando o navegador bloqueia a janela", async () => {
  let chamadas = 0;
  const fechadas = [];
  let buscou = false;
  const resultado = await abrirPdfsAutorizados([
    { status: "autorizada", idnf: 1, idempresa: 1, nrdoc: "1" },
    { status: "autorizada", idnf: 2, idempresa: 1, nrdoc: "2" },
  ], {
    abrir() {
      chamadas += 1;
      if (chamadas > 1) return null;
      const aberta = janela([]);
      aberta.close = () => fechadas.push(aberta);
      return aberta;
    },
    async buscar() { buscou = true; },
    criarUrl: () => "blob:",
  });

  assert.equal(resultado.bloqueado, true);
  assert.equal(resultado.abertas, 0);
  assert.equal(buscou, false);
  assert.equal(fechadas.length, 1);
});

test("escreve o erro na janela que já estava aberta", async () => {
  const escritos = [];
  const resultado = await abrirPdfsAutorizados([
    { status: "autorizada", idnf: 3, idempresa: 1, nrdoc: "9" },
  ], {
    abrir: () => janela(escritos),
    async buscar() {
      return {
        ok: false,
        headers: { get: () => "application/json" },
        json: async () => ({ erro: "XML autorizado da NF-e nao encontrado." }),
        blob: async () => { throw new Error("sem pdf"); },
      };
    },
    criarUrl: () => "blob:",
  });

  assert.deepEqual(resultado.erros, [{ idnf: 3, mensagem: "XML autorizado da NF-e nao encontrado." }]);
  assert.match(escritos.at(-1), /XML autorizado da NF-e nao encontrado/);
  assert.equal(escritos.some(item => String(item).startsWith("pdf:")), false);
});
