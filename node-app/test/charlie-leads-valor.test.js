import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { contextoGeografico, localizarCliente, localizarPedido, ufsMelhoresClientes } from "../server/lib/charlie-leads-erp.js";

test("pedido sem valor não vira faturamento nem ticket", async () => {
  const consultas = [];
  const query = async (sql) => {
    consultas.push(String(sql));
    if (sql.includes("COUNT(*)") && sql.includes("SAIDAESTOQUE")) return [{ QTD: 2, ULTIMA: "2026-09-01", TOTAL: 80, SEM: 1 }];
    if (sql.includes("FROM CLIENTE") && sql.includes("CDCLIENTE")) return [{ CDCLIENTE: 10, NOME: "Cliente", INATIVO: 0, UF: "RJ", CDVENDEDOR: 3 }];
    if (sql.includes("ORCAMENTO")) return [{ QTD: 0 }];
    if (sql.includes("AVG(TOTAL)")) return [{ MEDIA: 800, OMITIDOS: 2 }];
    if (sql.includes("GROUP BY NRPEDIDO")) return [{ NRPEDIDO: 9, IDEMPRESA: 1, CDCLIENTE: 10, TOTAL: 0, SEM: 1 }];
    if (sql.includes("DATEADD")) return [{ UF: "RJ", TOTAL: 0 }];
    return [];
  };
  const cliente = await localizarCliente(query, "00000000000191");
  assert.equal(cliente.faturamentoRegistrado, null);
  const geo = await contextoGeografico(query, "rj", "");
  assert.equal(geo.ticketMedioUf, 800);
  assert.equal(geo.ticketMedioOmitidos, 2);
  const pedido = await localizarPedido(query, 9);
  assert.equal(pedido.valor, null);
  const ufs = await ufsMelhoresClientes(query);
  assert.equal(ufs[0].total, 0);
  assert.match(consultas.find((sql) => sql.includes("AVG(TOTAL)")), /VLTOTAL IS NULL AND se.SUBTOTAL IS NULL/);
  assert.doesNotMatch(consultas.join("\n"), /SUBTOTAL, 0\)/);
  const fonte = fs.readFileSync(new URL("../server/lib/charlie-commercial-service.js", import.meta.url), "utf8");
  assert.match(fonte, /QTDPRODUTO IS NOT NULL AND sp.VLUNIT IS NOT NULL/);
  assert.doesNotMatch(fonte, /VLUNIT,0\) RECEITA/);
});
