function texto(valor) {
  const limpo = String(valor ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function caminhoDe(valor) {
  const base = String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base ? `/${base}` : null;
}

function tituloDe(produto, nomeErp) {
  const nome = texto(produto.name);
  const nomeOk = Boolean(nome) && nome !== "Produto sem descrição";
  const erp = texto(nomeErp);
  const partes = [];
  let origem = null;
  if (nomeOk) {
    partes.push(nome);
    origem = "tray";
  } else if (erp) {
    partes.push(erp);
    origem = "erp";
  }
  if (!partes.length) return { titulo: null, origem: null };
  const marca = texto(produto.brand);
  const modelo = texto(produto.model);
  if (marca && !partes.join(" ").toLowerCase().includes(marca.toLowerCase())) partes.push(marca);
  if (modelo && !partes.join(" ").toLowerCase().includes(modelo.toLowerCase())) partes.push(modelo);
  return { titulo: partes.join(" "), origem };
}

function descricaoDe(produto) {
  const sincronizada = produto.description !== undefined || produto.descriptionSmall !== undefined;
  if (!sincronizada) return { texto: null, origem: null, falta: "descricao_nao_sincronizada", cortada: false };
  const completa = texto(produto.description);
  const curta = texto(produto.descriptionSmall);
  const escolhida = completa || curta;
  if (!escolhida) return { texto: null, origem: null, falta: "descricao_vazia", cortada: false };
  const cortada = escolhida.length > 300;
  return {
    texto: cortada ? `${escolhida.slice(0, 300).trim()}…` : escolhida,
    origem: completa ? "description" : "description_small",
    falta: null,
    cortada,
  };
}

function sugerirProduto(produto, nomeErp) {
  const faltas = [];
  const nome = texto(produto.name);
  const nomeOk = Boolean(nome) && nome !== "Produto sem descrição";
  if (!nomeOk) faltas.push("titulo");
  const titulo = tituloDe(produto, nomeErp);
  const descricao = descricaoDe(produto);
  if (descricao.falta) faltas.push(descricao.falta);
  const erp = texto(nomeErp);
  const nomesDiferentes = Boolean(nomeOk && erp && nome.toLowerCase() !== erp.toLowerCase());
  const caminho = caminhoDe(titulo.titulo || produto.reference);
  return {
    id: String(produto.externalId),
    referencia: texto(produto.reference),
    nome: nomeOk ? nome : null,
    nomeErp: erp,
    tituloSugerido: titulo.titulo,
    origemTitulo: titulo.origem,
    descricaoSugerida: descricao.texto,
    origemDescricao: descricao.origem,
    descricaoCortada: descricao.cortada,
    caminhoSugerido: caminho,
    caminhoRepetido: false,
    urlPublicada: null,
    faltas,
    nomesDiferentes,
  };
}

export function sugerirSeo(fatos = {}) {
  const lacunas = [
    "O Charlie não publica título, descrição nem URL na Tray.",
    "A URL publicada da loja não veio na sincronização.",
    "O caminho sugerido é um rascunho feito com o nome cadastrado. Não é o endereço da loja.",
  ];
  if (fatos.produtos == null) lacunas.push("O catálogo sincronizado da Tray não foi lido.");
  if (fatos.nomesErp == null) lacunas.push("O nome do ERP não foi consultado.");
  const nomes = fatos.nomesErp || {};
  const sugeridos = (fatos.produtos || []).map((produto) => {
    const referencia = texto(produto.reference);
    return sugerirProduto(produto, referencia ? nomes[referencia.toUpperCase()] : null);
  });
  const contagem = new Map();
  for (const item of sugeridos) if (item.caminhoSugerido) contagem.set(item.caminhoSugerido, (contagem.get(item.caminhoSugerido) || 0) + 1);
  for (const item of sugeridos) item.caminhoRepetido = Boolean(item.caminhoSugerido && contagem.get(item.caminhoSugerido) > 1);
  const itens = sugeridos.filter((item) => item.faltas.length || item.caminhoRepetido || item.origemTitulo === "erp" || item.nomesDiferentes || item.descricaoCortada || (item.tituloSugerido && item.tituloSugerido !== item.nome));
  itens.sort((a, b) => b.faltas.length - a.faltas.length || String(a.referencia || a.id).localeCompare(String(b.referencia || b.id), "pt-BR"));
  return {
    itens: itens.slice(0, 200),
    lidos: sugeridos.length,
    semDescricao: sugeridos.filter((item) => item.faltas.some((falta) => falta.startsWith("descricao"))).length,
    caminhosRepetidos: sugeridos.filter((item) => item.caminhoRepetido).length,
    lacunas,
    aviso: "As sugestões usam somente campos já cadastrados. Nenhum texto foi gravado.",
  };
}
