import fs from "node:fs";
import path from "node:path";

export const port = Number(process.env.DASHBOARD_PORT || 505);
export const dataDir = process.env.DASHBOARD_DATA_DIR ||
  "C:\\administracao\\Dashboard";
export const appRoot = path.resolve(import.meta.dirname, "..");
export const clientDist = path.join(appRoot, "dist");
export const schemaFile = path.resolve(appRoot, "..", "schema.json");
export const configFile = path.join(dataDir, "start.ini");
const legacyConfigFile = path.resolve(appRoot, "..", "database_config.json");

const defaults = {
  type: "firebird",
  name: "Banco principal",
  host: "localhost",
  port: 3051,
  database: "C:\\Administracao\\db\\MIAUTOMEC.FDB",
  user: "SYSDBA",
  password: "masterkey",
  charset: "WIN1252",
  role: "",
  active: true
};

export function ensureDataDirs() {
  fs.mkdirSync(path.join(dataDir, "logs"), { recursive: true });
}

export function loadDatabaseConfig() {
  ensureDataDirs();
  const source = fs.existsSync(configFile) ? configFile : legacyConfigFile;
  if (!fs.existsSync(source)) return { ...defaults };
  let loaded;
  try {
    loaded = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    throw new Error(
      `A configuração do banco em ${source} contém JSON inválido. ` +
      `Em caminhos do Windows, use barras duplas (por exemplo, C:\\\\Administracao\\\\db\\\\MIAUTOMEC.FDB). ` +
      `Detalhe: ${error.message}`,
    );
  }
  const config = { ...defaults, ...loaded };
  // Migrate the old portable configuration on first Node.js startup.  Keep
  // the original file untouched so rollback remains possible.
  if (source === legacyConfigFile) {
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  return config;
}

export function normalizeDatabaseConfig(input = {}, current = loadDatabaseConfig()) {
  const next = { ...current, ...input };
  if (!input.password && current.password) next.password = current.password;
  next.type = "firebird";
  next.port = Number(next.port || 3051);
  next.active = input.active === undefined ? Boolean(current.active) : Boolean(input.active);
  return next;
}

export function saveDatabaseConfig(input) {
  const config = normalizeDatabaseConfig(input);
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export function publicDatabaseConfig(config = loadDatabaseConfig()) {
  const { password, ...safe } = config;
  return {
    ...safe,
    has_password: Boolean(password),
    password_masked: password ? "********" : "",
    available_types: [{
      id: "firebird",
      label: "Firebird",
      enabled: true,
      default_port: 3051,
      description: "Banco atual do sistema."
    }]
  };
}
