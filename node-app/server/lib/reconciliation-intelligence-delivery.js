import nodemailer from "nodemailer";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { interpretarLancamentosApi, separarJaImportados } from "./reconciliation-intelligence.js";
import { loadConfig as loadWhatsApp, sendTemplate, sendText } from "../routes/whatsapp.js";

const ARQUIVO = "extrato_bancario.json";

function publico(conta) {
  return {
    banco: String(conta.banco || ""),
    agencia: String(conta.agencia || ""),
    conta: String(conta.conta || ""),
    extratoAutorizado: Boolean(conta.extratoAutorizado),
    consentimento: Boolean(conta.consentimento),
    openFinanceConsentido: Boolean(conta.openFinanceConsentido),
    url: String(conta.url || ""),
    temToken: Boolean(conta.token),
    empresa: Number(conta.empresa) || null,
  };
}

export function lerFontesExtrato() {
  const salvo = readJsonConfig(ARQUIVO, { contas: [] });
  return (salvo.contas || []).map(publico);
}

export function salvarFonteExtrato(entrada = {}) {
  const atual = readJsonConfig(ARQUIVO, { contas: [] });
  const chave = `${entrada.banco}|${entrada.conta}`;
  const contas = (atual.contas || []).filter((conta) => `${conta.banco}|${conta.conta}` !== chave);
  const anterior = (atual.contas || []).find((conta) => `${conta.banco}|${conta.conta}` === chave) || {};
  const token = entrada.token ? String(entrada.token) : anterior.token || "";
  contas.push({
    banco: String(entrada.banco || "").slice(0, 10),
    agencia: String(entrada.agencia || "").slice(0, 10),
    conta: String(entrada.conta || "").slice(0, 20),
    extratoAutorizado: Boolean(entrada.extratoAutorizado),
    consentimento: Boolean(entrada.consentimento),
    openFinanceConsentido: Boolean(entrada.openFinanceConsentido),
    url: String(entrada.url || "").slice(0, 300),
    empresa: Number(entrada.empresa) || null,
    token,
  });
  writeJsonConfig(ARQUIVO, { contas });
  return contas.map(publico);
}

export async function puxarExtratosAutorizados(buscar = fetch) {
  const salvo = readJsonConfig(ARQUIVO, { contas: [] });
  const resultado = [];
  for (const conta of salvo.contas || []) {
    const base = { banco: conta.banco, conta: conta.conta };
    if (!conta.consentimento || !conta.extratoAutorizado || !conta.openFinanceConsentido || !conta.url || !conta.token) {
      resultado.push({ ...base, status: "aguardando_consentimento", itens: [] });
      continue;
    }
    try {
      const resposta = await buscar(conta.url, {
        headers: { Authorization: `Bearer ${conta.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resposta.ok) {
        resultado.push({ ...base, status: "falha", itens: [], erro: `HTTP ${resposta.status}` });
        continue;
      }
      const payload = await resposta.json();
      resultado.push({ ...base, empresa: Number(conta.empresa) || null, agencia: conta.agencia || "", status: "recebido", itens: interpretarLancamentosApi(payload) });
    } catch (error) {
      resultado.push({ ...base, status: "falha", itens: [], erro: String(error.message || error).replace(/bearer\s+\S+/gi, "bearer").slice(0, 160) });
    }
  }
  return resultado;
}

export function novosDoExtrato(itens, chavesExistentes) {
  return separarJaImportados(itens, chavesExistentes).novos;
}

export async function enviarAvisosConciliacao(registros, notificacoes = {}) {
  const canais = [];
  const motivos = [];
  const textos = (registros || []).map((item) => item.texto).filter(Boolean);
  if (!textos.length || notificacoes.envioReal !== true) return { canais, motivos };
  if (notificacoes.email) {
    const smtp = readJsonConfig("email_config.json", {});
    const destinatarios = (notificacoes.destinatarios || []).map((item) => String(item).trim()).filter((item) => item.includes("@"));
    if (!smtp.smtp_host || !smtp.smtp_user || !smtp.smtp_password) motivos.push("smtp_incompleto");
    else if (!destinatarios.length) motivos.push("sem_destinatario_email");
    else {
      const transporte = nodemailer.createTransport({
        host: smtp.smtp_host,
        port: Number(smtp.smtp_port || 587),
        secure: Boolean(smtp.usar_ssl),
        auth: { user: smtp.smtp_user, pass: smtp.smtp_password },
      });
      await transporte.sendMail({
        from: smtp.remetente || smtp.smtp_user,
        to: destinatarios.join(", "),
        subject: "Conciliação bancária",
        text: textos.join("\n\n"),
      });
      canais.push("email");
    }
  }
  if (notificacoes.whatsapp) {
    const whatsapp = loadWhatsApp();
    const telefones = String(notificacoes.telefones || "").split(/[;,\s]+/).map((item) => item.replace(/\D/g, "")).filter((item) => item.length >= 10);
    if (!whatsapp.access_token || !whatsapp.phone_number_id) motivos.push("whatsapp_sem_credencial");
    else if (!telefones.length) motivos.push("sem_telefone");
    else {
      const texto = textos.join("\n").slice(0, 900);
      for (const telefone of telefones) {
        if (notificacoes.templateWhatsapp) await sendTemplate(whatsapp, telefone, notificacoes.templateWhatsapp, [texto]);
        else await sendText(whatsapp, telefone, texto);
      }
      canais.push("whatsapp");
    }
  }
  return { canais, motivos };
}
