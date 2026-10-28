import { readJsonConfig } from "./json-config.js";
import { readSettings } from "./charlie-breakfast-store.js";
import { montarMissoes } from "./charlie-sales-mission.js";

async function consultar(query, sql, params = []) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function hojeSp(data = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

function dataLocal(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function somarDias(iso, dias) {
  const data = dataLocal(iso);
  data.setDate(data.getDate() + dias);
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function fimDoMes(iso) {
  const [ano, mes] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
}

function segunda(iso) {
  const data = dataLocal(iso);
  const dia = data.getDay();
  return somarDias(iso, dia === 0 ? -6 : 1 - dia);
}

function dinheiroOuNulo(receita, sem) {
  return Number(sem) > 0 ? null : (receita == null || receita === "" ? 0 : receita);
}

function empresa(ator) {
  return Number(ator?.company) > 0 ? Number(ator.company) : null;
}

function onde(ator) {
  const id = empresa(ator);
  return id ? { sql: " AND se.IDEMPRESA=?", params: [id] } : { sql: "", params: [] };
}

async function agregado(deps, inicio, fimExclusivo, grupo, ator) {
  const filtro = onde(ator);
  const campo = grupo === "vendedor" ? "se.CDVENDEDOR" : grupo === "loja" ? "se.IDEMPRESA" : grupo === "grupo" ? "pr.CDGRUPO" : null;
  const juncao = grupo === "grupo"
    ? `JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
       LEFT JOIN (SELECT CDPRODUTO, MAX(CDGRUPO) CDGRUPO FROM PRODUTO GROUP BY CDPRODUTO) pr ON pr.CDPRODUTO=sp.CDPRODUTO`
    : "";
  const valor = grupo === "grupo"
    ? "CASE WHEN sp.SUBTOTAL IS NOT NULL THEN sp.SUBTOTAL WHEN sp.TOTAL IS NOT NULL THEN sp.TOTAL WHEN sp.QTDPRODUTO IS NOT NULL AND sp.VLUNIT IS NOT NULL THEN sp.QTDPRODUTO * sp.VLUNIT ELSE 0 END"
    : "CASE WHEN se.VLTOTAL IS NOT NULL THEN se.VLTOTAL WHEN se.SUBTOTAL IS NOT NULL THEN se.SUBTOTAL ELSE 0 END";
  const sem = grupo === "grupo"
    ? "CASE WHEN sp.SUBTOTAL IS NULL AND sp.TOTAL IS NULL AND (sp.QTDPRODUTO IS NULL OR sp.VLUNIT IS NULL) THEN 1 ELSE 0 END"
    : "CASE WHEN se.VLTOTAL IS NULL AND se.SUBTOTAL IS NULL THEN 1 ELSE 0 END";
  const selecao = campo ? `${campo} ID,` : "";
  const agrupamento = campo ? ` GROUP BY ${campo}` : "";
  const rows = await consultar(deps.query, `SELECT ${selecao}
      SUM(${valor}) RECEITA,
      SUM(${sem}) SEM,
      COUNT(*) ITENS
    FROM SAIDAESTOQUE se
    ${juncao}
    WHERE se.DTSAIDA>=? AND se.DTSAIDA<?
      AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS,0) IN (1,3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
      ${grupo === "grupo" ? "AND COALESCE(sp.STATUSSE,0)=0" : ""}${filtro.sql}${agrupamento}`, [dataLocal(inicio), dataLocal(fimExclusivo), ...filtro.params]);
  if (rows == null) return null;
  if (!campo) {
    const row = rows[0] || {};
    return Number(row.ITENS) > 0 ? dinheiroOuNulo(row.RECEITA, row.SEM) : 0;
  }
  const mapa = new Map();
  for (const row of rows) mapa.set(String(row.ID), Number(row.ITENS) > 0 ? dinheiroOuNulo(row.RECEITA, row.SEM) : 0);
  return mapa;
}

async function nomes(deps, tabela, id, nome, lista) {
  const ids = [...new Set(lista.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))].slice(0, 200);
  if (!ids.length) return new Map();
  const rows = await consultar(deps.query, `SELECT ${id} ID, MAX(${nome}) NOME FROM ${tabela} WHERE ${id} IN (${ids.map(() => "?").join(",")}) GROUP BY ${id}`, ids);
  if (rows == null) return null;
  return new Map(rows.map((row) => [String(row.ID), row.NOME]));
}

function metaDe(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function realizadoDe(mapa, id) {
  if (mapa == null) return null;
  if (mapa instanceof Map) return mapa.has(String(id)) ? mapa.get(String(id)) : 0;
  return mapa;
}

export async function painelMissoes(deps = {}, opcoes = {}) {
  if (opcoes.fatos) return montarMissoes(opcoes.fatos);
  const hoje = hojeSp(opcoes.hoje || new Date());
  const inicioMes = `${hoje.slice(0, 8)}01`;
  const fimMes = fimDoMes(hoje);
  const inicioSemana = segunda(hoje);
  const fimSemana = somarDias(inicioSemana, 6);
  let diario = opcoes.diario;
  let legado = opcoes.legado;
  if (diario === undefined) {
    try { diario = readSettings().metas || {}; } catch { diario = null; }
  }
  if (legado === undefined) {
    try { legado = readJsonConfig("management_reports.json", {}); } catch { legado = null; }
  }
  if (diario == null && legado == null) return montarMissoes({ metas: null });
  const metas = [];
  const lojas = new Set();
  const vendedores = new Set();
  const grupos = new Set();
  const adicionar = (item) => { if (metaDe(item.meta)) metas.push(item); };
  const mensal = diario?.mensal;
  if (metaDe(mensal)) adicionar({ id: "mensal", tipo: "Mensal", nome: "Meta mensal", origem: "Charlie Daily", meta: mensal, inicio: inicioMes, prazo: fimMes });
  if (metaDe(diario?.diaria)) adicionar({ id: "diaria", tipo: "Diária", nome: "Meta diária", origem: "Charlie Daily", meta: diario.diaria, inicio: hoje, prazo: hoje });
  if (metaDe(diario?.semanal)) adicionar({ id: "semanal", tipo: "Semanal", nome: "Meta semanal", origem: "Charlie Daily", meta: diario.semanal, inicio: inicioSemana, prazo: fimSemana });
  for (const [id, meta] of Object.entries(diario?.filiais || {})) {
    if (!metaDe(meta)) continue;
    lojas.add(id);
    adicionar({ id: `filial:${id}`, tipo: "Loja", nome: null, origem: "Charlie Daily", meta, chave: id, inicio: inicioMes, prazo: fimMes });
  }
  for (const [id, meta] of Object.entries(diario?.vendedores || {})) {
    if (!metaDe(meta)) continue;
    vendedores.add(id);
    adicionar({ id: `vendedor-daily:${id}`, tipo: "Vendedor", nome: null, origem: "Charlie Daily", meta, chave: id, inicio: inicioMes, prazo: fimMes });
  }
  for (const [id, meta] of Object.entries(legado?.goals || {})) {
    if (!metaDe(meta)) continue;
    lojas.add(id);
    adicionar({ id: `loja:${id}`, tipo: "Loja", nome: null, origem: "Relatórios gerenciais", meta, chave: id, inicio: inicioMes, prazo: fimMes });
  }
  for (const [id, meta] of Object.entries(legado?.seller_goals || {})) {
    if (!metaDe(meta)) continue;
    vendedores.add(id);
    adicionar({ id: `vendedor:${id}`, tipo: "Vendedor", nome: null, origem: "Relatórios gerenciais", meta, chave: id, inicio: inicioMes, prazo: fimMes });
  }
  for (const [id, meta] of Object.entries(legado?.category_goals || {})) {
    if (!metaDe(meta)) continue;
    grupos.add(id);
    adicionar({ id: `grupo:${id}`, tipo: "Grupo", nome: null, origem: "Relatórios gerenciais", meta, chave: id, inicio: inicioMes, prazo: fimMes });
  }
  for (const [id, meta] of Object.entries(diario?.equipes || {})) {
    if (!metaDe(meta)) continue;
    lojas.add(id);
    adicionar({ id: `equipe:${id}`, tipo: "Equipe", nome: `Equipe ${id}`, origem: "Charlie Daily", meta, chave: id, inicio: inicioMes, prazo: fimMes, equipe: true });
  }
  if (metaDe(diario?.equipe)) adicionar({ id: "equipe", tipo: "Equipe", nome: "Equipe", origem: "Charlie Daily", meta: diario.equipe, inicio: inicioMes, prazo: fimMes, realizado: null, equipe: true });
  const fimMesExclusivo = somarDias(fimMes, 1);
  const amanha = somarDias(hoje, 1);
  const [mesTotal, mesLoja, mesVendedor, mesGrupo, dia, semana, nomesLoja, nomesVendedor, nomesGrupo] = await Promise.all([
    metaDe(mensal) ? agregado(deps, inicioMes, fimMesExclusivo, null, opcoes.ator || {}) : null,
    lojas.size ? agregado(deps, inicioMes, fimMesExclusivo, "loja", opcoes.ator || {}) : null,
    vendedores.size ? agregado(deps, inicioMes, fimMesExclusivo, "vendedor", opcoes.ator || {}) : null,
    grupos.size ? agregado(deps, inicioMes, fimMesExclusivo, "grupo", opcoes.ator || {}) : null,
    metaDe(diario?.diaria) ? agregado(deps, hoje, amanha, null, opcoes.ator || {}) : null,
    metaDe(diario?.semanal) ? agregado(deps, inicioSemana, amanha, null, opcoes.ator || {}) : null,
    nomes(deps, "CONFIGURACAO", "IDEMPRESA", "NOMEEMPRESA", [...lojas]),
    nomes(deps, "VENDEDOR", "CDVENDEDOR", "VENDEDOR", [...vendedores]),
    nomes(deps, "GRUPOS", "CDGRUPO", "GRUPOS", [...grupos]),
  ]);
  for (const item of metas) {
    if (item.equipe && !item.chave) continue;
    if (item.id === "mensal") item.realizado = mesTotal;
    else if (item.id === "diaria") item.realizado = dia;
    else if (item.id === "semanal") item.realizado = semana;
    else if (item.tipo === "Loja" || item.equipe) item.realizado = realizadoDe(mesLoja instanceof Map ? mesLoja : null, item.chave);
    else if (item.tipo === "Vendedor") item.realizado = realizadoDe(mesVendedor, item.chave);
    else if (item.tipo === "Grupo") item.realizado = realizadoDe(mesGrupo, item.chave);
    const tabela = item.tipo === "Loja" || item.equipe ? nomesLoja : item.tipo === "Vendedor" ? nomesVendedor : item.tipo === "Grupo" ? nomesGrupo : null;
    if (tabela) item.nome = tabela.get(String(item.chave)) || null;
  }
  return montarMissoes({
    metas,
    amostra: metas.length > 100,
    recorte: empresa(opcoes.ator || {}) ? "O realizado está limitado à empresa da sessão." : null,
  });
}
