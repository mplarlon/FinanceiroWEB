import express from "express";
import { withWriteTransaction } from "../db.js";
import { readJsonConfig } from "../lib/json-config.js";
import { digits, ensureSchema, isoDate, loadTitles, request } from "./boleto-bradesco.js";

const router = express.Router();
const tokenCache = new Map();

const configs = {
  bb: () => readJsonConfig("boletos_bb_config.json"),
  sicredi: () => readJsonConfig("boletos_sicredi_config.json")
};
function bbPublic(cfg) {
  const required=["client_id","client_secret","app_key","numero_convenio","numero_carteira","variacao_carteira"];
  return { configurado:!required.some(k=>!String(cfg[k]||"").trim()), faltando:required.filter(k=>!String(cfg[k]||"").trim()), homologado:Boolean(cfg.homologado) };
}
function sicrediPublic(cfg) {
  const required=["api_key","codigo_acesso","cooperativa","posto","codigo_beneficiario"];
  return { configurado:!required.some(k=>!String(cfg[k]||"").trim()), faltando:required.filter(k=>!String(cfg[k]||"").trim()), homologado:Boolean(cfg.homologado) };
}
async function ensureExtraSchema(tx, includeEvent=false) {
  await ensureSchema(tx);
  const columns=new Set((await tx.query(`SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS
    WHERE RDB$RELATION_NAME='DASH_BOLETO'`)).map(r=>r.NAME));
  if(!columns.has("QR_CODE")) await tx.execute("ALTER TABLE DASH_BOLETO ADD QR_CODE BLOB SUB_TYPE TEXT");
  if(!columns.has("TXID")) await tx.execute("ALTER TABLE DASH_BOLETO ADD TXID VARCHAR(100)");
  if(includeEvent) {
    const eventColumns=new Set((await tx.query(`SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS
      WHERE RDB$RELATION_NAME='DASH_BOLETO_EVENTO'`)).map(r=>r.NAME));
    if(!eventColumns.has("ID_EXTERNO")) await tx.execute("ALTER TABLE DASH_BOLETO_EVENTO ADD ID_EXTERNO VARCHAR(100)");
    const indexes=await tx.query("SELECT RDB$INDEX_NAME FROM RDB$INDICES WHERE RDB$INDEX_NAME='UX_DASH_BOL_EVT_EXT'");
    if(!indexes.length) await tx.execute("CREATE UNIQUE INDEX UX_DASH_BOL_EVT_EXT ON DASH_BOLETO_EVENTO (ID_EXTERNO)");
  }
}
async function city(tx, clienteId) {
  const row=await tx.singleton(`SELECT FIRST 1 COALESCE(mc.MUNICIPIO, mn.MUNICIPIO) AS MUNICIPIO
    FROM CLIENTE c LEFT JOIN MUNICIPIO mc ON mc.CDMUNICIPIO=c.CDMUNICIPIO_COB
    LEFT JOIN MUNICIPIO mn ON mn.CDMUNICIPIO=c.CDMUNICIPIO WHERE c.CDCLIENTE=?`,[clienteId]);
  return row?.MUNICIPIO;
}
function summary(title) { return { controle:title.controle,idempresa:title.idempresa,pagador:title.pagador,
  documento:digits(title.documento_pagador),valor:Number(title.valor),vencimento:isoDate(title.vencimento),quantidade_titulos:title.itens.length }; }

async function existingBoleto(tx,title) {
  for(const item of title.itens) {
    const row=await tx.singleton(`SELECT FIRST 1 b.IDBOLETO,b.STATUS FROM DASH_BOLETO b LEFT JOIN DASH_BOLETO_ITEM bi ON bi.IDBOLETO=b.IDBOLETO
      WHERE (b.CONTROLE=? AND b.IDEMPRESA=?) OR (bi.CONTROLE=? AND bi.IDEMPRESA=?)`,[item.controle,item.idempresa,item.controle,item.idempresa]);
    if(row) return row;
  }
}
async function linkTitles(tx,localId,title,bank,nosso,agency,account) {
  for(let i=0;i<title.itens.length;i++) { const item=title.itens[i];
    await tx.execute("INSERT INTO DASH_BOLETO_ITEM (IDBOLETO,CONTROLE,IDEMPRESA,VALOR) VALUES (?,?,?,?)",[localId,item.controle,item.idempresa,item.valor]);
    await tx.execute(`UPDATE CTARECEBER SET NRBOLETO=?,NOSSONUMERO=?,CDBANCOBOLETO=?,AGENCIABOLETO=?,NUMCONTABOLETO=?,STATUSBOLETO=1,DATABOLETO=CURRENT_TIMESTAMP,PARCELABOLETO=?,DTALTER=CURRENT_TIMESTAMP WHERE CONTROLE=? AND IDEMPRESA=?`,
      [localId,String(nosso||"").slice(0,20),Number(bank),String(agency||"").slice(0,7),String(account||"").slice(0,15),i+1,item.controle,item.idempresa]);
  }
}
async function jsonRequest(url,options,label) {
  const response=await request(url,options);
  if(response.status<200||response.status>=300) throw new Error(`${label} respondeu HTTP ${response.status}: ${response.text.slice(0,1500)}`);
  return response.text?JSON.parse(response.text):{};
}
async function bbToken(cfg) {
  const key=`bb:${cfg.client_id}`, cached=tokenCache.get(key);
  if(cached?.expiresAt>Date.now()+20_000) return cached.value;
  const production=cfg.ambiente==="producao";
  const tokenUrl=cfg.token_url||(production?"https://oauth.bb.com.br/oauth/token":"https://oauth.hm.bb.com.br/oauth/token");
  const form=new URLSearchParams({grant_type:"client_credentials",scope:cfg.scope||"cobrancas.boletos-info cobrancas.boletos-requisicao"}).toString();
  const result=await jsonRequest(tokenUrl,{method:"POST",body:form,certPath:cfg.cert_path,keyPath:cfg.key_path,timeout:30_000,
    headers:{Authorization:`Basic ${Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json","Content-Length":Buffer.byteLength(form)}},"Banco do Brasil");
  if(!result.access_token) throw new Error("BB nao retornou access_token.");
  tokenCache.set(key,{value:result.access_token,expiresAt:Date.now()+Number(result.expires_in||300)*1000}); return result.access_token;
}
function bbUrl(cfg,suffix="") { const production=cfg.ambiente==="producao"; const base=cfg.api_url||(production?"https://api.bb.com.br/cobrancas/v2/boletos":"https://api.hm.bb.com.br/cobrancas/v2/boletos");
  const url=new URL(base.replace(/\/$/,"")+suffix); url.searchParams.set("gw-dev-app-key",cfg.app_key); return url.toString(); }
function bbPayload(title,municipio,cfg) { const doc=digits(title.documento_pagador), convenio=digits(cfg.numero_convenio).padStart(7,"0").slice(-7), unique=`${String(Number(title.idempresa)).padStart(3,"0")}${String(Number(title.controle)).padStart(10,"0")}`.slice(-13);
  return {numeroConvenio:Number(cfg.numero_convenio),numeroCarteira:Number(cfg.numero_carteira),numeroVariacaoCarteira:Number(cfg.variacao_carteira),codigoModalidade:Number(cfg.codigo_modalidade||1),dataEmissao:new Date().toISOString().slice(0,10),dataVencimento:isoDate(title.vencimento),valorOriginal:Number(Number(title.valor).toFixed(2)),valorAbatimento:0,quantidadeDiasProtesto:Number(cfg.dias_protesto||0),quantidadeDiasNegativacao:Number(cfg.dias_negativacao||0),orgaoNegativador:Number(cfg.orgao_negativador||10),indicadorAceiteTituloVencido:"S",numeroDiasLimiteRecebimento:Number(cfg.dias_limite_recebimento||30),codigoAceite:"N",codigoTipoTitulo:Number(cfg.codigo_tipo_titulo||2),descricaoTipoTitulo:String(cfg.descricao_tipo_titulo||"DUPLICATA MERCANTIL").slice(0,30),indicadorPermissaoRecebimentoParcial:"N",numeroTituloBeneficiario:String(title.seu_numero||title.controle).slice(0,15),numeroTituloCliente:convenio+unique,mensagemBloquetoOcorrencia:String(cfg.mensagem||"Boleto emitido pelo sistema").slice(0,30),pagador:{tipoInscricao:doc.length===11?1:2,numeroInscricao:Number(doc),nome:String(title.pagador).slice(0,60),endereco:String(title.endereco_cobranca||title.endereco).slice(0,60),cep:Number(digits(title.cep_cobranca||title.cep)),cidade:String(municipio).slice(0,30),bairro:String(title.bairro_cobranca||title.bairro||"").slice(0,30),uf:String(title.uf_cobranca||title.uf).toUpperCase().slice(0,2)}}; }
function sicrediPayload(title,municipio,cfg) { const doc=digits(title.documento_pagador); return {tipoCobranca:cfg.tipo_cobranca||"NORMAL",codigoBeneficiario:String(cfg.codigo_beneficiario),pagador:{tipoPessoa:doc.length===11?"PESSOA_FISICA":"PESSOA_JURIDICA",documento:doc,nome:String(title.pagador).slice(0,200),endereco:String(title.endereco_cobranca||title.endereco).slice(0,40),cidade:String(municipio).slice(0,40),uf:String(title.uf_cobranca||title.uf).toUpperCase(),cep:digits(title.cep_cobranca||title.cep),email:String(title.email||"").slice(0,40)},especieDocumento:cfg.especie_documento||"DUPLICATA_MERCANTIL_INDICACAO",seuNumero:String(title.seu_numero||title.controle).slice(0,10),idTituloEmpresa:`${title.idempresa}-${title.controle}`,dataVencimento:isoDate(title.vencimento),valor:Number(Number(title.valor).toFixed(2)),informativos:[String(cfg.informativo||"Boleto emitido pelo sistema").slice(0,80)]}; }
async function sicrediToken(cfg) { const key=`sicredi:${cfg.api_key}|${cfg.codigo_beneficiario}`,cached=tokenCache.get(key);if(cached?.expiresAt>Date.now()+15_000)return cached.value;const production=cfg.ambiente==="producao",url=cfg.token_url||(production?"https://api-parceiro.sicredi.com.br/auth/openapi/token":"https://api-parceiro.sicredi.com.br/sb/auth/openapi/token");const form=new URLSearchParams({grant_type:"password",username:String(cfg.codigo_beneficiario)+String(cfg.cooperativa),password:cfg.codigo_acesso,scope:"cobranca"}).toString();const result=await jsonRequest(url,{method:"POST",body:form,timeout:30_000,headers:{"x-api-key":cfg.api_key,context:"COBRANCA","Content-Type":"application/x-www-form-urlencoded",Accept:"application/json","Content-Length":Buffer.byteLength(form)}},"Sicredi");if(!result.access_token)throw new Error("Sicredi nao retornou access_token.");tokenCache.set(key,{value:result.access_token,expiresAt:Date.now()+Number(result.expires_in||240)*1000});return result.access_token; }

router.post("/bb/preparar",async(req,res)=>{try{const result=await withWriteTransaction(async tx=>{await ensureExtraSchema(tx);const[title,errors]=await loadTitles(tx,req.body||{});const municipio=await city(tx,title.cliente_id);if(!municipio)errors.push("cidade de cobranca");if(!(title.bairro_cobranca||title.bairro))errors.push("bairro de cobranca");return{ok:!errors.length,titulo:summary(title),pendencias:errors,configuracao:{...bbPublic(configs.bb())}}});res.json(result)}catch(e){res.status(400).json({ok:false,erro:e.message})}});
router.post("/sicredi/preparar",async(req,res)=>{try{const result=await withWriteTransaction(async tx=>{await ensureExtraSchema(tx,true);const[title,errors]=await loadTitles(tx,req.body||{});if(!await city(tx,title.cliente_id))errors.push("cidade de cobranca");return{ok:!errors.length,titulo:summary(title),pendencias:errors,configuracao:{...sicrediPublic(configs.sicredi())}}});res.json(result)}catch(e){res.status(400).json({ok:false,erro:e.message})}});

router.post("/bb/emitir",async(req,res)=>{const cfg=configs.bb(),visible=bbPublic(cfg);if(!visible.configurado)return res.status(409).json({ok:false,erro:`Configuracao BB incompleta: ${visible.faltando.join(", ")}`});if(!visible.homologado)return res.status(409).json({ok:false,erro:"Integracao BB ainda nao homologada."});try{const result=await withWriteTransaction(async tx=>{await ensureExtraSchema(tx);const[title,errors]=await loadTitles(tx,req.body||{}),municipio=await city(tx,title.cliente_id);if(!municipio)errors.push("cidade de cobranca");if(!(title.bairro_cobranca||title.bairro))errors.push("bairro de cobranca");if(errors.length)throw new Error(`Complete o cadastro: ${errors.join(", ")}`);const existing=await existingBoleto(tx,title);if(existing)throw Object.assign(new Error(`Este titulo ja possui boleto (${existing.STATUS}).`),{status:409});const payload=bbPayload(title,municipio,cfg),token=await bbToken(cfg),body=JSON.stringify(payload),response=await jsonRequest(bbUrl(cfg),{method:"POST",body,certPath:cfg.cert_path,keyPath:cfg.key_path,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json","Content-Length":Buffer.byteLength(body)}},"Banco do Brasil");const nosso=String(response.numero||response.nossoNumero||payload.numeroTituloCliente),sequence=await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_BOLETO AS ID FROM RDB$DATABASE"),localId=sequence.ID,now=new Date();await tx.execute(`INSERT INTO DASH_BOLETO (IDBOLETO,BANCO_CODIGO,CONTROLE,IDEMPRESA,ID_EXTERNO,NOSSO_NUMERO,LINHA_DIGITAVEL,CODIGO_BARRAS,STATUS,VALOR,VENCIMENTO,PAYLOAD,RESPOSTA,CRIADO_EM,ATUALIZADO_EM) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[localId,"001",title.controle,title.idempresa,payload.numeroTituloCliente,nosso,response.linhaDigitavel||response.codigoLinhaDigitavel,response.codigoBarras||response.codigoBarraNumerico,"REGISTRADO",title.valor,title.vencimento,JSON.stringify(payload),JSON.stringify(response),now,now]);await linkTitles(tx,localId,title,req.body.cdbanco||1,nosso,cfg.agencia,cfg.conta);return{ok:true,mensagem:"Boleto registrado no Banco do Brasil.",boleto:response}});res.json(result)}catch(e){res.status(e.status||400).json({ok:false,erro:e.message})}});

router.post("/sicredi/emitir",async(req,res)=>{const cfg=configs.sicredi(),visible=sicrediPublic(cfg);if(!visible.configurado)return res.status(409).json({ok:false,erro:`Configuracao Sicredi incompleta: ${visible.faltando.join(", ")}`});if(!visible.homologado)return res.status(409).json({ok:false,erro:"Integracao Sicredi ainda nao homologada."});try{const result=await withWriteTransaction(async tx=>{await ensureExtraSchema(tx,true);const[title,errors]=await loadTitles(tx,req.body||{}),municipio=await city(tx,title.cliente_id);if(!municipio)errors.push("cidade de cobranca");if(errors.length)throw new Error(`Complete o cadastro: ${errors.join(", ")}`);const existing=await existingBoleto(tx,title);if(existing)throw Object.assign(new Error(`Este titulo ja possui boleto (${existing.STATUS}).`),{status:409});const payload=sicrediPayload(title,municipio,cfg),token=await sicrediToken(cfg),production=cfg.ambiente==="producao",url=cfg.issue_url||(production?"https://api-parceiro.sicredi.com.br/cobranca/boleto/v1/boletos":"https://api-parceiro.sicredi.com.br/sb/cobranca/boleto/v1/boletos"),body=JSON.stringify(payload),response=await jsonRequest(url,{method:"POST",body,headers:{Authorization:`Bearer ${token}`,"x-api-key":cfg.api_key,cooperativa:String(cfg.cooperativa),posto:String(cfg.posto),"Content-Type":"application/json",Accept:"application/json","Content-Length":Buffer.byteLength(body)}},"Sicredi"),nosso=String(response.nossoNumero||"");if(!nosso)throw new Error("Sicredi nao retornou nossoNumero.");const sequence=await tx.singleton("SELECT NEXT VALUE FOR GEN_DASH_BOLETO AS ID FROM RDB$DATABASE"),localId=sequence.ID,now=new Date();await tx.execute(`INSERT INTO DASH_BOLETO (IDBOLETO,BANCO_CODIGO,CONTROLE,IDEMPRESA,ID_EXTERNO,NOSSO_NUMERO,LINHA_DIGITAVEL,CODIGO_BARRAS,STATUS,VALOR,VENCIMENTO,PAYLOAD,RESPOSTA,CRIADO_EM,ATUALIZADO_EM,QR_CODE,TXID) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[localId,"748",title.controle,title.idempresa,payload.idTituloEmpresa,nosso,response.linhaDigitavel,response.codigoBarras,"REGISTRADO",title.valor,title.vencimento,JSON.stringify(payload),JSON.stringify(response),now,now,response.qrCode,response.txid]);await linkTitles(tx,localId,title,req.body.cdbanco||748,nosso,cfg.cooperativa,cfg.codigo_beneficiario);return{ok:true,mensagem:"Boleto registrado no Sicredi.",boleto:response}});res.json(result)}catch(e){res.status(e.status||400).json({ok:false,erro:e.message})}});

router.post("/bb/:boletoId/consultar",async(req,res)=>{const cfg=configs.bb();try{const result=await withWriteTransaction(async tx=>{await ensureExtraSchema(tx);const row=await tx.singleton("SELECT NOSSO_NUMERO FROM DASH_BOLETO WHERE IDBOLETO=? AND BANCO_CODIGO=?",[Number(req.params.boletoId),"001"]);if(!row)throw Object.assign(new Error("Boleto BB nao encontrado."),{status:404});const token=await bbToken(cfg);const suffix=`/${encodeURIComponent(String(row.NOSSO_NUMERO))}?numeroConvenio=${encodeURIComponent(String(cfg.numero_convenio))}`;const response=await jsonRequest(bbUrl(cfg,suffix),{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},certPath:cfg.cert_path,keyPath:cfg.key_path},"Banco do Brasil");const status=String(response.estadoTituloCobranca||response.codigoEstadoTituloCobranca||"CONSULTADO").slice(0,30);await tx.execute("UPDATE DASH_BOLETO SET STATUS=?,RESPOSTA=?,ATUALIZADO_EM=? WHERE IDBOLETO=?",[status,JSON.stringify(response),new Date(),Number(req.params.boletoId)]);return{ok:true,boleto:response}});res.json(result)}catch(e){res.status(e.status||400).json({ok:false,erro:e.message})}});

router.post("/sicredi/webhook",async(req,res)=>{try{const event=req.body||{},eventId=String(event.idEventoWebhook||"");if(!eventId||!event.nossoNumero||!event.movimento)return res.status(400).json({ok:false,erro:"Evento Sicredi incompleto."});const result=await withWriteTransaction(async tx=>{await ensureExtraSchema(tx,true);const row=await tx.singleton("SELECT FIRST 1 IDBOLETO FROM DASH_BOLETO WHERE BANCO_CODIGO=? AND NOSSO_NUMERO=?",["748",String(event.nossoNumero)]);if(!row)return{ok:true,ignorado:"Boleto nao localizado."};if(await tx.singleton("SELECT FIRST 1 IDBOLETO FROM DASH_BOLETO_EVENTO WHERE ID_EXTERNO=?",[eventId]))return{ok:true,duplicado:true};const movement=String(event.movimento),status=movement.startsWith("ESTORNO_")?"ESTORNADO":"LIQUIDADO",now=new Date();await tx.execute("UPDATE DASH_BOLETO SET STATUS=?,ATUALIZADO_EM=?,RESPOSTA=? WHERE IDBOLETO=?",[status,now,JSON.stringify(event),row.IDBOLETO]);await tx.execute("INSERT INTO DASH_BOLETO_EVENTO (IDBOLETO,OCORREU_EM,TIPO,CONTEUDO,ID_EXTERNO) VALUES (?,?,?,?,?)",[row.IDBOLETO,now,movement,JSON.stringify(event),eventId]);return{ok:true}});res.json(result)}catch(e){res.status(400).json({ok:false,erro:e.message})}});

export { bbPayload, bbPublic, sicrediPayload, sicrediPublic };
export default router;
