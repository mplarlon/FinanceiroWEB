export const roundMoney = (value) =>
  Math.round(Number(value || 0) * 100) / 100;

function calendarKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const key = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function clockDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? "").trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

// O Automec faz EdtDtCobranca.Date - DTVENC, com a hora do vencimento.
// Meio-dia no título tira meio dia do cálculo (175,15 a 5% em 25,5 dias = 223,32).
export function interestDays(due, paidOn) {
  const paidKey = calendarKey(paidOn);
  const dueDate = clockDate(due);
  if (!paidKey || !dueDate) return 0;
  const [year, month, day] = paidKey.split("-").map(Number);
  const paid = new Date(year, month - 1, day, 0, 0, 0, 0);
  const days = (paid.getTime() - dueDate.getTime()) / 86400000;
  return days > 0 ? days : 0;
}

export function parcelInterest(value, rate, days) {
  return roundMoney(Number(value || 0) * Number(rate || 0) * Number(days || 0) / 100);
}

export function totalParcelInterest(parcels = []) {
  return roundMoney(
    parcels.reduce(
      (sum, parcel) =>
        sum + parcelInterest(parcel.value, parcel.rate, parcel.days),
      0,
    ),
  );
}
