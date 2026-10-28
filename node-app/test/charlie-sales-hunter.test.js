import assert from "node:assert/strict";
import test from "node:test";
import { classificarCaca, planoDeCaca, rascunhoAbordagem } from "../server/lib/charlie-sales-hunter.js";

const segmentos = [{ id: "eletrica", nome: "Instalações elétricas", cnaes: ["4321500"], termos: ["eletrica", "elétrica"] }];

test("o plano da caça resolve segmento e exige um filtro real", () => {
  const plano = planoDeCaca({ segmento: "elétrica", uf: "rj", porte: "03", limite: 50 }, segmentos);
  assert.equal(plano.erros.length, 0);
  assert.equal(plano.segmento.id, "eletrica");
  assert.deepEqual(plano.pesquisa.codigo_atividade_principal, ["4321500"]);
  assert.equal(plano.pesquisa.uf, "rj");
  assert.equal(plano.pesquisa.limite, 10);
  assert.equal(plano.pesquisa.naoCadastradas, false);
  assert.equal(planoDeCaca({ segmento: "elétrica", somenteNovos: true }, segmentos).pesquisa.naoCadastradas, true);
  assert.equal(planoDeCaca({ porte: "99" }, segmentos).erros.length > 0, true);
  assert.match(planoDeCaca({}, segmentos).erros[0], /segmento, CNAE/);
});

test("a classificação separa cliente, duplicado e prioridade sem chamar isso de probabilidade", () => {
  const empresas = classificarCaca([
    { cnpj: "1", razaoSocial: "Nova", uf: "RJ", municipio: "Niterói", cnae: "4321500", cnaeDescricao: "Instalação elétrica", pontuacao: 70, leadId: null, vinculo: { verificado: true, existe: false } },
    { cnpj: "2", razaoSocial: "Já lead", pontuacao: 90, leadId: "abc", vinculo: { verificado: true, existe: false } },
    { cnpj: "3", razaoSocial: "Cliente", pontuacao: 90, leadId: null, vinculo: { verificado: true, existe: true, clienteId: 9 } },
    { cnpj: "4", razaoSocial: "Baixa", pontuacao: 20, leadId: null, vinculo: { verificado: true, existe: false } },
    { cnpj: "5", razaoSocial: "Sem ERP", pontuacao: 80, leadId: null, vinculo: { verificado: false } },
  ], { scoreMinimo: 50, segmento: { id: "eletrica", nome: "Instalações elétricas" } });
  assert.deepEqual(empresas.map((item) => item.destino), ["elegivel", "duplicado", "ja_cliente", "abaixo_da_priorizacao", "cadastro_nao_verificado"]);
  assert.equal(empresas[2].clienteId, 9);
  assert.match(empresas[0].aviso, /não é probabilidade/i);
  assert.match(rascunhoAbordagem(empresas[0]), /Nova/);
  assert.match(rascunhoAbordagem(empresas[0]), /Instalação elétrica/);
  assert.doesNotMatch(rascunhoAbordagem(empresas[0]), /precisa comprar|probabilidade/i);
});
