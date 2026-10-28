export function suggestForItems(items, titles, { limit = 5, tolerance = 0.01 } = {}) {
  const buckets = new Map();
  for (const title of titles) {
    const key = cents(title.valor);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(title);
    else buckets.set(key, [title]);
  }
  return items.map((item) => {
    const valor = Number(item.valor) || 0;
    if (item.conciliado) {
      return { ...item, sugestao: { status: "conciliado", tipo: null, total: 0, titulos: [] } };
    }
    const tipo = valor >= 0 ? "receber" : "pagar";
    const amount = Math.abs(valor);
    const key = cents(amount);
    const found = [];
    for (const near of [key - 1, key, key + 1]) {
      for (const title of buckets.get(near) || []) {
        if (title.tipo !== tipo) continue;
        if (Math.abs(Math.abs(Number(title.valor) || 0) - amount) <= tolerance + 1e-9) found.push(title);
      }
    }
    found.sort((a, b) => {
      const distance = dayDistance(item.data, a.dtvenc) - dayDistance(item.data, b.dtvenc);
      return distance || Number(a.controle) - Number(b.controle);
    });
    const total = found.length;
    return {
      ...item,
      sugestao: {
        status: total === 1 ? "unico" : total ? "multiplos" : "nao_encontrado",
        tipo,
        total,
        titulos: found.slice(0, limit),
      },
    };
  });
}

function cents(value) {
  return Math.round(Math.abs(Number(value) || 0) * 100);
}

function dayStamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dayDistance(left, right) {
  const a = dayStamp(left);
  const b = dayStamp(right);
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
}
