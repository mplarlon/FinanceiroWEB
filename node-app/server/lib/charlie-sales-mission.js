function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function dinheiro(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null;
}

function metaValida(valor) {
  const numero = dinheiro(valor);
  return numero != null && numero > 0 ? numero : null;
}

function dataIso(valor) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor || ""));
  return match ? match[1] : null;
}

function fechar(item) {
  const meta = metaValida(item.meta);
  if (!meta) return null;
  const realizado = dinheiro(item.realizado);
  const falta = realizado == null ? null : Math.round((meta - realizado) * 100) / 100;
  const atingimento = realizado == null ? null : Math.round((realizado / meta) * 10000) / 100;
  const situacao = realizado == null ? "Realizado não consultado" : falta <= 0 ? "Meta alcançada no período" : "Ainda falta valor no período";
  return {
    id: texto(item.id) || `${item.tipo || "meta"}:${meta}`,
    tipo: texto(item.tipo) || "Meta",
    nome: texto(item.nome),
    origem: texto(item.origem),
    meta,
    realizado,
    atingimento,
    falta,
    inicio: dataIso(item.inicio),
    prazo: dataIso(item.prazo),
    situacao,
    plano: "Acompanha a meta já gravada. Nenhum plano novo foi criado.",
  };
}

export function montarMissoes(fatos = {}) {
  const lacunas = [
    "A missão só aparece quando a meta já está gravada.",
    "Campo ausente não vira zero. Zero gravado no pedido conta.",
    "A meta mensal usa o mês corrente. A diária usa o dia de hoje. A semanal vai de segunda até hoje e o prazo é o domingo.",
    "Nenhum plano foi gravado e nenhum contato foi disparado.",
  ];
  if (fatos.metas == null) lacunas.push("As metas gravadas não foram lidas.");
  if (fatos.amostra === true) lacunas.push("A lista para em 100 missões. Não é o cadastro inteiro de metas.");
  const itens = [];
  for (const bruto of fatos.metas || []) {
    const missao = fechar(bruto);
    if (missao) itens.push(missao);
  }
  if (fatos.metas != null && !itens.length) lacunas.push("Não há meta gravada. Nenhuma missão foi criada.");
  if (itens.some((item) => item.tipo === "Equipe" && item.realizado == null)) lacunas.push("A meta de equipe sem empresa não tem a lista de vendedores. O realizado fica em branco.");
  if (fatos.recorte) lacunas.push(fatos.recorte);
  itens.sort((a, b) => Number(a.situacao === "Meta alcançada no período") - Number(b.situacao === "Meta alcançada no período")
    || (b.falta ?? -1) - (a.falta ?? -1)
    || a.id.localeCompare(b.id, "pt-BR"));
  return {
    itens: itens.slice(0, 100),
    lidas: itens.length,
    alcancadas: itens.filter((item) => item.situacao === "Meta alcançada no período").length,
    semRealizado: itens.filter((item) => item.realizado == null).length,
    lacunas,
    aviso: "Nenhum plano foi gravado. O acompanhamento repete a meta já cadastrada e o faturamento do período.",
  };
}
