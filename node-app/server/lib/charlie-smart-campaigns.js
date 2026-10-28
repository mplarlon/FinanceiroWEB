function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function dia(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  return partes ? `${partes[1]}-${partes[2]}-${partes[3]}` : null;
}

function deslocar(iso, dias) {
  const partes = dia(iso);
  if (!partes) return null;
  const [ano, mes, diaMes] = partes.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, diaMes));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function margem(preco, custo) {
  if (!(preco > 0) || custo == null || custo <= 0) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}

function cancelado(pedido) {
  return /cancel/i.test(pedido?.status || "");
}

function chaveItem(item, produtos) {
  if (item?.externalId && produtos.has(String(item.externalId))) return String(item.externalId);
  const referencia = String(item?.reference || "").trim();
  if (!referencia) return null;
  for (const produto of produtos.values()) {
    if (String(produto.reference || "").trim() === referencia) return String(produto.externalId);
  }
  return null;
}

export function identificarCampanhas(store, opcoes = {}) {
  if (!store) return { sugestoes: [], lacunas: ["O catálogo sincronizado não foi lido."] };
  const hoje = dia(opcoes.hoje) || new Date().toISOString().slice(0, 10);
  const inicioRecente = deslocar(hoje, -90);
  const inicioAnterior = deslocar(hoje, -180);
  const produtos = new Map(Object.values(store.products || {}).filter((item) => item?.externalId).map((item) => [String(item.externalId), item]));
  const porProduto = new Map();
  let semData = 0;
  const pares = new Map();
  for (const pedido of Object.values(store.orders || {})) {
    if (cancelado(pedido)) continue;
    const data = dia(pedido.date);
    if (!data) semData += 1;
    const vistos = new Set();
    for (const item of pedido.items || []) {
      const id = chaveItem(item, produtos);
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const atual = porProduto.get(id) || { linhas: 0, recente: [], anterior: [], meses: [] };
      atual.linhas += 1;
      if (data && data > inicioRecente && data <= hoje) atual.recente.push(numero(item.quantity));
      else if (data && data > inicioAnterior && data <= inicioRecente) atual.anterior.push(numero(item.quantity));
      if (data) atual.meses.push(data);
      porProduto.set(id, atual);
    }
    const ids = [...vistos].sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const chave = `${ids[i]}|${ids[j]}`;
        pares.set(chave, (pares.get(chave) || 0) + 1);
      }
    }
  }

  const sugestoes = [];
  for (const produto of produtos.values()) {
    const id = String(produto.externalId);
    const uso = porProduto.get(id) || { linhas: 0, recente: [], anterior: [], meses: [] };
    const saldo = numero(produto.stock);
    const preco = numero(produto.price);
    const custo = numero(produto.cost);
    const margemEstimada = margem(preco, custo);
    const recente = somar(uso.recente);
    const anterior = somar(uso.anterior);
    if (saldo > 0 && uso.linhas === 0) sugestoes.push(rascunho({ tipo: "parado", produto, preco, evidencia: { saldo }, texto: `${produto.name} tem saldo ${saldo} e nenhum pedido sincronizado não cancelado.` }));
    if (margemEstimada != null && margemEstimada >= 40) sugestoes.push(rascunho({ tipo: "margem_alta", produto, preco, evidencia: { margemEstimada }, texto: `${produto.name} tem margem estimada de ${margemEstimada}% sobre preço e custo. Imposto, comissão e taxa não entram.` }));
    if (anterior > 0 && recente != null && recente <= anterior * 0.7) sugestoes.push(rascunho({ tipo: "queda", produto, preco, evidencia: { recente, anterior }, texto: `${produto.name} caiu de ${anterior} para ${recente} unidades entre os dois períodos de 90 dias. A causa não foi inferida.` }));
    const estacao = sazonal(uso.meses, hoje);
    if (estacao) sugestoes.push(rascunho({ tipo: "sazonal", produto, preco, evidencia: estacao, texto: `${produto.name} teve pedido em ${hoje.slice(5, 7)} em ${estacao.anos} anos. O período da campanha não foi preenchido.` }));
  }
  for (const [chave, apoio] of pares) {
    if (apoio < 3) continue;
    const [esquerda, direita] = chave.split("|");
    const origem = produtos.get(esquerda);
    const destino = produtos.get(direita);
    if (!origem || !destino) continue;
    sugestoes.push(rascunho({
      tipo: "venda_cruzada",
      produto: origem,
      preco: numero(origem.price),
      evidencia: { apoio, relacionadoId: direita, relacionado: destino.name },
      texto: `${destino.name} apareceu com ${origem.name} em ${apoio} pedidos. Isso não comprova compatibilidade técnica.`,
    }));
  }
  const lacunas = ["Preço sugerido, meta e público não são preenchidos sem regra e sem lista de clientes."];
  if (semData) lacunas.push(`${semData} pedido(s) sem data ficaram fora da queda e da sazonalidade.`);
  return { sugestoes, lacunas, aviso: "Campanha nasce como rascunho. Aprovar não publica e nenhuma mensagem é enviada." };
}

function somar(valores) {
  if (!valores.length) return 0;
  const numeros = valores.filter((valor) => valor != null);
  if (!numeros.length) return null;
  return Math.round(numeros.reduce((soma, valor) => soma + valor, 0) * 100) / 100;
}

function sazonal(datas, hoje) {
  const mes = hoje.slice(5, 7);
  const anos = new Set(datas.filter((data) => data.slice(5, 7) === mes).map((data) => data.slice(0, 4)));
  if (anos.size < 2) return null;
  return { mes, anos: anos.size };
}

function rascunho({ tipo, produto, preco, evidencia, texto }) {
  return {
    id: `campanha:${tipo}:${produto.externalId}`,
    tipo,
    produtoId: String(produto.externalId),
    nomeProduto: produto.name || String(produto.externalId),
    nome: nomeCampanha(tipo, produto.name),
    objetivo: texto,
    publico: null,
    publicoMotivo: "Não há lista de clientes nem registro de consentimento nesta campanha.",
    produtos: [String(produto.externalId)],
    precoAtual: preco,
    precoSugerido: null,
    precoMotivo: "Não há desconto autorizado. O preço sugerido fica em branco.",
    inicio: null,
    fim: null,
    meta: null,
    metaMotivo: "Não há meta comercial cadastrada para esta campanha.",
    descricao: texto,
    mensagem: `Rascunho interno sobre ${produto.name || "o produto"}. ${texto} Esta mensagem não foi enviada.`,
    enviada: false,
    indicadores: { resultado: null, aviso: "Nenhuma venda foi atribuída a esta campanha." },
    evidencia,
  };
}

function nomeCampanha(tipo, nome) {
  const titulo = { parado: "Giro", margem_alta: "Margem estimada", queda: "Queda observada", sazonal: "Mês recorrente", venda_cruzada: "Compra conjunta" }[tipo] || "Campanha";
  return `${titulo} — ${nome || "produto"}`;
}

export function decidirRascunho(campanha, decisao) {
  if (!campanha) {
    const erro = new Error("Campanha não encontrada.");
    erro.status = 404;
    throw erro;
  }
  if (campanha.status !== "rascunho") {
    const erro = new Error("A campanha já foi decidida.");
    erro.status = 409;
    throw erro;
  }
  if (!["aprovada", "rejeitada"].includes(decisao)) {
    const erro = new Error("Decisão inválida.");
    erro.status = 400;
    throw erro;
  }
  return { ...campanha, status: decisao, publicada: false, enviada: false };
}

export function publicarRascunho(campanha, autorizada) {
  if (!campanha) {
    const erro = new Error("Campanha não encontrada.");
    erro.status = 404;
    throw erro;
  }
  if (!autorizada) {
    const erro = new Error("A publicação automática não está autorizada.");
    erro.status = 403;
    throw erro;
  }
  if (campanha.status !== "aprovada") {
    const erro = new Error("Só uma campanha aprovada pode ser marcada para publicação.");
    erro.status = 409;
    throw erro;
  }
  return {
    ...campanha,
    publicada: true,
    enviada: false,
    canal: null,
    avisoPublicacao: "Não há canal externo autorizado nesta etapa. Nenhuma mensagem foi enviada.",
  };
}
