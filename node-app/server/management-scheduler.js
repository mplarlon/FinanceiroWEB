import nodemailer from "nodemailer";
import { withDatabase } from "./db.js";
import { readJsonConfig, writeJsonConfig } from "./lib/json-config.js";
import { daily, settings } from "./routes/management-reports.js";
import { loadConfig as loadWhatsApp, sendText } from "./routes/whatsapp.js";

const STATE_FILE = "management_delivery_state.json";
const money = value => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function summaryText(report) {
  const total = report.totals || {};
  const stores = (report.stores || []).map(x => `• ${x.NOME || `Loja ${x.ID}`}: ${money(x.FATURAMENTO)} (${Number(x.PEDIDOS || 0)} pedidos)`).join("\n");
  const priorities=(report.priority||[]).map(x=>`• ${x.title}: ${x.title.includes("Estoque")?Number(x.value||0):money(x.value)}`).join("\n");
  return `Resumo gerencial diário — ${report.date}\n\nVendas: ${money(total.sales)}\nLucro bruto: ${money(total.profit)}\nPedidos: ${Number(total.orders || 0)}\nSaldo bancário: ${money(total.bank_balance)}\nA receber em 7 dias: ${money(total.receivable_7d)}\nA pagar em 7 dias: ${money(total.payable_7d)}\nRecebimentos vencidos: ${money(total.receivable_overdue)}\nPagamentos vencidos: ${money(total.payable_overdue)}\nEstoque negativo: ${Number(total.stock_negative||0)}\n\nAlertas prioritários:\n${priorities||"Nenhum alerta prioritário."}\n\nPor loja:\n${stores || "Sem vendas registradas hoje."}`;
}
async function sendEmail(config, subject, text) {
  const smtp = readJsonConfig("email_config.json", {});
  if (!smtp.smtp_host || !smtp.smtp_user || !smtp.smtp_password) throw new Error("Configuração SMTP incompleta.");
  const transport = nodemailer.createTransport({ host: smtp.smtp_host, port: Number(smtp.smtp_port || 587), secure: Boolean(smtp.usar_ssl), requireTLS: !smtp.usar_ssl && smtp.usar_tls !== false, auth: { user: smtp.smtp_user, pass: smtp.smtp_password }, connectionTimeout: 120000, socketTimeout: 120000 });
  await transport.sendMail({ from: smtp.remetente || smtp.smtp_user, to: config.emails, subject, text });
}
export async function deliverManagementSummary() {
  const config = settings().daily;
  const report = await withDatabase(db => daily(db));
  const text = summaryText(report), deliveries = [];
  if (String(config.emails || "").trim()) { await sendEmail(config, `Resumo gerencial — ${report.date}`, text); deliveries.push("email"); }
  const numbers = String(config.whatsapp_numbers || "").split(/[;,\s]+/).map(x => x.replace(/\D/g, "")).filter(Boolean);
  if (numbers.length) { const wa = loadWhatsApp(); for (const number of numbers) await sendText(wa, number, text); deliveries.push("whatsapp"); }
  return { report, deliveries, text };
}
async function tick() {
  const config = settings().daily;
  if (!config.enabled) return;
  const now = new Date(), local = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  if (local !== config.time) return;
  const day = now.toISOString().slice(0,10), state = readJsonConfig(STATE_FILE, {});
  if (state.last_delivery === day) return;
  try { const result = await deliverManagementSummary(); writeJsonConfig(STATE_FILE, { last_delivery: day, delivered_at: new Date().toISOString(), channels: result.deliveries }); }
  catch (error) { writeJsonConfig(STATE_FILE, { last_error_at: new Date().toISOString(), error: error.message }); }
}
export function startManagementScheduler() { tick(); const timer = setInterval(tick, 30_000); timer.unref(); return timer; }
