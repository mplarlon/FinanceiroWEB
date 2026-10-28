function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function horarioDe(agenda) {
  if (!agenda || !Number.isInteger(agenda.hora) || !Number.isInteger(agenda.minuto)) return null;
  return `${String(agenda.hora).padStart(2, "0")}:${String(agenda.minuto).padStart(2, "0")}`;
}

function itemDe(bruto) {
  const agenda = bruto?.agenda && typeof bruto.agenda === "object" ? bruto.agenda : null;
  return {
    id: bruto?.id ?? null,
    nome: texto(bruto?.nome),
    status: texto(bruto?.status),
    modalidade: texto(bruto?.modalidade),
    acao: texto(bruto?.acao),
    agenda: texto(agenda?.tipo),
    horario: horarioDe(agenda),
    proximaExecucao: texto(bruto?.proximaExecucao),
    politica: texto(bruto?.politicaConfirmacao),
    objetivo: texto(bruto?.objetivo)?.slice(0, 180) || null,
  };
}

export function resumirAutomacoes(lista) {
  const lacunas = [
    "A lista usa o motor de automações que já existe.",
    "Esta tela não confirma, não pausa e não executa.",
    "Destinatário e parâmetro não aparecem aqui.",
  ];
  if (lista == null) lacunas.push("As automações não foram lidas.");
  const todas = Array.isArray(lista) ? lista : [];
  if (todas.length > 100) lacunas.push("A lista para em 100 automações. Não é o arquivo inteiro.");
  const itens = todas.slice(0, 100).map(itemDe);
  if (Array.isArray(lista) && !itens.length) lacunas.push("Não há automação gravada neste servidor.");
  return {
    itens,
    lidas: todas.length,
    ativas: itens.filter((item) => item.status === "ativa").length,
    aguardando: itens.filter((item) => item.status === "aguardando_confirmacao").length,
    lacunas,
    aviso: "Nenhuma automação foi confirmada, pausada ou executada nesta tela.",
  };
}
