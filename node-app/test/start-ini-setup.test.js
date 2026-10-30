import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "start-ini-"));
process.env.DASHBOARD_DATA_DIR = dataDir;

test("editar start.ini grava a conexão e preserva a senha do banco", async () => {
  const { configFile, databaseSetupInput, saveDatabaseConfig } = await import("../server/config.js");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configFile, `${JSON.stringify({
    host: "localhost",
    port: 3051,
    database: "C:\\dados\\erp.fdb",
    user: "SYSDBA",
    password: "segredo-banco",
    charset: "WIN1252",
    role: "",
  }, null, 2)}\n`);

  const kept = databaseSetupInput({
    senha: "115",
    acao: "salvar",
    name: "Loja",
    host: "192.168.0.10",
    port: "3050",
    database: "D:\\db\\loja.fdb",
    user: "SYSDBA",
    password: "",
    charset: "UTF8",
    role: "",
  });
  assert.equal(kept.senha, undefined);
  assert.equal(kept.acao, undefined);
  assert.equal(kept.password, undefined);
  const saved = saveDatabaseConfig(kept);
  assert.equal(saved.host, "192.168.0.10");
  assert.equal(saved.port, 3050);
  assert.equal(saved.password, "segredo-banco");
  assert.equal(saved.charset, "UTF8");

  const changed = saveDatabaseConfig(databaseSetupInput({
    ...kept,
    password: "nova-senha",
  }));
  assert.equal(changed.password, "nova-senha");
  const raw = fs.readFileSync(configFile, "utf8");
  assert.equal(raw.includes("115"), false);
  assert.equal(raw.includes("acao"), false);
  assert.equal(raw.includes("nova-senha"), true);
});

test("editar start.ini exige servidor, caminho e usuário", async () => {
  const { databaseSetupInput } = await import("../server/config.js");
  assert.throws(() => databaseSetupInput({ host: "", database: "C:\\db.fdb", user: "SYSDBA" }), /servidor/);
  assert.throws(() => databaseSetupInput({ host: "localhost", database: "C:\\db.fdb", user: " " }), /usuário/);
});
