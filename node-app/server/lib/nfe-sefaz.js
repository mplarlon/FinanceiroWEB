// Integracao NF-e com o gateway fiscal (ACBrMonitor local ou HTTP), porta de
// nfe_sefaz.py. O gateway monta/assina o XML e conversa com a SEFAZ; este
// modulo cuida da logica de negocio (tributacao, persistencia, arquivamento).

import fs from "node:fs";
import path from "node:path";
import { appRoot } from "../config.js";
import { withWriteTransaction } from "../db.js";
import * as acbr from "./acbr-monitor.js";
import { HttpError } from "./http-error.js";

export const AUTORIZADA = new Set([100, 150]);
export const CANCELADA = new Set([101, 135, 155]);
export const EVENTO_REGISTRADO = new Set([135, 136]);
export const INUTILIZADA = new Set([102]);

const tokenCache = { token: null, expires: 0 };

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}
function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function configPath() {
  return process.env.DASHBOARD_NFE_CONFIG || path.resolve(appRoot, "..", "nfe_sefaz_config.json");
}

export function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return { enabled: false };
  let text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const cfg = JSON.parse(text);
  cfg.enabled = Boolean(cfg.enabled);
  return cfg;
}

function pick(result, ...names) {
  for (const name of names) {
    const value = result?.[name];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function cstat(result) {
  const value = result?.cStat ?? result?.cstat ?? result?.status_code;
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---- Gateway ACBrMonitor / Nuvem Fiscal / HTTP generico ----

export async function postGateway(acao, payload, cfg) {
  cfg = cfg || loadConfig();
  if (!cfg.enabled && acao !== "status") {
    throw new Error("Emissao SEFAZ nao configurada. Crie nfe_sefaz_config.json a partir do arquivo de exemplo.");
  }
  const provider = String(cfg.provider || "").toLowerCase();
  if (provider === "acbr_monitor") return acbr.executar(acao, payload, cfg);
  if (provider === "nuvem_fiscal") return postNuvemFiscal(acao, payload, cfg);
  return postGenericGateway(acao, payload, cfg);
}

async function postGenericGateway(acao, payload, cfg) {
  const baseUrl = String(cfg.base_url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("base_url do gateway fiscal e invalida.");
  const paths = cfg.paths || {};
  const routePath = String(paths[acao] || `/nfe/${acao}`);
  const url = baseUrl + "/" + routePath.replace(/^\/+/, "");
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const token = String(cfg.token || "").trim();
  if (token) headers.Authorization = "Bearer " + token;
  for (const [k, v] of Object.entries(cfg.headers || {})) {
    if (!["content-length", "host"].includes(String(k).toLowerCase())) headers[String(k)] = String(v);
  }
  const timeoutMs = Number(cfg.timeout_seconds || 60) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
  } catch (error) {
    throw new Error("Nao foi possivel acessar o gateway fiscal: " + error.message);
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(`Gateway fiscal retornou HTTP ${response.status}: ${raw.slice(0, 1000)}`);
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error("Gateway fiscal retornou uma resposta que nao e JSON."); }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("Resposta invalida do gateway fiscal.");
  }
  return result;
}

async function nuvemToken(cfg) {
  if (tokenCache.token && tokenCache.expires > Date.now() / 1000 + 30) return tokenCache.token;
  const clientId = String(cfg.client_id || "").trim();
  const clientSecret = String(cfg.client_secret || "").trim();
  if (!clientId || !clientSecret) throw new Error("Informe client_id e client_secret da Nuvem Fiscal.");
  const body = new URLSearchParams({
    grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "nfe empresa",
  });
  const res = await fetch(String(cfg.auth_url || "https://auth.nuvemfiscal.com.br/oauth/token"), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const result = await res.json();
  tokenCache.token = result.access_token;
  tokenCache.expires = Date.now() / 1000 + Number(result.expires_in || 300);
  return tokenCache.token;
}

const UF_CODES = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
  SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41,
  SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};

function nuvemPayloadEmissao(source, cfg) {
  const nota = source.nota, itens = source.itens;
  const emit = source.emitente || {}, dest = source.destinatario || {};
  const ambiente = String(cfg.ambiente || "homologacao");
  const missing = [];
  for (const [label, value] of [
    ["CNPJ do emitente", emit.CNPJ], ["IE do emitente", emit.INSCEST],
    ["municipio IBGE do emitente", emit.IDMUNICIPIO], ["CPF/CNPJ do cliente", dest.CGC],
    ["municipio IBGE do cliente", dest.CDMUNICIPIO],
  ]) {
    if (!onlyDigits(value)) missing.push(label);
  }
  itens.forEach((item, index) => {
    if (onlyDigits(item.NCM).length !== 8) missing.push(`NCM do item ${index + 1} (${item.CDPRODUTO})`);
    if (onlyDigits(item.CFOP).length !== 4) missing.push(`CFOP do item ${index + 1} (${item.CDPRODUTO})`);
  });
  if (missing.length) throw new Error("Dados fiscais obrigatorios ausentes: " + missing.join(", "));

  const ufEmit = String(emit.UF || "").toUpperCase();
  const ufDest = String(dest.UF || "").toUpperCase();
  let dh = nota.DTEMISS instanceof Date ? nota.DTEMISS.toISOString() : String(nota.DTEMISS || new Date().toISOString()).replace(" ", "T");
  if (dh.length === 10) dh += "T12:00:00";
  dh = dh.slice(0, 19) + "-03:00";
  const crt = Number(emit.SIMPLES || 0) !== 0 ? 1 : Number(cfg.crt || 3);

  const detalhes = [];
  let totalProd = 0, totalBc = 0, totalIcms = 0, totalPis = 0, totalCofins = 0;
  itens.forEach((item, idx) => {
    const pos = idx + 1;
    const qtd = Number(item.QTDPRODUTO || 0);
    const unit = Number(item.VLUNIT || 0);
    const value = round2(item.TOTAL || qtd * unit);
    totalProd += value;
    const pIcms = Number(item.PICMS || item.ICMS || 0);
    const vBc = value;
    const vIcms = round2(vBc * pIcms / 100);
    const pPis = Number(item.PPIS || 0);
    const pCofins = Number(item.PCOFINS || 0);
    const vPis = round2(value * pPis / 100);
    const vCofins = round2(value * pCofins / 100);
    totalBc += vBc; totalIcms += vIcms; totalPis += vPis; totalCofins += vCofins;
    const icms = [1, 2, 4].includes(crt)
      ? { ICMSSN102: { orig: Number(item.ORIG || 0), CSOSN: String(item.CSOSN || "102") } }
      : { ICMS00: { orig: Number(item.ORIG || 0), CST: String(item.CST || "00").padStart(2, "0"),
          modBC: Number(item.MODBC || 3), vBC: vBc, pICMS: pIcms, vICMS: vIcms } };
    detalhes.push({
      nItem: pos,
      prod: { cProd: String(item.CDPRODUTO), cEAN: "SEM GTIN", xProd: String(item.DESCRICAO || "").slice(0, 120),
        NCM: onlyDigits(item.NCM), CFOP: onlyDigits(item.CFOP), uCom: String(item.UNID || "UN"), qCom: qtd,
        vUnCom: unit, vProd: value, cEANTrib: "SEM GTIN", uTrib: String(item.UNID || "UN"), qTrib: qtd,
        vUnTrib: unit, indTot: 1 },
      imposto: {
        ICMS: icms,
        PIS: { PISAliq: { CST: "01", vBC: value, pPIS: pPis, vPIS: vPis } },
        COFINS: { COFINSAliq: { CST: "01", vBC: value, pCOFINS: pCofins, vCOFINS: vCofins } },
      },
    });
  });
  const doc = onlyDigits(dest.CGC);
  const enderDest = { xLgr: dest.ENDERECO, nro: String(dest.NUMERO || "S/N"), xBairro: dest.BAIRRO,
    cMun: onlyDigits(dest.CDMUNICIPIO), xMun: String(dest.MUNICIPIO || "NAO INFORMADO"), UF: ufDest,
    CEP: onlyDigits(dest.CEP), cPais: "1058", xPais: "BRASIL" };
  const destObj = { xNome: dest.RAZAO || dest.CLIENTE, enderDest, indIEDest: dest.INSCEST ? 1 : 9 };
  destObj[doc.length === 14 ? "CNPJ" : "CPF"] = doc;
  if (dest.INSCEST) destObj.IE = onlyDigits(dest.INSCEST);

  const inf = {
    versao: "4.00",
    ide: { cUF: UF_CODES[ufEmit], cNF: String(nota.CNF || nota.IDNF).slice(-8).padStart(8, "0"),
      natOp: String(cfg.natureza_operacao || "VENDA DE MERCADORIA"), mod: 55, serie: Number(nota.SERIE_NFE || 1),
      nNF: Number(onlyDigits(nota.NRDOC)), dhEmi: dh, dhSaiEnt: dh, tpNF: 1,
      idDest: ufEmit === ufDest ? 1 : 2, cMunFG: onlyDigits(emit.IDMUNICIPIO), tpImp: 1, tpEmis: 1,
      tpAmb: ambiente === "homologacao" ? 2 : 1, finNFe: 1, indFinal: 1, indPres: Number(nota.INDPRES || 1),
      procEmi: 0, verProc: "Dashboard 1.0" },
    emit: { CNPJ: onlyDigits(emit.CNPJ), xNome: emit.NOMEEMPRESA, IE: onlyDigits(emit.INSCEST), CRT: crt,
      enderEmit: { xLgr: emit.ENDERECO, nro: String(emit.NUMERO || "S/N"), xBairro: emit.BAIRRO,
        cMun: onlyDigits(emit.IDMUNICIPIO), xMun: String(emit.MUNICIPIO || "NAO INFORMADO"), UF: ufEmit,
        CEP: onlyDigits(emit.CEP), cPais: "1058", xPais: "BRASIL" } },
    dest: destObj, det: detalhes,
    total: { ICMSTot: { vBC: round2(totalBc), vICMS: round2(totalIcms), vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0,
      vFCPST: 0, vFCPSTRet: 0, vProd: round2(totalProd), vFrete: 0, vSeg: 0, vDesc: 0, vII: 0, vIPI: 0,
      vIPIDevol: 0, vPIS: round2(totalPis), vCOFINS: round2(totalCofins), vOutro: 0,
      vNF: round2(nota.VLTOTAL || totalProd) } },
    transp: { modFrete: 9 },
    pag: { detPag: [{ indPag: 0, tPag: String(cfg.meio_pagamento || "01"), vPag: round2(nota.VLTOTAL || totalProd) }] },
    infAdic: { infCpl: String(nota.OBSERVACAO || "").slice(0, 5000) },
  };
  return { ambiente, referencia: `dashboard-${nota.IDEMPRESA}-${nota.IDNF}`, infNFe: inf };
}

async function postNuvemFiscal(acao, payload, cfg) {
  const token = await nuvemToken(cfg);
  const base = String(cfg.base_url || "https://api.nuvemfiscal.com.br").replace(/\/+$/, "");
  let body, urlPath;
  if (acao === "emitir") {
    body = nuvemPayloadEmissao(payload, cfg);
    urlPath = "/nfe";
  } else if (acao === "inutilizar") {
    body = { ...payload, ambiente: cfg.ambiente || "homologacao", cnpj: onlyDigits(cfg.cnpj) };
    delete body.idempresa; delete body.modelo;
    urlPath = "/nfe/inutilizacoes";
  } else if (acao === "consultar") {
    throw new Error("Consulta de NF-e ainda nao implementada para o provider nuvem_fiscal.");
  } else {
    let remoteId = payload.remote_id;
    if (!remoteId) {
      const query = new URLSearchParams({
        $top: "1", cpf_cnpj: onlyDigits(cfg.cnpj), ambiente: cfg.ambiente || "homologacao",
        chave: onlyDigits(payload.chave),
      });
      const lookup = await fetch(`${base}/nfe?${query}`, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      });
      const found = await lookup.json();
      const records = found.data || found.items || found.value || [];
      remoteId = records[0]?.id || null;
    }
    if (!remoteId) throw new Error("Nota nao localizada na Nuvem Fiscal pela chave de acesso.");
    urlPath = `/nfe/${remoteId}/${acao === "cancelar" ? "cancelamento" : "carta-correcao"}`;
    body = acao === "cancelar" ? { justificativa: payload.justificativa } : { correcao: payload.correcao };
  }
  let res;
  try {
    res = await fetch(base + urlPath, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error("Nao foi possivel acessar a Nuvem Fiscal: " + error.message);
  }
  const raw = await res.text();
  if (!res.ok) throw new Error(`Nuvem Fiscal HTTP ${res.status}: ${raw.slice(0, 2000)}`);
  let result = raw ? JSON.parse(raw) : {};
  if (acao === "emitir" && result.id && result.status === "pendente") {
    const attempts = Number(cfg.poll_attempts || 15);
    const intervalMs = Number(cfg.poll_interval_seconds || 2) * 1000;
    for (let i = 0; i < attempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      const check = await fetch(`${base}/nfe/${result.id}`, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      });
      result = await check.json();
      if (result.status !== "pendente") break;
    }
  }
  const auth = result.autorizacao || {};
  result.cStat = auth.codigo_status || result.codigo_status;
  result.xMotivo = auth.motivo_status || result.motivo_status || result.status;
  result.chNFe = result.chave || result.chave_acesso;
  result.nProt = auth.numero_protocolo || result.numero_protocolo;
  result._remote_id = result.id;
  return result;
}

// ---- Persistencia (NOTAFISCAL / NOTAFIS_PRODUTO / NFE) ----

export async function carregarNota(tx, idnf, idempresa) {
  let where = "IDNF = ?";
  const params = [Number(idnf)];
  if (idempresa !== undefined && idempresa !== null && idempresa !== "") {
    where += " AND IDEMPRESA = ?";
    params.push(Number(idempresa));
  }
  const notas = await tx.query(`SELECT FIRST 1 * FROM NOTAFISCAL WHERE ${where}`, params);
  const nota = notas[0];
  if (!nota) throw new HttpError("Nota fiscal nao encontrada.", 404);
  const itens = await tx.query(
    "SELECT * FROM NOTAFIS_PRODUTO WHERE IDNF = ? AND IDEMPRESA = ? ORDER BY POSIC",
    [Number(nota.IDNF), Number(nota.IDEMPRESA)]
  );
  return { nota, itens };
}

// Busca o protocolo da SEFAZ na tabela NFE (XML autorizado), ligada por CHAVE.
// NOTAFISCAL nao tem coluna NPROT/CSTAT.
export async function protocoloAutorizado(tx, chave) {
  chave = String(chave || "").trim();
  if (!chave) return null;
  const row = await tx.singleton("SELECT FIRST 1 TRIM(NPROT) AS NPROT FROM NFE WHERE CHAVE = ?", [chave]);
  return row?.NPROT || null;
}

async function updateExisting(tx, table, whereSql, whereValues, values) {
  const cols = await tx.query(
    "SELECT TRIM(RDB$FIELD_NAME) AS COL FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME) = ?",
    [table.toUpperCase()]
  );
  const columns = new Set(cols.map(r => String(r.COL).trim().toUpperCase()));
  const usable = Object.entries(values).filter(([k]) => columns.has(k.toUpperCase()));
  if (!usable.length) return;
  const setSql = usable.map(([k]) => `${k} = ?`).join(", ");
  const params = [...usable.map(([, v]) => v), ...whereValues];
  await tx.execute(`UPDATE ${table} SET ${setSql} WHERE ${whereSql}`, params);
}

function resolverCaminhoFiscal(value) {
  const raw = String(value || "").trim();
  if (raw && isDir(raw)) return raw;
  const normalized = raw.replace(/\//g, "\\");
  const parts = normalized.split("\\").filter(Boolean);
  if (normalized.startsWith("\\\\") && parts.length >= 3) {
    const local = path.join("C:\\", ...parts.slice(1));
    if (isDir(local)) return local;
  }
  throw new HttpError("Caminho fiscal configurado nao encontrado: " + raw, 404);
}

function arquivarDocumentosFiscais(nota, configuracao, xmlPath, pdfPath) {
  const isCfe = Number(nota.NFCE || 0) !== 0;
  const base = resolverCaminhoFiscal(isCfe ? configuracao.CAMINHOCFE : configuracao.CAMINHONFE);
  let dt = nota.DTEMISS instanceof Date ? nota.DTEMISS : new Date(nota.DTEMISS);
  if (Number.isNaN(dt.getTime())) dt = new Date();
  const periodo = `${dt.getMonth() + 1}_${dt.getFullYear()}`;
  const producao = path.join(base, "Producao");
  const procDir = path.join(producao, isCfe ? "procCFe" : "procNFe", periodo);
  const retornoDir = path.join(producao, isCfe ? "RETCFE" : "RETNFE", periodo);
  fs.mkdirSync(procDir, { recursive: true });
  fs.mkdirSync(retornoDir, { recursive: true });
  const xmlName = path.basename(xmlPath);
  const xmlExt = path.extname(xmlPath);
  const xmlProc = path.join(procDir, xmlName);
  const xmlRetorno = path.join(retornoDir, xmlName);
  const pdfRetorno = path.join(retornoDir, path.basename(xmlPath, xmlExt) + ".pdf");
  if (path.resolve(xmlPath) !== path.resolve(xmlProc)) fs.copyFileSync(xmlPath, xmlProc);
  if (path.resolve(xmlPath) !== path.resolve(xmlRetorno)) fs.copyFileSync(xmlPath, xmlRetorno);
  if (path.resolve(pdfPath) !== path.resolve(pdfRetorno)) fs.copyFileSync(pdfPath, pdfRetorno);
  return { xml: xmlProc, xml_retorno: xmlRetorno, pdf: pdfRetorno };
}

// O AutoMec grava NOTAFISCAL.CAMINHO apontando para o PDF em retNFe.
// As operacoes do gateway, porem, precisam do XML autorizado. Aceita os dois
// formatos para manter compatibilidade com registros antigos e novos.
export function resolverXmlAutorizado(nota) {
  const armazenado = String(nota?.CAMINHO || "").trim();
  const candidatos = [];
  if (armazenado) candidatos.push(armazenado);
  if (/\.pdf$/i.test(armazenado)) {
    candidatos.unshift(
      armazenado.replace(/retNFe/ig, "procNFe").replace(/\.pdf$/i, ".xml"),
      armazenado.replace(/\.pdf$/i, ".xml")
    );
  } else if (/\.xml$/i.test(armazenado) && /retNFe/i.test(armazenado)) {
    candidatos.unshift(armazenado.replace(/retNFe/ig, "procNFe"));
  }
  const encontrado = candidatos.find(caminho => caminho && isFile(caminho));
  if (!encontrado) throw new HttpError("XML autorizado da NF-e nao encontrado.", 404);
  return encontrado;
}

// Gera o DANFE usando apenas o XML autorizado, sem retransmitir a NF-e.
export async function gerarPdfNfe(nota, cfg) {
  const xmlPath = resolverXmlAutorizado(nota);
  const result = await postGateway("pdf", { xml_path: xmlPath, protocolo: nota.NPROT || "" }, cfg);
  const pdfPath = String(result.arquivo || "").trim();
  if (!pdfPath || !isFile(pdfPath)) throw new HttpError("O ACBr nao gerou o PDF da NF-e.", 500);
  return pdfPath;
}

export function arquivarPdf(nota, configuracao, xmlPath, pdfPath) {
  return arquivarDocumentosFiscais(nota, configuracao, xmlPath, pdfPath);
}

// Emite uma NF-e ja gravada em NOTAFISCAL: resolve tributacao, chama o
// gateway, grava CHAVE/NPROT/CSTAT e gera/arquiva o DANFE.
export async function emitirNfePorId(idnf, idempresa) {
  const cfg = loadConfig();
  return withWriteTransaction(async tx => {
    const { nota, itens } = await carregarNota(tx, idnf, idempresa);
    if (Number(nota.NFE_EMITIDA || 0) !== 0 && nota.CHAVE) {
      return { ok: true, ja_emitida: true, idnf: Number(idnf), chave: nota.CHAVE };
    }
    const emitente = (await tx.query("SELECT FIRST 1 * FROM CONFIGURACAO WHERE IDEMPRESA = ?", [Number(nota.IDEMPRESA)]))[0] || {};
    const destinatario = (await tx.query("SELECT FIRST 1 * FROM CLIENTE WHERE CDCLIENTE = ?", [Number(nota.CDCLIENTE)]))[0] || {};
    const ufEmit = String(emitente.UF || "").toUpperCase();
    const ufDest = String(destinatario.UF || "").toUpperCase();

    // A tributacao do ERP nasce em PRODUTO.IDIMPOSTO_VENDA -> IMPOSTO.
    // CLASSFISCAL e o NCM; o CFOP depende de operacao interna/interestadual.
    const pendentesReforma = [];
    for (const item of itens) {
      const taxRows = await tx.query(
        "SELECT FIRST 1 p.CLASSFISCAL, p.ORIGEM, p.SITTRIBUT," +
        " i.CST, i.CSOSN, i.CFOP_EST, i.CFOP_INT," +
        " i.MODBC, i.MODBCST, i.REDUZ_BASE," +
        " i.TIPOPIS, i.ALIQPIS, i.TIPOCOFI, i.ALIQCOFI," +
        " i.CST_REFORMA, i.CCLASSTRIB, i.ALIQCBS" +
        " FROM PRODUTO p LEFT JOIN IMPOSTO i ON i.IDIMPOSTO = p.IDIMPOSTO_VENDA" +
        " WHERE p.CDPRODUTO = ?",
        [item.CDPRODUTO]
      );
      const rule = taxRows[0];
      if (rule) {
        item.NCM = item.NCM || rule.CLASSFISCAL;
        item.ORIG = item.ORIG !== undefined && item.ORIG !== null ? item.ORIG : rule.ORIGEM;
        item.CST = rule.CST || "00";
        item.CSOSN = rule.CSOSN;
        item.CFOP = item.CFOP || (ufEmit === ufDest ? rule.CFOP_EST : rule.CFOP_INT);
        item.MODBC = rule.MODBC;
        item.PICMS = item.PICMS || emitente.PERCICMS || emitente.ICMS;
        item.PPIS = rule.ALIQPIS || 0;
        item.PCOFINS = rule.ALIQCOFI || 0;
        if (rule.CST_REFORMA && rule.CCLASSTRIB) {
          const base = Number(item.TOTAL || 0);
          item.CST_IBSCBS = rule.CST_REFORMA;
          item.CCLASSTRIB = rule.CCLASSTRIB;
          item.VBC_IBSCBS = base;
          item.PIBSUF = Number(cfg.aliq_ibs_uf || 0.1);
          item.VIBSUF = round2(base * item.PIBSUF / 100);
          item.PIBSMUN = Number(cfg.aliq_ibs_mun || 0);
          item.VIBSMUN = round2(base * item.PIBSMUN / 100);
          item.PCBS = rule.ALIQCBS || 0.9;
          item.VCBS = round2(base * Number(item.PCBS) / 100);
        } else {
          pendentesReforma.push(`${item.CDPRODUTO} - ${item.DESCRICAO || ""}`.trim());
        }
      } else {
        if (!item.NCM) {
          const prodRows = await tx.query("SELECT FIRST 1 CLASSFISCAL FROM PRODUTO WHERE CDPRODUTO = ?", [item.CDPRODUTO]);
          item.NCM = prodRows[0]?.CLASSFISCAL ?? null;
        }
        pendentesReforma.push(`${item.CDPRODUTO} - ${item.DESCRICAO || ""}`.trim());
      }
    }

    // A partir de 03/08/2026 a SEFAZ rejeita NF-e do regime normal (CRT 3)
    // sem os grupos IBS/CBS (NT 2025.002-RTC). Bloqueia aqui com uma
    // mensagem acionavel em vez de deixar a rejeicao acontecer la na frente.
    const crt = Number(cfg.crt || 3);
    const limiteReforma = new Date(cfg.reforma_obrigatoria_desde || "2026-08-03T00:00:00-03:00");
    if (crt === 3 && pendentesReforma.length && new Date() >= limiteReforma) {
      throw new HttpError(
        "Reforma tributaria: os seguintes produtos nao tem CST_REFORMA/CCLASSTRIB cadastrados na tabela " +
        "IMPOSTO e a NF-e sera rejeitada pela SEFAZ sem eles: " + pendentesReforma.join("; ") +
        ". Cadastre a tributacao da reforma antes de emitir.",
        422
      );
    }
    // IDs de municipio sao internos; a NF-e exige o codigo IBGE.
    for (const [record, key] of [[emitente, "IDMUNICIPIO"], [destinatario, "CDMUNICIPIO"]]) {
      const cityRows = await tx.query(
        "SELECT FIRST 1 CDMUNICIPIOIBGE, MUNICIPIO, UF FROM MUNICIPIO WHERE CDMUNICIPIO = ?",
        [record[key]]
      );
      const city = cityRows[0];
      if (city) { record[key] = city.CDMUNICIPIOIBGE; record.MUNICIPIO = city.MUNICIPIO; record.UF = city.UF; }
    }

    const result = await postGateway("emitir", { nota, itens, emitente, destinatario }, cfg);
    const status = cstat(result);
    if (!AUTORIZADA.has(status)) {
      const motivo = pick(result, "xMotivo", "motivo", "message");
      throw new Error(
        `NF-e rejeitada pela SEFAZ${status !== null ? ` (cStat ${status})` : ""}${motivo ? `: ${motivo}` : "."}`
      );
    }
    const chave = String(pick(result, "chNFe", "chave", "access_key") || "").replace("NFe", "");
    const protocolo = pick(result, "nProt", "protocolo", "protocol");
    await updateExisting(tx, "NOTAFISCAL", "IDNF = ? AND IDEMPRESA = ?", [Number(nota.IDNF), Number(nota.IDEMPRESA)], {
      NFE_EMITIDA: -1, STATUS: 0, CHAVE: chave || null,
      NPROT: protocolo, CSTAT: status, XML_NFE: pick(result, "xml", "xmlNFe"),
      CAMINHO: pick(result, "arquivo", "nomearquivo", "path"),
      DTALTER: new Date(), SIST_ALT: "DASHBRD",
    });

    let pdfErro = null;
    try {
      const notaPdf = { ...nota, CAMINHO: pick(result, "arquivo", "nomearquivo", "path"), NPROT: protocolo };
      const pdfPath = await gerarPdfNfe(notaPdf, cfg);
      const arquivos = arquivarDocumentosFiscais(notaPdf, emitente, notaPdf.CAMINHO, pdfPath);
      await updateExisting(tx, "NOTAFISCAL", "IDNF = ? AND IDEMPRESA = ?", [Number(nota.IDNF), Number(nota.IDEMPRESA)], {
        CAMINHO: arquivos.pdf,
      });
    } catch (error) {
      pdfErro = error.message;
    }

    return {
      ok: true, idnf: Number(nota.IDNF), cStat: status, chave, protocolo,
      motivo: pick(result, "xMotivo", "motivo", "message"),
      pdf_url: `/api/fiscal/nfe/${Number(nota.IDNF)}/pdf?idempresa=${Number(nota.IDEMPRESA)}`,
      pdf_erro: pdfErro,
    };
  });
}

export { pick, cstat, updateExisting, resolverCaminhoFiscal };
