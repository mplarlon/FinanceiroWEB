import fs from "node:fs/promises";
import path from "node:path";
import { withReadOnlyDatabase, query } from "../node-app/server/db.js";

const config = {
  host: "100.92.55.29",
  port: 3050,
  database: "C:\\Administracao\\db\\MIAUTOMEC.FDB",
  user: "SYSDBA",
  password: "masterkey",
  charset: "WIN1252",
};

const output = path.resolve("outputs", "trocas-vendedores-2026", "historico_trocas_2026.json");

await withReadOnlyDatabase(async (db) => {
  const histories = await query(db, `
    SELECT ID, TIPO,
           CAST(CONTEXTO AS VARCHAR(50) CHARACTER SET OCTETS) AS CONTEXTO,
           CAST(MENSAGEM AS VARCHAR(80) CHARACTER SET OCTETS) AS MENSAGEM,
           IDUSUARIO, DATA_HORA
    FROM SIS_APPHISTORY
    WHERE DATA_HORA >= DATE '2026-01-01'
      AND DATA_HORA < DATE '2027-01-01'
      AND IDMENUITEM = 16
      AND CONTEXTO STARTING WITH 'NRPEDIDO='
    ORDER BY ID
  `, [], { timeoutMs: 120000 });

  const parsed = histories.map((row) => ({
    ...row,
    pedido: Number(String(row.CONTEXTO || "").match(/NRPEDIDO=(\d+)/)?.[1] || 0),
    empresa: Number(String(row.CONTEXTO || "").match(/IDEMPRESA=(\d+)/)?.[1] || 0),
  })).filter((row) => row.pedido > 0);

  const changeRows = parsed.filter((row) => Number(row.TIPO) === 2 && /(^|;)CDVENDEDOR(;|$)/i.test(String(row.MENSAGEM || "")));
  const keys = [...new Set(changeRows.map((row) => `${row.empresa}:${row.pedido}`))];
  const keySet = new Set(keys);
  const historiesByKey = new Map();
  for (const row of parsed) {
    const key = `${row.empresa}:${row.pedido}`;
    if (!keySet.has(key)) continue;
    if (!historiesByKey.has(key)) historiesByKey.set(key, []);
    historiesByKey.get(key).push(row);
  }

  const pedidos = [...new Set(changeRows.map((row) => row.pedido))];
  const orders = [];
  for (let i = 0; i < pedidos.length; i += 120) {
    const chunk = pedidos.slice(i, i + 120);
    const placeholders = chunk.map(() => "?").join(",");
    orders.push(...await query(db, `
      SELECT s.NRPEDIDO, s.IDEMPRESA, s.DTSAIDA, s.DTALTER, s.CDCLIENTE, s.CLIENTE,
             s.CDVENDEDOR AS CDVENDEDOR_ATUAL, v.VENDEDOR AS VENDEDOR_ATUAL,
             s.VLTOTAL, s.STATUS, s.DTCANCELAMENTO, s.SIST_ALT
      FROM SAIDAESTOQUE s
      LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = s.CDVENDEDOR
      WHERE s.NRPEDIDO IN (${placeholders})
    `, chunk));
  }
  const orderMap = new Map(orders.map((row) => [`${row.IDEMPRESA}:${row.NRPEDIDO}`, row]));

  const users = await query(db, `
    SELECT u.IDUSUARIO, u.LOGIN, u.NOMECOMPLETO, u.CDVENDEDOR,
           v.VENDEDOR
    FROM USUARIOS u
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = u.CDVENDEDOR
  `);
  const userMap = new Map(users.map((row) => [Number(row.IDUSUARIO), row]));

  const changesPerKey = new Map();
  for (const row of changeRows) {
    const key = `${row.empresa}:${row.pedido}`;
    changesPerKey.set(key, (changesPerKey.get(key) || 0) + 1);
  }

  const events = changeRows.map((row) => {
    const key = `${row.empresa}:${row.pedido}`;
    const timeline = historiesByKey.get(key) || [];
    const creation = timeline.find((event) => Number(event.TIPO) === 1) || null;
    const actor = userMap.get(Number(row.IDUSUARIO)) || {};
    const creator = creation ? (userMap.get(Number(creation.IDUSUARIO)) || {}) : {};
    const order = orderMap.get(key) || {};
    const countChanges = changesPerKey.get(key) || 0;
    const inferredExact = countChanges === 1 && creator.CDVENDEDOR != null && order.CDVENDEDOR_ATUAL != null && Number(creator.CDVENDEDOR) !== Number(order.CDVENDEDOR_ATUAL);
    const isExample = row.pedido === 666800;
    return {
      idHistorico: Number(row.ID),
      pedido: row.pedido,
      empresa: row.empresa,
      dataHoraAlteracao: row.DATA_HORA,
      idUsuarioAlterou: row.IDUSUARIO == null ? null : Number(row.IDUSUARIO),
      usuarioAlterou: actor.LOGIN || actor.NOMECOMPLETO || null,
      vendedorDoUsuarioQueAlterou: actor.VENDEDOR || null,
      dataHoraCriacao: creation?.DATA_HORA || null,
      idUsuarioCriou: creation?.IDUSUARIO == null ? null : Number(creation.IDUSUARIO),
      usuarioCriou: creator.LOGIN || creator.NOMECOMPLETO || null,
      cdVendedorCriador: creator.CDVENDEDOR == null ? null : Number(creator.CDVENDEDOR),
      vendedorCriador: creator.VENDEDOR || null,
      cdVendedorAtual: order.CDVENDEDOR_ATUAL == null ? null : Number(order.CDVENDEDOR_ATUAL),
      vendedorAtual: order.VENDEDOR_ATUAL || null,
      vendedorAntes: isExample ? "POLIANA BISPO" : (inferredExact ? creator.VENDEDOR : null),
      vendedorDepois: isExample ? "Flavia" : (inferredExact ? order.VENDEDOR_ATUAL : null),
      baseValores: isExample ? "captura durante a ocorrência" : (inferredExact ? "inferido: criador e vendedor final" : "não reconstruído"),
      totalAlteracoesVendedorNoPedido: countChanges,
      camposAlterados: row.MENSAGEM,
      dataPedido: order.DTSAIDA || null,
      dataUltimaAlteracao: order.DTALTER || null,
      cliente: order.CLIENTE || null,
      valorPedido: order.VLTOTAL == null ? null : Number(order.VLTOTAL),
      statusPedido: order.STATUS == null ? null : Number(order.STATUS),
      cancelado: order.DTCANCELAMENTO ? 1 : 0,
      sistemaAtual: order.SIST_ALT || null,
    };
  });

  const byActor = new Map();
  for (const event of events) {
    const key = event.usuarioAlterou || `(usuário ${event.idUsuarioAlterou ?? "n.a."})`;
    const acc = byActor.get(key) || { usuario: key, alteracoes: 0, pedidos: new Set(), valorPedidos: 0 };
    acc.alteracoes += 1;
    if (!acc.pedidos.has(event.pedido)) {
      acc.pedidos.add(event.pedido);
      acc.valorPedidos += Number(event.valorPedido || 0);
    }
    byActor.set(key, acc);
  }
  const usuariosResumo = [...byActor.values()].map((row) => ({
    usuario: row.usuario,
    alteracoes: row.alteracoes,
    pedidos: row.pedidos.size,
    valorPedidos: row.valorPedidos,
  })).sort((a, b) => b.alteracoes - a.alteracoes || b.valorPedidos - a.valorPedidos);

  const payload = {
    extraidoEm: new Date().toISOString(),
    criterio: "SIS_APPHISTORY: IDMENUITEM=16, TIPO=2 e MENSAGEM contendo exatamente CDVENDEDOR",
    eventos: events,
    usuariosResumo,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload), "utf8");
  console.log(JSON.stringify({ output, eventos: events.length, pedidos: keys.length, usuarios: usuariosResumo.length }));
}, config);
