function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function custoPositivo(valor) {
  const n = numero(valor);
  return n != null && n > 0 ? n : null;
}

function mapa(linhas) {
  const saida = new Map();
  for (const linha of linhas || []) saida.set(String(linha.produtoId), linha);
  return saida;
}

function diaUtc(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
  const encontrado = String(valor ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!encontrado) return null;
  return Date.UTC(Number(encontrado[1]), Number(encontrado[2]) - 1, Number(encontrado[3]));
}

function diasEntre(pedido, entrada) {
  const inicio = diaUtc(pedido);
  const fim = diaUtc(entrada);
  if (inicio == null || fim == null || fim < inicio) return null;
  return Math.round((fim - inicio) / 86400000);
}

function mediana(valores) {
  const lista = valores.filter((item) => item != null).sort((a, b) => a - b);
  if (!lista.length) return null;
  const meio = Math.floor(lista.length / 2);
  if (lista.length % 2) return lista[meio];
  return Math.round(((lista[meio - 1] + lista[meio]) / 2) * 10) / 10;
}

function qualidadesUnicas(linhas) {
  const grupos = new Map();
  for (const linha of linhas || []) {
    const indice = numero(linha.indice);
    if (linha.fornecedorId == null || indice == null) continue;
    const id = String(linha.fornecedorId);
    const valores = grupos.get(id) || new Set();
    valores.add(indice);
    grupos.set(id, valores);
  }
  const saida = new Map();
  for (const [id, valores] of grupos) saida.set(id, valores.size === 1 ? [...valores][0] : null);
  return saida;
}

function escolherFornecedor(linhas) {
  const porFornecedor = new Map();
  for (const linha of linhas || []) {
    if (linha.fornecedorId == null || linha.fornecedorId === "") continue;
    const id = String(linha.fornecedorId);
    const atual = porFornecedor.get(id) || { fornecedorId: linha.fornecedorId, fornecedor: null, custoUnitario: null, ultima: null, prazos: [] };
    const dia = diaUtc(linha.entrada);
    const preco = custoPositivo(linha.custo) ?? custoPositivo(linha.preco);
    if (preco != null && (atual.custoUnitario == null || (dia != null && (atual.ultima == null || dia >= atual.ultima)))) {
      atual.custoUnitario = preco;
      if (dia != null) atual.ultima = dia;
      atual.fornecedor = linha.fornecedor || atual.fornecedor;
    }
    const prazo = diasEntre(linha.pedido, linha.entrada);
    if (prazo != null) atual.prazos.push(prazo);
    if (!atual.fornecedor && linha.fornecedor) atual.fornecedor = linha.fornecedor;
    porFornecedor.set(id, atual);
  }
  const candidatos = [...porFornecedor.values()].filter((item) => item.custoUnitario != null);
  if (!candidatos.length) return { fornecedorId: null, fornecedor: null, custoUnitario: null, prazoDias: null, prazoObservacoes: 0 };
  candidatos.sort((a, b) => a.custoUnitario - b.custoUnitario || (b.ultima || 0) - (a.ultima || 0));
  const escolhido = candidatos[0];
  return {
    fornecedorId: escolhido.fornecedorId,
    fornecedor: escolhido.fornecedor,
    custoUnitario: escolhido.custoUnitario,
    prazoDias: mediana(escolhido.prazos),
    prazoObservacoes: escolhido.prazos.length,
  };
}

function prioridadeCompra(saldo) {
  const pontos = saldo <= 0 ? 80 : 50;
  return {
    pontos,
    rotulo: pontos >= 70 ? "alta" : "media",
    aviso: "Prioridade para acompanhar a compra. Não é probabilidade de ruptura.",
  };
}

export function montarCompras(fatos = {}, opcoes = {}) {
  const janela = [7, 15, 30, 60].includes(opcoes.janelaDias) ? opcoes.janelaDias : 15;
  const lacunas = [
    "A qualidade só aparece quando há um único índice cadastrado para o fornecedor.",
    "O prazo é a mediana dos dias entre o pedido e a entrada. Sem essas duas datas, o prazo fica em branco.",
    "A demanda prevista repete a média dos últimos 90 dias na janela. Não é previsão estatística.",
    "Esta leitura não emite pedido de compra.",
  ];
  if (fatos.produtos == null) lacunas.push("O saldo do ERP não foi consultado.");
  if (fatos.vendas == null) lacunas.push("As saídas dos últimos 90 dias não foram consultadas.");
  if (fatos.pendentes == null) lacunas.push("Os pedidos de compra em aberto não foram consultados.");
  if (fatos.entradas == null) lacunas.push("O histórico de entradas não foi consultado. Não há preço nem fornecedor.");
  if (fatos.qualidades == null) lacunas.push("O índice de qualidade do fornecedor não foi consultado.");

  const vendas = mapa(fatos.vendas);
  const pendentes = mapa(fatos.pendentes);
  const qualidades = qualidadesUnicas(fatos.qualidades);
  const entradas = new Map();
  for (const linha of fatos.entradas || []) {
    const lista = entradas.get(String(linha.produtoId)) || [];
    lista.push(linha);
    entradas.set(String(linha.produtoId), lista);
  }

  const itens = [];
  let saidaIncompleta = false;
  let pendenteIncompleto = false;
  for (const produto of fatos.produtos || []) {
    const id = String(produto.id);
    const saldo = numero(produto.saldo);
    if (saldo == null) continue;
    const minimo = numero(produto.minimo);
    const registroVenda = fatos.vendas == null ? null : vendas.get(id);
    const saidas = fatos.vendas == null ? null : registroVenda ? numero(registroVenda.quantidade) : 0;
    const registroPendente = fatos.pendentes == null ? null : pendentes.get(id);
    const pendente = fatos.pendentes == null ? null : registroPendente ? numero(registroPendente.quantidade) : 0;
    if (registroVenda && saidas == null) saidaIncompleta = true;
    if (registroPendente && pendente == null) pendenteIncompleto = true;
    if (registroVenda && saidas == null) continue;
    const demandaDia = saidas == null ? null : Math.round((saidas / 90) * 100) / 100;
    const demandaPrevista = demandaDia == null ? null : Math.round(demandaDia * janela * 100) / 100;
    const alvo = demandaDia == null ? (minimo > 0 ? minimo : null) : Math.max(demandaDia * janela, minimo > 0 ? minimo : 0);
    if (alvo == null) continue;
    const quantidade = Math.round((alvo - saldo - (pendente == null ? 0 : pendente)) * 100) / 100;
    if (!(quantidade > 0)) continue;
    const oferta = escolherFornecedor(entradas.get(id) || []);
    const qualidade = oferta.fornecedorId == null ? null : (qualidades.get(String(oferta.fornecedorId)) ?? null);
    const custoEstimado = oferta.custoUnitario == null ? null : Math.round(oferta.custoUnitario * quantidade * 100) / 100;
    itens.push({
      id: `compra:${id}`,
      produtoId: id,
      nome: produto.nome || id,
      saldo,
      minimo: minimo > 0 ? minimo : null,
      saidas90: saidas,
      demandaDia,
      demandaPrevista,
      pendente,
      quantidade,
      fornecedorId: oferta.fornecedorId,
      fornecedor: oferta.fornecedor,
      custoUnitario: oferta.custoUnitario,
      custoEstimado,
      prazoDias: oferta.prazoDias,
      prazoObservacoes: oferta.prazoObservacoes,
      qualidade,
      depositoId: produto.depositoId ?? null,
      empresaId: produto.empresaId ?? null,
      pedidoEmitido: false,
      justificativa: [
        `${produto.nome || id}: comprar ${quantidade}.`,
        `Saldo ${saldo}.`,
        pendente == null ? "Os pedidos em aberto não entraram na conta." : `Pedido em aberto ${pendente}.`,
        oferta.fornecedor ? `Fornecedor ${oferta.fornecedor} pelo menor custo observado nas entradas.` : "Não há custo de entrada para escolher fornecedor.",
        oferta.prazoDias == null ? "Não há prazo observado." : `Prazo observado de ${oferta.prazoDias} dia(s) em ${oferta.prazoObservacoes} entrega(s).`,
        qualidade == null ? "Não há índice único de qualidade." : `Índice de qualidade cadastrado: ${qualidade}.`,
        "Nenhum pedido definitivo foi emitido.",
      ].join(" "),
      prioridade: prioridadeCompra(saldo),
    });
  }
  if (saidaIncompleta) lacunas.push("Há saída sem quantidade. Esse produto não entra na sugestão.");
  if (pendenteIncompleto) lacunas.push("Há pedido de compra sem quantidade. Ele não foi descontado da sugestão.");
  itens.sort((a, b) => b.prioridade.pontos - a.prioridade.pontos || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  return {
    itens: itens.slice(0, 200),
    analisados: (fatos.produtos || []).length,
    janela,
    lacunas,
    aviso: "A sugestão usa saldo, saídas, pedidos em aberto e entradas do ERP. A demanda prevista repete a média dos últimos 90 dias. Nenhum pedido é emitido nesta consulta.",
  };
}
