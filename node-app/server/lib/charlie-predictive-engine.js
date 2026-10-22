const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits = 2) => Number(num(value).toFixed(digits));
const DAY = 86400000;

function isoDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function normalizeSeries(rows = [], options = {}) {
  const dateField = options.dateField || "date";
  const valueField = options.valueField || "value";
  const aggregate = new Map();
  let invalid = 0, duplicates = 0;
  for (const row of rows || []) {
    const date = isoDay(row?.[dateField]);
    const value = Number(row?.[valueField]);
    if (!date || !Number.isFinite(value)) { invalid += 1; continue; }
    if (aggregate.has(date)) duplicates += 1;
    aggregate.set(date, num(aggregate.get(date)) + value);
  }
  const sorted = [...aggregate].sort(([a], [b]) => a.localeCompare(b));
  if (!sorted.length) return { points: [], quality: { status: "insuficiente", records: 0, invalid, duplicates, gaps: 0, outliers: 0, reasons: ["Nenhum registro histórico válido."] } };
  const fill = options.fillMissing !== false;
  const points = [];
  let gaps = 0;
  for (let time = Date.parse(`${sorted[0][0]}T00:00:00Z`), end = Date.parse(`${sorted.at(-1)[0]}T00:00:00Z`); time <= end; time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10);
    if (!aggregate.has(date)) gaps += 1;
    if (fill || aggregate.has(date)) points.push({ date, value: round(aggregate.get(date) || 0) });
  }
  const values = points.map((point) => point.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const sd = Math.sqrt(variance);
  const outliers = sd ? values.filter((value) => Math.abs(value - mean) > 3 * sd).length : 0;
  const reasons = [];
  if (points.length < (options.minimumRecords || 14)) reasons.push(`Histórico curto: ${points.length} pontos válidos.`);
  if (gaps / Math.max(1, points.length) > 0.2) reasons.push("Mais de 20% das datas não possuem registros.");
  if (invalid) reasons.push(`${invalid} registro(s) inválido(s) foram ignorados.`);
  return {
    points,
    quality: {
      status: reasons.length && points.length < (options.minimumRecords || 14) ? "insuficiente" : reasons.length ? "limitada" : "adequada",
      records: points.length, invalid, duplicates, gaps, outliers,
      start: points[0]?.date, end: points.at(-1)?.date, reasons,
    },
  };
}

const METHODS = {
  naive(values) { return num(values.at(-1)); },
  moving_average(values) {
    const sample = values.slice(-Math.min(7, values.length));
    return sample.reduce((sum, value) => sum + value, 0) / sample.length;
  },
  weighted_moving_average(values) {
    const sample = values.slice(-Math.min(7, values.length));
    const denominator = sample.reduce((sum, _, index) => sum + index + 1, 0);
    return sample.reduce((sum, value, index) => sum + value * (index + 1), 0) / denominator;
  },
  exponential_smoothing(values) {
    let level = values[0] || 0;
    for (let index = 1; index < values.length; index += 1) level = 0.3 * values[index] + 0.7 * level;
    return level;
  },
  linear_trend(values, step = 1) {
    const length = values.length;
    const meanX = (length - 1) / 2;
    const meanY = values.reduce((sum, value) => sum + value, 0) / length;
    const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0);
    const slope = denominator ? values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0) / denominator : 0;
    return Math.max(0, meanY + slope * (length - 1 + step - meanX));
  },
};

export function errorMetrics(actual = [], predicted = []) {
  const length = Math.min(actual.length, predicted.length);
  if (!length) return { mae: null, rmse: null, wape: null, bias: null };
  let absolute = 0, squared = 0, signed = 0, base = 0;
  for (let index = 0; index < length; index += 1) {
    const error = num(predicted[index]) - num(actual[index]);
    absolute += Math.abs(error); squared += error ** 2; signed += error; base += Math.abs(num(actual[index]));
  }
  return { mae: round(absolute / length), rmse: round(Math.sqrt(squared / length)), wape: base ? round(absolute / base * 100) : null, bias: round(signed / length) };
}

export function backtest(values = [], methodName, options = {}) {
  const method = METHODS[methodName];
  if (!method || values.length < 8) return { valid: false, metrics: errorMetrics(), residuals: [], samples: 0 };
  const minimumTrain = Math.max(7, Math.min(Number(options.minimumTrain) || 14, values.length - 1));
  const actual = [], predicted = [], residuals = [];
  for (let index = minimumTrain; index < values.length; index += 1) {
    const forecast = Math.max(0, method(values.slice(0, index), 1));
    actual.push(values[index]); predicted.push(forecast); residuals.push(values[index] - forecast);
  }
  return { valid: actual.length >= 3, metrics: errorMetrics(actual, predicted), residuals, samples: actual.length };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))];
}

export function forecastSeries(rows, options = {}) {
  const horizon = Math.max(1, Math.min(366, Number(options.horizon) || 30));
  const normalized = normalizeSeries(rows, options);
  if (normalized.quality.status === "insuficiente") return { ok: false, horizon, quality: normalized.quality, message: "Os dados disponíveis não sustentam uma previsão estatística." };
  const values = normalized.points.map((point) => point.value);
  const candidates = Object.keys(METHODS).map((method) => ({ method, ...backtest(values, method, options) }));
  const valid = candidates.filter((candidate) => candidate.valid);
  const selected = valid.sort((a, b) => (a.metrics.mae ?? Infinity) - (b.metrics.mae ?? Infinity))[0];
  if (!selected) return { ok: false, horizon, quality: { ...normalized.quality, status: "insuficiente", reasons: [...normalized.quality.reasons, "Não há amostras suficientes para backtesting."] }, message: "Não foi possível validar um método contra o histórico." };
  const generated = [...values];
  const lastDate = Date.parse(`${normalized.points.at(-1).date}T00:00:00Z`);
  const uncertainty = percentile(selected.residuals.map(Math.abs), 0.8);
  const forecasts = [];
  for (let step = 1; step <= horizon; step += 1) {
    const central = Math.max(0, METHODS[selected.method](generated, step));
    generated.push(central);
    forecasts.push({
      date: new Date(lastDate + step * DAY).toISOString().slice(0, 10),
      central: round(central),
      lower: round(Math.max(0, central - uncertainty)),
      upper: round(central + uncertainty),
    });
  }
  const naive = candidates.find((candidate) => candidate.method === "naive");
  const beatsNaive = selected.method === "naive" || selected.metrics.mae <= naive.metrics.mae;
  return {
    ok: true, horizon, model: selected.method, modelVersion: "1.0.0", forecasts,
    total: round(forecasts.reduce((sum, item) => sum + item.central, 0)),
    interval: { lower: round(forecasts.reduce((sum, item) => sum + item.lower, 0)), upper: round(forecasts.reduce((sum, item) => sum + item.upper, 0)), method: "erro_absoluto_p80_backtest", statisticallyValidated: selected.samples >= 7 },
    validation: { ...selected, residuals: undefined, beatsNaive, candidates: candidates.map(({ method, valid: usable, metrics, samples }) => ({ method, valid: usable, metrics, samples })) },
    quality: normalized.quality,
    assumptions: ["A estrutura recente do negócio continuará comparável durante o horizonte.", "Cancelamentos e devoluções seguem as regras oficiais da extração.", "A faixa é baseada em erros históricos e não representa garantia."],
    history: normalized.points,
  };
}

export function projectCashFlow({ openingBalance = 0, receivables = [], payables = [], horizon = 30, receiptRate = 1, paymentRate = 1 } = {}) {
  const days = Math.max(1, Math.min(366, Number(horizon) || 30));
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const byDate = (items) => items.reduce((map, item) => { const key = isoDay(item.date); if (key) map.set(key, num(map.get(key)) + num(item.value)); return map; }, new Map());
  const incoming = byDate(receivables), outgoing = byDate(payables);
  let balance = num(openingBalance);
  const projection = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(today.getTime() + index * DAY).toISOString().slice(0, 10);
    const receipt = round(num(incoming.get(date)) * receiptRate), payment = round(num(outgoing.get(date)) * paymentRate);
    balance = round(balance + receipt - payment);
    projection.push({ date, receipts: receipt, payments: payment, balance, negative: balance < 0 });
  }
  return { openingBalance: round(openingBalance), projection, closingBalance: balance, firstNegativeDate: projection.find((item) => item.negative)?.date || null };
}

export function forecastStock(items = [], options = {}) {
  const safetyDays = Math.max(0, num(options.safetyDays ?? 7));
  return items.map((item) => {
    const available = Math.max(0, num(item.onHand) - num(item.reserved));
    const dailyDemand = Math.max(0, num(item.dailyDemand));
    const inbound = Math.max(0, num(item.inbound));
    const leadTime = Math.max(0, num(item.leadTimeDays));
    const coverageDays = dailyDemand ? available / dailyDemand : null;
    const required = dailyDemand * (leadTime + safetyDays);
    const suggested = Math.max(0, Math.ceil(required - available - inbound));
    const risk = !dailyDemand ? "indeterminado" : coverageDays < leadTime ? "alto" : coverageDays < leadTime + safetyDays ? "medio" : "baixo";
    return { ...item, available: round(available), dailyDemand: round(dailyDemand, 4), coverageDays: coverageDays == null ? null : round(coverageDays, 1), suggestedPurchase: suggested, risk };
  }).sort((a, b) => ({ alto: 0, medio: 1, baixo: 2, indeterminado: 3 }[a.risk] - { alto: 0, medio: 1, baixo: 2, indeterminado: 3 }[b.risk]));
}

export function assessCustomerInactivity(customers = [], now = new Date()) {
  return customers.map((customer) => {
    const intervals = customer.intervals || [];
    const mean = intervals.length ? intervals.reduce((sum, value) => sum + num(value), 0) / intervals.length : null;
    const daysSince = Math.max(0, (now - new Date(customer.lastPurchase)) / DAY);
    const ratio = mean ? daysSince / mean : null;
    const classification = intervals.length < 3 ? "reducao_observada" : ratio >= 2 ? "risco_inatividade" : ratio >= 1.5 ? "estatisticamente_atipico" : "normal";
    return { ...customer, meanIntervalDays: mean == null ? null : round(mean, 1), daysSinceLastPurchase: round(daysSince, 1), classification, score: ratio == null ? null : round(ratio, 2) };
  }).sort((a, b) => num(b.score) - num(a.score));
}

export function simulatePriceScenario(items = [], scenario = {}) {
  const priceChange = num(scenario.priceChangePercent) / 100;
  const costChange = num(scenario.costChangePercent) / 100;
  const expenseChange = num(scenario.variableExpenseChangePercent) / 100;
  const rows = items.map((item) => {
    const quantity = num(item.quantity);
    const currentRevenue = num(item.price) * quantity;
    const simulatedRevenue = num(item.price) * (1 + priceChange) * quantity;
    const currentCost = num(item.cost) * quantity;
    const simulatedCost = num(item.cost) * (1 + costChange) * quantity;
    const currentExpense = num(item.variableExpense) * quantity;
    const simulatedExpense = num(item.variableExpense) * (1 + expenseChange) * quantity;
    return { ...item, currentRevenue: round(currentRevenue), simulatedRevenue: round(simulatedRevenue), currentContribution: round(currentRevenue - currentCost - currentExpense), simulatedContribution: round(simulatedRevenue - simulatedCost - simulatedExpense), simulatedPrice: round(num(item.price) * (1 + priceChange)) };
  });
  const sum = (field) => round(rows.reduce((total, row) => total + num(row[field]), 0));
  return { rows, current: { revenue: sum("currentRevenue"), contribution: sum("currentContribution") }, simulated: { revenue: sum("simulatedRevenue"), contribution: sum("simulatedContribution") }, assumptions: ["Quantidades vendidas mantidas constantes.", "Nenhuma elasticidade de demanda foi aplicada.", "A simulação não altera dados do ERP."] };
}

export function simulateFinancialScenario(baseProjection = [], adjustments = []) {
  const changes = adjustments.reduce((map, item) => { const key = isoDay(item.date); if (key) map.set(key, num(map.get(key)) + num(item.value)); return map; }, new Map());
  let accumulated = 0;
  return baseProjection.map((item) => { accumulated += num(changes.get(item.date)); return { ...item, baseBalance: num(item.balance), adjustment: round(num(changes.get(item.date))), simulatedBalance: round(num(item.balance) + accumulated) }; });
}

export const predictiveMethods = Object.freeze(Object.keys(METHODS));
