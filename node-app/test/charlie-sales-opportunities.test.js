import test from "node:test";
import assert from "node:assert/strict";
import { montarOportunidades } from "../server/lib/charlie-sales-opportunities.js";
import { painelOportunidades } from "../server/lib/charlie-sales-opportunities-service.js";

test("origem ausente não vira zero e o dado sensível fica de fora", () => {
  const painel = montarOportunidades({
    ator: { id: 4, gerencial: false, company: 2 },
    arquivos: {
      "charlie-commercial-opportunities.json": {
        opportunities: [
          { id: "a", type: "recompra", status: "identificada", ownerUserId: 4, company: 2, customer: "Cliente Sigiloso", phone: "21999990000" },
          { id: "b", type: "recompra", status: "convertida", ownerUserId: 4, company: 2, customer: "Outro" },
          { id: "c", type: "sinal_publico", status: "identificada", ownerUserId: 9, company: 2, customer: "De outro" },
          { id: "d", type: "recompra", status: "identificada", ownerUserId: 4, company: 3, customer: "Outra empresa" },
        ],
      },
      "ecommerce_intelligence_control.json": null,
    },
  });
  assert.equal(painel.fontes.find((item) => item.origem === "Comercial").abertas, 1);
  assert.equal(painel.fontes.find((item) => item.origem === "Comercial").encerradas, 1);
  assert.equal(painel.fontes.find((item) => item.origem === "E-commerce").lida, false);
  assert.equal(painel.fontes.find((item) => item.origem === "E-commerce").abertas, null);
  assert.deepEqual(painel.grupos, [{ origem: "Comercial", tipo: "recompra", quantidade: 1 }]);
  const json = JSON.stringify(painel);
  assert.equal(json.includes("Cliente Sigiloso"), false);
  assert.equal(json.includes("21999990000"), false);
  assert.equal(json.includes("De outro"), false);
  assert.match(painel.aviso, /Nenhuma oportunidade foi criada/);
});

test("a leitura não grava oportunidade", async () => {
  const arquivos = {
    "ecommerce_intelligence_control.json": {
      opportunities: {
        a: { id: "a", type: "pricing", status: "identified" },
        b: { id: "b", type: "pricing", status: "dismissed" },
      },
    },
  };
  const antes = JSON.stringify(arquivos);
  const painel = await painelOportunidades({}, { ator: { id: 1, gerencial: true }, arquivos });
  assert.equal(JSON.stringify(arquivos), antes);
  assert.equal(painel.fontes.find((item) => item.origem === "Comercial").abertas, null);
  assert.equal(painel.fontes.find((item) => item.origem === "E-commerce").abertas, 1);
  assert.equal(painel.fontes.find((item) => item.origem === "E-commerce").encerradas, 1);
  assert.equal(painel.grupos[0].tipo, "pricing");
});
