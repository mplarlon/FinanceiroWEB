const MEDIOS = new Set(["pricing", "price", "campaign", "campaign_draft", "campanha", "descricao"]);
const ALTOS = new Set(["financeiro", "credito", "cancelamento", "massa", "exclusao"]);

export function classificarSinal(sinal = {}) {
  const tipo = String(sinal.tipo || "").toLowerCase();
  const texto = `${sinal.tipo || ""} ${sinal.descricao || ""}`.toLowerCase();
  if (ALTOS.has(tipo) || /cr[eé]dito|cancel|em massa|exclus|apagar registro|opera[cç][aã]o financeira/.test(texto)) {
    return { risco: "alto", podeAutomatizar: false, motivo: "Exige aprovação humana. O Autopilot não executa operação financeira, crédito, cancelamento, alteração em massa nem exclusão." };
  }
  if (MEDIOS.has(tipo)) {
    return { risco: "medio", podeAutomatizar: false, motivo: "Exige autorização específica. Preço, campanha e descrição continuam na central de ações e não são alterados aqui." };
  }
  return { risco: "baixo", podeAutomatizar: true, motivo: "Pode virar alerta, relatório ou tarefa interna. Não envia mensagem nem altera cadastro." };
}

export function montarCiclo(fontes = {}, opcoes = {}) {
  const baixoAutomatico = Boolean(opcoes.baixoAutomatico);
  const sinais = reunir(fontes);
  const propostas = sinais.map((sinal) => {
    const classe = classificarSinal(sinal);
    let etapa = sinal.etapaInicial || (classe.risco === "alto" ? "bloqueada" : "recomendada");
    let resultado = sinal.etapaInicial === "rejeitada" ? "Já estava rejeitada na central de ações." : null;
    if (baixoAutomatico && classe.risco === "baixo" && !sinal.etapaInicial) {
      etapa = "executada";
      resultado = "Registro interno. Nenhuma mensagem foi enviada e nenhum cadastro foi alterado.";
    }
    return { ...sinal, ...classe, etapa, resultado };
  });
  return {
    problemas: propostas.filter((item) => item.risco === "alto" || item.prioridade === "critical"),
    oportunidades: propostas.filter((item) => item.origem !== "acao"),
    propostas,
    executadas: propostas.filter((item) => item.etapa === "executada"),
    rejeitadas: propostas.filter((item) => item.etapa === "rejeitada"),
    resultados: {
      observado: fontes.resultados?.observedRevenue ?? null,
      estimado: fontes.resultados?.estimatedRevenue ?? null,
      aviso: fontes.resultados?.attributionNotice || "Nenhuma venda foi atribuída a este ciclo.",
    },
    aviso: "O ciclo classifica o que os módulos já registraram. Não cria problema novo e não executa ação de risco médio ou alto.",
  };
}

function reunir(fontes) {
  const acoes = fontes.acoes || [];
  const ligadas = new Set(acoes.map((item) => item.opportunityId).filter(Boolean));
  const sinais = [];
  for (const item of fontes.oportunidades || []) {
    if (["converted", "dismissed", "rejeitada"].includes(item.status)) continue;
    if (ligadas.has(item.id)) continue;
    sinais.push({ id: `oportunidade:${item.id}`, origem: "oportunidade", tipo: item.type || "oportunidade", descricao: item.description || "", prioridade: item.priority || null, status: item.status || "identified" });
  }
  for (const item of acoes) {
    if (["rejected", "rejeitada", "reverted"].includes(item.status)) {
      sinais.push({ id: `acao:${item.id}`, origem: "acao", tipo: item.type || "acao", descricao: item.description || "", prioridade: item.priority || null, status: item.status, etapaInicial: "rejeitada" });
      continue;
    }
    sinais.push({ id: `acao:${item.id}`, origem: "acao", tipo: item.type || "acao", descricao: item.description || "", prioridade: item.priority || null, status: item.status || "pending" });
  }
  for (const item of fontes.campanhas || []) {
    if (item.status === "rejeitada") continue;
    sinais.push({ id: `campanha:${item.id}`, origem: "campanha", tipo: "campanha", descricao: item.objetivo || item.nome || "", prioridade: null, status: item.status || "rascunho" });
  }
  return sinais.map((item) => item.etapaInicial ? { ...item, etapa: item.etapaInicial } : item);
}

export function aplicarDecisao(item, decisao, baixoAutomatico) {
  if (!item) {
    const erro = new Error("Ação do Autopilot não encontrada.");
    erro.status = 404;
    throw erro;
  }
  if (decisao === "rejeitar") return { ...item, etapa: "rejeitada", resultado: "Rejeitada por um usuário. Nada foi executado." };
  if (item.risco === "alto") {
    const erro = new Error("Ação de alto risco não é executada pelo Autopilot.");
    erro.status = 403;
    throw erro;
  }
  if (item.risco === "medio") {
    const erro = new Error("Preço, campanha e descrição não são executados aqui. A autorização continua na central de ações.");
    erro.status = 403;
    throw erro;
  }
  if (!baixoAutomatico) {
    const erro = new Error("A automação de baixo risco está desligada.");
    erro.status = 403;
    throw erro;
  }
  return { ...item, etapa: "executada", resultado: "Registro interno. Nenhuma mensagem foi enviada e nenhum cadastro foi alterado." };
}
