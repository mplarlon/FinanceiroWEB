function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function positivo(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function disponibilidadeDe(produto) {
  if (produto.available != null && produto.available !== "") {
    const n = Number(produto.available);
    if (!Number.isFinite(n)) return null;
    return n > 0 ? "em_estoque" : "sem_estoque";
  }
  if (produto.stock != null && produto.stock !== "") {
    const n = Number(produto.stock);
    if (!Number.isFinite(n)) return null;
    return n > 0 ? "em_estoque" : "sem_estoque";
  }
  return null;
}

function conferirProduto(produto, precoErp) {
  const faltas = [];
  const titulo = texto(produto.name);
  const tituloOk = Boolean(titulo) && titulo !== "Produto sem descrição";
  if (!tituloOk) faltas.push("titulo");
  if (produto.description === undefined && produto.descriptionSmall === undefined) faltas.push("descricao_nao_sincronizada");
  else if (!texto(produto.description) && !texto(produto.descriptionSmall)) faltas.push("descricao_vazia");
  const preco = positivo(produto.price);
  if (preco == null) faltas.push("preco");
  if (produto.imagesObserved !== true) faltas.push("imagem_nao_sincronizada");
  else if (!(Number(produto.imageCount) > 0)) faltas.push("imagem");
  if (!texto(produto.brand)) faltas.push("marca");
  const disponibilidade = disponibilidadeDe(produto);
  if (disponibilidade == null) faltas.push("disponibilidade");
  const erp = positivo(precoErp);
  const divergencia = preco != null && erp != null ? Math.round((preco - erp) * 100) / 100 : null;
  return {
    id: String(produto.externalId),
    referencia: texto(produto.reference),
    nome: tituloOk ? titulo : null,
    preco,
    precoErp: erp,
    divergencia,
    disponibilidade,
    link: null,
    gtin: null,
    faltas,
    sugestao: faltas.length ? "Complete no cadastro da Tray os campos ausentes. Esta tela não grava título nem descrição." : null,
  };
}

export function conferirCatalogo(fatos = {}) {
  const lacunas = [
    "O Charlie não consulta o Google Merchant Center.",
    "O link do anúncio e o GTIN não vieram na sincronização da Tray.",
    "A diferença de preço compara a Tray com o ERP. Não é o preço publicado no Google.",
  ];
  if (fatos.produtos == null) lacunas.push("O catálogo sincronizado da Tray não foi lido.");
  if (fatos.precosErp == null) lacunas.push("O preço do ERP não foi consultado.");
  const errosTray = (fatos.errosTray || []).map((erro) => ({
    em: erro.em || erro.at || null,
    mensagem: texto(erro.mensagem || erro.message),
    origem: "sincronizacao_tray",
  })).filter((erro) => erro.mensagem);
  if (!errosTray.length) lacunas.push("A sincronização da Tray não trouxe recusa do Google Merchant Center.");
  const precos = fatos.precosErp || {};
  const conferidos = (fatos.produtos || []).map((produto) => conferirProduto(produto, produto.reference ? precos[String(produto.reference).trim().toUpperCase()] : null));
  const itens = conferidos.filter((item) => item.faltas.length || item.divergencia);
  itens.sort((a, b) => b.faltas.length - a.faltas.length || String(a.referencia || a.id).localeCompare(String(b.referencia || b.id), "pt-BR"));
  return {
    itens: itens.slice(0, 200),
    lidos: conferidos.length,
    incompletos: conferidos.filter((item) => item.faltas.length).length,
    divergentes: conferidos.filter((item) => item.divergencia).length,
    errosTray,
    errosGoogle: [],
    lacunas,
    aviso: "A conferência usa o catálogo já sincronizado da Tray. Nenhum anúncio foi alterado.",
  };
}
