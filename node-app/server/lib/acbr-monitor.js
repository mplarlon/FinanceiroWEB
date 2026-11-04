// Cliente local do ACBrMonitorPLUS para NF-e, porta do acbr_monitor.py.
// Fala com o ACBrMonitor por um socket TCP simples (texto + terminador ETX 0x03),
// sem depender da UI do ERP.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function safe(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r/g, " ").replace(/\n/g, " ").trim();
}

function roundHalfUp(value, places) {
  const n = Number(value || 0);
  const factor = 10 ** places;
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * factor + 1e-9)) / factor;
}

function moneyStr(value) {
  return roundHalfUp(value, 2).toFixed(2);
}

function numberStr(value, places = 4) {
  return roundHalfUp(value, places).toFixed(places);
}

function textoLivre(value) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Buffer.isBuffer(value)) return value.toString("latin1").replace(/\s+/g, " ").trim();
  return "";
}

// Venda e devolução do mesmo produto, no mesmo preço, viram uma linha só.
// A NF-e recusa quantidade, vProd e vCBS negativos (o schema só aceita zero ou positivo).
export function consolidarItensNfe(itens) {
  const groups = new Map();
  const order = [];
  for (const item of itens || []) {
    const unitKey = roundHalfUp(Number(item.VLUNIT || 0), 4).toFixed(4);
    const key = [
      String(item.CDPRODUTO ?? "").trim(),
      unitKey,
      String(item.UNID || "UN").trim().toUpperCase(),
    ].join("\t");
    let group = groups.get(key);
    if (!group) {
      group = { ...item, QTDPRODUTO: 0, TOTAL: 0 };
      groups.set(key, group);
      order.push(group);
    }
    group.QTDPRODUTO = roundHalfUp(group.QTDPRODUTO + Number(item.QTDPRODUTO || 0), 4);
    group.TOTAL = roundHalfUp(group.TOTAL + Number(item.TOTAL || 0), 2);
  }
  return order.filter(item => Math.abs(item.QTDPRODUTO) >= 0.0001 || Math.abs(item.TOTAL) >= 0.01);
}

// Fórmula do MOC para CST 20/70: o ICMS que deixou de ser cobrado por causa da redução.
function icmsDesonerado(base, pIcms, pRedBC, cst) {
  const aliq = Number(pIcms || 0) / 100;
  const red = Number(pRedBC || 0) / 100;
  if (!(base > 0) || !(aliq > 0) || aliq >= 1) return 0;
  let valor = 0;
  if (cst === "20" || cst === "70") {
    valor = base * (1 - (aliq * (1 - red))) / (1 - aliq) - base;
  } else if (["30", "40", "41", "50", "51"].includes(cst)) {
    valor = (base / (1 - aliq)) * aliq;
  }
  return roundHalfUp(Math.max(0, valor), 2);
}

function unitarioCompativel(qty, unit, total) {
  if (!(qty > 0)) return unit;
  const esperado = roundHalfUp(qty * unit, 2);
  if (Math.abs(esperado - total) <= 0.01) return unit;
  return total / qty;
}

function ratearComTeto(bases, total, tetos) {
  const alvo = roundHalfUp(Math.max(0, total), 2);
  const partes = bases.map(() => 0);
  if (!bases.length || alvo <= 0) return partes;
  const soma = bases.reduce((acc, value) => acc + Math.max(0, value), 0);
  let restante = alvo;
  for (let i = 0; i < bases.length; i++) {
    const teto = tetos ? tetos[i] : Number.POSITIVE_INFINITY;
    const peso = Math.max(0, bases[i]);
    let parte = i === bases.length - 1 ? restante : (soma > 0 ? roundHalfUp(alvo * peso / soma, 2) : 0);
    parte = Math.min(Math.max(0, parte), restante, teto);
    partes[i] = roundHalfUp(parte, 2);
    restante = roundHalfUp(restante - partes[i], 2);
  }
  for (let i = 0; i < bases.length && restante > 0.001; i++) {
    const teto = tetos ? tetos[i] : Number.POSITIVE_INFINITY;
    const room = roundHalfUp(teto - partes[i], 2);
    if (room <= 0) continue;
    const add = Math.min(room, restante);
    partes[i] = roundHalfUp(partes[i] + add, 2);
    restante = roundHalfUp(restante - add, 2);
  }
  if (restante > 0.009) {
    throw new Error(`Nao foi possivel ratear ${moneyStr(alvo)} entre os itens da NF-e.`);
  }
  return partes;
}

// Fecha vNF = vProd - vDesc + vFrete + vOutro sem linha negativa.
export function prepararItensNfe(itens, nota) {
  const aproveitaveis = [];
  for (const bruto of consolidarItensNfe(itens)) {
    const item = { ...bruto };
    let total = roundHalfUp(item.TOTAL, 2);
    let qty = roundHalfUp(item.QTDPRODUTO, 4);
    if (total > 0 && qty <= 0) {
      qty = 1;
      item.VLUNIT = total;
    }
    if (qty <= 0 || total < 0) continue;
    item.QTDPRODUTO = qty;
    item.TOTAL = total;
    item.VLUNIT = unitarioCompativel(qty, Number(item.VLUNIT || 0), total);
    aproveitaveis.push(item);
  }
  if (!aproveitaveis.length) {
    throw new Error("A nota nao tem itens com quantidade e valor positivos para a NF-e.");
  }
  const vProd = roundHalfUp(aproveitaveis.reduce((acc, item) => acc + item.TOTAL, 0), 2);
  const freteNota = roundHalfUp(nota?.FRETE || 0, 2);
  const outrosNota = roundHalfUp(nota?.OUTROS || 0, 2);
  const vNF = roundHalfUp(nota?.VLTOTAL ?? vProd, 2);
  let vDesc = roundHalfUp(vProd + freteNota + outrosNota - vNF, 2);
  let vOutro = outrosNota;
  if (vDesc < -0.009) {
    vOutro = roundHalfUp(vOutro - vDesc, 2);
    vDesc = 0;
  }
  if (vDesc > vProd + 0.001) {
    throw new Error(
      `Nao foi possivel fechar o total da NF-e: produtos ${moneyStr(vProd)}, frete ${moneyStr(freteNota)}, outras ${moneyStr(outrosNota)}, total da nota ${moneyStr(vNF)}.`,
    );
  }
  vDesc = roundHalfUp(Math.max(0, vDesc), 2);
  const bases = aproveitaveis.map(item => item.TOTAL);
  const descontos = ratearComTeto(bases, vDesc, bases);
  const fretes = ratearComTeto(bases, freteNota);
  const outros = ratearComTeto(bases, vOutro);
  aproveitaveis.forEach((item, index) => {
    item.VDESC_NFE = descontos[index];
    item.VFRETE_NFE = fretes[index];
    item.VOUTRO_NFE = outros[index];
  });
  return { itens: aproveitaveis, vProd, vDesc, vFrete: freteNota, vOutro, vNF };
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function section(lines, name, values) {
  lines.push(`[${name}]`);
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") lines.push(`${key}=${safe(value)}`);
  }
  lines.push("");
}

const UF_CODES = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
  SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41,
  SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};

function fmtDateTime(d) {
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Monta o .ini que o comando NFE.CriarEnviarNFe do ACBrMonitor espera.
export function montarIniNfe(source, cfg) {
  const nota = source.nota, emit = source.emitente, dest = source.destinatario;
  const preparado = prepararItensNfe(source.itens, nota);
  const itens = preparado.itens;
  const ambiente = String(cfg.ambiente || "homologacao");
  const crt = Number(cfg.crt || 3);
  const ufEmit = String(emit.UF || "").toUpperCase();
  const ufDest = String(dest.UF || "").toUpperCase();

  const missing = [];
  for (const [label, value] of [
    ["CNPJ emitente", emit.CNPJ], ["IE emitente", emit.INSCEST],
    ["municipio IBGE emitente", emit.IDMUNICIPIO], ["CPF/CNPJ cliente", dest.CGC],
    ["municipio IBGE cliente", dest.CDMUNICIPIO],
  ]) {
    if (!digits(value)) missing.push(label);
  }
  itens.forEach((item, index) => {
    if (digits(item.NCM).length !== 8) missing.push(`NCM item ${index + 1} (${item.CDPRODUTO})`);
    if (digits(item.CFOP).length !== 4) missing.push(`CFOP item ${index + 1} (${item.CDPRODUTO})`);
  });
  if (missing.length) throw new Error("Dados fiscais obrigatorios ausentes: " + missing.join(", "));

  let dt = nota.DTEMISS instanceof Date ? nota.DTEMISS : new Date(nota.DTEMISS);
  if (Number.isNaN(dt?.getTime?.())) dt = new Date();

  const lines = [];
  section(lines, "infNFe", { versao: "4.00" });
  section(lines, "Identificacao", {
    cNF: String(nota.CNF || nota.IDNF).slice(-8).padStart(8, "0"),
    natOp: cfg.natureza_operacao || "VENDA DE MERCADORIA",
    mod: 55, serie: Number(nota.SERIE_NFE || 1),
    nNF: Number(digits(nota.NRDOC)), dhEmi: fmtDateTime(dt), dhSaiEnt: fmtDateTime(dt), tpNF: 1,
    idDest: ufEmit === ufDest ? 1 : 2,
    tpAmb: ambiente === "homologacao" ? 2 : 1, tpImp: 1,
    tpEmis: 1, finNFe: 1,
    indFinal: Number(nota.INDFINAL || 0) !== 0 ? 1 : 0,
    indPres: Number(nota.INDPRES || 1), procEmi: 0,
    cMunFG: digits(emit.IDMUNICIPIO), verProc: "Dashboard 1.0",
  });
  section(lines, "Emitente", {
    CRT: crt, CNPJCPF: digits(emit.CNPJ),
    xNome: emit.NOMEEMPRESA, IE: digits(emit.INSCEST),
    xLgr: emit.ENDERECO, nro: emit.NUMERO || "S/N",
    xBairro: emit.BAIRRO, cMun: digits(emit.IDMUNICIPIO),
    xMun: emit.MUNICIPIO, cUF: UF_CODES[ufEmit], UF: ufEmit,
    CEP: digits(emit.CEP), cPais: 1058, xPais: "BRASIL",
    Fone: digits(emit.TELEFONE),
  });
  section(lines, "Destinatario", {
    CNPJCPF: digits(dest.CGC), xNome: dest.RAZAO || dest.CLIENTE,
    indIEDest: dest.INSCEST ? 1 : 9,
    IE: dest.INSCEST ? digits(dest.INSCEST) : null,
    Email: dest.EMAILFISCAL || dest.EMAIL,
    xLgr: dest.ENDERECO, nro: dest.NUMERO || "S/N",
    xBairro: dest.BAIRRO, cMun: digits(dest.CDMUNICIPIO),
    xMun: dest.MUNICIPIO, UF: ufDest, CEP: digits(dest.CEP),
    cPais: 1058, xPais: "BRASIL", Fone: digits(dest.TELEFONE),
  });

  const totals = { bc: 0, icms: 0, icmsDeson: 0, pis: 0, cofins: 0, ibsuf: 0, ibsmun: 0, cbs: 0, bcIbs: 0 };
  itens.forEach((item, idx) => {
    const pos = idx + 1;
    const value = Number(item.TOTAL || 0);
    const vDesc = Number(item.VDESC_NFE || 0);
    const vFrete = Number(item.VFRETE_NFE || 0);
    const vOutro = Number(item.VOUTRO_NFE || 0);
    const base = roundHalfUp(Math.max(0, value - vDesc + vFrete + vOutro), 2);
    const pIcms = Number(item.PICMS || item.ICMS || 0);
    const cstIcms = String(item.CST || "00").padStart(2, "0");
    const icmsComBasePropria = crt === 3 && ["00", "10", "20", "51", "70", "90"].includes(cstIcms);
    const pRedBC = Number(item.PREDBC || 0);
    const reduzBase = icmsComBasePropria && pRedBC > 0;
    let baseIcms = base;
    if (reduzBase) {
      baseIcms = Number(item.TP_REDUC_BASE || 0) === 0
        ? roundHalfUp(base - (base * pRedBC / 100), 2)
        : (pIcms > 0 ? roundHalfUp(roundHalfUp(base * pRedBC / 100, 2) / (pIcms / 100), 2) : base);
    }
    const pPis = Number(item.PPIS || 0);
    const pCofins = Number(item.PCOFINS || 0);
    const vIcms = icmsComBasePropria ? roundHalfUp(baseIcms * pIcms / 100, 2) : 0;
    const vIcmsDeson = textoLivre(item.CBENEF) ? icmsDesonerado(base, pIcms, pRedBC, cstIcms) : 0;
    if (vIcmsDeson) totals.icmsDeson = roundHalfUp(totals.icmsDeson + vIcmsDeson, 2);
    const vPis = roundHalfUp(base * pPis / 100, 2);
    const vCofins = roundHalfUp(base * pCofins / 100, 2);
    if (icmsComBasePropria) {
      totals.bc = roundHalfUp(totals.bc + baseIcms, 2);
      totals.icms = roundHalfUp(totals.icms + vIcms, 2);
    }
    totals.pis = roundHalfUp(totals.pis + vPis, 2);
    totals.cofins = roundHalfUp(totals.cofins + vCofins, 2);

    const suffix = String(pos).padStart(3, "0");
    section(lines, "Produto" + suffix, {
      cProd: item.CDPRODUTO, cEAN: "SEM GTIN", cEANTrib: "SEM GTIN", xProd: item.DESCRICAO,
      NCM: digits(item.NCM), cBenef: textoLivre(item.CBENEF) || null, CFOP: digits(item.CFOP),
      uCom: item.UNID || "UN", qCom: numberStr(item.QTDPRODUTO),
      vUnCom: numberStr(item.VLUNIT, 6), vProd: moneyStr(value),
      uTrib: item.UNID || "UN", qTrib: numberStr(item.QTDPRODUTO),
      vUnTrib: numberStr(item.VLUNIT, 6),
      vFrete: vFrete ? moneyStr(vFrete) : null,
      vDesc: vDesc ? moneyStr(vDesc) : null,
      vOutro: vOutro ? moneyStr(vOutro) : null,
      indTot: 1,
    });
    section(lines, "ICMS" + suffix, {
      orig: Number(item.ORIG || 0),
      CSOSN: [1, 2, 4].includes(crt) ? String(item.CSOSN || "").padStart(3, "0") : null,
      CST: crt === 3 ? cstIcms : null,
      modBC: icmsComBasePropria ? Number(item.MODBC || 3) : null,
      pRedBC: reduzBase ? moneyStr(pRedBC) : null,
      vBC: icmsComBasePropria ? moneyStr(baseIcms) : null,
      pICMS: icmsComBasePropria ? moneyStr(pIcms) : null,
      vICMS: icmsComBasePropria ? moneyStr(vIcms) : null,
      vICMSDeson: vIcmsDeson ? moneyStr(vIcmsDeson) : null,
      motDesICMS: vIcmsDeson ? Number(item.MOTIV_DESON || 9) : null,
      indDeduzDeson: vIcmsDeson ? 0 : null,
      cBenef: textoLivre(item.CBENEF) || null,
    });
    section(lines, "PIS" + suffix, { CST: "01", vBC: moneyStr(base), pPIS: moneyStr(pPis), vPIS: moneyStr(vPis) });
    section(lines, "COFINS" + suffix, {
      CST: "01", vBC: moneyStr(base), pCOFINS: moneyStr(pCofins), vCOFINS: moneyStr(vCofins),
    });
    if (item.CST_IBSCBS && item.CCLASSTRIB) {
      const pIbsUf = Number(item.PIBSUF || 0);
      const pIbsMun = Number(item.PIBSMUN || 0);
      const pCbs = Number(item.PCBS || 0);
      const vIbsUf = roundHalfUp(base * pIbsUf / 100, 2);
      const vIbsMun = roundHalfUp(base * pIbsMun / 100, 2);
      const vCbs = roundHalfUp(base * pCbs / 100, 2);
      totals.ibsuf = roundHalfUp(totals.ibsuf + vIbsUf, 2);
      totals.ibsmun = roundHalfUp(totals.ibsmun + vIbsMun, 2);
      totals.cbs = roundHalfUp(totals.cbs + vCbs, 2);
      totals.bcIbs = roundHalfUp(totals.bcIbs + base, 2);
      section(lines, "IBSCBS" + suffix, { CST: item.CST_IBSCBS, cClassTrib: item.CCLASSTRIB });
      section(lines, "gIBSCBS" + suffix, {
        vBC: moneyStr(base),
        vIBS: moneyStr(vIbsUf + vIbsMun),
      });
      section(lines, "gIBSUF" + suffix, { pIBSUF: moneyStr(pIbsUf), vIBSUF: moneyStr(vIbsUf) });
      section(lines, "gIBSMun" + suffix, { pIBSMun: moneyStr(pIbsMun), vIBSMun: moneyStr(vIbsMun) });
      section(lines, "gCBS" + suffix, { pCBS: moneyStr(pCbs), vCBS: moneyStr(vCbs) });
    }
  });

  const vNF = preparado.vNF;
  section(lines, "Total", {
    vBC: moneyStr(totals.bc), vICMS: moneyStr(totals.icms), vICMSDeson: moneyStr(totals.icmsDeson),
    vBCST: "0.00", vST: "0.00", vProd: moneyStr(preparado.vProd),
    vFrete: moneyStr(preparado.vFrete), vSeg: "0.00", vDesc: moneyStr(preparado.vDesc), vII: "0.00",
    vIPI: "0.00", vPIS: moneyStr(totals.pis), vCOFINS: moneyStr(totals.cofins), vOutro: moneyStr(preparado.vOutro),
    vNF: moneyStr(vNF),
    vNFTot: moneyStr(vNF + totals.ibsuf + totals.ibsmun + totals.cbs),
  });
  if (totals.ibsuf || totals.ibsmun || totals.cbs) {
    section(lines, "IBSCBSTot", { vBCIBSCBS: moneyStr(totals.bcIbs) });
    section(lines, "gIBS", { vIBS: moneyStr(totals.ibsuf + totals.ibsmun), vCredPres: "0.00", vCredPresCondSus: "0.00" });
    section(lines, "gIBSUFTot", { vDif: "0.00", vDevTrib: "0.00", vIBSUF: moneyStr(totals.ibsuf) });
    section(lines, "gIBSMunTot", { vDif: "0.00", vDevTrib: "0.00", vIBSMun: moneyStr(totals.ibsmun) });
    section(lines, "gCBSTot", {
      vDif: "0.00", vDevTrib: "0.00", vCBS: moneyStr(totals.cbs), vCredPres: "0.00", vCredPresCondSus: "0.00",
    });
  }
  section(lines, "Transportador", { modFrete: Number(nota.TIPOFRETE || 9) });
  section(lines, "pag001", { tPag: cfg.meio_pagamento || "01", vPag: moneyStr(vNF) });
  section(lines, "DadosAdicionais", { infCpl: textoLivre(nota.OBSERVACAO).slice(0, 5000) });
  return lines.join("\r\n") + "\r\n";
}

// Envia um comando texto ao ACBrMonitor via TCP e devolve a resposta bruta
// (ate o primeiro ETX). Replica o protocolo de saudacao/terminador do
// ACBrMonitorPLUS: a saudacao inicial e delimitada por ETX (0x03), o comando
// e enviado terminado em CRLF + "." + CRLF, e a resposta tambem termina em ETX.
// Depois que a resposta comeca a chegar, um timeout curto (response_idle_seconds)
// e suficiente pra detectar o fim mesmo em versoes que nao mandem ETX.
export function acbrConnectionError(error, host, port) {
  const code = String(error?.code || "");
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "ETIMEDOUT"].includes(code)) {
    return new Error(
      `O ACBr Monitor não está em execução em ${host}:${port}. Abra o ACBrMonitorPLUS e tente novamente.`,
    );
  }
  return error;
}

export function sendCommand(cfg, command) {
  return new Promise((resolve, reject) => {
    const host = cfg.host || "127.0.0.1";
    const port = Number(cfg.port || 3434);
    const timeoutMs = Number(cfg.timeout_seconds || 60) * 1000;
    const idleMs = Number(cfg.response_idle_seconds || 1.0) * 1000;

    let phase = "connecting";
    let greeting = Buffer.alloc(0);
    const chunks = [];
    let settled = false;

    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    function finish(fn, arg) {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      fn(arg);
    }

    function respondWithChunks() {
      const full = Buffer.concat(chunks);
      const etxIndex = full.indexOf(0x03);
      const raw = (etxIndex >= 0 ? full.subarray(0, etxIndex) : full).toString("utf8").trim();
      if (/^ERRO/i.test(raw)) finish(reject, new Error(raw.slice(0, 2000)));
      else finish(resolve, raw);
    }

    socket.once("connect", () => {
      phase = "greeting";
      socket.setTimeout(idleMs);
    });
    socket.on("timeout", () => {
      if (phase === "connecting") finish(reject, new Error("Nao foi possivel conectar ao ACBrMonitor."));
      else if (phase === "greeting") finish(reject, new Error("ACBrMonitor nao respondeu a saudacao inicial."));
      else if (phase === "reading") {
        if (chunks.length) respondWithChunks();
        else finish(reject, new Error("ACBrMonitor nao respondeu ao comando."));
      }
    });
    socket.on("error", err => finish(reject, acbrConnectionError(err, host, port)));
    socket.on("close", () => {
      if (settled) return;
      if (phase === "greeting") finish(reject, new Error("ACBrMonitor encerrou a conexao na saudacao."));
      else if (chunks.length) respondWithChunks();
      else finish(reject, new Error("ACBrMonitor encerrou a conexao sem responder."));
    });
    socket.on("data", data => {
      if (phase === "greeting") {
        greeting = Buffer.concat([greeting, data]);
        if (greeting.includes(0x03)) {
          phase = "sending";
          socket.write(command.trimEnd() + "\r\n.\r\n", "utf8", () => {
            phase = "reading";
            socket.setTimeout(timeoutMs);
          });
        }
        return;
      }
      if (phase === "reading") {
        chunks.push(data);
        socket.setTimeout(idleMs);
        if (data.includes(0x03)) respondWithChunks();
      }
    });
  });
}

function parseResponse(response) {
  const result = { raw: response };
  const re = /^[ \t]*([A-Za-z][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*?)[ \t]*$/gim;
  let m;
  while ((m = re.exec(response))) result[m[1].toLowerCase()] = m[2].trim();
  const status = result.cstat;
  if (status && /^\d+$/.test(status)) result.cStat = Number(status);
  result.xMotivo = result.xmotivo || response.split(/\r?\n/)[0];
  result.chNFe = result.chave || result.chdfe || result.chnfe;
  result.nProt = result.nprot;
  result.arquivo = result.arquivo || result.nomearquivo || result.nomearq;
  if (!result.arquivo) {
    const ok = String(response || "").match(/^OK:\s*(.+\.xml)\s*$/im);
    if (ok) result.arquivo = ok[1].trim();
  }
  return result;
}

function statusFromXml(cfg) {
  const logsDir = cfg.acbr_logs_dir;
  if (!logsDir) return null;
  let entries;
  try {
    entries = fs.readdirSync(logsDir)
      .filter(f => f.endsWith("-sta.xml"))
      .map(f => ({ f, t: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch {
    return null;
  }
  if (!entries.length) return null;
  const xmlPath = path.join(logsDir, entries[0].f);
  const xml = fs.readFileSync(xmlPath, "utf8");
  const values = {};
  for (const tag of ["tpAmb", "verAplic", "cStat", "xMotivo", "cUF", "dhRecbto", "tMed"]) {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`));
    if (m) values[tag] = m[1].trim();
  }
  if (!values.cStat) return null;
  values.raw_xml = xmlPath;
  values.cStat = Number(values.cStat);
  values.xMotivo = values.xMotivo || "";
  return values;
}

// Executa uma acao fiscal (emitir/cancelar/inutilizar/carta-correcao/status/pdf/consultar)
// via ACBrMonitor. Espelha acbr_monitor.py:executar().
export async function executar(acao, payload, cfg) {
  const workDir = cfg.work_dir || path.join(os.tmpdir(), "dashboard-acbr");
  fs.mkdirSync(workDir, { recursive: true });

  let command;
  if (acao === "emitir") {
    const iniPath = path.join(workDir, `nfe-${payload.nota.IDEMPRESA}-${payload.nota.IDNF}.ini`);
    fs.writeFileSync(iniPath, montarIniNfe(payload, cfg), "utf8");
    command = `NFE.CriarEnviarNFe("${iniPath}",${Number(payload.nota.IDNF)},0,1)`;
  } else if (acao === "cancelar") {
    command = `NFE.CancelarNFe("${digits(payload.chave)}","${safe(payload.justificativa)}","${digits(cfg.cnpj)}",1)`;
  } else if (acao === "inutilizar") {
    command = `NFE.InutilizarNFe("${digits(cfg.cnpj)}","${safe(payload.justificativa)}",` +
      `${Number(payload.ano) % 100},55,${Number(payload.serie || 1)},` +
      `${Number(payload.numero_inicial)},${Number(payload.numero_final)})`;
  } else if (acao === "carta-correcao") {
    const iniPath = path.join(workDir, `cce-${digits(payload.chave)}-${payload.sequencia}.ini`);
    const content = "[EVENTO]\r\nidLote=1\r\n[EVENTO001]\r\n" +
      `cOrgao=33\r\nCNPJ=${digits(cfg.cnpj)}\r\nchNFe=${digits(payload.chave)}\r\n` +
      `dhEvento=${fmtDateTime(new Date())}\r\ntpEvento=110110\r\nnSeqEvento=${Number(payload.sequencia)}\r\n` +
      `versaoEvento=1.00\r\ndescEvento=Carta de Correcao\r\nxCorrecao=${safe(payload.correcao)}\r\n`;
    fs.writeFileSync(iniPath, content, "utf8");
    command = `NFE.EnviarEvento("${iniPath}")`;
  } else if (acao === "status") {
    command = "NFE.StatusServico";
  } else if (acao === "pdf") {
    const xmlPath = String(payload.xml_path || "").trim();
    if (!xmlPath || !isFile(xmlPath)) throw new Error("XML autorizado da NF-e nao encontrado.");
    command = `NFE.ImprimirDANFEPDF("${xmlPath}","${safe(payload.protocolo)}")`;
  } else if (acao === "consultar") {
    const xmlPath = String(payload.xml_path || "").trim();
    if (!xmlPath || !isFile(xmlPath)) throw new Error("XML autorizado da NF-e nao encontrado.");
    command = `NFE.ConsultarNFe("${xmlPath}")`;
  } else {
    throw new Error("Acao ACBr desconhecida: " + acao);
  }

  const response = await sendCommand(cfg, command);
  const result = parseResponse(response);
  if (acao === "pdf") {
    const m = response.match(/Arquivo criado em:\s*(.+?\.pdf)\s*$/im);
    if (!m) throw new Error("ACBr nao informou o caminho do PDF gerado.");
    result.arquivo = m[1].trim();
  }
  if (acao === "status" && result.cStat === 0) {
    const xmlStatus = statusFromXml(cfg);
    if (xmlStatus) Object.assign(result, xmlStatus);
  }
  return result;
}
