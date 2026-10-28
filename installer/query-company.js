const fs = require("node:fs");
const { createNativeClient, getDefaultLibraryFilename } = require("node-firebird-driver-native");

const configPath = process.argv[2];
const outputPath = process.argv[3];
const timer = setTimeout(() => {
  try { fs.writeFileSync(outputPath, Buffer.alloc(0)); } catch { /* o instalador trata o arquivo vazio */ }
  process.exit(2);
}, 15000);

function texto(valor) {
  if (Buffer.isBuffer(valor)) return valor.toString("latin1").trim();
  return String(valor || "").trim();
}

async function main() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const library = process.env.DASHBOARD_FBCLIENT || getDefaultLibraryFilename();
  const client = createNativeClient(library);
  const db = await client.connect(`${config.host}/${Number(config.port)}:${config.database}`, {
    username: config.user,
    password: config.password,
    charSetForNONE: "windows-1252",
  });
  try {
    const tx = await db.startTransaction({ accessMode: "READ_ONLY" });
    const result = await db.executeQuery(tx, "SELECT FIRST 1 TRIM(NOMEEMPRESA) AS NOME FROM CONFIGURACAO WHERE NOMEEMPRESA IS NOT NULL AND TRIM(NOMEEMPRESA) <> '' ORDER BY IDEMPRESA");
    const rows = await result.fetchAsObject();
    await result.close();
    await tx.commit();
    fs.writeFileSync(outputPath, Buffer.from(texto(rows[0] && rows[0].NOME), "latin1"));
  } finally {
    await db.disconnect();
  }
}

main().then(() => {
  clearTimeout(timer);
}).catch(() => {
  clearTimeout(timer);
  try { fs.writeFileSync(outputPath, Buffer.alloc(0)); } catch { /* sem nome lido */ }
  process.exit(1);
});
