const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

function isoDate(value) {
  const match = String(value || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;
  return { year, month, day, iso: match[0] };
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDays(iso, days) {
  const parsed = isoDate(iso);
  const date = new Date(parsed.year, parsed.month - 1, parsed.day + days, 12);
  return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function shiftMonths(iso, months, day) {
  const parsed = isoDate(iso);
  const target = new Date(parsed.year, parsed.month - 1 + months, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return formatDate(
    target.getFullYear(),
    target.getMonth() + 1,
    Math.min(day, last),
  );
}

export function equalInstallmentValues(total, count) {
  const amount = roundMoney(total);
  const each = roundMoney(amount / count);
  const values = Array.from({ length: count }, () => each);
  values[count - 1] = roundMoney(amount - roundMoney(each * (count - 1)));
  return values;
}

export function buildInstallments({
  total,
  count,
  firstDue,
  interval = 0,
  fixedDay = false,
  custom = null,
} = {}) {
  const parcels = Number(count);
  const spacing = Number(interval || 0);
  const first = isoDate(firstDue);
  if (!Number.isInteger(parcels) || parcels < 1 || parcels > 120)
    throw new Error("Informe entre 1 e 120 parcelas.");
  if (!Number.isInteger(spacing) || spacing < 0 || spacing > 999)
    throw new Error("Informe um intervalo entre 0 e 999 dias.");
  if (!first) throw new Error("Informe o primeiro vencimento.");
  const amount = roundMoney(total);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("Informe um valor maior que zero.");

  const dates = [first.iso];
  for (let index = 1; index < parcels; index += 1) {
    dates.push(
      fixedDay && spacing === 30
        ? shiftMonths(first.iso, index, first.day)
        : shiftDays(dates[index - 1], spacing),
    );
  }

  const values = custom
    ? custom.map((item) => roundMoney(item?.valor ?? item?.value))
    : equalInstallmentValues(amount, parcels);
  if (values.length !== parcels)
    throw new Error("Informe o valor de todas as parcelas.");
  if (values.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("Cada parcela precisa ter valor maior que zero.");
  const sum = roundMoney(values.reduce((totalValue, value) => totalValue + value, 0));
  if (Math.abs(sum - amount) > 0.009)
    throw new Error(
      `A soma das parcelas (${sum.toFixed(2)}) deve ser igual ao valor total (${amount.toFixed(2)}).`,
    );

  return dates.map((vencimento, index) => {
    const informedDue = custom ? isoDate(custom[index]?.vencimento) : null;
    if (custom && !informedDue)
      throw new Error(`Informe o vencimento da parcela ${index + 1}.`);
    return {
      parcela: index + 1,
      vencimento: informedDue?.iso || vencimento,
      valor: values[index],
      intervalo: spacing,
    };
  });
}
