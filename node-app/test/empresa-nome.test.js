import assert from "node:assert/strict";
import test from "node:test";

import { escolherNomeEmpresa, NOME_EMPRESA_PADRAO } from "../server/lib/empresa-nome.js";

test("o título usa a empresa padrão da configuração", () => {
  assert.equal(escolherNomeEmpresa([
    { IDEMPRESA: 1, NOMEEMPRESA: "Filial Norte", PADRAO: 0 },
    { IDEMPRESA: 2, NOMEEMPRESA: "  Madeireira São José  ", PADRAO: -1 },
  ]), "Madeireira São José");
});

test("sem empresa padrão, usa a primeira configuração com nome", () => {
  assert.equal(escolherNomeEmpresa([
    { IDEMPRESA: 4, NOMEEMPRESA: "Loja B", PADRAO: 0 },
    { IDEMPRESA: 2, NOMEEMPRESA: "Loja A", PADRAO: 0 },
  ]), "Loja A");
});

test("sem nome na configuração, mantém o título padrão", () => {
  assert.equal(escolherNomeEmpresa([]), NOME_EMPRESA_PADRAO);
  assert.equal(escolherNomeEmpresa([{ IDEMPRESA: 1, NOMEEMPRESA: "   ", PADRAO: -1 }]), NOME_EMPRESA_PADRAO);
});
