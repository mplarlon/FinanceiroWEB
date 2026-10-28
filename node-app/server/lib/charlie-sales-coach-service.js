import { readSettings } from "./charlie-breakfast-store.js";
import { saoPauloParts } from "./charlie-breakfast-engine.js";
import { montarCoach } from "./charlie-sales-coach.js";
import { ITEM_SEM_SQL, ITEM_VALOR_SQL, valorLido } from "./charlie-sale-value.js";

async function consultar(query, sql, params) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function dataLocal(iso) {
  const [ano, mes, dia] = String(iso).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function amanha(iso) {
  const [ano, mes, dia] = String(iso).split("-").map(Number);
  return new Date(ano, mes - 1, dia + 1);
}

function proximoMes(iso) {
  const [ano, mes] = String(iso).split("-").map(Number);
  return new Date(ano, mes, 1);
}

function metasLidas(lerMetas) {
  try {
    const salvo = (lerMetas || readSettings)();
    const mensal = Number(salvo?.metas?.mensal);
    const diaria = Number(salvo?.metas?.diaria);
    const dias = Number(salvo?.limites?.clienteInativoDias);
    return {
      mensal: Number.isFinite(mensal) && mensal > 0 ? mensal : null,
      diaria: Number.isFinite(diaria) && diaria > 0 ? diaria : null,
      vendedores: salvo?.metas?.vendedores || {},
      inativoDias: Number.isInteger(dias) && dias > 0 ? dias : null,
    };
  } catch {
    return null;
  }
}

async function vendedorDoUsuario(deps, ator) {
  if (ator?.vendedorId != null) return ator.vendedorId;
  if (!deps.query || !ator?.id) return null;
  const rows = await consultar(deps.query, "SELECT FIRST 1 CDVENDEDOR FROM USUARIOS WHERE IDUSUARIO=?", [ator.id]);
  const id = rows?.[0]?.CDVENDEDOR;
  return id == null || id === "" ? null : Number(id);
}

export async function lerFatos(deps = {}, ator = {}, opcoes = {}) {
  const hoje = opcoes.hoje || saoPauloParts(new Date()).date;
  const vendedorId = await vendedorDoUsuario(deps, ator);
  const equipe = Boolean(ator.gerencial) && (vendedorId == null || opcoes.todos);
  if (!equipe && vendedorId == null) {
    return { hoje, inativoDias: null, metas: null, vendedores: [], orcamentos: [], vendasMes: [], vendasDia: [], inativos: [], complementos: null, vendedorId: null };
  }
  const inicio = `${hoje.slice(0, 8)}01`;
  const metas = opcoes.metas === undefined ? metasLidas(deps.lerMetas) : opcoes.metas;
  const filtro = equipe ? { sql: "", params: [] } : { sql: " AND se.CDVENDEDOR=?", params: [vendedorId] };
  const filtroOrc = equipe ? { sql: "", params: [] } : { sql: " AND o.CDVENDEDOR=?", params: [vendedorId] };
  const filtroCli = equipe ? { sql: "", params: [] } : { sql: " AND c.CDVENDEDOR=?", params: [vendedorId] };
  const vendasSql = `SELECT se.CDVENDEDOR, SUM(${ITEM_VALOR_SQL}) VALOR, SUM(${ITEM_SEM_SQL}) SEM
    FROM SAIDAPRODUTO sp
    JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<?
      AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
      AND COALESCE(sp.STATUSSE,0)=0`;
  const paresSql = `SELECT FIRST 200 se.CDVENDEDOR, a.CDPRODUTO A,
      (SELECT MAX(p.PRODUTO) FROM PRODUTO p WHERE p.CDPRODUTO=a.CDPRODUTO) NOME_A,
      b.CDPRODUTO B,
      (SELECT MAX(p.PRODUTO) FROM PRODUTO p WHERE p.CDPRODUTO=b.CDPRODUTO) NOME_B,
      COUNT(*) PEDIDOS
    FROM SAIDAPRODUTO a
    JOIN SAIDAPRODUTO b ON b.NRPEDIDO=a.NRPEDIDO AND b.IDEMPRESA=a.IDEMPRESA AND b.CDPRODUTO>a.CDPRODUTO
    JOIN SAIDAESTOQUE se ON se.NRPEDIDO=a.NRPEDIDO AND se.IDEMPRESA=a.IDEMPRESA
    WHERE se.DTSAIDA>=DATEADD(-365 DAY TO CURRENT_DATE)
      AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
      AND COALESCE(a.STATUSSE,0)=0
      AND COALESCE(b.STATUSSE,0)=0${filtro.sql}
    GROUP BY se.CDVENDEDOR, a.CDPRODUTO, b.CDPRODUTO
    HAVING COUNT(*)>=3
    ORDER BY COUNT(*) DESC`;
  const [vendedores, orcamentos, vendasMes, vendasDia, inativos, pares] = await Promise.all([
    consultar(deps.query, `SELECT CDVENDEDOR, VENDEDOR FROM VENDEDOR WHERE COALESCE(INATIVO,0)=0${equipe ? "" : " AND CDVENDEDOR=?"}`, equipe ? [] : [vendedorId]),
    consultar(deps.query, `SELECT FIRST 4000 o.CDVENDEDOR, o.STATUS, o.VLTOTAL, o.CONTATO, o.CDCLIENTE, COALESCE(o.CLIENTE, c.CLIENTE) CLIENTE, o.DTORC, o.NRORCAMENTO
      FROM ORCAMENTO o
      LEFT JOIN CLIENTE c ON c.CDCLIENTE=o.CDCLIENTE
      WHERE o.DTORC>=? AND o.DTORC<? AND o.DTCANCELAMENTO IS NULL${filtroOrc.sql}`, [dataLocal(inicio), proximoMes(hoje), ...filtroOrc.params]),
    consultar(deps.query, `${vendasSql}${filtro.sql} GROUP BY se.CDVENDEDOR`, [dataLocal(inicio), proximoMes(hoje), ...filtro.params]),
    consultar(deps.query, `${vendasSql}${filtro.sql} GROUP BY se.CDVENDEDOR`, [dataLocal(hoje), amanha(hoje), ...filtro.params]),
    metas?.inativoDias == null ? null : consultar(deps.query, `SELECT FIRST 300 c.CDCLIENTE, COALESCE(c.CLIENTE, c.RAZAO) CLIENTE, c.CDVENDEDOR, c.DTULTCOMPRA
      FROM CLIENTE c
      WHERE c.CDVENDEDOR IS NOT NULL AND c.DTULTCOMPRA IS NOT NULL AND c.DTULTCOMPRA < DATEADD(? DAY TO CURRENT_DATE) AND COALESCE(c.INATIVO,0)=0${filtroCli.sql}
      ORDER BY c.DTULTCOMPRA`, [-metas.inativoDias, ...filtroCli.params]),
    consultar(deps.query, paresSql, filtro.params),
  ]);
  return {
    hoje,
    inativoDias: metas?.inativoDias ?? null,
    metas,
    vendedores: vendedores?.map((row) => ({ id: row.CDVENDEDOR, nome: row.VENDEDOR })) ?? [],
    orcamentos: orcamentos?.map((row) => ({ vendedorId: row.CDVENDEDOR, status: Number(row.STATUS), valor: row.VLTOTAL, contato: row.CONTATO, cliente: row.CLIENTE, numero: row.NRORCAMENTO })) ?? null,
    vendasMes: vendasMes?.map((row) => ({ vendedorId: row.CDVENDEDOR, valor: valorLido(row.VALOR, row.SEM) })) ?? null,
    vendasDia: vendasDia?.map((row) => ({ vendedorId: row.CDVENDEDOR, valor: valorLido(row.VALOR, row.SEM) })) ?? null,
    inativos: inativos?.map((row) => ({ vendedorId: row.CDVENDEDOR, clienteId: row.CDCLIENTE, cliente: row.CLIENTE, ultimaCompra: row.DTULTCOMPRA })) ?? null,
    complementos: pares == null ? null : pares.map((row) => ({
      vendedorId: row.CDVENDEDOR,
      produto: String(row.NOME_A || row.A || "").trim() || null,
      junto: String(row.NOME_B || row.B || "").trim() || null,
      suporte: Number(row.PEDIDOS),
    })),
    vendedorId,
  };
}

export async function painelCoach(deps = {}, ator = {}, opcoes = {}) {
  if (opcoes.fatos) return montarCoach(opcoes.fatos, { gerencial: Boolean(ator.gerencial), vendedorId: ator.vendedorId ?? null, todos: Boolean(opcoes.todos) });
  const fatos = await lerFatos(deps, ator, opcoes);
  return montarCoach(fatos, { gerencial: Boolean(ator.gerencial), vendedorId: fatos.vendedorId, todos: Boolean(opcoes.todos) });
}
