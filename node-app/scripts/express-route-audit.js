import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serverDir = path.join(root, "server");
const indexPath = path.join(serverDir, "index.js");
const inventoryPath = path.join(import.meta.dirname, "route-inventory.json");

const cleanPath = (value) => {
  const normalized = String(value)
    .replace(/<(?:(?:int|path|string|float):)?[^>]+>/g, ":param")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":param")
    .replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
};
const joinPath = (prefix, route) => cleanPath(`${prefix}/${route}`);
const key = (method, route) => `${method.toUpperCase()} ${cleanPath(route)}`;

function literalRoutes(source, receiver, prefix = "") {
  const found = new Set();
  const direct = new RegExp(
    `${receiver}\\.(get|post|put|delete|patch)\\(\\s*(["'])(.*?)\\2`,
    "g",
  );
  for (const match of source.matchAll(direct)) {
    found.add(key(match[1], joinPath(prefix, match[3])));
  }

  const chained = new RegExp(
    `${receiver}\\.route\\(\\s*(["'])(.*?)\\1\\)`,
    "g",
  );
  for (const match of source.matchAll(chained)) {
    const start = match.index + match[0].length;
    const next = source.indexOf(`${receiver}.`, start);
    const fragment = source.slice(start, next < 0 ? source.length : next);
    for (const method of fragment.matchAll(
      /\.(get|post|put|delete|patch)\s*\(/g,
    )) {
      found.add(key(method[1], joinPath(prefix, match[2])));
    }
  }
  return found;
}

function generatedRoutes(source, prefix = "") {
  const found = new Set();
  if (source.includes("router.route(`/${bank}/config`)")) {
    const definitionBlock =
      source.match(/const definitions\s*=\s*\{([\s\S]*?)\n\};/)?.[1] || "";
    for (const match of definitionBlock.matchAll(/^  (\w+):\s*\{/gm)) {
      found.add(key("GET", joinPath(prefix, `/${match[1]}/config`)));
      found.add(key("POST", joinPath(prefix, `/${match[1]}/config`)));
    }
  }
  return found;
}

const indexSource = fs.readFileSync(indexPath, "utf8");
const imports = new Map();
for (const match of indexSource.matchAll(
  /import\s+(\w+)\s+from\s+["']\.\/routes\/([^"']+)\.js["']/g,
)) {
  imports.set(match[1], path.join(serverDir, "routes", `${match[2]}.js`));
}

const actual = literalRoutes(indexSource, "app");
for (const mount of indexSource.matchAll(
  /app\.use\(\s*(["'])(.*?)\1\s*,\s*(\w+)\s*\)/g,
)) {
  const routeFile = imports.get(mount[3]);
  if (!routeFile) continue;
  const source = fs.readFileSync(routeFile, "utf8");
  for (const route of literalRoutes(source, "router", mount[2]))
    actual.add(route);
  for (const route of generatedRoutes(source, mount[2])) actual.add(route);
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const expected = new Set(
  inventory.routes.flatMap((route) =>
    route.methods.map((method) => key(method, route.path)),
  ),
);
const missing = [...expected].filter((route) => !actual.has(route)).sort();
const covered = expected.size - missing.length;

console.log(
  `Auditoria Express: ${covered}/${expected.size} contratos encontrados no codigo montado.`,
);
if (missing.length) {
  console.error("Contratos ausentes:");
  for (const route of missing) console.error(`- ${route}`);
  process.exitCode = 1;
}
