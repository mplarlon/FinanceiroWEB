import fs from "node:fs";
import path from "node:path";

const centerUrl = process.env.UPDATE_CENTER_URL || "https://financeiroweb.nuvempontual.com";
const tokenFile = process.argv[2];
const output = process.argv[3];
const count = Number(process.argv[4] || 30);
if (!tokenFile || !output) {
  console.error("Uso: node scripts/create-enrollment-pool.js <admin.token> <saida.json> [quantidade]");
  process.exit(1);
}
let adminToken = fs.readFileSync(tokenFile, "utf8").trim().replace(/^\uFEFF/, "");
if (adminToken.startsWith("UPDATE_CENTER_ADMIN_TOKEN=")) adminToken = adminToken.slice(adminToken.indexOf("=") + 1).trim();
adminToken = adminToken.replace(/^["']|["']$/g, "");
const tokens = [];
for (let index = 0; index < count; index += 1) {
  const response = await fetch(new URL("/api/admin/enrollment-tokens", centerUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ clientId: `instalacao-${index + 1}`, companyName: "", group: "pilot", expiresInMinutes: 60 * 24 * 90 }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.token) throw new Error(result.error || `Falha ao reservar registro HTTP ${response.status}`);
  tokens.push(result.token);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ tokens }, null, 2)}\n`);
console.log(`Reservados ${tokens.length} registros de instalacao.`);
