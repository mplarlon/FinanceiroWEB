function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function mapa(linhas, campo = "produtoId") {
  const saida = new Map();
  for (const linha of linhas || []) saida.set(String(linha[campo]), linha);
  return saida;
}

export function montarGuardian(fatos = {}, opcoes = {}) {
  const janela = Number.isInteger(opcoes.janelaDias) ? opcoes.janelaDias : 15;
  const lacunas = [
    "O estoque reservado não entrou nesta leitura.",
    "O prazo do fornecedor não está neste cadastro. A cobertura usa a janela configurada, não um prazo inventado.",
  ];
  if (fatos.produtos == null) lacunas.push("O saldo do ERP não foi consultado.");
  if (fatos.vendas == null) lacunas.push("As saídas dos últimos 90 dias não foram consultadas.");
  if (fatos.pendentes == null) lacunas.push("Os pedidos de compra em aberto não foram consultados.");
  if (fatos.depositos == null) lacunas.push("O saldo por depósito não foi consultado. Não há sugestão de redistribuição.");
  if (fatos.tray == null) lacunas.push("O estoque sincronizado da Tray não foi lido. Não há comparação de divergência.");
  else lacunas.push("A quantidade vendida na Tray não entra na demanda do ERP, para a mesma saída não ser contada duas vezes.");

  const vendas = mapa(fatos.vendas);
  const pendentes = mapa(fatos.pendentes);
  const tray = mapa(fatos.tray, "referencia");
  const depositos = new Map();
  for (const linha of fatos.depositos || []) {
    const chave = String(linha.produtoId);
    const lista = depositos.get(chave) || [];
    lista.push(linha);
    depositos.set(chave, lista);
  }

  const itens = [];
  let saidaIncompleta = false;
  let pendenteIncompleto = false;
  for (const produto of fatos.produtos || []) {
    const id = String(produto.id);
    const saldo = numero(produto.saldo);
    const minimo = numero(produto.minimo);
    const maximo = numero(produto.maximo);
    const seguranca = numero(produto.seguranca);
    const linhaVenda = fatos.vendas == null ? undefined : vendas.get(id);
    const saidas = fatos.vendas == null ? null : linhaVenda ? numero(linhaVenda.quantidade) : 0;
    if (linhaVenda && saidas == null) saidaIncompleta = true;
    const linhaPendente = fatos.pendentes == null ? undefined : pendentes.get(id);
    const pendente = fatos.pendentes == null ? null : linhaPendente ? numero(linhaPendente.quantidade) : 0;
    if (linhaPendente && pendente == null) pendenteIncompleto = true;
    const demandaDia = saidas == null ? null : Math.round((saidas / 90) * 100) / 100;
    const cobertura = saldo != null && demandaDia > 0 ? Math.round((saldo / demandaDia) * 10) / 10 : null;
    const coberturaComPedido = saldo != null && pendente != null && demandaDia > 0
      ? Math.round(((saldo + pendente) / demandaDia) * 10) / 10
      : null;
    const anuncio = fatos.tray == null ? null : tray.get(id) || null;
    const saldoTray = anuncio ? numero(anuncio.saldo) : null;
    const situacoes = [];
    if (saldo != null && saldo < 0) situacoes.push("saldo_negativo");
    if (saidas > 0 && saldo != null && saldo <= 0) situacoes.push("sem_disponibilidade");
    if (saldo != null && saldo > 0 && ((demandaDia > 0 && cobertura != null && cobertura < janela) || (minimo > 0 && saldo < minimo) || (seguranca > 0 && saldo < seguranca))) situacoes.push("ruptura");
    if (saidas >= 10 && cobertura != null && cobertura < janela) situacoes.push("demanda_alta");
    if (maximo > 0 && saldo != null && saldo > maximo) situacoes.push("excesso");
    if (saidas === 0 && saldo != null && saldo > 0) situacoes.push("parado");
    if (saldo != null && saldoTray != null && Math.abs(saldo - saldoTray) > 0.009) situacoes.push("divergencia");
    if (!situacoes.length) continue;

    const redistribuicao = redistribuir(depositos.get(id));
    const compra = sugerirCompra({ situacoes, saldo, demandaDia, janela, minimo, pendente });
    const prioridade = prioridadeEstoque(situacoes);
    itens.push({
      id: `estoque:${id}`,
      produtoId: id,
      nome: produto.nome || id,
      saldo,
      minimo: minimo > 0 ? minimo : null,
      maximo: maximo > 0 ? maximo : null,
      seguranca: seguranca > 0 ? seguranca : null,
      saidas90: saidas,
      demandaDia,
      cobertura,
      coberturaComPedido,
      pendente,
      saldoTray,
      canaisTray: anuncio?.canais || [],
      reservado: null,
      prazoFornecedor: null,
      situacoes,
      redistribuicao,
      compra,
      campanha: situacoes.includes("parado") ? { texto: `Rascunho para girar ${produto.nome || id}. O saldo é ${saldo} e não houve saída considerada nos últimos 90 dias. Não foi publicado.`, publicada: false } : null,
      prioridade,
    });
  }
  if (saidaIncompleta) lacunas.push("Há saída sem quantidade. Esse produto não entra como parado nem como demanda.");
  if (pendenteIncompleto) lacunas.push("Há pedido de compra sem quantidade. Ele não foi descontado da sugestão.");
  itens.sort((a, b) => b.prioridade.pontos - a.prioridade.pontos || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  return {
    itens: itens.slice(0, 200),
    analisados: (fatos.produtos || []).length,
    ocultos: Math.max(0, itens.length - 200),
    janela,
    lacunas,
    aviso: "Nenhuma quantidade física é alterada nesta tela. A prioridade ordena o acompanhamento e não é probabilidade de ruptura.",
  };
}

function redistribuir(linhas) {
  if (!linhas || linhas.length < 2) return null;
  const comSaldo = linhas.filter((linha) => numero(linha.saldo) > 0);
  const semSaldo = linhas.filter((linha) => numero(linha.saldo) != null && numero(linha.saldo) <= 0);
  if (!comSaldo.length || !semSaldo.length) return null;
  const origem = comSaldo.sort((a, b) => numero(b.saldo) - numero(a.saldo))[0];
  const destino = semSaldo[0];
  return {
    origem: origem.deposito || String(origem.depositoId),
    saldoOrigem: numero(origem.saldo),
    destino: destino.deposito || String(destino.depositoId),
    saldoDestino: numero(destino.saldo),
    texto: `O depósito ${origem.deposito || origem.depositoId} tem saldo ${numero(origem.saldo)} e o depósito ${destino.deposito || destino.depositoId} está com ${numero(destino.saldo)}. Nenhuma transferência foi feita.`,
  };
}

function sugerirCompra({ situacoes, saldo, demandaDia, janela, minimo, pendente }) {
  if (!situacoes.includes("ruptura") && !situacoes.includes("sem_disponibilidade")) return null;
  if (saldo == null || demandaDia == null) return { quantidade: null, motivo: "Falta saldo ou demanda observada para calcular uma quantidade." };
  const alvo = Math.max(demandaDia * janela, minimo > 0 ? minimo : 0);
  const abate = pendente == null ? 0 : pendente;
  const quantidade = Math.round((alvo - saldo - abate) * 100) / 100;
  if (quantidade <= 0) return null;
  return {
    quantidade,
    motivo: pendente == null
      ? "A conta usa saldo e demanda de 90 dias. Os pedidos de compra em aberto não entraram. Nenhum pedido foi gerado."
      : "A conta desconta o saldo e o pedido de compra em aberto. Nenhum pedido foi gerado.",
  };
}

function prioridadeEstoque(situacoes) {
  const pontos = situacoes.includes("sem_disponibilidade") || situacoes.includes("saldo_negativo") || situacoes.includes("ruptura")
    ? 80
    : situacoes.includes("divergencia") || situacoes.includes("demanda_alta") ? 50 : 20;
  return {
    pontos,
    rotulo: pontos >= 70 ? "alta" : pontos >= 40 ? "media" : "baixa",
    aviso: "Prioridade para acompanhar o estoque. Não é probabilidade de ruptura.",
  };
}

const ACOES = new Set(["alerta", "compra", "redistribuicao", "campanha"]);

export function validarAcao(item, tipo) {
  if (!ACOES.has(tipo)) {
    const erro = new Error("Ação de estoque desconhecida.");
    erro.status = 400;
    throw erro;
  }
  if (tipo === "compra" && !item.compra) {
    const erro = new Error("Não há quantidade de compra sugerida para este produto.");
    erro.status = 400;
    throw erro;
  }
  if (tipo === "redistribuicao" && !item.redistribuicao) {
    const erro = new Error("Não há depósitos com e sem saldo para sugerir redistribuição.");
    erro.status = 400;
    throw erro;
  }
  if (tipo === "campanha" && !item.campanha) {
    const erro = new Error("A campanha só é sugerida para estoque parado.");
    erro.status = 400;
    throw erro;
  }
}
