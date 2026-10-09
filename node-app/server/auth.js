import crypto from "node:crypto";
import { query, withDatabase } from "./db.js";

const keys = [Buffer.from([0xc4, 0x3a, 0x1b]), Buffer.from([0x4e])];
const menuIds = Array.from({ length: 18 }, (_, index) => 9000 + index);

function encoded(password, key) {
  const input = Buffer.from(password || "", "latin1");
  return Buffer.from(input.map((byte, index) => byte ^ key[index % key.length]));
}

function passwordMatches(password, stored) {
  return keys.some(key => {
    const candidate = encoded(password, key);
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  });
}

export async function debugLogin(login, password = "") {
  const normalized = String(login || "").trim();
  if (!normalized) throw Object.assign(new Error("Informe login."), { status: 400 });
  return withDatabase(async db => {
    const row = (await query(db, `SELECT FIRST 1 IDUSUARIO,LOGIN,NOMECOMPLETO,SENHA,INATIVO
      FROM USUARIOS WHERE UPPER(TRIM(LOGIN))=UPPER(TRIM(?))`, [normalized]))[0];
    const accepted_keys = keys.map(key => [...key].map(byte => byte.toString(16).toUpperCase().padStart(2,"0")).join(" "));
    if (!row) return { ok:true, found:false, accepted_keys };
    const stored = Buffer.isBuffer(row.SENHA) ? row.SENHA : Buffer.from(row.SENHA || "", "latin1");
    let match = null;
    if (password) for (const key of keys) {
      const candidate = encoded(password, key);
      if (candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)) {
        match = [...key].map(byte => byte.toString(16).toUpperCase().padStart(2,"0")).join(" "); break;
      }
    }
    const placeholders = menuIds.map(() => "?").join(",");
    const permission = await query(db, `SELECT FIRST 1 1 AS OK FROM SIS_OPERACAOUSUARIO
      WHERE IDUSUARIO=? AND IDOPERACAO=900 AND APPID=1 AND IDMENUITEM IN (${placeholders})`,
      [row.IDUSUARIO,...menuIds]);
    return { ok:true,found:true,idusuario:Number(row.IDUSUARIO),login:String(row.LOGIN||"").trim(),
      nome:String(row.NOMECOMPLETO||"").trim(),inativo:Number(row.INATIVO||0),
      senha_cadastrada:Boolean(stored.length),senha_tamanho:stored.length,
      senha_hex:[...stored].map(byte=>byte.toString(16).toUpperCase().padStart(2,"0")).join(" "),
      senha_confere:Boolean(match),chave_confere:match,tem_permissao_dashboard:Boolean(permission.length),accepted_keys };
  });
}

export async function authenticate(login, password) {
  if (!String(login || "").trim() || !password) throw new Error("Informe login e senha.");
  return withDatabase(async db => {
    const users = await query(db, `
      SELECT FIRST 1 IDUSUARIO, LOGIN, NOMECOMPLETO, SENHA, INATIVO
      FROM USUARIOS WHERE UPPER(TRIM(LOGIN)) = UPPER(TRIM(?))
    `, [String(login).trim()]);
    const row = users[0];
    if (!row || Number(row.INATIVO || 0) === 1) throw new Error("Usuario ou senha invalido.");
    const stored = Buffer.isBuffer(row.SENHA) ? row.SENHA : Buffer.from(row.SENHA || "", "latin1");
    if (!passwordMatches(password, stored)) throw new Error("Usuario ou senha invalido.");
    const placeholders = menuIds.map(() => "?").join(",");
    const permission = await query(db, `
      SELECT FIRST 1 1 AS OK FROM SIS_OPERACAOUSUARIO
      WHERE IDUSUARIO = ? AND IDOPERACAO = 900 AND APPID = 1
      AND IDMENUITEM IN (${placeholders})
    `, [row.IDUSUARIO, ...menuIds]);
    if (!permission.length) throw new Error("Usuario sem permissao para acessar o Dashboard.");
    return {
      idusuario: Number(row.IDUSUARIO),
      login: String(row.LOGIN || "").trim(),
      nome: String(row.NOMECOMPLETO || row.LOGIN || "").trim(),
      permissao_gerencial: true,
      idmenuitems: menuIds,
      menus: []
    };
  });
}
