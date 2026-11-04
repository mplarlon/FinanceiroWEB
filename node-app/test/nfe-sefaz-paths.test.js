import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { arquivarPdf, locaisDoCaminho, resolverXmlAutorizado } from "../server/lib/nfe-sefaz.js";

test("resolve o XML em procNFe quando CAMINHO aponta para o PDF em retNFe", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nfe-path-"));
  try {
    const ret = path.join(root, "Producao", "retNFe", "9_2026");
    const proc = path.join(root, "Producao", "procNFe", "9_2026");
    fs.mkdirSync(ret, { recursive: true });
    fs.mkdirSync(proc, { recursive: true });
    const pdf = path.join(ret, "chave-nfe.pdf");
    const xml = path.join(proc, "chave-nfe.xml");
    fs.writeFileSync(pdf, "%PDF-test");
    fs.writeFileSync(xml, "<nfeProc/>");
    assert.equal(resolverXmlAutorizado({ CAMINHO: pdf }).toLowerCase(), xml.toLowerCase());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("grava XML e PDF no padrao do Automec", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nfe-arquivar-"));
  const chave = "33261186760899000166550010000128551469420632";
  try {
    const xml = path.join(root, "origem.xml");
    const pdf = path.join(root, "origem.pdf");
    const fiscal = path.join(root, "NF-e");
    fs.mkdirSync(fiscal);
    fs.writeFileSync(xml, "<nfeProc/>");
    fs.writeFileSync(pdf, "%PDF-test");
    const arquivos = arquivarPdf(
      { NFCE: 0, CHAVE: chave, DTEMISS: new Date("2026-11-02T03:00:00.000Z") },
      { CAMINHONFE: fiscal },
      xml,
      pdf,
      { ambiente: "producao", chave }
    );
    const proc = path.join(fiscal, "PRODUCAO", "PROCNFE", "11_2026", `${chave}-nfe.xml`);
    const retXml = path.join(fiscal, "PRODUCAO", "RETNFE", "11_2026", `${chave}-nfe.xml`);
    const retPdf = path.join(fiscal, "PRODUCAO", "RETNFE", "11_2026", `${chave}-nfe.pdf`);
    assert.equal(fs.readFileSync(proc, "utf8"), "<nfeProc/>");
    assert.equal(fs.readFileSync(retXml, "utf8"), "<nfeProc/>");
    assert.equal(fs.readFileSync(retPdf, "utf8"), "%PDF-test");
    assert.equal(arquivos.pdf, `${fiscal}\\PRODUCAO\\RETNFE\\11_2026\\${chave}-nfe.pdf`);
    assert.equal(arquivos.pdf_local, retPdf);
    assert.equal(resolverXmlAutorizado({ CAMINHO: arquivos.pdf }), proc);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolve o XML quando o CAMINHO do Automec usa RETNFE", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nfe-retnfe-"));
  try {
    const proc = path.join(root, "PRODUCAO", "PROCNFE", "10_2026");
    fs.mkdirSync(proc, { recursive: true });
    const xml = path.join(proc, "chave-nfe.xml");
    fs.writeFileSync(xml, "<nfeProc/>");
    const pdf = path.join(root, "PRODUCAO", "RETNFE", "10_2026", "chave-nfe.pdf");
    assert.equal(resolverXmlAutorizado({ CAMINHO: pdf }), xml);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("troca o servidor do caminho UNC por C: e D:", () => {
  assert.deepEqual(locaisDoCaminho("\\\\servidor\\administracao\\NF-e"), [
    "\\\\servidor\\administracao\\NF-e",
    "C:\\administracao\\NF-e",
    "D:\\administracao\\NF-e",
  ]);
});

test("mantem compatibilidade com CAMINHO antigo apontando diretamente para XML", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nfe-path-"));
  try {
    const xml = path.join(root, "chave-nfe.xml");
    fs.writeFileSync(xml, "<nfeProc/>");
    assert.equal(resolverXmlAutorizado({ CAMINHO: xml }), xml);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
