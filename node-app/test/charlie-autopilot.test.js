import test from "node:test";
import assert from "node:assert/strict";
import { aplicarDecisao, classificarSinal, montarCiclo } from "../server/lib/charlie-autopilot.js";
import { autorizarBaixoRisco, decidirAutopilot, painelAutopilot, rodarCiclo, usarMemoriaDeTeste } from "../server/lib/charlie-autopilot-service.js";

const fontes = {
  oportunidades: [{ id: "op1", type: "inventory", description: "Filtro pode ficar sem saldo.", status: "identified", priority: "critical" }],
  acoes: [{ id: "a1", type: "price", description: "Ajustar preço do cabo.", status: "pending", opportunityId: "op2" }],
  campanhas: [],
  resultados: { observedRevenue: null, estimatedRevenue: 10, attributionNotice: "Estimativa separada do observado." },
};

test("preço fica no risco médio e exclusão fica bloqueada", () => {
  assert.equal(classificarSinal({ tipo: "price", descricao: "Ajustar preço" }).risco, "medio");
  assert.equal(classificarSinal({ tipo: "alerta", descricao: "Cancelar pedidos em massa" }).risco, "alto");
  assert.equal(classificarSinal({ tipo: "inventory", descricao: "Criar alerta de estoque" }).risco, "baixo");
  const ciclo = montarCiclo({ ...fontes, oportunidades: [...fontes.oportunidades, { id: "op3", type: "exclusao", description: "Apagar registro", status: "identified" }] }, { baixoAutomatico: false });
  assert.equal(ciclo.propostas.find((item) => item.tipo === "price").etapa, "recomendada");
  assert.equal(ciclo.propostas.find((item) => item.tipo === "exclusao").etapa, "bloqueada");
  assert.equal(ciclo.executadas.length, 0);
  assert.equal(ciclo.resultados.observado, null);
  assert.match(ciclo.aviso, /Não cria problema novo/);
});

test("ciclo vazio não inventa problema e o baixo risco só registra por dentro", () => {
  const vazio = montarCiclo({}, { baixoAutomatico: true });
  assert.equal(vazio.problemas.length, 0);
  assert.equal(vazio.propostas.length, 0);
  usarMemoriaDeTeste({ baixoAutomatico: false, itens: [], historico: [] });
  const parado = rodarCiclo({ id: 4, gerencial: true }, { fontes });
  assert.equal(parado.executadas.length, 0);
  assert.throws(() => decidirAutopilot("oportunidade:op1", "executar", { id: 4, gerencial: true }, { fontes }), /desligada/);
  autorizarBaixoRisco(true, { id: 4, gerencial: true });
  const rodado = rodarCiclo({ id: 4, gerencial: true }, { fontes });
  assert.equal(rodado.executadas[0].resultado.includes("Nenhuma mensagem"), true);
  assert.throws(() => decidirAutopilot("acao:a1", "executar", { id: 4, gerencial: true }, { fontes }), /não são executados/);
  assert.throws(() => aplicarDecisao({ id: "x", risco: "alto", etapa: "bloqueada" }, "executar", true), /alto risco/);
  const painel = painelAutopilot({ fontes });
  assert.equal(painel.baixoAutomatico, true);
  assert.throws(() => rodarCiclo({ id: 4, gerencial: false }, { fontes }), /gerencial/);
  usarMemoriaDeTeste(null);
});
