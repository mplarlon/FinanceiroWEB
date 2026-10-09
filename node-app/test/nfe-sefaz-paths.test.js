import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolverXmlAutorizado } from "../server/lib/nfe-sefaz.js";

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
    assert.equal(resolverXmlAutorizado({ CAMINHO: pdf }), xml);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
