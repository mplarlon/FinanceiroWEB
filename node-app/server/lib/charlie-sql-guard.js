const MAX_ROWS = 200;
const HEAVY_ROWS = 100000;
const BLOCKED_TABLES = new Set(["USUARIOS", "SIS_OPERACAOUSUARIO"]);
const SENSITIVE_COLUMNS = new Set(["SENHA", "SENHAWEB", "PASSWORD", "TOKEN", "SENHA_HASH"]);
const COMMANDS = new Set([
  "INSERT", "UPDATE", "DELETE", "MERGE", "EXECUTE", "EXEC", "ALTER", "DROP",
  "CREATE", "RECREATE", "GRANT", "REVOKE", "COMMIT", "ROLLBACK", "TRUNCATE",
  "BACKUP", "RESTORE",
]);

function maskStrings(sql) {
  let out = "";
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== "'") {
      out += sql[index];
      continue;
    }
    out += "''";
    index += 1;
    while (index < sql.length) {
      if (sql[index] === "'" && sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      if (sql[index] === "'") break;
      index += 1;
    }
  }
  return out;
}

function identifiers(sql) {
  return maskStrings(sql).toUpperCase().match(/[A-Z_][A-Z0-9_$]*/g) || [];
}

export function referencedTables(sql) {
  const found = [];
  const expression = /\b(?:from|join)\s+([a-z_][a-z0-9_$]*)/gi;
  for (const match of maskStrings(sql).matchAll(expression)) {
    const name = match[1].toUpperCase();
    if (!["SELECT", "LATERAL"].includes(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

export function validateReadOnlySql(value, options = {}) {
  const maxRows = Math.max(1, Math.min(MAX_ROWS, Number(options.maxRows) || MAX_ROWS));
  let sql = String(value || "").trim().replace(/^```sql\s*/i, "").replace(/```$/i, "").trim();
  sql = sql
    .replace(/\s+FETCH\s+FIRST\s+\d+\s+ROWS?\s+ONLY\s*$/i, "")
    .replace(/\s+AND\s+(?:[A-Z][A-Z0-9_]*\.)?SIST_ALT\s+(?:IS\s+NULL|=\s*(?:'[^']*'|\d+))/ig, "")
    .replace(/\s+FIRST\s+\d+\s*$/i, "");
  if (/^select\b[\s\S]*\bcount\s*\(/i.test(sql) && !/\bgroup\s+by\b/i.test(sql))
    sql = sql.replace(/\s+order\s+by\s+[\s\S]*$/i, "");
  if ((sql.match(/;/g) || []).length === 1 && /;\s*$/.test(sql))
    sql = sql.replace(/;\s*$/, "").trim();
  if (!/^(select|with)\b/i.test(sql))
    throw new Error("O Ollama não produziu uma consulta SELECT válida.");

  const masked = maskStrings(sql);
  if (/;|--|\/\*|\*\//.test(masked))
    throw new Error("A consulta contém múltiplas instruções ou comentários.");
  const tokens = identifiers(sql);
  if (tokens.some((token) => COMMANDS.has(token)))
    throw new Error("O Charlie bloqueou uma tentativa de alteração do banco.");
  if (tokens.includes("INTO"))
    throw new Error("A consulta tenta gravar em variável com INTO.");
  if (/\b(?:from|join)\s+[a-z_][a-z0-9_$]*\s*\(/i.test(masked))
    throw new Error("A consulta chama procedimento ou função de tabela, o que é bloqueado.");
  if (tokens.some((token) => token.startsWith("RDB$") || token.startsWith("MON$")))
    throw new Error("A consulta a tabelas internas do Firebird foi bloqueada.");
  if (tokens.some((token) => SENSITIVE_COLUMNS.has(token) || BLOCKED_TABLES.has(token)))
    throw new Error("A consulta pede dados confidenciais e foi bloqueada.");

  const tables = referencedTables(sql);
  const known = options.knownTables;
  if (known) {
    const missing = tables.filter((name) => !known.has(name));
    if (missing.length)
      throw new Error(`A consulta usa tabela fora do catálogo: ${missing.join(", ")}.`);
    const heavy = tables.filter((name) => Number(known.get(name)?.rowCount || 0) > HEAVY_ROWS);
    const filtered = /\bwhere\b/i.test(masked) || /\bgroup\s+by\b/i.test(masked)
      || /\b(count|sum|avg|min|max)\s*\(/i.test(masked);
    if (heavy.length && !filtered)
      throw new Error(`A consulta em ${heavy.join(", ")} precisa de filtro, período ou agregação.`);
  }

  if (/^with\b/i.test(sql)) {
    if (!/\bfirst\s+\d+/i.test(sql) && !/\brows\s+\d+\b/i.test(sql)) sql += " ROWS 200";
  } else if (!/\bfirst\s+\d+/i.test(sql)) {
    sql = sql.replace(/^select\s+(?:skip\s+\d+\s+)?/i, (match) => match.replace(/^select\s+/i, `SELECT FIRST ${maxRows} `));
  }
  sql = sql.replace(/\bfirst\s+(\d+)/ig, (_, amount) => `FIRST ${Math.min(maxRows, Math.max(1, Number(amount)))}`);
  return sql;
}
