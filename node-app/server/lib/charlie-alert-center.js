const ENCERRADOS = new Set(["converted", "dismissed"]);

function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function presente(objeto, chave) {
  return Boolean(objeto) && Object.prototype.hasOwnProperty.call(objeto, chave);
}

function booleano(objeto, chave) {
  if (!presente(objeto, chave)) return null;
  return Boolean(objeto[chave]);
}

function horarioDe(valor) {
  const textoHora = texto(valor);
  return textoHora && /^([01]\d|2[0-3]):[0-5]\d$/.test(textoHora) ? textoHora : null;
}

export function resumirAlertas(fatos = {}) {
  const lacunas = [
    "A frequência e a preferência só aparecem quando estão gravadas no controle.",
    "O agrupamento usa o tipo já gravado na oportunidade.",
    "E-mail e telefone não aparecem nesta tela.",
    "Nenhum aviso foi disparado.",
  ];
  const configuracao = fatos.configuracao;
  if (configuracao == null) lacunas.push("A preferência de aviso não foi lida.");
  if (fatos.alertas == null) lacunas.push("Os alertas não foram lidos.");
  const aviso = configuracao?.notification && typeof configuracao.notification === "object" ? configuracao.notification : null;
  const horarioGravado = presente(configuracao, "dailyReportTime");
  const horario = horarioGravado ? horarioDe(configuracao.dailyReportTime) : null;
  if (horarioGravado && !horario) lacunas.push("O horário gravado não está no formato HH:MM.");
  const abertos = (fatos.alertas || []).filter((item) => item && !ENCERRADOS.has(item.status));
  const grupos = new Map();
  for (const item of abertos) {
    const tipo = texto(item.type) || "sem tipo";
    grupos.set(tipo, (grupos.get(tipo) || 0) + 1);
  }
  const agrupamento = fatos.alertas == null ? [] : [...grupos.entries()].map(([tipo, quantidade]) => ({ tipo, quantidade })).sort((a, b) => b.quantidade - a.quantidade || a.tipo.localeCompare(b.tipo, "pt-BR"));
  const itens = abertos
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || String(a.id || "").localeCompare(String(b.id || "")))
    .slice(0, 100)
    .map((item) => ({
      id: texto(item.id) || texto(item.key),
      tipo: texto(item.type),
      prioridade: texto(item.priority),
      status: texto(item.status),
      descricao: texto(item.description),
    }));
  if (abertos.length > 100) lacunas.push("A lista para em 100 alertas em aberto. Não é o total.");
  return {
    preferencia: {
      avisos: booleano(configuracao, "notifications"),
      horario,
      email: booleano(aviso, "email"),
      whatsapp: booleano(aviso, "whatsapp"),
      envioReal: booleano(aviso, "sendReal"),
    },
    agrupamento,
    itens,
    abertos: fatos.alertas == null ? null : abertos.length,
    lacunas,
    aviso: "Nenhum aviso foi disparado. A tela só lê o controle já gravado.",
  };
}
