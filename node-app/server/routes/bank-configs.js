import fs from "node:fs";
import express from "express";
import { mergeAllowed, readJsonConfig, writeJsonConfig } from "../lib/json-config.js";
import { query, withDatabase } from "../db.js";

const router = express.Router();
const definitions = {
  bradesco: {
    file: "boletos_bradesco_config.json",
    allowed: ["ambiente","token_url","issue_url","query_url","cancel_url","client_id","client_secret","agencia","conta","carteira","convenio","cert_path","key_path","homologado"],
    public(cfg) {
      const required=["token_url","issue_url","client_id","client_secret","agencia","conta","carteira"], faltando=required.filter(k=>!cfg[k]);
      return { banco:"Bradesco",codigo_banco:"237",ambiente:cfg.ambiente||"homologacao",agencia:cfg.agencia||"",conta:cfg.conta||"",carteira:cfg.carteira||"",homologado:Boolean(cfg.homologado),configurado:!faltando.length,faltando,tem_certificado:Boolean(cfg.cert_path&&fs.existsSync(cfg.cert_path)) };
    }
  },
  bb: {
    file: "boletos_bb_config.json",
    allowed: ["ambiente","client_id","client_secret","app_key","numero_convenio","numero_carteira","variacao_carteira","codigo_modalidade","scope","token_url","api_url","cert_path","key_path","dias_protesto","dias_negativacao","dias_limite_recebimento","codigo_tipo_titulo","descricao_tipo_titulo","mensagem","homologado"],
    public(cfg) {
      const required=["client_id","client_secret","app_key","numero_convenio","numero_carteira","variacao_carteira"],faltando=required.filter(k=>!String(cfg[k]||"").trim());
      const production=cfg.ambiente==="producao";
      return { banco:"Banco do Brasil",codigo_banco:"001",ambiente:cfg.ambiente||"homologacao",numero_convenio:cfg.numero_convenio||"",numero_carteira:cfg.numero_carteira||"",variacao_carteira:cfg.variacao_carteira||"",token_url:cfg.token_url||(production?"https://oauth.bb.com.br/oauth/token":"https://oauth.hm.bb.com.br/oauth/token"),api_url:cfg.api_url||(production?"https://api.bb.com.br/cobrancas/v2/boletos":"https://api.hm.bb.com.br/cobrancas/v2/boletos"),configurado:!faltando.length,faltando,homologado:Boolean(cfg.homologado) };
    }
  },
  sicredi: {
    file: "boletos_sicredi_config.json",
    allowed: ["ambiente","api_key","codigo_acesso","cooperativa","posto","codigo_beneficiario","tipo_cobranca","especie_documento","informativo","token_url","issue_url","homologado"],
    public(cfg) {
      const required=["api_key","codigo_acesso","cooperativa","posto","codigo_beneficiario"],faltando=required.filter(k=>!String(cfg[k]||"").trim()),production=cfg.ambiente==="producao";
      return { banco:"Sicredi",codigo_banco:"748",ambiente:cfg.ambiente||"homologacao",cooperativa:cfg.cooperativa||"",posto:cfg.posto||"",codigo_beneficiario:cfg.codigo_beneficiario||"",tipo_cobranca:cfg.tipo_cobranca||"NORMAL",token_url:cfg.token_url||(production?"https://api-parceiro.sicredi.com.br/auth/openapi/token":"https://api-parceiro.sicredi.com.br/sb/auth/openapi/token"),issue_url:cfg.issue_url||(production?"https://api-parceiro.sicredi.com.br/cobranca/boleto/v1/boletos":"https://api-parceiro.sicredi.com.br/sb/cobranca/boleto/v1/boletos"),configurado:!faltando.length,faltando,homologado:Boolean(cfg.homologado) };
    }
  },
  caixa: {
    file: "boletos_caixa_config.json", allowEmpty: true,
    allowed: ["ambiente","agencia","conta","codigo_beneficiario","convenio","cnpj_beneficiario","nome_beneficiario","nosso_numero_prefixo","output_dir","pdf_output_dir","remessa_output_dir","geracao_automatica","homologado"],
    public(cfg) {
      const required=["agencia","conta","codigo_beneficiario","cnpj_beneficiario","nome_beneficiario"],faltando=required.filter(k=>!String(cfg[k]||"").trim());
      return { banco:"CAIXA ECONOMICA FEDERAL",codigo_banco:"104",ambiente:cfg.ambiente||"homologacao",agencia:cfg.agencia||"",conta:cfg.conta||"",codigo_beneficiario:cfg.codigo_beneficiario||"",convenio:cfg.convenio||"",homologado:Boolean(cfg.homologado),geracao_automatica:cfg.geracao_automatica!==false,configurado:!faltando.length,faltando };
    }
  }
};

router.get("/bancos", async (_req, res) => {
  try {
    const rows = await withDatabase(db => query(db, `
      SELECT CDBANCO, BANCO, COALESCE(EMITEBOLETO, 0) AS EMITEBOLETO,
             AGENCIA, NUMCONTA
      FROM BANCO
      WHERE BANCO IS NOT NULL
        AND (CDBANCO IN (237, 748)
          OR UPPER(BANCO) CONTAINING 'BRADESCO'
          OR UPPER(BANCO) CONTAINING 'SICREDI'
          OR UPPER(BANCO) CONTAINING 'BANCO DO BRASIL')
      ORDER BY CASE WHEN COALESCE(EMITEBOLETO, 0) <> 0 THEN 0 ELSE 1 END,
               BANCO, CDBANCO
    `));
    const bancos = rows.flatMap(row => {
      const nome = String(row.BANCO || "");
      const codigo = Number(row.CDBANCO || 0);
      if (codigo === 237 || nome.toUpperCase().includes("BRADESCO")) {
        return [{ ...row, INTEGRACAO: "bradesco", CODIGO_FEBRABAN: "237" }];
      }
      if (codigo === 748 || nome.toUpperCase().includes("SICREDI")) {
        return [{ ...row, INTEGRACAO: "sicredi", CODIGO_FEBRABAN: "748" }];
      }
      if (nome.toUpperCase().includes("BANCO DO BRASIL")) {
        return [{ ...row, INTEGRACAO: "bb", CODIGO_FEBRABAN: "001" }];
      }
      return [];
    });
    res.json({ ok: true, bancos });
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message });
  }
});

for (const [bank, definition] of Object.entries(definitions)) {
  router.route(`/${bank}/config`).get((_req,res)=>{
    const cfg=readJsonConfig(definition.file); res.json({ok:true,...definition.public(cfg)});
  }).post((req,res)=>{
    const cfg=mergeAllowed(readJsonConfig(definition.file),req.body||{},definition.allowed,definition.allowEmpty);
    writeJsonConfig(definition.file,cfg); res.json({ok:true,...definition.public(cfg)});
  });
}

export default router;
