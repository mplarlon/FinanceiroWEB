const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const day = 86400000;
const daysBetween = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / day));
const avg = (values) => values.length ? values.reduce((s, x) => s + n(x), 0) / values.length : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function scoreOpportunity(input) {
  const revenue = clamp(n(input.historicalRevenue) / 1000, 0, 25);
  const reduction = clamp(n(input.reductionPercent) / 4, 0, 25);
  const delay = clamp(n(input.delayRatio) * 15, 0, 20);
  const margin = clamp(n(input.marginPercent) / 4, 0, 15);
  const stock = input.stockAvailable ? 10 : 0;
  const contact = input.openOpportunity ? -20 : input.recentContact ? -10 : 5;
  const score = Math.round(clamp(revenue + reduction + delay + margin + stock + contact, 0, 100));
  return { score, priority: score >= 70 ? "relevante" : score >= 40 ? "moderada" : "acompanhamento", meaning: "prioridade_de_abordagem" };
}

export function analyzeCommercialSales(rows, options = {}) {
  const now = new Date(options.now || Date.now());
  const periodDays = clamp(n(options.periodDays) || 90, 30, 180);
  const minSupport = Math.max(3, n(options.minSupport) || 3);
  const customers = new Map(), orders = new Map();
  for (const row of rows || []) {
    const customerId = n(row.customerId); if (!customerId || !row.date) continue;
    const date = new Date(row.date); if (Number.isNaN(date.getTime())) continue;
    const item = customers.get(customerId) || { customerId, customer: row.customer || "Cliente", sellerId: n(row.sellerId) || null, seller: row.seller || "Sem vendedor", purchases: [], products: new Map() };
    const value = n(row.revenue), quantity = n(row.quantity);
    item.purchases.push({ date, value, order: row.order, productId: n(row.productId), product: row.product, quantity, cost: n(row.cost) });
    const product = item.products.get(n(row.productId)) || { productId: n(row.productId), product: row.product, dates: [], revenue: 0, quantity: 0 };
    product.dates.push(date); product.revenue += value; product.quantity += quantity; item.products.set(product.productId, product); customers.set(customerId, item);
    const key = `${customerId}:${row.order}`; const order = orders.get(key) || new Set(); order.add(n(row.productId)); orders.set(key, order);
  }
  const pairSupport = new Map();
  for (const set of orders.values()) { const ids = [...set].filter(Boolean).sort((a,b)=>a-b); for (let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){ const key=`${ids[i]}:${ids[j]}`; pairSupport.set(key,(pairSupport.get(key)||0)+1); } }
  const opportunities = [];
  for (const c of customers.values()) {
    const dates = [...new Set(c.purchases.map((p) => p.date.toISOString().slice(0,10)))].map((x)=>new Date(x)).sort((a,b)=>a-b);
    const intervals = dates.slice(1).map((date,i)=>daysBetween(dates[i],date)); const habitual = avg(intervals);
    const last = dates.at(-1), daysIdle = daysBetween(last, now), historicalRevenue = c.purchases.reduce((s,p)=>s+p.value,0);
    const currentStart = new Date(now.getTime()-periodDays*day), previousStart = new Date(now.getTime()-periodDays*2*day);
    const current = c.purchases.filter((p)=>p.date>=currentStart).reduce((s,p)=>s+p.value,0);
    const previous = c.purchases.filter((p)=>p.date>=previousStart&&p.date<currentStart).reduce((s,p)=>s+p.value,0);
    const reductionPercent = previous > 0 ? Math.max(0,(previous-current)/previous*100) : 0;
    if (dates.length >= 3 && daysIdle >= Math.max(n(options.minimumInactiveDays)||30, habitual*1.5)) opportunities.push(base(c,"inatividade",`Há ${daysIdle} dias sem comprar; intervalo habitual estimado em ${Math.round(habitual)} dias.`,{ lastPurchase:last,daysIdle,habitualInterval:Math.round(habitual),historicalRevenue,reductionPercent,delayRatio:habitual?daysIdle/habitual:0 }));
    if (previous > 0 && reductionPercent >= (n(options.minimumReduction)||30)) opportunities.push(base(c,"reducao_compras",`Faturamento caiu ${reductionPercent.toFixed(1)}% entre períodos equivalentes de ${periodDays} dias; a causa não foi inferida.`,{currentRevenue:current,previousRevenue:previous,historicalRevenue,reductionPercent,delayRatio:0}));
    for (const product of c.products.values()) {
      const unique = [...new Set(product.dates.map((x)=>x.toISOString().slice(0,10)))].map((x)=>new Date(x)).sort((a,b)=>a-b); if(unique.length<3) continue;
      const pIntervals=unique.slice(1).map((date,i)=>daysBetween(unique[i],date)), pHabitual=avg(pIntervals), pIdle=daysBetween(unique.at(-1),now);
      if(pIdle>=Math.max(14,pHabitual*1.35)) opportunities.push(base(c,"recompra",`${product.product} era comprado a cada ${Math.round(pHabitual)} dias; já se passaram ${pIdle} dias. É uma necessidade estimada, não confirmada.`,{productId:product.productId,product:product.product,lastPurchase:unique.at(-1),daysIdle:pIdle,habitualInterval:Math.round(pHabitual),historicalRevenue:product.revenue,delayRatio:pHabitual?pIdle/pHabitual:0}));
    }
    const owned=new Set(c.products.keys());
    for(const [key,support] of pairSupport){ if(support<minSupport)continue; const [a,b]=key.split(":").map(Number), target=owned.has(a)&&!owned.has(b)?b:owned.has(b)&&!owned.has(a)?a:null; if(!target)continue; opportunities.push(base(c,"venda_cruzada",`Produto ${target} apareceu junto a itens comprados por este cliente em ${support} pedidos. Associação comercial não comprova compatibilidade técnica.`,{productId:target,support,historicalRevenue,delayRatio:0})); }
  }
  return opportunities.map((item)=>({...item,...scoreOpportunity(item.metrics)})).sort((a,b)=>b.score-a.score);
}
function base(customer,type,reason,metrics){ return { key:`${customer.customerId}:${type}:${metrics.productId||"geral"}`,customerId:customer.customerId,customer:customer.customer,sellerId:customer.sellerId,seller:customer.seller,type,reason,evidence:{sources:["SAIDAESTOQUE","SAIDAPRODUTO","CLIENTE","VENDEDOR"],metrics},metrics}; }
