import { withWriteTransaction } from "../db.js";

// Mesma trava do Automec (TDm.EstaNoPrazo): a empresa com PADRAO = -1
// guarda DATALIMITE cifrada por Code/Decode e EXPIRADO. 0 libera, -1 trava.
// A data é comparada com o dia local e o próprio dia do limite já não libera.
export const ACESSO_EXPIRADO = "O acesso a este sistema está expirado. Procure a Pontual Tecnologia.";

const CHAVES = [
  Buffer.from("bcbda1abbba6c1c2a2a5a4f0d0b6cacbc8dfd4d2f5d5b5fededadbd9fdddafb4b1bea7f7b8b0a861736c6b64666a67707177657274", "hex"),
  Buffer.from("d0abbba6b6a2a5a4f0cacbbdbca1c1c261736c6b6466c8dfd4d2f5d5b5fededadbd9bea7f7b8b0a8707177657274fdddafb4b16a67", "hex"),
  Buffer.from("f0cacbbdbcd0ab776572bba6b6a2a5dfd4d2f5a4a1c1c261736c6b6466c8b0a8afb4b16ad5b5fededadbd9bea7f7b867707174fddd", "hex"),
];

const DECODIFICADOR = new TextDecoder("windows-1252");
const MAPA_1252 = new Map();
for (let byte = 0; byte < 256; byte += 1) {
  MAPA_1252.set(DECODIFICADOR.decode(Uint8Array.of(byte)), byte);
}

let cache = null;
const CACHE_MS = 30_000;

export function codeBytes(texto) {
  const entrada = Buffer.from(String(texto ?? ""), "latin1");
  const tamanho = entrada.length;
  if (!tamanho) return Buffer.alloc(0);
  const invertido = Buffer.alloc(tamanho);
  for (let i = 0; i < tamanho - 1; i += 1) invertido[i] = entrada[i + 1];
  invertido[tamanho - 1] = entrada[0];
  const saida = Buffer.alloc(tamanho);
  let modo = 0;
  let posicao = 0;
  for (let i = 0; i < tamanho; i += 1) {
    let aux = CHAVES[modo][posicao] + invertido[i] + (i + 1);
    if (modo === 2) posicao += 1;
    if (posicao >= CHAVES[0].length) posicao = 0;
    modo += 1;
    if (modo > 2) modo = 0;
    if (aux > 255) aux -= 255;
    saida[i] = aux & 255;
  }
  return saida;
}

export function decodeBytes(cifrado) {
  const entrada = Buffer.isBuffer(cifrado) ? cifrado : Buffer.from(cifrado || []);
  const tamanho = entrada.length;
  if (!tamanho) return "";
  const claro = Buffer.alloc(tamanho);
  let modo = 0;
  let posicao = 0;
  for (let i = 0; i < tamanho; i += 1) {
    let aux = entrada[i] - CHAVES[modo][posicao] - (i + 1);
    if (modo === 2) posicao += 1;
    if (posicao >= CHAVES[0].length) posicao = 0;
    modo += 1;
    if (modo > 2) modo = 0;
    if (aux < 0) aux = 255 + aux;
    claro[i] = aux & 255;
  }
  return Buffer.concat([claro.subarray(tamanho - 1), claro.subarray(0, tamanho - 1)]).toString("latin1");
}

export function textoBanco(bytes) {
  return DECODIFICADOR.decode(bytes);
}

export function bytesBanco(valor) {
  if (valor == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(valor)) return valor;
  const texto = String(valor);
  if ([...texto].every((caractere) => caractere.codePointAt(0) <= 255)) return Buffer.from(texto, "latin1");
  return Buffer.from([...texto].map((caractere) => MAPA_1252.get(caractere) ?? 0x3f));
}

export function dataLocal(data = new Date()) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

export function formatarData(data) {
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getFullYear()}`;
}

export function parseData(texto) {
  const encontrado = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto || "").trim());
  if (!encontrado) return null;
  const data = new Date(Number(encontrado[3]), Number(encontrado[2]) - 1, Number(encontrado[1]));
  if (data.getFullYear() !== Number(encontrado[3]) || data.getMonth() !== Number(encontrado[2]) - 1 || data.getDate() !== Number(encontrado[1])) return null;
  return data;
}

function campoVazio(valor) {
  if (valor == null) return true;
  if (Buffer.isBuffer(valor)) return valor.length === 0 || valor.toString("latin1").trim() === "";
  return String(valor).trim() === "";
}

export function interpretarPrazo({ datalimite, expirado, hoje }) {
  const dia = dataLocal(hoje);
  if (campoVazio(datalimite)) {
    const nova = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 30);
    return { liberado: true, gravarData: formatarData(nova), marcarExpirado: false };
  }
  const data = parseData(decodeBytes(bytesBanco(datalimite)));
  const marcado = Number(expirado || 0);
  const liberado = marcado === 0 && data instanceof Date && data.getTime() > dia.getTime();
  return { liberado, gravarData: null, marcarExpirado: !liberado && marcado !== -1 };
}

export function limparCachePrazo() {
  cache = null;
}

function erroExpirado() {
  const erro = new Error(ACESSO_EXPIRADO);
  erro.expirado = true;
  erro.status = 401;
  return erro;
}

async function lerEmpresaPadrao(tx) {
  const rows = await tx.query(
    "SELECT FIRST 1 IDEMPRESA, DATALIMITE, EXPIRADO FROM CONFIGURACAO WHERE PADRAO = -1 ORDER BY IDEMPRESA",
  );
  return rows[0] || null;
}

export async function avaliarPrazo(tx, hoje = dataLocal()) {
  const empresa = await lerEmpresaPadrao(tx);
  if (!empresa) return { liberado: false, motivo: ACESSO_EXPIRADO };
  const decisao = interpretarPrazo({
    datalimite: empresa.DATALIMITE,
    expirado: empresa.EXPIRADO,
    hoje,
  });
  const id = Number(empresa.IDEMPRESA);
  if (decisao.gravarData) {
    await tx.execute(
      "UPDATE CONFIGURACAO SET DATALIMITE = ? WHERE IDEMPRESA = ?",
      [textoBanco(codeBytes(decisao.gravarData)), id],
    );
  }
  if (decisao.marcarExpirado) {
    await tx.execute(
      "UPDATE CONFIGURACAO SET EXPIRADO = -1 WHERE IDEMPRESA = ? AND COALESCE(EXPIRADO, 0) <> -1",
      [id],
    );
  }
  return { liberado: decisao.liberado, motivo: decisao.liberado ? "" : ACESSO_EXPIRADO };
}

export async function exigirPrazo(agora = new Date()) {
  const hoje = dataLocal(agora);
  const dia = formatarData(hoje);
  if (cache && cache.dia === dia && agora.getTime() - cache.at < CACHE_MS) {
    if (!cache.liberado) throw erroExpirado();
    return cache;
  }
  const estado = await withWriteTransaction((tx) => avaliarPrazo(tx, hoje));
  cache = { at: agora.getTime(), dia, liberado: estado.liberado };
  if (!estado.liberado) throw erroExpirado();
  return estado;
}
