import crypto from "node:crypto";
import { query, withDatabase } from "./db.js";
import { decodeBytes, exigirPrazo } from "./lib/prazo-acesso.js";

// O desktop (miStr.Code/Decode) e a forma correta de gravar SENHA em USUARIOS.
// As chaves XOR abaixo so existem para cadastros antigos/testes que nao passaram
// pelo Code do Automec; a senha "2907" coincidia com o XOR e mascarava o bug
// para alguns usuarios, enquanto logins com senha numerica tipica (123, 1234)
// falhavam no Dashboard.
const keys = [
  Buffer.from([0xc4, 0x3a, 0x1b]),
  Buffer.from([0x4e]),
  Buffer.from([0xdc, 0x63, 0x33, 0x5f, 0x4b, 0x32, 0x7f, 0x85]),
];
const menuIds = Array.from({ length: 18 }, (_, index) => 9000 + index);

// Qualquer usuario ativo do ERP entra no Dashboard; nao exige linha em
// SIS_OPERACAOUSUARIO / APPID do Automec.
export function userCanEnterDashboard({ inactive = 0 } = {}) {
  return Number(inactive || 0) !== 1;
}

function asText(value) {
  return String(value ?? "");
}

function storedPassword(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(asText(value), "latin1");
}

function encoded(password, key) {
  const input = Buffer.from(asText(password), "latin1");
  return Buffer.from(input.map((byte, index) => byte ^ key[index % key.length]));
}

function xorPasswordMatches(password, stored) {
  return keys.some(key => {
    const candidate = encoded(password, key);
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  });
}

export function passwordMatches(password, stored) {
  const typed = asText(password);
  const bytes = storedPassword(stored);
  if (!bytes.length) return typed === "";
  // Mesmo criterio do Automec desktop: Decode(SENHA) = senha digitada.
  if (decodeBytes(bytes) === typed) return true;
  return xorPasswordMatches(typed, bytes);
}

export async function debugLogin(login, password = "") {
  const normalized = asText(login).trim();
  if (!normalized) throw Object.assign(new Error("Informe login."), { status: 400 });
  return withDatabase(async db => {
    const row = (await query(db, `SELECT FIRST 1 IDUSUARIO,LOGIN,NOMECOMPLETO,SENHA,INATIVO
      FROM USUARIOS WHERE UPPER(TRIM(LOGIN))=UPPER(TRIM(?))`, [normalized]))[0];
    if (!row) return { ok:true, found:false };
    const stored = storedPassword(row.SENHA);
    const match = password !== "" && password != null ? passwordMatches(password, stored) : false;
    return { ok:true,found:true,idusuario:Number(row.IDUSUARIO),login:asText(row.LOGIN).trim(),
      nome:asText(row.NOMECOMPLETO).trim(),inativo:Number(row.INATIVO||0),
      senha_cadastrada:Boolean(stored.length),senha_tamanho:stored.length,
      senha_confere:match,
      tem_permissao_dashboard:userCanEnterDashboard({ inactive:row.INATIVO }) };
  });
}

export async function authenticate(login, password) {
  const loginName = asText(login).trim();
  const senha = asText(password);
  if (!loginName || !senha) throw new Error("Informe login e senha.");
  return withDatabase(async db => {
    const users = await query(db, `
      SELECT FIRST 1 IDUSUARIO, LOGIN, NOMECOMPLETO, SENHA, INATIVO
      FROM USUARIOS WHERE UPPER(TRIM(LOGIN)) = UPPER(TRIM(?))
    `, [loginName]);
    const row = users[0];
    if (!row || !userCanEnterDashboard({ inactive: row.INATIVO }))
      throw new Error("Usuario ou senha invalido.");
    if (!passwordMatches(senha, row.SENHA)) throw new Error("Usuario ou senha invalido.");
    return {
      idusuario: Number(row.IDUSUARIO),
      login: asText(row.LOGIN).trim(),
      nome: asText(row.NOMECOMPLETO || row.LOGIN).trim(),
      permissao_gerencial: true,
      idmenuitems: menuIds,
      menus: []
    };
  }).then(async (usuario) => {
    await exigirPrazo();
    return usuario;
  });
}
