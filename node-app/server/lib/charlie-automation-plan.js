import { getAction, userCan, validateActionParams } from "./charlie-task-catalog.js";

const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

export function looksLikeAutomation(text) {
  const value = normalize(text);
  return /\b(todo|toda|todos|todas|sempre que|quando|a cada|diariamente|semanalmente|mensalmente)\b/.test(value)
    && /\b(dia|dias|diariamente|semanalmente|mensalmente|semana|semanas|mes|meses|hora|horas|quando|sempre|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(value);
}

function actionFor(text) {
  const value = normalize(text);
  if (/maiores problemas|resumo executivo|problemas da empresa|resultados com as metas|compare os resultados com as metas/.test(value)) {
    const count = /\b3\b|\btres\b/.test(value) ? 3 : 3;
    return ["executivo.resumo", { limite: count, formato: /excel/.test(value) ? "excel" : "nenhum" }];
  }
  if (/risco financeiro|previsao indicar risco/.test(value)) return ["preditivo.fluxo_caixa", { dias: numberBefore(value, " dia") || 30 }];
  if (/(?:resultado|economia|produtividade).*(?:charlie|recomendac)|(?:charlie|recomendac).*(?:resultado|economia|produtividade)/.test(value)) return ["relatorios.resultados_charlie", { meses: /semana/.test(value) ? 1 : 1, formato: /pdf/.test(value) ? "pdf" : "excel" }];
  if (/anomali|comportamento.*incomum|alteracoes?.*atipic|cancelamentos?.*incomum|incomum.*cancelamentos?|risco elevado/.test(value)) return ["auditoria.anomalias_comportamentais", { risco: /elevado/.test(value) ? "elevado" : "todos", limite: 100 }];
  if (/duplicidades?.*financeir|titulos?.*duplicad/.test(value)) return ["auditoria.duplicidades_financeiras", { dias: numberBefore(value, " dia") || 90, limite: 500 }];
  if (/previs[aã]o.*fluxo de caixa|proj(?:etar|ecao).*fluxo de caixa/.test(text.toLowerCase())) return ["preditivo.fluxo_caixa", { dias: numberBefore(value, " dia") || 30 }];
  if (/previs[aã]o.*faturamento|prever.*faturamento/.test(text.toLowerCase())) return ["preditivo.faturamento", { dias: numberBefore(value, " dia") || 30 }];
  if (/risco.*ruptura|ruptura.*estoque/.test(value)) return ["preditivo.ruptura_estoque", { dias: 90 }];
  if (/margem/.test(value)) return ["produtos.margem_insuficiente", { margem: numberBefore(value, "%") || 15 }];
  if (/estoque.*minimo|minimo.*estoque/.test(value)) return ["estoque.abaixo_minimo", {}];
  if (/clientes?.*(?:reduziram|reducao|queda).*(?:compras?|faturamento)|(?:reducao|queda).*(?:compras?|faturamento).*clientes?/.test(value)) return ["comercial.reducao_compras", { meses: 3, percentual: numberBefore(value, "%") || 30, formato: /excel/.test(value) ? "excel" : "nenhum" }];
  if (/cliente.*(?:sem comprar|inativ)|(?:sem comprar|inativ).*cliente/.test(value)) return ["comercial.clientes_inativos", { dias: numberBefore(value, " dia") || 45 }];
  if (/inadimpl|titulos? vencid|contas? a receber/.test(value)) return ["financeiro.inadimplencia", { dominio: "receber", dias: 1, agrupar: "cliente", formato: /excel/.test(value) ? "excel" : "nenhum" }];
  if (/faturamento.*(?:cair|queda)|(?:cair|queda).*faturamento/.test(value)) return ["relatorios.faturamento_periodo", { meses: 1, periodo: "mes", formato: "excel" }];
  if (/vendas?.*(?:resumo|relatorio)|(?:resumo|relatorio).*vendas?/.test(value)) return ["relatorios.faturamento_periodo", { meses: 1, periodo: "mes", formato: /pdf/.test(value) ? "pdf" : "excel" }];
  if (/reajust|atualiz.*pre[cç]o/.test(text.toLowerCase())) {
    const tabela = Number(value.match(/tabela\s+(\d+)/)?.[1]);
    const percentual = numberBefore(value, "%");
    return ["produtos.reajuste_precos", { tabela: tabela || undefined, percentual: percentual || undefined }];
  }
  return null;
}

function numberBefore(text, suffix) {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${escaped}`));
  return found ? Number(found[1].replace(",", ".")) : null;
}

function scheduleFor(text, now = new Date()) {
  const value = normalize(text);
  const time = value.match(/(?:as|às)?\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\b/);
  const hour = time ? Number(time[1]) : null;
  const minute = time ? Number(time[2] || 0) : 0;
  const weekday = Object.entries(WEEKDAYS).find(([name]) => value.includes(name))?.[1];
  if (/primeiro dia util/.test(value)) return { tipo: "mensal_dia_util", diaUtil: 1, hora: hour, minuto: minute };
  if (weekday !== undefined) return { tipo: "semanal", diasSemana: [weekday], hora: hour, minuto: minute };
  const monthDay = value.match(/todo dia\s+(\d{1,2})\b/);
  if (monthDay) return { tipo: "mensal", diaMes: Number(monthDay[1]), hora: hour, minuto: minute };
  const interval = value.match(/a cada\s+(\d+)\s*(minuto|hora)/);
  if (interval) return { tipo: "intervalo", minutos: Number(interval[1]) * (interval[2] === "hora" ? 60 : 1), inicio: now.toISOString() };
  if (/todos os dias|todo dia|diariamente/.test(value)) return { tipo: "diaria", hora: hour, minuto: minute };
  if (/\bmensalmente\b/.test(value)) return { tipo: "mensal", diaMes: 1, hora: hour, minuto: minute };
  if (/quando|sempre que|\bse\b/.test(value)) return { tipo: "condicional", intervaloMinutos: 15 };
  return null;
}

export function nextExecution(schedule, from = new Date(), timezone = "America/Sao_Paulo") {
  if (!schedule) return null;
  if (schedule.tipo === "intervalo" || schedule.tipo === "condicional")
    return new Date(from.getTime() + Number(schedule.minutos || schedule.intervaloMinutos || 15) * 60000).toISOString();
  for (let offset = 1; offset <= 550 * 24 * 60; offset += 1) {
    const date = new Date(from.getTime() + offset * 60000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    const hour = Number(parts.hour), minute = Number(parts.minute), day = Number(parts.day);
    if (hour !== schedule.hora || minute !== schedule.minuto) continue;
    if (schedule.tipo === "diaria") return date.toISOString();
    if (schedule.tipo === "semanal" && schedule.diasSemana.includes(weekday)) return date.toISOString();
    if (schedule.tipo === "mensal" && day === schedule.diaMes) return date.toISOString();
    if (schedule.tipo === "mensal_dia_util" && weekday > 0 && weekday < 6 && day <= 3) return date.toISOString();
  }
  return null;
}

function recipients(text) {
  const value = normalize(text);
  const role = value.match(/(?:avise|notifique|envie (?:ao|a)|destino)\s+(?:o |a )?([^,.]+)/)?.[1];
  return role ? [{ tipo: "papel", valor: role.trim().slice(0, 80) }] : [];
}

function conditionFor(text, actionId) {
  const value = normalize(text);
  if (actionId === "financeiro.inadimplencia") {
    const amount = value.match(/r\$\s*([\d.]+(?:,\d+)?)/)?.[1];
    if (amount) return { tipo: "soma_maior_que", campos: ["SALDO", "TOTAL", "VALOR"], valor: Number(amount.replaceAll(".", "").replace(",", ".")), verificavel: true };
  }
  if (actionId === "preditivo.fluxo_caixa" && /risco financeiro|previsao indicar risco/.test(value))
    return { tipo: "projecao_caixa_negativa", verificavel: true };
  const percent = numberBefore(value, "%");
  if (/queda|cair|cair mais/.test(value) && percent) return { tipo: "variacao_menor_que", campos: ["VARIACAO", "PERCENTUAL"], valor: -Math.abs(percent), verificavel: true };
  return { tipo: actionId, verificavel: true };
}

export function planAutomation(text, user, options = {}) {
  if (!looksLikeAutomation(text)) return null;
  const selected = actionFor(text);
  if (!selected) return { ok: false, pergunta: "Qual ação ou relatório o Charlie deve executar nessa automação?" };
  const [actionId, rawParams] = selected;
  const action = getAction(actionId);
  if (!action || !userCan(action, user, "preparar")) return { ok: false, erro: "Você não tem permissão para configurar essa ação." };
  if (action.id === "executivo.resumo" && !user?.gerencial) return { ok: false, erro: "Você não tem permissão para configurar essa ação." };
  const schedule = scheduleFor(text, options.now || new Date());
  if (!schedule) return { ok: false, pergunta: "Qual deve ser a periodicidade ou condição de execução?" };
  if (["diaria", "semanal", "mensal", "mensal_dia_util"].includes(schedule.tipo) && schedule.hora == null)
    return { ok: false, pergunta: "Em qual horário a automação deve ser executada?" };
  const validation = validateActionParams(action, rawParams);
  if (!validation.ok) return { ok: false, pergunta: validation.errors[0] };
  const timezone = options.timezone || "America/Sao_Paulo";
  const conditional = schedule.tipo === "condicional";
  const write = action.nivel >= 3;
  return {
    ok: true,
    automacao: {
      nome: `${action.nome} — ${conditional ? "sob condição" : "programada"}`,
      objetivo: String(text).slice(0, 500),
      status: "aguardando_confirmacao",
      modalidade: conditional ? "condicional" : schedule.tipo === "intervalo" ? "recorrente" : "programada",
      acao: action.id,
      parametros: validation.params,
      agenda: schedule,
      fusoHorario: timezone,
      condicao: conditional ? conditionFor(text, action.id) : null,
      destinatarios: recipients(text),
      politicaConfirmacao: write ? "confirmar_cada_execucao" : "automatica_leitura",
      repeticaoAlertaMinutos: conditional ? 24 * 60 : null,
      criadaPor: Number(user?.id || 0),
      proximaExecucao: nextExecution(schedule, options.now || new Date(), timezone),
      ativaSemResponsavel: false,
    },
  };
}
