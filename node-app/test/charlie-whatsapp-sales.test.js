import assert from "node:assert/strict";
import test from "node:test";
import { extrairConsulta, montarResposta } from "../server/lib/charlie-whatsapp-sales.js";
import { decidirConsulta, registrarConsulta, usarMemoriaDeTeste } from "../server/lib/charlie-whatsapp-sales-service.js";

test("só mensagem comercial vira consulta e a resposta não inventa número", () => {
  assert.equal(extrairConsulta("bom dia, tudo bem?"), null);
  const consulta = extrairConsulta("qual o preço e o estoque do cabo flexível 2,5?");
  assert.equal(consulta.termos.includes("cabo"), true);
  assert.match(montarResposta([]), /não informo preço, estoque nem prazo/);
  assert.doesNotMatch(montarResposta([]), /\d/);
  const texto = montarResposta([{ codigo: "55", nome: "Cabo flexível", preco: 12.5, estoque: 3 }]);
  assert.match(texto, /R\$\s*12,50/);
  assert.match(texto, /estoque atual 3/);
  assert.match(texto, /prazo de entrega não está neste cadastro/);
  assert.match(montarResposta([{ codigo: "55", nome: "Cabo", preco: null, estoque: null }]), /preço não cadastrado/);
  assert.doesNotMatch(montarResposta([{ codigo: "55", nome: "Cabo", preco: null, estoque: null }]), /R\$/);
});

test("a consulta comercial fica aguardando e o envio usa o rascunho aprovado", async () => {
  usarMemoriaDeTeste({ itens: [] });
  const enviados = [];
  const registrada = await registrarConsulta({ from: "5521999999999", id: "w1", text: "preço do produto CABO123" }, {
    query: async (sql) => sql.includes("UPPER") ? [{ CDPRODUTO: "CABO123", PRODUTO: "Cabo flexível", PRECO: 10, ESTOQUE: 4 }] : [],
  });
  assert.equal(registrada.comercial, true);
  assert.equal(registrada.item.status, "aguardando");
  assert.match(registrada.item.rascunho, /CABO123/);
  await assert.rejects(() => decidirConsulta(registrada.item.id, "aprovar", { id: 2, gerencial: false }, {}), /gerencial/);
  const enviado = await decidirConsulta(registrada.item.id, "aprovar", { id: 1, gerencial: true }, {
    sendText: async (destino, corpo) => { enviados.push({ destino, corpo }); return { ok: true }; },
  });
  assert.equal(enviado.status, "enviado");
  assert.equal(enviados[0].corpo, registrada.item.rascunho);
  assert.match(enviados[0].corpo, /estoque atual 4/);
});
