import { query } from "../db.js";

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date, amount) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
};

const validDate = (year, month, day) => {
  const result = new Date(year, month - 1, day);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day
    ? result
    : null;
};

const databaseDate = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return validDate(year, month, day);
};

const WEEKDAYS = {
  domingo: 0,
  segunda: 1,
  "segunda-feira": 1,
  terca: 2,
  "terca-feira": 2,
  quarta: 3,
  "quarta-feira": 3,
  quinta: 4,
  "quinta-feira": 4,
  sexta: 5,
  "sexta-feira": 5,
  sabado: 6,
};

export function parseFinancialDate(question, now = new Date()) {
  const text = normalize(question);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\bhoje\b/.test(text)) return { start: isoDate(today), end: isoDate(today), label: "hoje" };
  if (/\bamanha\b/.test(text)) {
    const tomorrow = addDays(today, 1);
    return { start: isoDate(tomorrow), end: isoDate(tomorrow), label: "amanhã" };
  }
  const inDays = text.match(/\bdaqui\s+a\s+(\d{1,3})\s+dias?\b/);
  if (inDays) {
    const target = addDays(today, Math.min(365, Number(inDays[1])));
    return {
      start: /\bate\b/.test(text) ? isoDate(today) : isoDate(target),
      end: isoDate(target),
      label: /\bate\b/.test(text) ? `até daqui a ${inDays[1]} dias` : `daqui a ${inDays[1]} dias`,
    };
  }
  if (/\b(?:esta|nesta|nessa)\s+semana\b/.test(text)) {
    const end = addDays(today, (7 - today.getDay()) % 7);
    return { start: isoDate(today), end: isoDate(end), label: "nesta semana" };
  }
  if (/\b(?:proxima|semana que vem)\s+semana?\b|\bsemana que vem\b/.test(text)) {
    const monday = addDays(today, ((8 - today.getDay()) % 7) || 7);
    return { start: isoDate(monday), end: isoDate(addDays(monday, 6)), label: "na próxima semana" };
  }
  if (/\b(?:este|neste|nesse|deste)\s+mes\b/.test(text)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: isoDate(start), end: isoDate(end), label: "neste mês" };
  }
  if (/\b(?:fim|final)\s+do\s+mes\b/.test(text)) {
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: isoDate(today), end: isoDate(end), label: "até o fim do mês" };
  }
  if (/\bontem\b/.test(text)) {
    const yesterday = addDays(today, -1);
    return { start: isoDate(yesterday), end: isoDate(yesterday), label: "ontem" };
  }
  if (/\bmes passado\b/.test(text)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: isoDate(start), end: isoDate(end), label: "no mês passado" };
  }
  if (/\bano passado\b/.test(text)) {
    const year = today.getFullYear() - 1;
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: "no ano passado" };
  }
  if (/\b(?:este|neste|nesse)\s+ano\b/.test(text)) {
    const year = today.getFullYear();
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: "neste ano" };
  }
  const months = {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  };
  const monthName = Object.keys(months).find((name) => new RegExp(`\\b${name}\\b`).test(text));
  if (monthName) {
    const month = months[monthName];
    const explicit = text.match(/\b(20\d{2})\b/);
    let year = explicit ? Number(explicit[1]) : today.getFullYear();
    if (!explicit && month - 1 > today.getMonth()) year -= 1;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { start: isoDate(start), end: isoDate(end), label: `em ${monthName}` };
  }

  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    let date = validDate(year, Number(numeric[2]), Number(numeric[1]));
    if (date && !numeric[3] && date < today)
      date = validDate(year + 1, Number(numeric[2]), Number(numeric[1]));
    if (date) {
      const until = /\bate\b/.test(text);
      return {
        start: until ? isoDate(today) : isoDate(date),
        end: isoDate(date),
        label: until
          ? `até o dia ${date.toLocaleDateString("pt-BR")}`
          : `em ${date.toLocaleDateString("pt-BR")}`,
      };
    }
  }

  const dayOnly = text.match(/\b(?:dia|no)\s+(\d{1,2})\b/);
  if (dayOnly) {
    let date = validDate(today.getFullYear(), today.getMonth() + 1, Number(dayOnly[1]));
    if (date && date < today) date = validDate(today.getFullYear(), today.getMonth() + 2, Number(dayOnly[1]));
    if (date) {
      const until = /\bate\b/.test(text);
      return {
        start: until ? isoDate(today) : isoDate(date),
        end: isoDate(date),
        label: until
          ? `até o dia ${date.toLocaleDateString("pt-BR")}`
          : `no dia ${date.toLocaleDateString("pt-BR")}`,
      };
    }
  }

  const weekdayMatch = Object.keys(WEEKDAYS).find((name) => new RegExp(`\\b${name}\\b`).test(text));
  if (weekdayMatch) {
    const target = WEEKDAYS[weekdayMatch];
    let distance = (target - today.getDay() + 7) % 7;
    if (!distance && !/\b(?:ate|nesta|essa)\b/.test(text)) distance = 7;
    const date = addDays(today, distance);
    return {
      start: /\bate\b/.test(text) ? isoDate(today) : isoDate(date),
      end: isoDate(date),
      label: /\bate\b/.test(text) ? `até ${weekdayMatch}` : `na próxima ${weekdayMatch}`,
    };
  }
  return null;
}

function extractPerson(question) {
  const original = String(question || "").trim();
  const patterns = [
    /\b(?:pagar|receber)\s+(?:para\s+|da\s+|do\s+)(?:a\s+|o\s+)?(.+?)(?=\s+(?:no|na|dia|ate|até|hoje|amanh[ãa]|venc|em aberto|atras)|[?.!,]|$)/i,
    /\b(?:devo|devendo)\s+(?:(?:algo|alguma coisa|quanto)\s+)?(?:para\s+|a\s+|ao\s+)(?:a\s+|o\s+)?(.+?)(?=\s+(?:no|na|dia|ate|até|hoje|amanh[ãa]|venc|em aberto|atras)|[?.!,]|$)/i,
    /\b(?:para|pro|pra)\s+(?:a\s+|o\s+)?(.+?)(?=\s+(?:no|na|dia|ate|até|hoje|amanh[ãa]|venc|em aberto|atras)|[?.!,]|$)/i,
    /\b(?:da|do)\s+(.+?)(?=\s+(?:no|na|dia|ate|até|hoje|amanh[ãa]|venc|em aberto|atras)|[?.!,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = original.match(pattern);
    const value = match?.[1]?.trim();
    if (
      value &&
      !/^(dia|mes|m[eê]s|ano|financeiro|pagar|receber|pagamento|recebimento|hoje|amanh[ãa]|prazo|caixa)(\b|\s)/i.test(value)
    )
      return value.slice(0, 80);
  }
  return null;
}

export function detectFinancialIntent(question, now = new Date()) {
  const text = normalize(question);
  const financialWords = /\b(conta|contas|titulo|titulos|duplicata|duplicatas|boleto|boletos|fatura|faturas|pagar|pagamento|pagamentos|desembolsar|sair|sai|saem|saida|receber|recebimento|recebimentos|cobrar|cobranca|entrar|entra|entram|entrada|vence|vencem|vencimento|vencimentos|atrasad[oa]s?|atraso|pendente|pendencia|pendencias|quitad[oa]s?|liquidad[oa]s?|baixad[oa]s?|pago|pagas|recebido|recebidas|compromisso|divida|dividas|debito|debitos|devo|devendo|saldo restante)\b/;
  if (!financialWords.test(text)) return null;

  let domain = null;
  if (/\b(receber|recebimento|recebimentos|cliente|clientes|cobrar|cobranca|cobrancas|recebido|recebidas|me devem|vai entrar|vao entrar|entrar no caixa|entra no caixa|credito a receber)\b/.test(text)) domain = "receber";
  if (/\b(pagar|pagamento|pagamentos|fornecedor|fornecedores|compromisso|compromissos|divida|dividas|debito|debitos|pago|pagas|devo|devendo|desembolsar|vai sair|vao sair|sair do caixa|sai do caixa)\b/.test(text)) domain = "pagar";
  if (!domain && /\bcontas?\s+atrasad/.test(text)) domain = "pagar";

  const status = /\b(parcial|parcialmente|parte paga|parte recebida|saldo restante)\b/.test(text)
    ? "parcial"
    : /\b(pag[oa]s?|quitad[oa]s?|liquidad[oa]s?|baixad[oa]s?|recebid[oa]s?)\b/.test(text)
      ? "quitado"
      : /\b(?:atrasad|vencid)[oa]s?\b|\bem atraso\b|\bfora do prazo\b/.test(text)
        ? "vencido"
        : "aberto";
  const date = parseFinancialDate(question, now);
  const person = extractPerson(question);

  return {
    type: "financeiro_titulos",
    domain,
    status,
    date,
    person,
    limit: 50,
  };
}

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dateLabel = (value) => {
  if (!value) return "sem data";
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toLocaleDateString("pt-BR");
  const raw = String(value).slice(0, 10).split("-");
  return raw.length === 3 ? `${raw[2]}/${raw[1]}/${raw[0]}` : String(value);
};

export async function answerFinancialQuestion(db, intent) {
  let preResolvedPeople = null;
  if (!intent.domain && intent.person) {
    const findPeople = (table, id, names) =>
      query(
        db,
        `SELECT FIRST 20 ${id} AS ID FROM ${table} WHERE ${names
          .split(",")
          .map((name) => `${name} CONTAINING ?`)
          .join(" OR ")}`,
        names.split(",").map(() => intent.person),
      );
    const [suppliers, customers] = await Promise.all([
      findPeople("FORNECEDOR", "CDFORNECEDOR", "FORNECEDOR,FANTASIA"),
      findPeople("CLIENTE", "CDCLIENTE", "CLIENTE,RAZAO"),
    ]);
    if (suppliers.length && !customers.length) {
      intent = { ...intent, domain: "pagar" };
      preResolvedPeople = suppliers;
    } else if (customers.length && !suppliers.length) {
      intent = { ...intent, domain: "receber" };
      preResolvedPeople = customers;
    }
  }
  if (!intent.domain) {
    return {
      resposta: "Você quer consultar contas a pagar ou contas a receber?",
      intencao: { ...intent, needsClarification: true },
      dados: [],
      sugestoes: ["contas a pagar", "contas a receber"],
    };
  }

  const receive = intent.domain === "receber";
  const table = receive ? "CTARECEBER" : "CTAPAGAR";
  const personTable = receive ? "CLIENTE" : "FORNECEDOR";
  const personId = receive ? "CDCLIENTE" : "CDFORNECEDOR";
  const personName = receive ? "p.CLIENTE" : "p.FORNECEDOR";
  const baseValue = receive ? "COALESCE(t.VALOR,t.DIVIDA,0)" : "COALESCE(t.VALOR,t.TOTAL,0)";
  const paidValue = receive ? "COALESCE(t.TOTALPG,t.VLPGLIQ,0)" : "COALESCE(t.VLPAGTO,0)";
  const paidDate = receive ? "t.DTCOB" : "t.DTPAGTO";
  const document = receive
    ? "CAST(COALESCE(CAST(t.NRPEDIDO AS VARCHAR(20)),t.NRDOC,t.NRDOC2) AS VARCHAR(40))"
    : "CAST(COALESCE(t.NOTAFISCAL,t.NRDOC,t.NRDOC2) AS VARCHAR(40))";
  const conservativeBalance = `CASE WHEN t.STATUS=1 AND ${paidValue}>0 AND ${paidValue}<${baseValue} THEN ${baseValue}-${paidValue} ELSE ${baseValue} END`;
  const where = ["t.DTVENC IS NOT NULL"];
  const params = [];

  if (intent.status === "quitado") where.push("t.STATUS=2");
  else {
    where.push("t.STATUS=1");
    if (intent.status === "vencido") {
      where.push("t.DTVENC<CURRENT_DATE");
      // Vales são adiantamentos internos e não devem compor as contas
      // atrasadas apresentadas pelo Charlie.
      if (!receive) where.push("COALESCE(t.STATUSVALE,0) NOT IN (1,2)");
    }
    if (intent.status === "parcial") where.push(`${paidValue}>0`, `${paidValue}<${baseValue}`);
  }
  if (intent.date?.start) {
    where.push("t.DTVENC>=CAST(? AS DATE)");
    params.push(databaseDate(intent.date.start));
  }
  if (intent.date?.end) {
    where.push("t.DTVENC<DATEADD(1 DAY TO CAST(? AS DATE))");
    params.push(databaseDate(intent.date.end));
  }
  if (intent.person) {
    // Resolve primeiro os IDs. Aplicar a busca textual depois do JOIN faz o
    // Firebird percorrer cadastros antigos com bytes invalidos de charset.
    const names = receive ? ["CLIENTE", "RAZAO"] : ["FORNECEDOR", "FANTASIA"];
    const people = preResolvedPeople || await query(
      db,
      `SELECT FIRST 20 ${personId} AS ID FROM ${personTable}
       WHERE ${names.map((name) => `${name} CONTAINING ?`).join(" OR ")}`,
      names.map(() => intent.person),
    );
    if (!people.length) where.push("1=0");
    else {
      where.push(`t.${personId} IN (${people.map(() => "?").join(",")})`);
      params.push(...people.map((row) => Number(row.ID)));
    }
  }

  const amount = intent.status === "quitado" ? paidValue : conservativeBalance;
  const rawData = await query(
    db,
    `SELECT FIRST ${Math.max(1, Math.min(50, Number(intent.limit) || 50))}
       t.CONTROLE,t.IDEMPRESA,${personId === "CDCLIENTE" ? "t.CDCLIENTE" : "t.CDFORNECEDOR"} AS PESSOA_ID,
       ${personName} AS PESSOA,${document} AS DOCUMENTO,t.PARCELA,
       CAST(t.DTVENC AS DATE) AS VENCIMENTO,${amount} AS SALDO,
       ${baseValue} AS VALOR_ORIGINAL,${paidValue} AS VALOR_BAIXADO,
       CASE WHEN t.STATUS=1 AND t.DTVENC<CURRENT_DATE THEN DATEDIFF(DAY,t.DTVENC,CURRENT_DATE) ELSE 0 END AS DIAS_ATRASO,
       CASE WHEN t.STATUS=2 THEN 'Quitado' WHEN ${paidValue}>0 AND ${paidValue}<${baseValue} THEN 'Parcial' WHEN t.DTVENC<CURRENT_DATE THEN 'Vencido' ELSE 'Aberto' END AS SITUACAO,
       CASE WHEN ${paidDate} IS NULL OR ${paidDate}<=CAST('1899-12-30' AS DATE) THEN NULL ELSE CAST(${paidDate} AS DATE) END AS DATA_BAIXA
     FROM ${table} t
     LEFT JOIN ${personTable} p ON p.${personId}=t.${personId}
     WHERE ${where.join(" AND ")}
     ORDER BY t.DTVENC,t.CONTROLE`,
    params,
  );
  const data = rawData.map((row) => ({ ...row, PESSOA: row.PESSOA || "Não informado" }));
  const summary = (
    await query(
      db,
      `SELECT COUNT(*) AS TITULOS,COALESCE(SUM(${amount}),0) AS TOTAL
       FROM ${table} t
       WHERE ${where.join(" AND ")}`,
      params,
    )
  )[0] || { TITULOS: 0, TOTAL: 0 };
  const titleCount = Number(summary.TITULOS || 0);
  const total = Number(summary.TOTAL || 0);
  const kind = receive ? "receber" : "pagar";
  const statusLabel = intent.status === "vencido" ? "vencida(s)" : intent.status === "quitado" ? "quitada(s)" : intent.status === "parcial" ? "parcialmente baixada(s)" : "em aberto";
  const filters = [intent.person ? `de ${intent.person}` : null, intent.date?.label || null].filter(Boolean).join(" ");
  let response = titleCount
    ? `Encontrei ${titleCount} conta(s) a ${kind} ${statusLabel}${filters ? ` ${filters}` : ""}, totalizando ${money(total)}.`
    : `Não encontrei contas a ${kind} ${statusLabel}${filters ? ` ${filters}` : ""}.`;
  if (data.length) {
    const preview = data.slice(0, 5).map((row) => `${row.PESSOA}: ${money(row.SALDO)} em ${dateLabel(row.VENCIMENTO)}`);
    response += ` ${preview.join("; ")}.`;
    if (titleCount > preview.length) response += ` Há mais ${titleCount - preview.length} título(s); até 50 aparecem na tabela abaixo.`;
  }
  return {
    resposta: response,
    intencao: intent,
    dados: data,
    sugestoes: receive
      ? ["contas a receber vencidas", "o que recebo hoje", "recebimentos até sexta"]
      : ["contas a pagar vencidas", "o que pago hoje", "pagamentos até sexta"],
  };
}
