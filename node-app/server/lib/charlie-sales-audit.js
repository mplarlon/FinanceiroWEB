const LIMITE = 100;

function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const lido = Number(valor);
  return Number.isFinite(lido) ? lido : null;
}

function responsavelDe(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  return texto(valor);
}

function descricaoSegura(item = {}) {
  const detalhe = item.detalhe && typeof item.detalhe === "object" ? item.detalhe : {};
  const partes = [];
  const quantidade = numero(detalhe.quantidade);
  const pontuacao = numero(detalhe.score);
  const validos = numero(detalhe.validos);
  if (quantidade != null) partes.push(`quantidade ${quantidade}`);
  if (pontuacao != null) partes.push(`pontuação ${pontuacao}`);
  if (validos != null) partes.push(`válidos ${validos}`);
  if (typeof detalhe.localizado === "boolean") partes.push(detalhe.localizado ? "pedido localizado" : "pedido não localizado");
  if (texto(detalhe.status)) partes.push(`situação ${texto(detalhe.status)}`);
  if (Array.isArray(detalhe.campos)) {
    const campos = detalhe.campos.map((campo) => texto(campo)).filter(Boolean);
    if (campos.length) partes.push(`campos ${campos.join(", ")}`);
  }
  const de = numero(item.de);
  const para = numero(item.para);
  if (de != null || para != null) partes.push(`de ${de == null ? "ausente" : de} para ${para == null ? "ausente" : para}`);
  for (const chave of ["propostas", "executadas", "bloqueadas"]) {
    const lido = numero(item[chave]);
    if (lido != null) partes.push(`${chave} ${lido}`);
  }
  if (typeof item.autorizada === "boolean") partes.push(item.autorizada ? "autorizada" : "não autorizada");
  if (typeof item.ligado === "boolean") partes.push(item.ligado ? "ligado" : "desligado");
  if (texto(item.tarefaId)) partes.push(`tarefa ${texto(item.tarefaId)}`);
  return partes.join(" · ") || null;
}

function linha(origem, item, extra = {}) {
  return {
    origem,
    em: texto(extra.em ?? item.em ?? item.at ?? item.createdAt ?? item.fimEm ?? item.inicioEm ?? item.criadaEm),
    evento: texto(extra.evento ?? item.tipo ?? item.event ?? item.acao ?? item.status),
    responsavel: responsavelDe(extra.responsavel ?? item.usuario ?? item.usuarioId ?? item.actor ?? item.createdBy),
    referencia: texto(extra.referencia ?? item.id),
    descricao: texto(extra.descricao ?? descricaoSegura(item))?.slice(0, 180) || null,
  };
}

function trilha(arquivo, chave) {
  if (arquivo == null || typeof arquivo !== "object") return { lida: false, itens: null };
  if (!Object.prototype.hasOwnProperty.call(arquivo, chave)) return { lida: true, itens: null };
  const valor = arquivo[chave];
  if (Array.isArray(valor)) return { lida: true, itens: valor };
  if (valor && typeof valor === "object") return { lida: true, itens: Object.values(valor) };
  return { lida: true, itens: null };
}

function eventosEcommerce(itens) {
  const eventos = [];
  for (const acao of itens || []) {
    if (!acao) continue;
    const historico = Array.isArray(acao.history) ? acao.history : [];
    if (!historico.length) {
      eventos.push(linha("Ações da loja", acao, { em: acao.createdAt, evento: acao.status, responsavel: acao.createdBy, referencia: acao.id, descricao: acao.description }));
      continue;
    }
    for (const entrada of historico) {
      eventos.push(linha("Ações da loja", entrada || {}, { referencia: acao.id, descricao: acao.description }));
    }
  }
  return eventos;
}

function eventosAchados(itens) {
  const eventos = [];
  for (const achado of itens || []) {
    if (!achado) continue;
    const historico = Array.isArray(achado.history) ? achado.history : [];
    if (!historico.length) {
      eventos.push(linha("Anúncios", achado, { em: achado.updatedAt || achado.identifiedAt, evento: achado.status, referencia: achado.id, descricao: achado.problem }));
      continue;
    }
    for (const entrada of historico) {
      eventos.push(linha("Anúncios", entrada || {}, { referencia: achado.id, descricao: achado.problem }));
    }
  }
  return eventos;
}

function eventosLeads(itens, ator) {
  const eventos = [];
  for (const item of itens || []) {
    if (!item) continue;
    if (!ator?.gerencial && Number(item.usuarioId) !== Number(ator?.id)) continue;
    const detalhe = item.detalhe && typeof item.detalhe === "object" ? item.detalhe : {};
    eventos.push(linha("Contatos", item, { referencia: detalhe.id || item.id, descricao: descricaoSegura(item) }));
  }
  return eventos;
}

function eventosAutomacoes(arquivo, ator) {
  const execucoes = trilha(arquivo, "execucoes");
  if (!execucoes.lida || execucoes.itens == null) return { ...execucoes, eventos: execucoes.itens };
  if (ator?.gerencial) return { lida: true, itens: execucoes.itens, eventos: execucoes.itens.filter(Boolean).map((item) => linha("Automações", item, { referencia: item.automacaoId, descricao: descricaoSegura(item) })) };
  const automacoes = trilha(arquivo, "automacoes");
  if (!automacoes.lida || automacoes.itens == null) return { lida: true, itens: null, eventos: null };
  const proprias = new Set(automacoes.itens.filter((item) => Number(item?.criadaPor) === Number(ator?.id)).map((item) => Number(item.id)));
  const visiveis = execucoes.itens.filter((item) => item && proprias.has(Number(item.automacaoId)));
  return { lida: true, itens: visiveis, eventos: visiveis.map((item) => linha("Automações", item, { referencia: item.automacaoId, descricao: descricaoSegura(item) })) };
}

function eventosHistorico(origem, itens) {
  return (itens || []).filter(Boolean).map((item) => linha(origem, item));
}

const HISTORICOS = [
  ["charlie_rebuy.json", "Comprar de novo"],
  ["charlie_buying_signals.json", "Quem pode comprar"],
  ["charlie_stock_guardian.json", "Estoque"],
  ["charlie_autopilot.json", "Rotina automática"],
  ["charlie_smart_purchasing.json", "O que comprar"],
  ["charlie_smart_campaigns.json", "Promoções"],
  ["charlie_competitor_radar.json", "Concorrentes"],
  ["charlie_price_rules.json", "Preços"],
];

function eventosWhatsapp(itens) {
  return (itens || []).filter(Boolean).map((item) => linha("WhatsApp", {
    em: item.enviadoEm || item.em,
    tipo: item.status,
    usuario: item.aprovadoPor,
    id: item.id,
  }, {
    descricao: item.status === "enviado" ? "mensagem aprovada" : item.status === "rejeitado" ? "mensagem rejeitada" : "consulta aguardando",
  }));
}

function eventosRecuperacao(acoes) {
  const eventos = [];
  for (const [id, salvo] of Object.entries(acoes || {})) {
    for (const acao of salvo?.acoes || []) {
      if (!acao) continue;
      eventos.push(linha("Clientes parados", acao, { referencia: id, evento: acao.tipo, descricao: acao.resultado || acao.tipo }));
    }
  }
  return eventos;
}

function eventosOrcamentos(itens) {
  return (itens || []).filter(Boolean).map((item) => linha("Orçamentos", { em: item.em, tipo: item.origem, id: item.id }, { descricao: "rascunho de orçamento" }));
}

export function montarAuditoria(fatos = {}) {
  const arquivos = fatos.arquivos || {};
  const ator = fatos.ator || {};
  const lacunas = [
    "A lista junta as trilhas já gravadas. Nenhum evento foi criado aqui.",
    "Telefone, e-mail, CNPJ e o texto livre da execução não aparecem.",
    "Textos da loja, kits, lucro, ficha do cliente, tarefas do dia e alertas só leem. Não há evento para gravar.",
  ];
  if (!ator.gerencial) lacunas.push("Contatos e automações mostram só o que esta sessão pode ver.");
  const fontes = [];
  const eventos = [];
  const registrar = (rotulo, leitura, lista) => {
    fontes.push({ origem: rotulo, lida: leitura.lida, eventos: leitura.itens == null ? null : lista.length });
    if (!leitura.lida) lacunas.push(`A trilha de ${rotulo} não foi lida.`);
    else if (leitura.itens == null) lacunas.push(`O arquivo de ${rotulo} não tem a trilha.`);
    else eventos.push(...lista);
  };
  const ecommerce = trilha(arquivos["ecommerce_intelligence_control.json"], "actions");
  registrar("Ações da loja", ecommerce, ecommerce.itens ? eventosEcommerce(ecommerce.itens) : []);
  const booster = trilha(arquivos["ecommerce_marketplace_booster.json"], "findings");
  registrar("Anúncios", booster, booster.itens ? eventosAchados(booster.itens) : []);
  const leads = trilha(arquivos["charlie-leads.json"], "auditoria");
  registrar("Contatos", leads, leads.itens ? eventosLeads(leads.itens, ator) : []);
  const automacoes = eventosAutomacoes(arquivos["charlie-automations.json"], ator);
  registrar("Automações", automacoes, automacoes.eventos || []);
  if (!ator.gerencial && trilha(arquivos["charlie-automations.json"], "execucoes").lida && trilha(arquivos["charlie-automations.json"], "automacoes").itens == null) {
    lacunas.push("As execuções de automação ficam de fora porque a lista de automações não está no arquivo.");
  }
  const whatsapp = trilha(arquivos["charlie_whatsapp_sales.json"], "itens");
  registrar("WhatsApp", whatsapp, whatsapp.itens ? eventosWhatsapp(whatsapp.itens) : []);
  const recuperacao = arquivos["charlie_recovery.json"];
  if (recuperacao == null || typeof recuperacao !== "object") registrar("Clientes parados", { lida: false, itens: null }, []);
  else if (!recuperacao.acoes || typeof recuperacao.acoes !== "object") registrar("Clientes parados", { lida: true, itens: null }, []);
  else registrar("Clientes parados", { lida: true, itens: Object.values(recuperacao.acoes) }, eventosRecuperacao(recuperacao.acoes));
  const orcamentos = trilha(arquivos["charlie_smart_quotes.json"], "orcamentos");
  registrar("Orçamentos", orcamentos, orcamentos.itens ? eventosOrcamentos(orcamentos.itens) : []);
  for (const [arquivo, rotulo] of HISTORICOS) {
    const leitura = trilha(arquivos[arquivo], "historico");
    registrar(rotulo, leitura, leitura.itens ? eventosHistorico(rotulo, leitura.itens) : []);
  }
  const ordenados = eventos.slice().sort((a, b) => String(b.em || "").localeCompare(String(a.em || "")) || String(a.origem).localeCompare(String(b.origem), "pt-BR"));
  if (ordenados.length > LIMITE) lacunas.push("A lista para em 100 eventos. Não é o total.");
  return {
    fontes,
    itens: ordenados.slice(0, LIMITE),
    total: ordenados.length,
    lacunas,
    aviso: "Nenhuma trilha foi alterada. A lista junta o que cada módulo já gravou.",
  };
}
