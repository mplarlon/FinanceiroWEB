function diaCivil(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor));
  if (!partes) return null;
  return Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
}

function diasEntre(origem, destino) {
  const inicio = diaCivil(origem);
  const fim = diaCivil(destino);
  if (inicio == null || fim == null) return null;
  return Math.round((fim - inicio) / 86400000);
}

function somarDias(origem, dias) {
  const base = diaCivil(origem);
  if (base == null || !Number.isFinite(dias)) return null;
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}

function mediana(valores) {
  const numeros = valores.filter((valor) => Number.isFinite(valor)).sort((a, b) => a - b);
  if (!numeros.length) return null;
  const meio = Math.floor(numeros.length / 2);
  const valor = numeros.length % 2 ? numeros[meio] : (numeros[meio - 1] + numeros[meio]) / 2;
  return Math.round(valor);
}

function dinheiro(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100) / 100;
}

export function prioridadeRecompra(valor, diasAte, janela) {
  const valorFator = !Number.isFinite(Number(valor)) || Number(valor) <= 0 ? 0 : Math.min(1, Number(valor) / 5000);
  const limite = Math.max(1, janela);
  const proximidade = !Number.isFinite(diasAte) ? 0 : diasAte <= 0 ? 1 : Math.max(0, (limite - diasAte) / limite);
  const pontos = Math.round(valorFator * 60 + proximidade * 40);
  return {
    pontos,
    rotulo: pontos >= 70 ? "alta" : pontos >= 40 ? "media" : "baixa",
    aviso: "Prioridade comercial para ordenar o contato. Não é probabilidade de compra.",
  };
}

function sazonalidade(datas, prevista) {
  const mes = Number(String(prevista || "").slice(5, 7));
  if (!mes) return { meses: null, motivo: "A data prevista não pôde ser calculada." };
  const anos = new Set();
  let compras = 0;
  for (const data of datas) {
    const iso = somarDias(data, 0);
    if (!iso || Number(iso.slice(5, 7)) !== mes) continue;
    anos.add(iso.slice(0, 4));
    compras += 1;
  }
  if (anos.size < 2) {
    return { mes, compras, anos: anos.size, motivo: "Menos de dois anos com compra neste mês. A data prevista não foi ajustada." };
  }
  return { mes, compras, anos: anos.size, motivo: "Há compra neste mês em mais de um ano. A data prevista continua sendo a última compra mais o intervalo mediano." };
}

export function montarRecompra(linhas, opcoes = {}) {
  const hoje = opcoes.hoje || new Date();
  const janela = Number.isInteger(opcoes.janelaDias) ? opcoes.janelaDias : 7;
  const lacunas = [];
  if (linhas == null) {
    return {
      itens: [],
      lacunas: ["O histórico de vendas não foi consultado."],
      aviso: "A data prevista repete o intervalo mediano observado. Não é probabilidade de compra.",
      qualidade: { registros: 0, truncado: false },
    };
  }
  const grupos = new Map();
  for (const linha of linhas) {
    const clienteId = Number(linha.clienteId);
    const produtoId = Number(linha.produtoId);
    const data = diaCivil(linha.data);
    if (!clienteId || !produtoId || data == null) continue;
    const chave = `${clienteId}:${produtoId}`;
    const grupo = grupos.get(chave) || {
      clienteId,
      cliente: linha.cliente || "Cliente",
      produtoId,
      produto: linha.produto || "Produto",
      vendedorId: linha.vendedorId || null,
      vendedor: linha.vendedor || "Sem vendedor",
      compras: [],
      ultimaMs: null,
    };
    if (grupo.ultimaMs == null || data >= grupo.ultimaMs) {
      grupo.ultimaMs = data;
      grupo.vendedorId = linha.vendedorId || grupo.vendedorId;
      grupo.vendedor = linha.vendedor || grupo.vendedor;
      grupo.cliente = linha.cliente || grupo.cliente;
      grupo.produto = linha.produto || grupo.produto;
    }
    grupo.compras.push({ data: linha.data, quantidade: linha.quantidade, valor: linha.valor, pedido: linha.pedido });
    grupos.set(chave, grupo);
  }

  const itens = [];
  let semCiclo = 0;
  let valorIncompleto = false;
  for (const grupo of grupos.values()) {
    const porDia = new Map();
    for (const compra of grupo.compras) {
      const iso = somarDias(compra.data, 0);
      const atual = porDia.get(iso) || { data: iso, quantidade: null, quantidadeOk: true, valor: null, valorOk: true };
      const quantidade = dinheiro(compra.quantidade);
      if (quantidade == null) atual.quantidadeOk = false;
      else atual.quantidade = (atual.quantidade ?? 0) + quantidade;
      const valorLido = dinheiro(compra.valor);
      if (valorLido == null) atual.valorOk = false;
      else atual.valor = (atual.valor ?? 0) + valorLido;
      porDia.set(iso, atual);
    }
    const dias = [...porDia.values()].map((dia) => ({
      data: dia.data,
      quantidade: dia.quantidadeOk ? dia.quantidade : null,
      valor: dia.valorOk ? dia.valor : null,
    })).sort((a, b) => a.data.localeCompare(b.data));
    if (dias.length < 3) {
      semCiclo += 1;
      continue;
    }
    const intervalos = dias.slice(1).map((dia, indice) => diasEntre(dias[indice].data, dia.data)).filter((valor) => valor > 0);
    const intervalo = mediana(intervalos);
    if (!intervalo) {
      semCiclo += 1;
      continue;
    }
    const ultima = dias.at(-1).data;
    const prevista = somarDias(ultima, intervalo);
    const diasAte = diasEntre(hoje, prevista);
    if (diasAte == null || diasAte > janela) continue;
    const valores = dias.map((dia) => dia.quantidade).filter((valor) => valor != null);
    if (dias.some((dia) => dia.valor == null)) valorIncompleto = true;
    const valor = dias.every((dia) => dia.valor != null) ? dinheiro(dias.reduce((soma, dia) => soma + dia.valor, 0)) : null;
    const prioridade = prioridadeRecompra(valor, diasAte, janela);
    const estacao = sazonalidade(dias.map((dia) => dia.data), prevista);
    itens.push({
      id: `rebuy:${grupo.clienteId}:${grupo.produtoId}`,
      clienteId: grupo.clienteId,
      cliente: grupo.cliente,
      produtoId: grupo.produtoId,
      produto: grupo.produto,
      vendedorId: grupo.vendedorId,
      vendedor: grupo.vendedor,
      compras: dias.length,
      ultima,
      intervalo,
      amplitude: Math.max(...intervalos) - Math.min(...intervalos),
      prevista,
      diasAte,
      situacao: diasAte < 0 ? "vencida" : "proxima",
      quantidadeMediana: mediana(valores),
      valor,
      sazonalidade: estacao,
      prioridade,
      rascunho: `Olá. ${grupo.cliente} comprou ${grupo.produto} em ${dias.length} datas, com intervalo mediano de ${intervalo} dias. A última foi em ${ultima} e a data pelo mesmo intervalo é ${prevista}. A quantidade mediana observada foi ${mediana(valores) ?? "não informada"}. Posso verificar uma reposição?`,
    });
  }
  if (semCiclo) lacunas.push(`${semCiclo} combinação(ões) de cliente e produto têm menos de três datas de compra e ficaram de fora.`);
  if (valorIncompleto) lacunas.push("Há compra sem valor. A prioridade não usou esse valor.");
  itens.sort((a, b) => b.prioridade.pontos - a.prioridade.pontos || a.diasAte - b.diasAte);
  return {
    itens,
    lacunas,
    aviso: "A data prevista repete o intervalo mediano observado. Não é probabilidade de compra.",
    qualidade: { registros: linhas.length, truncado: Boolean(opcoes.truncado) },
  };
}

export function oportunidadeDeRecompra(item) {
  const prioridade = item.prioridade.rotulo === "alta" ? "relevante" : item.prioridade.rotulo === "media" ? "moderada" : "acompanhamento";
  return {
    key: item.id,
    customerId: item.clienteId,
    customer: item.cliente,
    sellerId: item.vendedorId,
    seller: item.vendedor,
    type: "recompra",
    reason: `${item.produto} teve intervalo mediano de ${item.intervalo} dias. A data pelo intervalo é ${item.prevista}. Não é probabilidade de compra.`,
    score: item.prioridade.pontos,
    priority: prioridade,
    metrics: {
      productId: item.produtoId,
      product: item.produto,
      habitualInterval: item.intervalo,
      daysIdle: diasEntre(item.ultima, item.prevista) - item.diasAte,
      historicalRevenue: item.valor,
      meaning: "prioridade_de_abordagem",
    },
    evidence: {
      sources: ["SAIDAESTOQUE", "SAIDAPRODUTO", "CLIENTE", "VENDEDOR", "PRODUTO"],
      metrics: { productId: item.produtoId, product: item.produto, prevista: item.prevista, intervalo: item.intervalo },
    },
  };
}
