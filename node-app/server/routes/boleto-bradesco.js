import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import express from "express";
import { withWriteTransaction } from "../db.js";
import { readJsonConfig } from "../lib/json-config.js";

const router = express.Router();
const CONFIG_FILE = "boletos_bradesco_config.json";
const digits = value => String(value ?? "").replace(/\D/g, "");
const isoDate = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);

function publicConfig(cfg) {
  const required = ["token_url", "issue_url", "client_id", "client_secret", "agencia", "conta", "carteira"];
  const faltando = required.filter(key => !cfg[key]);
  return {
    banco: "Bradesco", codigo_banco: "237", ambiente: cfg.ambiente || "homologacao",
    agencia: cfg.agencia || "", conta: cfg.conta || "", carteira: cfg.carteira || "",
    homologado: Boolean(cfg.homologado), configurado: !faltando.length, faltando,
    tem_certificado: Boolean(cfg.cert_path && fs.existsSync(cfg.cert_path))
  };
}

async function ensureSchema(tx) {
  const tables = new Set((await tx.query(`
    SELECT TRIM(RDB$RELATION_NAME) AS NAME FROM RDB$RELATIONS
    WHERE RDB$RELATION_NAME IN ('DASH_BOLETO','DASH_BOLETO_EVENTO','DASH_BOLETO_ITEM')
  `)).map(row => row.NAME));
  const sequences = new Set((await tx.query(`
    SELECT TRIM(RDB$GENERATOR_NAME) AS NAME FROM RDB$GENERATORS
    WHERE RDB$GENERATOR_NAME='GEN_DASH_BOLETO'
  `)).map(row => row.NAME));
  if (!sequences.has("GEN_DASH_BOLETO")) await tx.execute("CREATE SEQUENCE GEN_DASH_BOLETO");
  if (!tables.has("DASH_BOLETO")) await tx.execute(`CREATE TABLE DASH_BOLETO (
    IDBOLETO BIGINT NOT NULL PRIMARY KEY, BANCO_CODIGO CHAR(3) NOT NULL,
    CONTROLE INTEGER NOT NULL, IDEMPRESA INTEGER NOT NULL, ID_EXTERNO VARCHAR(100),
    NOSSO_NUMERO VARCHAR(30), LINHA_DIGITAVEL VARCHAR(60), CODIGO_BARRAS VARCHAR(60),
    URL_BOLETO VARCHAR(500), STATUS VARCHAR(30) NOT NULL, VALOR NUMERIC(18,2) NOT NULL,
    VENCIMENTO DATE NOT NULL, PAYLOAD BLOB SUB_TYPE TEXT, RESPOSTA BLOB SUB_TYPE TEXT,
    CRIADO_EM TIMESTAMP NOT NULL, ATUALIZADO_EM TIMESTAMP NOT NULL, ERRO VARCHAR(1000))`);
  if (!tables.has("DASH_BOLETO_EVENTO")) await tx.execute(`CREATE TABLE DASH_BOLETO_EVENTO (
    IDBOLETO BIGINT NOT NULL, OCORREU_EM TIMESTAMP NOT NULL,
    TIPO VARCHAR(40) NOT NULL, CONTEUDO BLOB SUB_TYPE TEXT)`);
  if (!tables.has("DASH_BOLETO_ITEM")) await tx.execute(`CREATE TABLE DASH_BOLETO_ITEM (
    IDBOLETO BIGINT NOT NULL, CONTROLE INTEGER NOT NULL, IDEMPRESA INTEGER NOT NULL,
    VALOR NUMERIC(18,2) NOT NULL, PRIMARY KEY (IDBOLETO, CONTROLE, IDEMPRESA))`);
  const indexes = await tx.query(`SELECT TRIM(RDB$INDEX_NAME) AS NAME FROM RDB$INDICES
    WHERE RDB$INDEX_NAME='UX_DASH_BOLETO_TITULO'`);
  if (!indexes.length) await tx.execute(
    "CREATE UNIQUE INDEX UX_DASH_BOLETO_TITULO ON DASH_BOLETO (CONTROLE, IDEMPRESA)");
}

async function loadTitle(tx, controle, idempresa) {
  const row = await tx.singleton(`SELECT FIRST 1 t.CONTROLE, t.IDEMPRESA, t.CDCLIENTE AS CLIENTE_ID,
    COALESCE(c.RAZAO, c.CLIENTE) AS PAGADOR, c.CGC AS DOCUMENTO_PAGADOR, c.EMAIL,
    c.ENDERECO_COB AS ENDERECO_COBRANCA, c.ENDERECO, c.NUMERO,
    c.BAIRRO_COB AS BAIRRO_COBRANCA, c.BAIRRO, c.CEP_COB AS CEP_COBRANCA, c.CEP,
    c.UF_COB AS UF_COBRANCA, c.UF, CAST(t.DTVENC AS DATE) AS VENCIMENTO,
    COALESCE(t.DIVIDA, t.VALOR, 0) AS VALOR,
    COALESCE(t.NRDOC, t.NRDOC2, CAST(t.NRPEDIDO AS VARCHAR(30))) AS SEU_NUMERO,
    t.STATUS AS STATUS_TITULO, r.RECEBTO AS FORMA_VENDA
    FROM CTARECEBER t JOIN CLIENTE c ON c.CDCLIENTE=t.CDCLIENTE
    LEFT JOIN RECEBTO r ON r.CDRECEBTO=t.CODPAGTO
    WHERE t.CONTROLE=? AND t.IDEMPRESA=?`, [controle, idempresa]);
  if (!row) throw new Error("Titulo de contas a receber nao encontrado.");
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
}

function validateTitle(title) {
  const errors = [];
  if (![11, 14].includes(digits(title.documento_pagador).length)) errors.push("CPF/CNPJ do cliente");
  if (!String(title.pagador || "").trim()) errors.push("nome/razao social do cliente");
  if (!(title.endereco_cobranca || title.endereco)) errors.push("endereco de cobranca");
  if (digits(title.cep_cobranca || title.cep).length !== 8) errors.push("CEP de cobranca");
  if (String(title.uf_cobranca || title.uf || "").trim().length !== 2) errors.push("UF de cobranca");
  if (Number(title.valor || 0) <= 0) errors.push("valor positivo");
  if (Number(title.status_titulo || 0) !== 1) errors.push("titulo com status Aberto");
  if (!String(title.forma_venda || "").toUpperCase().includes("BOLETO")) errors.push("forma de venda Boleto");
  return errors;
}

async function loadTitles(tx, data) {
  const refs = data.contas || [{ controle: data.controle, idempresa: data.idempresa }];
  const normalized = refs.map(item => [Number(item.controle), Number(item.idempresa)]);
  if (!normalized.length || normalized.some(([a,b]) => !Number.isInteger(a) || !Number.isInteger(b)) ||
      new Set(normalized.map(item => item.join(":"))).size !== normalized.length) {
    throw new Error("Selecao de titulos invalida.");
  }
  const items = [];
  for (const [controle, empresa] of normalized) items.push(await loadTitle(tx, controle, empresa));
  if (new Set(items.map(item => Number(item.cliente_id))).size !== 1)
    throw new Error("Todos os titulos do boleto devem ser do mesmo cliente.");
  if (new Set(items.map(item => Number(item.idempresa))).size !== 1)
    throw new Error("Todos os titulos do boleto devem ser da mesma empresa.");
  const errors = [...new Set(items.flatMap(validateTitle))];
  const title = { ...items[0] };
  title.valor = Math.round(items.reduce((sum, item) => sum + Number(item.valor || 0), 0) * 100) / 100;
  title.vencimento = isoDate(data.vencimento_boleto || items.map(item => isoDate(item.vencimento)).sort()[0]);
  title.itens = items;
  return [title, errors];
}

function request(urlValue, { method = "GET", headers = {}, body, certPath, keyPath, timeout = 40_000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const transport = url.protocol === "https:" ? https : http;
    const options = { method, headers, timeout };
    if (certPath) options.cert = fs.readFileSync(certPath);
    if (keyPath) options.key = fs.readFileSync(keyPath);
    const req = transport.request(url, options, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo limite excedido")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function issueBradesco(cfg, payload) {
  const form = "grant_type=client_credentials";
  const auth = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64");
  const tokenResponse = await request(cfg.token_url, { method: "POST", body: form,
    certPath: cfg.cert_path, keyPath: cfg.key_path, timeout: 30_000,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "Content-Length": Buffer.byteLength(form) } });
  if (tokenResponse.status < 200 || tokenResponse.status >= 300)
    throw new Error(`Falha na autenticacao Bradesco (HTTP ${tokenResponse.status}).`);
  const token = JSON.parse(tokenResponse.text || "{}").access_token;
  if (!token) throw new Error("Bradesco nao retornou access_token.");
  const body = JSON.stringify(payload);
  const response = await request(cfg.issue_url, { method: "POST", body,
    certPath: cfg.cert_path, keyPath: cfg.key_path,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": payload.idempotencia, "Content-Length": Buffer.byteLength(body) } });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Bradesco respondeu HTTP ${response.status}: ${response.text.slice(0, 1000)}`);
  return response.text ? JSON.parse(response.text) : {};
}

router.post("/preparar", async (req, res) => {
  try {
    const result = await withWriteTransaction(async tx => {
      await ensureSchema(tx);
      const [title, errors] = await loadTitles(tx, req.body || {});
      return { ok: !errors.length, titulo: { controle: title.controle, idempresa: title.idempresa,
        pagador: title.pagador, documento: digits(title.documento_pagador), valor: Number(title.valor),
        vencimento: isoDate(title.vencimento), quantidade_titulos: title.itens.length },
        pendencias: errors, configuracao: publicConfig(readJsonConfig(CONFIG_FILE)) };
    });
    res.json(result);
  } catch (error) { res.status(400).json({ ok: false, erro: error.message }); }
});

router.post("/emitir", async (req, res) => {
  const cfg = readJsonConfig(CONFIG_FILE);
  const visible = publicConfig(cfg);
  if (!visible.configurado) return res.status(409).json({ ok:false, erro:`Configuracao Bradesco incompleta: ${visible.faltando.join(", ")}` });
  if (!visible.homologado) return res.status(409).json({ ok:false, erro:"Contrato da API ainda nao foi marcado como homologado." });
  try {
    const result = await withWriteTransaction(async tx => {
      await ensureSchema(tx);
      const [title, errors] = await loadTitles(tx, req.body || {});
      if (errors.length) throw Object.assign(new Error(`Complete o cadastro: ${errors.join(", ")}`), { status: 400 });
      for (const item of title.itens) {
        const existing = await tx.singleton(`SELECT FIRST 1 b.IDBOLETO, b.STATUS FROM DASH_BOLETO b
          LEFT JOIN DASH_BOLETO_ITEM bi ON bi.IDBOLETO=b.IDBOLETO
          WHERE (b.CONTROLE=? AND b.IDEMPRESA=?) OR (bi.CONTROLE=? AND bi.IDEMPRESA=?)`,
          [item.controle,item.idempresa,item.controle,item.idempresa]);
        if (existing) throw Object.assign(new Error(`Este titulo ja possui boleto (${existing.STATUS}).`), { status: 409 });
      }
      const payload = { idempotencia:`237-${title.idempresa}-${title.controle}`, agencia:cfg.agencia,
        conta:cfg.conta, carteira:cfg.carteira, convenio:cfg.convenio,
        seuNumero:String(title.seu_numero || title.controle), valor:Number(title.valor).toFixed(2),
        vencimento:isoDate(title.vencimento), pagador:{ nome:title.pagador,
          documento:digits(title.documento_pagador), endereco:title.endereco_cobranca || title.endereco,
          numero:String(title.numero || "SN"), bairro:title.bairro_cobranca || title.bairro,
          cep:digits(title.cep_cobranca || title.cep), uf:title.uf_cobranca || title.uf } };
      const response = await issueBradesco(cfg, payload);
      const externalId = response.id || response.idTitulo || response.nossoNumero;
      if (!externalId) throw new Error("Resposta sem identificador do boleto; confira o layout homologado.");
      const sequence = await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_BOLETO AS ID FROM RDB$DATABASE");
      const localId = sequence.ID, now = new Date();
      await tx.execute(`INSERT INTO DASH_BOLETO (IDBOLETO,BANCO_CODIGO,CONTROLE,IDEMPRESA,
        ID_EXTERNO,NOSSO_NUMERO,LINHA_DIGITAVEL,CODIGO_BARRAS,URL_BOLETO,STATUS,VALOR,VENCIMENTO,
        PAYLOAD,RESPOSTA,CRIADO_EM,ATUALIZADO_EM) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [localId,"237",title.controle,title.idempresa,String(externalId),String(response.nossoNumero||""),
         response.linhaDigitavel,response.codigoBarras,response.url||response.urlBoleto,"REGISTRADO",
         title.valor,title.vencimento,JSON.stringify(payload),JSON.stringify(response),now,now]);
      for (let index=0; index<title.itens.length; index++) {
        const item=title.itens[index];
        await tx.execute("INSERT INTO DASH_BOLETO_ITEM (IDBOLETO,CONTROLE,IDEMPRESA,VALOR) VALUES (?,?,?,?)",
          [localId,item.controle,item.idempresa,item.valor]);
        await tx.execute(`UPDATE CTARECEBER SET NRBOLETO=?, NOSSONUMERO=?, CDBANCOBOLETO=?,
          AGENCIABOLETO=?, NUMCONTABOLETO=?, STATUSBOLETO=1, DATABOLETO=CURRENT_TIMESTAMP,
          PARCELABOLETO=?, DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=?`,
          [localId,String(response.nossoNumero||externalId).slice(0,20),Number(req.body.cdbanco||237),
           String(cfg.agencia||"").slice(0,7),String(cfg.conta||"").slice(0,15),index+1,item.controle,item.idempresa]);
      }
      return { ok:true, mensagem:"Boleto registrado no Bradesco.", boleto:response };
    });
    res.json(result);
  } catch (error) { res.status(error.status || 400).json({ ok:false, erro:error.message }); }
});

export { digits, ensureSchema, isoDate, loadTitles, publicConfig, request, validateTitle };
export default router;
