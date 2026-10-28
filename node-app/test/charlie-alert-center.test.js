import test from "node:test";
import assert from "node:assert/strict";
import { resumirAlertas } from "../server/lib/charlie-alert-center.js";
import { painelAlertas } from "../server/lib/charlie-alert-center-service.js";

test("preferência ausente não vira horário nem canal ligado", () => {
  const painel = resumirAlertas({
    configuracao: { notifications: false, notification: { email: true, phones: "21999990000", emails: "a@b.com" } },
    alertas: [
      { id: "1", type: "pricing", status: "identified", priority: "high", description: "Margem", updatedAt: "2026-10-02" },
      { id: "2", type: "pricing", status: "converted", description: "Encerrada" },
      { id: "3", type: "inventory", status: "identified", description: "Estoque", updatedAt: "2026-10-03" },
    ],
  });
  assert.equal(painel.preferencia.avisos, false);
  assert.equal(painel.preferencia.horario, null);
  assert.equal(painel.preferencia.email, true);
  assert.equal(painel.preferencia.whatsapp, null);
  assert.equal(painel.abertos, 2);
  assert.deepEqual(painel.agrupamento, [{ tipo: "inventory", quantidade: 1 }, { tipo: "pricing", quantidade: 1 }].sort((a, b) => b.quantidade - a.quantidade || a.tipo.localeCompare(b.tipo)));
  assert.equal(painel.agrupamento.find((item) => item.tipo === "pricing").quantidade, 1);
  const json = JSON.stringify(painel);
  assert.equal(json.includes("21999990000"), false);
  assert.equal(json.includes("a@b.com"), false);
  assert.match(painel.aviso, /Nenhum aviso foi disparado/);
});

test("a leitura não grava o controle", async () => {
  const arquivo = {
    settings: { dailyReportTime: "07:00", notification: { whatsapp: false, sendReal: false } },
    opportunities: { a: { id: "a", type: "campaign", status: "identified", description: "Campanha" } },
  };
  const antes = JSON.stringify(arquivo);
  const painel = await painelAlertas({}, { arquivo });
  assert.equal(JSON.stringify(arquivo), antes);
  assert.equal(painel.preferencia.horario, "07:00");
  assert.equal(painel.preferencia.avisos, null);
  assert.equal(painel.preferencia.whatsapp, false);
  assert.equal(painel.preferencia.envioReal, false);
  assert.equal(painel.agrupamento[0].tipo, "campaign");
  assert.equal(painel.agrupamento[0].quantidade, 1);
});
