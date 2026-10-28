function texto(valor) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function igual(a, b) {
  const esquerda = texto(a);
  const direita = texto(b);
  if (!esquerda || !direita) return null;
  return esquerda.localeCompare(direita, "pt-BR", { sensitivity: "base" }) === 0;
}

export function confiancaCorrespondencia(nosso, deles) {
  const marca = igual(nosso?.marca, deles?.marca);
  const codigo = igual(nosso?.codigo, deles?.codigo);
  const modelo = igual(nosso?.modelo, deles?.modelo);
  if (marca === false || codigo === false || modelo === false) return "insuficiente";
  if (marca === true && codigo === true) return "alta";
  if (marca === true && modelo === true && codigo === null) return "media";
  if (modelo === true && marca === null && codigo === null) return "baixa";
  return "insuficiente";
}

export function compararReferencia(nosso, referencia) {
  const confianca = confiancaCorrespondencia(nosso, referencia?.concorrente);
  const consulta = referencia?.consulta || {};
  const resultado = {
    confianca,
    fonte: texto(referencia?.fonte?.nome),
    url: texto(referencia?.fonte?.url),
    consultadoEm: texto(consulta.em),
    precoNosso: numero(nosso?.preco),
    precoReferencia: null,
    disponibilidade: null,
    frete: null,
    promocao: null,
    alteracao: referencia?.alteracao || null,
    alerta: null,
    motivo: "Marca, código ou modelo não confirmam que é o mesmo produto.",
  };
  if (confianca === "baixa") {
    resultado.motivo = "Só o modelo coincide. Sem marca e código, os preços não são comparados.";
    return resultado;
  }
  if (confianca === "insuficiente") return resultado;
  resultado.precoReferencia = numero(consulta.preco);
  resultado.disponibilidade = texto(consulta.disponibilidade);
  resultado.frete = numero(consulta.frete);
  resultado.promocao = texto(consulta.promocao);
  if (confianca === "media") {
    resultado.motivo = "Marca e modelo coincidem, mas o código não foi informado. A diferença fica visível e não gera alerta.";
    return resultado;
  }
  resultado.motivo = "Marca e código coincidem.";
  if (resultado.precoNosso == null || resultado.precoReferencia == null) {
    resultado.motivo = "Marca e código coincidem, mas falta o preço nosso ou o preço anunciado.";
    return resultado;
  }
  if (resultado.precoNosso > resultado.precoReferencia) {
    resultado.alerta = `${nosso.nome} está acima da referência cadastrada.`;
  }
  return resultado;
}

export function validarConsulta(consulta = {}) {
  const em = texto(consulta.em);
  if (!em || Number.isNaN(Date.parse(em))) {
    const erro = new Error("Informe a data da consulta.");
    erro.status = 400;
    throw erro;
  }
  const pronta = {
    em,
    preco: numero(consulta.preco),
    disponibilidade: texto(consulta.disponibilidade),
    frete: numero(consulta.frete),
    promocao: texto(consulta.promocao),
  };
  if (pronta.preco == null && !pronta.disponibilidade && pronta.frete == null && !pronta.promocao) {
    const erro = new Error("A consulta precisa de preço, disponibilidade, frete ou promoção observados.");
    erro.status = 400;
    throw erro;
  }
  return pronta;
}

export function validarConcorrente(concorrente = {}) {
  const pronto = {
    nome: texto(concorrente.nome),
    marca: texto(concorrente.marca),
    codigo: texto(concorrente.codigo),
    modelo: texto(concorrente.modelo),
    caracteristicas: texto(concorrente.caracteristicas),
    quantidade: texto(concorrente.quantidade),
    condicoes: texto(concorrente.condicoes),
  };
  if (!pronto.nome) {
    const erro = new Error("Informe o nome do anúncio concorrente.");
    erro.status = 400;
    throw erro;
  }
  return pronto;
}
