import { query } from "../db.js";
import { codigoENome } from "./charlie-behavioral-risk-engine.js";

const TABLE_NAME = /^(CTARECEBER|CTAPAGAR|PRODUTOPRECO|MOVIMENTO)$/i;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numericIds(values) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].slice(0, 300);
}

function remember(list, value) {
  const id = Number(value);
  if (Number.isInteger(id) && id > 0) list.push(id);
}

export function collectLabelIds(alerts = []) {
  const products = [];
  const clients = [];
  const suppliers = [];
  const users = [];
  for (const alert of alerts) {
    const evidence = alert?.evidencias || {};
    for (const event of evidence.events || []) {
      if (!clean(event.actor?.name)) remember(users, event.actor?.id);
      if (event.type === "price_change" || String(event.entity || "").toUpperCase() === "PRODUTOPRECO")
        remember(products, String(event.recordId || "").split(":")[0]);
    }
    if (String(evidence.entity || "").toUpperCase() === "PRODUTOPRECO")
      remember(products, String(evidence.recordId || "").split(":")[0]);
    for (const row of evidence.records || []) {
      if (row.partyId == null) continue;
      remember(row.domain === "pagar" || evidence.entity === "CTAPAGAR" ? suppliers : clients, row.partyId);
    }
  }
  return { products, clients, suppliers, users };
}

async function fetchNames(db, sql, values) {
  const ids = numericIds(values);
  if (!ids.length) return new Map();
  const marks = ids.map(() => "?").join(",");
  const rows = await query(db, sql.replace("IN (?)", `IN (${marks})`), ids, { timeoutMs: 8000 });
  const names = new Map();
  for (const row of rows) {
    const code = row.CODIGO ?? row.codigo;
    const name = clean(row.NOME ?? row.nome);
    if (code == null || !name) continue;
    names.set(String(code), name);
    const numeric = Number(code);
    if (Number.isInteger(numeric)) names.set(String(numeric), name);
  }
  return names;
}

export async function loadAlertNames(db, alerts = []) {
  const ids = collectLabelIds(alerts);
  const [products, clients, suppliers, users] = await Promise.all([
    fetchNames(db, "SELECT CDPRODUTO CODIGO, PRODUTO NOME FROM PRODUTO WHERE CDPRODUTO IN (?)", ids.products),
    fetchNames(db, "SELECT CDCLIENTE CODIGO, CLIENTE NOME FROM CLIENTE WHERE CDCLIENTE IN (?)", ids.clients),
    fetchNames(db, "SELECT CDFORNECEDOR CODIGO, FORNECEDOR NOME FROM FORNECEDOR WHERE CDFORNECEDOR IN (?)", ids.suppliers),
    fetchNames(db, `SELECT u.IDUSUARIO CODIGO,
      COALESCE(NULLIF(TRIM(v.VENDEDOR), ''), NULLIF(TRIM(u.NOMECOMPLETO), ''), NULLIF(TRIM(u.LOGIN), '')) NOME
      FROM USUARIOS u LEFT JOIN VENDEDOR v ON v.CDVENDEDOR = u.CDVENDEDOR
      WHERE u.IDUSUARIO IN (?)`, ids.users),
  ]);
  return { products, clients, suppliers, users };
}

function lookup(map, id) {
  return map?.get(String(id)) || map?.get(String(Number(id))) || "";
}

function nameParty(row, clients, suppliers) {
  const stored = clean(row.partyName);
  if (stored) return stored;
  return lookup(row.domain === "pagar" ? suppliers : clients, row.partyId);
}

function partyRows(records, clients, suppliers) {
  const seen = new Set();
  const rows = [];
  for (const row of records) {
    if (row.partyId == null) continue;
    const key = `${row.domain}:${row.partyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = nameParty(row, clients, suppliers);
    rows.push({
      CODIGO: row.partyId,
      NOME: name,
      DOCUMENTO: row.document || "",
      PARCELA: row.installment,
      VALOR: row.amount,
      DETALHE: [row.document ? `doc ${clean(row.document)}` : "", row.installment != null && row.installment !== "" ? `parcela ${row.installment}` : ""].filter(Boolean).join(" · "),
    });
  }
  return rows;
}

function mention(text, kind, label) {
  const source = String(text || "");
  if (!source || !label || source.includes(label)) return source;
  const named = `do ${kind} ${label} coincidem em documento, parcela, valor e vencimento`;
  const replaced = source
    .split("possuem documento, pessoa, parcela, valor e vencimento coincidentes").join(named)
    .split("coincidem em documento, pessoa, parcela, valor e vencimento").join(named);
  if (replaced.includes(label)) return replaced;
  return `${source} ${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${label}.`;
}

export function applyAlertNames(alerts = [], maps = {}) {
  const products = maps.products || new Map();
  const clients = maps.clients || new Map();
  const suppliers = maps.suppliers || new Map();
  const users = maps.users || new Map();
  return alerts.map((alert) => {
    const evidence = alert?.evidencias || {};
    let next = alert;
    if (Array.isArray(evidence.events) && evidence.events.length) {
      const events = evidence.events.map((event) => {
        let named = event;
        if (!event.productName && !event.next?.productName) {
          const product = lookup(products, String(event.recordId || "").split(":")[0]);
          if (product) named = { ...named, productName: product };
        }
        const seller = lookup(users, event.actor?.id);
        if (seller && !clean(event.actor?.name)) named = { ...named, actor: { ...event.actor, name: seller } };
        return named;
      });
      next = { ...alert, evidencias: { ...evidence, events } };
    }
    const records = next.evidencias?.records;
    if (Array.isArray(records) && records.some((row) => row.partyId != null)) {
      const registros = partyRows(records, clients, suppliers);
      const first = records.find((row) => row.partyId != null) || {};
      const kind = first.domain === "pagar" ? "fornecedor" : "cliente";
      const label = registros.map((row) => codigoENome(row.CODIGO, row.NOME)).filter(Boolean).join(", ");
      next = {
        ...next,
        registros,
        descricao: mention(next.descricao, kind, label),
        narrativa: next.narrativa ? mention(next.narrativa, kind, label) : next.narrativa,
      };
    } else if (String(next.evidencias?.entity || "").toUpperCase() === "PRODUTOPRECO") {
      const [code, table, unit] = String(next.evidencias.recordId || "").split(":");
      const name = lookup(products, code) || clean(next.evidencias.next?.productName);
      next = {
        ...next,
        registros: [{
          CODIGO: code,
          NOME: name,
          DETALHE: [table ? `tabela ${table}` : "", unit || ""].filter(Boolean).join(", "),
          VALOR: alert.registros?.[0]?.VALOR ?? null,
        }],
      };
    } else if (Array.isArray(next.registros)) {
      next = {
        ...next,
        registros: next.registros.map((row) => {
          if (!TABLE_NAME.test(String(row.NOME || ""))) return row;
          const code = String(row.CODIGO || "").split(":")[0];
          const name = lookup(products, code);
          return name ? { ...row, CODIGO: code, NOME: name } : { ...row, CODIGO: code || row.CODIGO, NOME: "" };
        }),
      };
    }
    return next;
  });
}

export async function withAlertNames(db, alerts = []) {
  return applyAlertNames(alerts, await loadAlertNames(db, alerts));
}
