const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MONEY_KEY = /TOTAL|VALOR|SALDO|FATUR|PRECO|CUSTO/;
const QTY_KEY = /^(QTD|QUANTIDADE|TITULOS|REGISTROS|COUNT)/i;
const DATE_KEY = /DATA|VENC|EMISS|DIA/i;

function formatCell(value, key) {
  if (value == null || value === "") return "não informado";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toLocaleDateString("pt-BR");
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match && DATE_KEY.test(key)) return `${match[3]}/${match[2]}/${match[1]}`;
  if (typeof value === "number" && MONEY_KEY.test(key)) return money(value);
  if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return String(value);
}

export function narrateQueryResult(rows, title = "Consulta") {
  const safeTitle = String(title || "Consulta").replace(/\s+/g, " ").trim().slice(0, 160) || "Consulta";
  if (!Array.isArray(rows) || !rows.length) {
    return {
      resposta: `${safeTitle}: não encontrei registros no banco para essa consulta.`,
      origem: "banco",
    };
  }
  const keys = Object.keys(rows[0] || {});
  const qtyKey = keys.find((key) => QTY_KEY.test(key));
  const moneyKey = keys.find((key) => MONEY_KEY.test(key));
  if (rows.length === 1 && (qtyKey || moneyKey) && keys.length <= 6) {
    const parts = [];
    if (qtyKey) parts.push(`${Number(rows[0][qtyKey] || 0).toLocaleString("pt-BR")} registro(s)`);
    if (moneyKey) parts.push(`total de ${money(rows[0][moneyKey])}`);
    return {
      resposta: `${safeTitle}: ${parts.join(", ")}. Valores consultados no banco.`,
      origem: "calculo_no_banco",
    };
  }
  let resposta = `${safeTitle}: encontrei ${rows.length.toLocaleString("pt-BR")} registro(s) no banco.`;
  if (moneyKey && rows.length > 1) {
    const sum = rows.reduce((total, row) => total + Number(row[moneyKey] || 0), 0);
    if (Number.isFinite(sum))
      resposta += ` A soma de ${moneyKey.replaceAll("_", " ").toLowerCase()} nas linhas retornadas é ${money(sum)}.`;
  }
  const preview = rows.slice(0, 3).map((row) => {
    const label = keys.slice(0, 2).map((key) => formatCell(row[key], key)).filter((item) => item !== "não informado").join(" — ");
    return label;
  }).filter(Boolean);
  if (preview.length) resposta += ` Principais linhas: ${preview.join("; ")}.`;
  if (rows.length >= 200) resposta += " A lista foi limitada aos 200 primeiros registros.";
  return { resposta, origem: moneyKey && rows.length > 1 ? "calculo" : "banco" };
}
