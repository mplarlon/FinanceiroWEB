function dataValida(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function diasDesde(valor, hoje = new Date()) {
  const origem = dataValida(valor);
  const base = dataValida(hoje);
  if (!origem || !base) return null;
  const inicio = Date.UTC(origem.getFullYear(), origem.getMonth(), origem.getDate());
  const fim = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.floor((fim - inicio) / 86400000);
}

export function dinheiro(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100) / 100;
}

export function prioridadeComercial(valor, dias) {
  const valorFator = !Number.isFinite(Number(valor)) || Number(valor) <= 0 ? 0 : Math.min(1, Number(valor) / 5000);
  const diasFator = !Number.isFinite(Number(dias)) || Number(dias) < 0 ? 0 : Math.min(1, Number(dias) / 90);
  const pontos = Math.round(valorFator * 60 + diasFator * 40);
  return {
    pontos,
    rotulo: pontos >= 70 ? "alta" : pontos >= 40 ? "media" : "baixa",
    aviso: "Prioridade comercial para ordenar o acompanhamento. Não é probabilidade de recuperação.",
  };
}

function itemBase(parcial) {
  const prioridade = prioridadeComercial(parcial.valor, parcial.dias);
  return {
    frequencia: parcial.frequencia ?? null,
    contato: null,
    avisoContato: "Não há registro de último contato. A idade usa a data do documento ou da última compra.",
    ...parcial,
    valor: dinheiro(parcial.valor),
    prioridade,
    rascunho: rascunhoRecuperacao(parcial),
  };
}

export function rascunhoRecuperacao(item) {
  const nome = item.cliente || "cliente";
  const valor = dinheiro(item.valor);
  const valorTexto = valor == null ? "sem valor informado no cadastro" : `no valor de R$ ${valor.toFixed(2).replace(".", ",")}`;
  if (item.tipo === "orcamento_parado") return `Olá. O orçamento ${item.documento} de ${nome} está aberto desde ${item.dataTexto || "a data registrada"}, ${valorTexto}. Posso retomar esse atendimento?`;
  if (item.tipo === "cliente_inativo") return `Olá, ${nome}. A última compra registrada foi em ${item.dataTexto || "data não informada"}. Posso ajudar com uma nova lista, se fizer sentido?`;
  if (item.tipo === "reducao_compras") return `Olá, ${nome}. As compras dos últimos ${item.janelaDias || 90} dias ficaram abaixo do período anterior equivalente. A comparação não explica a causa. Posso verificar o que vocês precisam agora?`;
  if (item.tipo === "pedido_nao_finalizado") return `Olá. O pedido ${item.documento} de ${nome} está fora do faturamento considerado venda, ${valorTexto}. Posso confirmar se ele segue em aberto?`;
  if (item.tipo === "negociacao_parada") return `Olá, ${nome}. A negociação está sem atualização desde ${item.dataTexto || "a última alteração"}. Posso retomar por aqui?`;
  return `Olá, ${nome}. Encontrei um acompanhamento comercial em aberto.`;
}

export function montarRecuperacao(fatos = {}, opcoes = {}) {
  const hoje = opcoes.hoje || new Date();
  const diasOrcamento = Number.isInteger(opcoes.diasOrcamento) ? opcoes.diasOrcamento : 15;
  const diasCliente = Number.isInteger(opcoes.diasCliente) ? opcoes.diasCliente : 60;
  const quedaMinima = Number.isFinite(Number(opcoes.quedaMinima)) ? Number(opcoes.quedaMinima) : 30;
  const itens = [];
  const lacunas = [];

  if (fatos.orcamentos == null) lacunas.push("Orçamentos em aberto não foram consultados.");
  else for (const orcamento of fatos.orcamentos) {
    const dias = diasDesde(orcamento.data, hoje);
    if (dias != null && dias < diasOrcamento) continue;
    itens.push(itemBase({
      id: `orcamento:${orcamento.empresa || 0}:${orcamento.numero}`,
      tipo: "orcamento_parado",
      documento: orcamento.numero,
      cliente: orcamento.cliente,
      clienteId: orcamento.clienteId || null,
      responsavel: orcamento.vendedor || "Sem vendedor",
      responsavelId: orcamento.vendedorId || null,
      data: orcamento.data || null,
      dataTexto: orcamento.data ? new Date(orcamento.data).toLocaleDateString("pt-BR") : "",
      dias,
      valor: orcamento.valor,
      valorRotulo: "Valor do orçamento aberto",
      frequencia: null,
    }));
  }

  if (fatos.clientes == null) lacunas.push("Clientes sem compra não foram consultados.");
  else for (const cliente of fatos.clientes) {
    const dias = cliente.diasSemCompra ?? diasDesde(cliente.ultimaCompra, hoje);
    if (dias != null && dias < diasCliente) continue;
    itens.push(itemBase({
      id: `cliente:${cliente.codigo}`,
      tipo: "cliente_inativo",
      documento: cliente.codigo,
      cliente: cliente.nome,
      clienteId: cliente.codigo,
      responsavel: cliente.vendedor || "Sem vendedor",
      responsavelId: cliente.vendedorId || null,
      data: cliente.ultimaCompra || null,
      dataTexto: cliente.ultimaCompra ? new Date(cliente.ultimaCompra).toLocaleDateString("pt-BR") : "",
      dias,
      valor: null,
      historico: dinheiro(cliente.historico),
      valorRotulo: "Sem estimativa de compra futura. O histórico não é valor potencial.",
      frequencia: cliente.frequencia ?? null,
    }));
  }

  if (fatos.reducoes == null) lacunas.push("A comparação de compras entre períodos não foi consultada.");
  else {
    if (Number(fatos.reducoesIncompletas) > 0) lacunas.push("Há cliente com pedido sem valor nos últimos 180 dias. A queda de compras não usou esse pedido.");
    let comparacaoSemValor = false;
    for (const reducao of fatos.reducoes) {
    const anterior = dinheiro(reducao.anterior);
    const atual = dinheiro(reducao.atual);
    if (anterior == null || atual == null) {
      comparacaoSemValor = true;
      continue;
    }
    if (!(anterior > 0)) continue;
    const percentual = ((anterior - atual) * 100) / anterior;
    if (percentual < quedaMinima) continue;
    itens.push(itemBase({
      id: `reducao:${reducao.clienteId}`,
      tipo: "reducao_compras",
      documento: reducao.clienteId,
      cliente: reducao.cliente,
      clienteId: reducao.clienteId,
      responsavel: reducao.vendedor || "Sem vendedor",
      data: reducao.ultimaCompra || null,
      dataTexto: reducao.ultimaCompra ? new Date(reducao.ultimaCompra).toLocaleDateString("pt-BR") : "",
      dias: diasDesde(reducao.ultimaCompra, hoje),
      valor: dinheiro(anterior - atual),
      valorRotulo: "Queda observada entre períodos. Não é previsão de perda.",
      percentual: Math.round(percentual * 10) / 10,
      janelaDias: reducao.janelaDias || 90,
      frequencia: reducao.frequencia ?? null,
    }));
    }
    if (comparacaoSemValor) lacunas.push("Há comparação sem valor. Ela não entrou como queda.");
  }

  if (fatos.pedidos == null) lacunas.push("Pedidos fora do faturamento não foram consultados.");
  else for (const pedido of fatos.pedidos) {
    const dias = diasDesde(pedido.data, hoje);
    itens.push(itemBase({
      id: `pedido:${pedido.empresa || 0}:${pedido.numero}`,
      tipo: "pedido_nao_finalizado",
      documento: pedido.numero,
      cliente: pedido.cliente,
      clienteId: pedido.clienteId || null,
      responsavel: pedido.vendedor || "Sem vendedor",
      data: pedido.data || null,
      dataTexto: pedido.data ? new Date(pedido.data).toLocaleDateString("pt-BR") : "",
      dias,
      valor: pedido.valor,
      valorRotulo: "Total da saída com STATUS_ORC=0. Esse status fica fora da venda considerada.",
    }));
  }

  if (fatos.negociacoes == null) lacunas.push("Negociações dos contatos não foram lidas.");
  else for (const lead of fatos.negociacoes) {
    const dias = diasDesde(lead.atualizadoEm, hoje);
    if (dias != null && dias < (opcoes.diasNegociacao || 7)) continue;
    itens.push(itemBase({
      id: `lead:${lead.id}`,
      tipo: "negociacao_parada",
      documento: lead.id,
      cliente: lead.cliente,
      clienteId: lead.clienteId || null,
      responsavel: lead.vendedor || "Sem vendedor",
      data: lead.atualizadoEm || null,
      dataTexto: lead.atualizadoEm ? new Date(lead.atualizadoEm).toLocaleDateString("pt-BR") : "",
      dias,
      valor: dinheiro(lead.valor),
      valorRotulo: lead.valor == null ? "A negociação não tem orçamento vinculado." : "Soma dos orçamentos já localizados no lead.",
    }));
  }

  if (fatos.carrinhos == null) lacunas.push("Carrinho abandonado não está na sincronização da Tray. Nenhum carrinho foi inventado.");
  else for (const carrinho of fatos.carrinhos) {
    itens.push(itemBase({
      id: `carrinho:${carrinho.id}`,
      tipo: "carrinho_abandonado",
      documento: carrinho.id,
      cliente: carrinho.cliente,
      data: carrinho.data || null,
      dataTexto: carrinho.data ? new Date(carrinho.data).toLocaleDateString("pt-BR") : "",
      dias: diasDesde(carrinho.data, hoje),
      valor: carrinho.valor,
      valorRotulo: "Valor informado pela fonte do carrinho.",
      responsavel: carrinho.responsavel || "Sem vendedor",
    }));
  }

  itens.sort((a, b) => b.prioridade.pontos - a.prioridade.pontos || (b.valor || 0) - (a.valor || 0));
  return { itens, lacunas, geradoEm: hoje.toISOString() };
}

const ACOES = new Set(["tarefa", "mensagem", "acompanhamento", "alerta", "campanha", "resultado"]);

export function registrarAcao(atual = {}, entrada = {}) {
  if (!ACOES.has(entrada.tipo)) throw Object.assign(new Error("Ação de recuperação inválida."), { status: 400 });
  const acoes = Array.isArray(atual.acoes) ? atual.acoes.slice() : [];
  const acao = {
    id: entrada.id,
    tipo: entrada.tipo,
    em: entrada.em,
    texto: String(entrada.texto || "").slice(0, 500),
    quando: entrada.quando || null,
    resultado: entrada.resultado || null,
    enviada: false,
  };
  if (entrada.tipo === "resultado" && !["em_contato", "recuperado", "perdido"].includes(entrada.resultado)) {
    throw Object.assign(new Error("O resultado deve ser em contato, recuperado ou perdido."), { status: 400 });
  }
  if (entrada.tipo === "campanha") acao.publicada = false;
  acoes.push(acao);
  return { acoes, resultado: entrada.tipo === "resultado" ? entrada.resultado : atual.resultado || null };
}
