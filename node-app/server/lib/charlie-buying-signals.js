const TIPOS = new Set(["licitacao", "edital", "demanda", "noticia", "unidade", "investimento", "projeto"]);

function texto(valor) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function normalizar(valor) {
  return texto(valor)?.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() || "";
}

export function validarSinal(pedido = {}) {
  const tipo = texto(pedido.tipo);
  if (!TIPOS.has(tipo)) {
    const erro = new Error("Informe o tipo: licitação, edital, demanda, notícia, unidade, investimento ou projeto.");
    erro.status = 400;
    throw erro;
  }
  const fonte = texto(pedido.fonte?.nome || pedido.fonte);
  const data = texto(pedido.data);
  const empresa = texto(pedido.empresa);
  if (!fonte || !data || Number.isNaN(Date.parse(data)) || !empresa) {
    const erro = new Error("Fonte, data e empresa são obrigatórias.");
    erro.status = 400;
    throw erro;
  }
  return {
    tipo,
    fonte: { nome: fonte, url: texto(pedido.fonte?.url || pedido.url) },
    data,
    empresa,
    cnpj: texto(pedido.cnpj),
    segmento: texto(pedido.segmento),
    codigos: [...new Set((pedido.codigos || []).map((item) => texto(item)).filter(Boolean))].slice(0, 5),
    descricao: texto(pedido.descricao),
  };
}

export function avaliarSinal(sinal, contexto = {}) {
  const segmentos = contexto.segmentos || [];
  const segmento = segmentos.find((item) => normalizar(item.nome) === normalizar(sinal.segmento));
  const produtos = [];
  for (const codigo of sinal.codigos || []) {
    const encontrado = (contexto.produtos || []).find((item) => normalizar(item.codigo) === normalizar(codigo));
    if (encontrado) produtos.push({ codigo: encontrado.codigo, nome: encontrado.nome });
  }
  const pontos = (segmento ? 40 : 0) + Math.min(40, produtos.length * 20) + (sinal.descricao ? 20 : 0);
  const rotulo = pontos >= 70 ? "alta" : pontos >= 40 ? "media" : "baixa";
  const produtosTexto = produtos.length ? produtos.map((item) => item.nome).join(", ") : null;
  return {
    segmentoId: segmento?.id || null,
    segmentoNome: segmento?.nome || null,
    produtos,
    afirmarCompra: false,
    relevancia: {
      pontos,
      rotulo,
      aviso: "Relevância para ordenar o acompanhamento. Não é probabilidade de compra.",
    },
    motivo: produtos.length
      ? "Os produtos saíram dos códigos informados e encontrados no ERP."
      : "Não há código de produto encontrado no ERP. Não dá para afirmar que a empresa precisa comprar um item.",
    abordagem: {
      texto: produtosTexto
        ? `Olá. Vi um registro público de ${sinal.empresa} em ${sinal.fonte.nome}, datado de ${sinal.data}. Os códigos informados existem no ERP: ${produtosTexto}. Posso verificar se faz sentido uma conversa?`
        : `Olá. Vi um registro público de ${sinal.empresa} em ${sinal.fonte.nome}, datado de ${sinal.data}. Não há produto do ERP vinculado a este sinal.`,
      enviada: false,
    },
  };
}
