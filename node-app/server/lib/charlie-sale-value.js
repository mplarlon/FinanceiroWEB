export const ITEM_VALOR_SQL = "CASE WHEN sp.SUBTOTAL IS NOT NULL THEN sp.SUBTOTAL WHEN sp.TOTAL IS NOT NULL THEN sp.TOTAL WHEN sp.QTDPRODUTO IS NOT NULL AND sp.VLUNIT IS NOT NULL THEN sp.QTDPRODUTO * sp.VLUNIT END";
export const ITEM_SEM_SQL = "CASE WHEN sp.SUBTOTAL IS NULL AND sp.TOTAL IS NULL AND (sp.QTDPRODUTO IS NULL OR sp.VLUNIT IS NULL) THEN 1 ELSE 0 END";
export const VALOR_AUSENTE = "Há item sem valor. O faturamento não foi somado.";

export function valorLido(total, sem) {
  if (Number(sem) > 0) return null;
  if (total == null || total === "") return null;
  const numero = Number(total);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null;
}

export function valorJanela(total, sem) {
  if (Number(sem) > 0) return null;
  if (total == null || total === "") return 0;
  const numero = Number(total);
  return Number.isFinite(numero) ? numero : null;
}

export function aplicarCampos(row, campos) {
  const incompleto = Number(row?.SEM) > 0;
  const next = { ...row };
  delete next.SEM;
  for (const campo of campos) next[campo] = incompleto ? null : valorLido(row?.[campo], 0);
  return next;
}

export function somaLida(rows, field = "TOTAL") {
  if (!rows?.length) return 0;
  if (rows.some((row) => row?.[field] == null)) return null;
  return Math.round(rows.reduce((sum, row) => sum + Number(row[field]), 0) * 100) / 100;
}
