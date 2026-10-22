import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { readJsonConfig } from "./json-config.js";
import { loadConfig as loadWhatsApp, sendTemplate } from "../routes/whatsapp.js";
import { dispatchAllowed, whatsappTemplateParameters } from "./charlie-breakfast-engine.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));

export function channelPlan(settings, probes = {}) {
  const emails = String(settings.emails || "").split(/[;,\s]+/).map((item) => item.trim()).filter((item) => item.includes("@"));
  const phones = String(settings.whatsapp || "").split(/[;,\s]+/).map((item) => item.replace(/\D/g, "")).filter(Boolean);
  const smtp = probes.smtp ?? readJsonConfig("email_config.json", {});
  const whatsapp = probes.whatsapp ?? loadWhatsApp();
  const smtpReady = Boolean(smtp.smtp_host && smtp.smtp_user && smtp.smtp_password);
  const whatsappReady = Boolean(whatsapp.access_token && whatsapp.phone_number_id);
  const real = settings.enviarReal === true;
  return {
    emails,
    phones,
    email: settings.canais?.email && emails.length ? (real && smtpReady ? "real" : "simulado") : "desligado",
    whatsapp: settings.canais?.whatsapp && phones.length ? (real && whatsappReady && settings.templateWhatsapp ? "real" : "simulado") : "desligado",
    motivoEmail: !smtpReady ? "SMTP incompleto." : "",
    motivoWhatsapp: !settings.templateWhatsapp ? "Modelo de WhatsApp pendente." : !whatsappReady ? "Credenciais da Meta incompletas." : "",
  };
}

export function renderHtml(report) {
  const cards = [
    ["Vendas de ontem", report.vendas?.ontem],
    ["Vendas no mês", report.vendas?.mes],
    ["Meta", report.meta?.atingimento == null ? null : `${report.meta.atingimento}%`],
    ["Orçamentos em aberto", report.orcamentos?.abertos],
  ];
  const cardHtml = cards.map(([label, value]) => `<td style="padding:8px;border:1px solid #e6e1dc;border-radius:8px"><div style="color:#8a7568;font-size:12px">${escapeHtml(label)}</div><strong style="font-size:18px">${escapeHtml(value == null ? "—" : value)}</strong></td>`).join("");
  const [year, month, day] = String(report.referencia || "").slice(0, 10).split("-");
  const dia = day && month && year ? `${day}/${month}/${year}` : "";
  const doDia = (report.ranking || []).length > 0;
  const linhas = (doDia ? report.ranking : report.rankingMes) || [];
  const aviso = !doDia && linhas.length ? `Nenhuma venda em ${dia}. Ranking do mês.` : (!linhas.length && dia ? `Nenhuma venda em ${dia}.` : "");
  const ranking = linhas.slice(0, 3).map((item) => `<tr><td style="padding:6px;border-bottom:1px solid #eee">${item.posicao}. ${escapeHtml(item.nome)}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(item.faturamento)}</td></tr>`).join("");
  const notes = (report.observacoes || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const alerts = (report.alertas || []).slice(0, 3).map((item) => `<li>${escapeHtml(item.titulo || item.descricao)}</li>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f6f4f1;font-family:Arial,sans-serif;color:#2c2a28"><div style="max-width:680px;margin:0 auto;padding:20px"><h1 style="font-size:22px">Charlie Daily</h1><p>${escapeHtml(report.empresa)} · ${escapeHtml(report.referencia)}</p><table width="100%" cellspacing="8"><tr>${cardHtml}</tr></table>${ranking ? `<h2 style="font-size:16px">Ranking</h2>${aviso ? `<p>${escapeHtml(aviso)}</p>` : ""}<table width="100%">${ranking}</table>` : ""}${notes ? `<ol>${notes}</ol>` : ""}${alerts ? `<ul>${alerts}</ul>` : ""}<p><a href="${escapeHtml(report.link || "#")}">Abrir no ERP</a></p></div></body></html>`;
}

export function renderPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(16).text("Charlie Daily");
    doc.moveDown(0.5);
    doc.fontSize(10).text(report.texto || "", { width: 500 });
    doc.end();
  });
}

async function sendEmail(settings, report, plan) {
  const smtp = readJsonConfig("email_config.json", {});
  const transport = nodemailer.createTransport({
    host: smtp.smtp_host,
    port: Number(smtp.smtp_port || 587),
    secure: Boolean(smtp.usar_ssl),
    requireTLS: !smtp.usar_ssl && smtp.usar_tls !== false,
    auth: { user: smtp.smtp_user, pass: smtp.smtp_password },
    connectionTimeout: 20000,
    socketTimeout: 20000,
  });
  const pdf = await renderPdf(report);
  await transport.sendMail({
    from: smtp.remetente || smtp.smtp_user,
    to: plan.emails.join(", "),
    subject: `Charlie Daily — ${report.referencia}`,
    text: report.texto,
    html: renderHtml(report),
    attachments: [{ filename: `cafe-manha-${report.referencia}.pdf`, content: pdf, contentType: "application/pdf" }],
  });
}

export async function deliverReport(report, settings, deps = {}) {
  const plan = channelPlan(settings, deps.probes);
  const result = { email: plan.email, whatsapp: plan.whatsapp, motivos: [], enviados: [] };
  if (plan.email === "simulado") result.motivos.push(plan.motivoEmail || "E-mail só simulado.");
  if (plan.whatsapp === "simulado") result.motivos.push(plan.motivoWhatsapp || "WhatsApp só simulado.");
  if (plan.email === "real") {
    await (deps.sendEmail || sendEmail)(settings, report, plan);
    result.enviados.push(...plan.emails.map((destino) => ({ canal: "email", destino })));
  }
  if (plan.whatsapp === "real") {
    const config = loadWhatsApp();
    const parameters = settings.templateVariaveis === false ? [] : whatsappTemplateParameters(report);
    for (const phone of plan.phones) {
      await (deps.sendWhatsApp || ((number) => sendTemplate(config, number, settings.templateWhatsapp, parameters, undefined, settings.templateIdioma || "pt_BR")))(phone, report.texto, parameters);
      result.enviados.push({ canal: "whatsapp", destino: phone });
    }
  }
  return result;
}

export async function deliverCampaign(campaign, settings, deps = {}) {
  const gate = dispatchAllowed(campaign, settings);
  if (!gate.ok) return { ...gate, enviados: [] };
  const plan = channelPlan(settings, deps.probes);
  if (plan.whatsapp !== "real" && plan.email !== "real") {
    return { ok: true, canal: "simulado", motivo: "Campanha aprovada e registrada em simulação. Nenhum destinatário real foi contactado.", enviados: [] };
  }
  const enviados = [];
  const texto = campaign.texto || "";
  if (plan.email === "real") {
    const emails = (campaign.destinatarios || []).map((item) => item.email).filter((item) => String(item || "").includes("@"));
    if (emails.length) {
      await (deps.sendEmail || sendEmail)(settings, { referencia: "campanha", texto, vendas: {}, link: "" }, { emails });
      enviados.push(...emails.map((destino) => ({ canal: "email", destino })));
    }
  }
  if (plan.whatsapp === "real") {
    const config = loadWhatsApp();
    const parameters = settings.templateVariaveis === false ? [] : [String(campaign.produto || "promocao").slice(0, 80), texto.slice(0, 400), "ERP"];
    for (const item of campaign.destinatarios || []) {
      const phone = String(item.telefone || "").replace(/\D/g, "");
      if (!phone) continue;
      await (deps.sendWhatsApp || ((number) => sendTemplate(config, number, settings.templateWhatsapp, parameters, undefined, settings.templateIdioma || "pt_BR")))(phone, texto, parameters);
      enviados.push({ canal: "whatsapp", destino: phone });
    }
  }
  return { ok: true, canal: enviados.length ? "real" : "simulado", enviados };
}
