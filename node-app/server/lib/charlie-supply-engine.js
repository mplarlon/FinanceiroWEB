const n=(v)=>Number.isFinite(Number(v))?Number(v):0;
const round=(v,d=2)=>Number(n(v).toFixed(d));
const DAY=86400000;

export function availableStock(item={}){
  // onHand is physical stock. Reservations and open sales are alternatives: installations
  // that expose reservations as already allocated must not subtract the same demand twice.
  const committed=item.reservationsIncludeOpenSales!==false?Math.max(n(item.reserved),n(item.openSales)):n(item.reserved)+n(item.openSales);
  return round(n(item.onHand)-committed);
}

export function demandProfile(history=[]){
  const values=history.map(n).filter(v=>v>=0),active=values.filter(v=>v>0);
  if(!values.length)return{type:"unknown",mean:0,sd:0,cv:null,zeroRatio:1,evidence:"Sem histórico de demanda."};
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const sd=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,values.length-1));
  const zeroRatio=values.filter(v=>v===0).length/values.length,cv=mean?sd/mean:null;
  const type=zeroRatio>=.5?"intermittent":cv!=null&&cv>.6?"variable":"stable";
  return{type,mean:round(mean,4),sd:round(sd,4),cv:cv==null?null:round(cv,3),zeroRatio:round(zeroRatio,3),evidence:`${values.length} período(s), ${active.length} com consumo.`};
}

const Z={.8:.842,.85:1.036,.9:1.282,.95:1.645,.975:1.96,.98:2.054,.99:2.326};
function zFor(level){const keys=Object.keys(Z).map(Number);return Z[keys.sort((a,b)=>Math.abs(a-level)-Math.abs(b-level))[0]];}
export function safetyStock(input={}){
  const profile=input.profile||demandProfile(input.history||[]),lead=Math.max(0,n(input.leadTimeDays)),configured=Math.max(0,n(input.configuredSafetyStock));
  if((input.history||[]).length<6||profile.type==="unknown")return{quantity:round(configured),method:"configured_fallback",limited:true,reason:"Histórico insuficiente; aplicada a regra configurada."};
  const z=zFor(Math.min(.99,Math.max(.8,n(input.serviceLevel)||.95))),leadSd=Math.max(0,n(input.leadTimeSd));
  let quantity;
  if(profile.type==="intermittent"){
    const nonZero=(input.history||[]).map(n).filter(v=>v>0).sort((a,b)=>a-b);
    const p=nonZero[Math.max(0,Math.ceil(nonZero.length*.8)-1)]||0;
    quantity=z*p*Math.sqrt(Math.max(1,lead));
  }else quantity=z*Math.sqrt(lead*profile.sd**2+(profile.mean**2)*(leadSd**2));
  return{quantity:round(Math.max(configured,quantity)),method:profile.type==="intermittent"?"intermittent_p80":"service_level_variability",limited:false,reason:`Perfil ${profile.type}; nível de serviço ${round((n(input.serviceLevel)||.95)*100,1)}%.`};
}

export function roundPurchaseQuantity(quantity,{minimumOrder=0,packMultiple=1}={}){
  if(n(quantity)<=0)return 0;
  const minimum=Math.max(0,n(minimumOrder)),multiple=Math.max(1,n(packMultiple));
  return Math.ceil(Math.max(n(quantity),minimum)/multiple)*multiple;
}

export function replenishment(item={},options={}){
  const available=availableStock(item),daily=Math.max(0,n(item.dailyDemand)),lead=Math.max(0,n(item.leadTimeDays));
  const safety=item.safetyStock!=null?{quantity:n(item.safetyStock),method:"configured",limited:false,reason:"Estoque de segurança cadastrado."}:safetyStock({...item,serviceLevel:options.serviceLevel||item.serviceLevel});
  const horizon=Math.max(1,n(options.horizonDays)||30),inbound=Math.max(0,n(item.openPurchases));
  const forecast=Math.max(0,item.forecastDemand!=null?n(item.forecastDemand):daily*horizon);
  const projected=available+inbound-forecast;
  const raw=Math.max(0,forecast+safety.quantity-available-inbound);
  const suggested=roundPurchaseQuantity(raw,item);
  const coverage=daily>0?available/daily:null;
  const urgency=available<=0&&daily>0?"critical":coverage!=null&&coverage<lead?"high":suggested>0?"medium":"low";
  return{...item,availableStock:available,forecastDemand:round(forecast),projectedAvailability:round(projected),coverageDays:coverage==null?null:round(coverage,1),safetyStock:round(safety.quantity),safetyMethod:safety.method,safetyLimited:safety.limited,suggestedQuantity:round(suggested),urgency,calculation:{available:`${n(item.onHand)} - compromissos = ${available}`,need:`max(0, ${round(forecast)} + ${round(safety.quantity)} - ${available} - ${inbound})`,horizonDays:horizon}};
}

export function classifyInventory(items=[],options={}){
  const enriched=items.map(x=>{const consumption=n(x.annualConsumption||x.dailyDemand*365),value=consumption*n(x.unitCost),profile=demandProfile(x.demandHistory||[]);return{...x,annualConsumption:round(consumption),consumptionValue:round(value),demandClass:profile.type,turnover:n(x.averageStock)>0?round(consumption/n(x.averageStock)):null};}).sort((a,b)=>b.consumptionValue-a.consumptionValue);
  const total=enriched.reduce((s,x)=>s+x.consumptionValue,0);let cumulative=0;
  return enriched.map(x=>{cumulative+=x.consumptionValue;const share=total?cumulative/total:1;return{...x,abc:share<=n(options.aThreshold||.8)?"A":share<=n(options.bThreshold||.95)?"B":"C",abcCriterion:"consumption_value"};});
}

export function excessStock(item={},options={}){
  const available=availableStock(item),daily=Math.max(0,n(item.dailyDemand)),maxDays=Math.max(1,n(options.maxCoverageDays||item.maxCoverageDays||90));
  const allowed=item.maximumStock!=null?n(item.maximumStock):daily*maxDays;
  const quantity=Math.max(0,available-allowed),last=item.lastMovement?Math.floor((new Date(options.now||Date.now())-new Date(item.lastMovement))/DAY):null;
  return{...item,excessQuantity:round(quantity),excessValue:round(quantity*n(item.unitCost)),coverageDays:daily?round(available/daily,1):null,lastMovementDays:last,recommendation:quantity>0?"Suspender ou reduzir novas compras e revisar consumo; capital imobilizado não é prejuízo realizado.":"Sem excesso pelos parâmetros atuais."};
}

export function acquisitionCost(offer={},quantity=0){
  const known={products:n(offer.unitPrice)*n(quantity),freight:n(offer.freight),insurance:n(offer.insurance),additional:n(offer.additionalCosts),nonRecoverableTaxes:n(offer.nonRecoverableTaxes),discounts:n(offer.discounts)};
  const total=known.products+known.freight+known.insurance+known.additional+known.nonRecoverableTaxes-known.discounts;
  const unknown=["freight","insurance","additionalCosts","nonRecoverableTaxes","discounts"].filter(k=>offer[k]==null);
  return{quantity:n(quantity),components:Object.fromEntries(Object.entries(known).map(([k,v])=>[k,round(v)])),total:round(total),unitTotal:n(quantity)?round(total/n(quantity),4):null,unknown,taxRule:offer.nonRecoverableTaxes==null?"not_evaluated":"erp_validated_input"};
}

export function supplierPerformance(deliveries=[]){
  const rows=deliveries.filter(x=>x.orderedAt&&x.receivedAt).map(x=>{const promised=x.promisedAt?Math.max(0,(new Date(x.receivedAt)-new Date(x.promisedAt))/DAY):null;return{lead:Math.max(0,(new Date(x.receivedAt)-new Date(x.orderedAt))/DAY),delay:promised==null?null:promised,quantityDivergence:Math.abs(n(x.orderedQuantity)-n(x.receivedQuantity)),returned:n(x.returnedQuantity),cancelled:Boolean(x.cancelled)};});
  const avg=k=>rows.length?round(rows.reduce((s,x)=>s+n(x[k]),0)/rows.length,1):null,dated=rows.filter(x=>x.delay!=null);
  return{records:rows.length,limited:rows.length<5,averageLeadDays:avg("lead"),onTimePercent:dated.length?round(dated.filter(x=>x.delay<=0).length/dated.length*100,1):null,averageDelayDays:dated.length?round(dated.reduce((s,x)=>s+Math.max(0,x.delay),0)/dated.length,1):null,quantityDivergence:round(rows.reduce((s,x)=>s+x.quantityDivergence,0)),returns:round(rows.reduce((s,x)=>s+x.returned,0)),cancellations:rows.filter(x=>x.cancelled).length};
}

export function compareSuppliers(offers=[],quantity=0,options={}){
  return offers.map(offer=>{const ordered=roundPurchaseQuantity(quantity,offer),cost=acquisitionCost(offer,ordered),performance=supplierPerformance(offer.deliveries||[]);const lead=n(offer.leadTimeDays||performance.averageLeadDays);const score=cost.unitTotal==null?Infinity:cost.unitTotal+(lead*n(options.leadDayCost||0))+(performance.onTimePercent==null?0:(100-performance.onTimePercent)*n(options.latenessPenalty||.01));return{...offer,orderedQuantity:ordered,cost,performance,score:round(score,4),limitations:[...(cost.unknown.length?[`Componentes sem informação: ${cost.unknown.join(", ")}.`]:[]),...(performance.limited?["Histórico de entregas com evidência limitada."]:[])]};}).sort((a,b)=>a.score-b.score);
}

export function simulateSupply(items=[],offersByProduct={},options={}){
  const rows=items.map(x=>replenishment(x,options)).filter(x=>!options.criticalOnly||["critical","high"].includes(x.urgency)).map(x=>{const offers=compareSuppliers(offersByProduct[x.productId]||[],x.suggestedQuantity,options);return{...x,bestOffer:offers[0]||null,estimatedCost:offers[0]?.cost.total??null};});
  return{rows,totalKnownCost:round(rows.reduce((s,x)=>s+n(x.estimatedCost),0)),unknownCostItems:rows.filter(x=>x.estimatedCost==null).length,simulationOnly:true};
}

export function groupPurchases(rows=[],field="supplierId"){
  const groups=new Map();for(const row of rows){const key=row[field]??"unassigned",current=groups.get(key)||{key,items:[],estimatedCost:0};current.items.push(row);current.estimatedCost+=n(row.estimatedCost);groups.set(key,current);}return[...groups.values()].map(x=>({...x,estimatedCost:round(x.estimatedCost)}));
}
