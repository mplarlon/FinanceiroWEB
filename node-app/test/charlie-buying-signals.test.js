import test from "node:test";
import assert from "node:assert/strict";
import { avaliarSinal, validarSinal } from "../server/lib/charlie-buying-signals.js";
import { cadastrarSinal, criarOportunidade, painelSinais, usarMemoriaDeTeste } from "../server/lib/charlie-buying-signals-service.js";

const segmentos = [{ id: "instalacao-eletrica", nome: "Instalações elétricas", termosProduto: [] }];
const produtos = [{ codigo: "CB25", nome: "Cabo 2,5mm" }];

test("sem código de produto não afirma necessidade de compra", () => {
  assert.throws(() => validarSinal({ tipo: "licitacao", fonte: "Diário", empresa: "Oficina Sul" }), /data/i);
  const avaliado = avaliarSinal({
    tipo: "edital",
    fonte: { nome: "Diário Oficial" },
    data: "2026-10-20",
    empresa: "Oficina Sul",
    segmento: "Instalações elétricas",
    codigos: ["CABO FLEXIVEL"],
    descricao: "Edital de material elétrico",
  }, { segmentos, produtos });
  assert.equal(avaliado.segmentoId, "instalacao-eletrica");
  assert.equal(avaliado.produtos.length, 0);
  assert.equal(avaliado.afirmarCompra, false);
  assert.match(avaliado.motivo, /Não dá para afirmar/);
  assert.match(avaliado.abordagem.texto, /Não há produto do ERP/);
  assert.equal(avaliado.abordagem.enviada, false);
  assert.match(avaliado.relevancia.aviso, /Não é probabilidade de compra/);
});

test("código exato vincula produto e a oportunidade não sai na consulta", async () => {
  const avaliado = avaliarSinal(validarSinal({
    tipo: "licitacao",
    fonte: "Portal",
    data: "2026-10-26",
    empresa: "Metalúrgica Norte",
    segmento: "outro",
    codigos: ["CB25"],
  }), { segmentos, produtos });
  assert.equal(avaliado.produtos[0].nome, "Cabo 2,5mm");
  assert.equal(avaliado.segmentoId, null);
  usarMemoriaDeTeste({ sinais: [], oportunidades: {}, historico: [] });
  const sinal = await cadastrarSinal({
    tipo: "noticia",
    fonte: "Revista",
    data: "2026-10-01",
    empresa: "Metalúrgica Norte",
    codigos: ["CB25"],
  }, { id: 4, gerencial: true }, {}, { produtos });
  const painel = await painelSinais({}, { sinais: [sinal], produtos });
  assert.equal(painel.sinais[0].oportunidadeId, null);
  assert.match(painel.aviso, /não consulta/);
  let gravacoes = 0;
  const criada = await criarOportunidade(sinal.id, { id: 4, gerencial: true }, {
    gravarOportunidade: () => {
      gravacoes += 1;
      return [{ id: "op-1" }];
    },
  }, { produtos });
  const deNovo = await criarOportunidade(sinal.id, { id: 4, gerencial: true }, {
    gravarOportunidade: () => {
      gravacoes += 1;
      return [{ id: "op-2" }];
    },
  }, { produtos });
  assert.equal(criada.oportunidadeId, "op-1");
  assert.equal(criada.enviada, false);
  assert.equal(deNovo.repetida, true);
  assert.equal(gravacoes, 1);
  await assert.rejects(() => cadastrarSinal({ tipo: "noticia", fonte: "Revista", data: "2026-10-01", empresa: "A" }, { id: 4, gerencial: false }), /gerencial/);
  usarMemoriaDeTeste(null);
});
