import test from "node:test";
import assert from "node:assert/strict";
import { compararProdutos } from "../server/lib/charlie-product-match.js";

const cabo = { id: "A1", nome: "Cabo flexível 2,5", marca: "Pontual", codigoFabricante: "FAB-1", comprimento: 100 };
const outroNome = { id: "A2", nome: "Cabo flexível 2,5", marca: "Outra", codigoFabricante: "FAB-9", comprimento: 100 };

test("nome igual não vira equivalente", () => {
  const painel = compararProdutos([cabo, outroNome], []);
  assert.equal(painel.pares.length, 0);
  assert.match(painel.aviso, /nome parecido/);
  assert.match(painel.lacunas.join(" "), /compatibilidade técnica não é confirmada/i);
});

test("código de fabricante com outra marca ou outra medida não confirma compatibilidade", () => {
  const painel = compararProdutos([
    cabo,
    { id: "B1", nome: "Cabo azul", marca: "Atlas", codigoFabricante: "FAB-1", comprimento: 100 },
    { id: "C1", nome: "Cabo curto", marca: "Pontual", codigoFabricante: "FAB-1", comprimento: 50 },
  ], []);
  const marca = painel.pares.find((item) => item.destinoId === "B1" || item.origemId === "B1");
  const medida = painel.pares.find((item) => item.tipo === "medidas_divergentes");
  assert.equal(marca.tipo, "marca_alternativa");
  assert.equal(marca.compatibilidade, "nao_confirmada");
  assert.equal(medida.compatibilidade, "nao_confirmada");
  assert.match(medida.motivo, /divergem/);
});

test("substituto cadastrado e kit não viram compatibilidade técnica", () => {
  const painel = compararProdutos([
    { id: "S1", nome: "Filtro", similar: "S2" },
    { id: "S2", nome: "Filtro alternativo" },
    { id: "S3", nome: "Sem destino", similar: "NAO-EXISTE" },
  ], [{ kit: "K1", produtoId: "S1" }, { kit: "K1", produtoId: "S2" }]);
  const substituto = painel.pares.find((item) => item.tipo === "substituto_cadastrado");
  const kit = painel.pares.find((item) => item.tipo === "complementar_kit");
  assert.equal(substituto.destinoId, "S2");
  assert.equal(substituto.compatibilidade, "nao_confirmada");
  assert.equal(kit.compatibilidade, "nao_confirmada");
  assert.match(painel.lacunas.join(" "), /NAO-EXISTE/);
});
