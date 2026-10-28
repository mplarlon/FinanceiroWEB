import crypto from "node:crypto";
import { query, withDatabase } from "./db.js";
import { exigirPrazo } from "./lib/prazo-acesso.js";

// O ERP legado gravou senhas com mais de uma chave ao longo do tempo. A
// primeira e a atual; as demais mantem compatibilidade com cadastros antigos
// sem exigir que a senha seja redefinida no banco.
const keys = [
  Buffer.from([0xc4, 0x3a, 0x1b]),
  Buffer.from([0x4e]),
  Buffer.from([0xdc, 0x63, 0x33, 0x5f, 0x4b, 0x32, 0x7f, 0x85]),
];
const menuIds = Array.from({ length: 18 }, (_, index) => 9000 + index);
const automecAppId = 1;

export function userCanEnterDashboard({ inactive = 0, hasAutomecPermission = false } = {}) {
  return Number(inactive || 0) !== 1 && Boolean(hasAutomecPermission);
}

function encoded(password, key) {
  const input = Buffer.from(password || "", "latin1");
  return Buffer.from(input.map((byte, index) => byte ^ key[index % key.length]));
}

export function passwordMatches(password, stored) {
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
    if (!row) return { ok:true, found:false };
    const stored = Buffer.isBuffer(row.SENHA) ? row.SENHA : Buffer.from(row.SENHA || "", "latin1");
    let match = false;
    if (password) for (const key of keys) {
      const candidate = encoded(password, key);
      if (candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored)) {
        match = true; break;
      }
    }
    const permission = await query(db, `SELECT FIRST 1 1 AS OK FROM SIS_OPERACAOUSUARIO
      WHERE IDUSUARIO=? AND APPID=?`, [row.IDUSUARIO, automecAppId]);
    const hasAutomecPermission = Boolean(permission.length);
    return { ok:true,found:true,idusuario:Number(row.IDUSUARIO),login:String(row.LOGIN||"").trim(),
      nome:String(row.NOMECOMPLETO||"").trim(),inativo:Number(row.INATIVO||0),
      senha_cadastrada:Boolean(stored.length),senha_tamanho:stored.length,
      senha_confere:match,tem_permissao_automec:hasAutomecPermission,
      tem_permissao_dashboard:userCanEnterDashboard({ inactive:row.INATIVO, hasAutomecPermission }) };
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
    const permission = await query(db, `
      SELECT FIRST 1 1 AS OK FROM SIS_OPERACAOUSUARIO
      WHERE IDUSUARIO = ? AND APPID = ?
    `, [row.IDUSUARIO, automecAppId]);
    if (!userCanEnterDashboard({ inactive: row.INATIVO, hasAutomecPermission: permission.length }))
      throw new Error("Usuario sem permissao para acessar o Dashboard.");
    return {
      idusuario: Number(row.IDUSUARIO),
      login: String(row.LOGIN || "").trim(),
      nome: String(row.NOMECOMPLETO || row.LOGIN || "").trim(),
      permissao_gerencial: true,
      idmenuitems: menuIds,
      menus: []
    };
  }).then(async (usuario) => {
    await exigirPrazo();
    return usuario;
  });
}
