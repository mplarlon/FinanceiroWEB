function texto(valor) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function codigo(valor) {
  const limpo = texto(valor);
  return limpo ? limpo.toUpperCase() : null;
}

function medida(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

function tokens(valor) {
  return String(valor || "").split(/[,;|]/).map((parte) => codigo(parte)).filter(Boolean);
}

function medidas(esquerda, direita) {
  const iguais = [];
  const divergentes = [];
  for (const campo of ["comprimento", "largura", "espessura"]) {
    if (esquerda[campo] == null || direita[campo] == null) continue;
    if (esquerda[campo] === direita[campo]) iguais.push(campo);
    else divergentes.push(campo);
  }
  return { iguais, divergentes };
}

export function compararProdutos(produtos = [], kits = null) {
  const lista = (produtos || []).map((item) => ({
    id: codigo(item.id),
    nome: texto(item.nome) || codigo(item.id),
    marca: texto(item.marca),
    codigoFabricante: codigo(item.codigoFabricante),
    similar: texto(item.similar),
    comprimento: medida(item.comprimento),
    largura: medida(item.largura),
    espessura: medida(item.espessura),
  })).filter((item) => item.id);
  const porId = new Map(lista.map((item) => [item.id, item]));
  const pares = [];
  const lacunas = [
    "Material e aplicação não estão neste cadastro. Compatibilidade técnica não é confirmada.",
    "Semelhança de nome não entra na comparação.",
  ];
  const vistos = new Set();

  function adicionar(par) {
    const chave = [par.origemId, par.destinoId, par.tipo].sort().join("|");
    if (vistos.has(chave) || par.origemId === par.destinoId) return;
    vistos.add(chave);
    pares.push(par);
  }

  for (const produto of lista) {
    for (const token of tokens(produto.similar)) {
      const destino = porId.get(token);
      if (!destino) {
        lacunas.push(`O substituto ${token} de ${produto.id} não foi encontrado no cadastro.`);
        continue;
      }
      adicionar(base(produto, destino, "substituto_cadastrado", "O campo de produto similar aponta este código. A compatibilidade técnica não foi confirmada."));
    }
  }

  const porFabricante = new Map();
  for (const produto of lista) {
    if (!produto.codigoFabricante) continue;
    const grupo = porFabricante.get(produto.codigoFabricante) || [];
    grupo.push(produto);
    porFabricante.set(produto.codigoFabricante, grupo);
  }
  for (const grupo of porFabricante.values()) {
    for (let i = 0; i < grupo.length; i += 1) {
      for (let j = i + 1; j < grupo.length; j += 1) {
        const esquerda = grupo[i];
        const direita = grupo[j];
        const comparacao = medidas(esquerda, direita);
        if (comparacao.divergentes.length) {
          adicionar(base(esquerda, direita, "medidas_divergentes", `O código de fabricante coincide e ${comparacao.divergentes.join(", ")} divergem. Compatibilidade não confirmada.`));
          continue;
        }
        if (esquerda.marca && direita.marca && codigo(esquerda.marca) !== codigo(direita.marca)) {
          adicionar(base(esquerda, direita, "marca_alternativa", "O código de fabricante coincide e as marcas diferem. Compatibilidade não confirmada."));
          continue;
        }
        adicionar(base(esquerda, direita, "mesmo_codigo_fabricante", "O código de fabricante coincide. Sem material e aplicação, a compatibilidade não foi confirmada."));
      }
    }
  }

  if (kits == null) lacunas.push("Os kits cadastrados não foram consultados.");
  else {
    const porKit = new Map();
    for (const item of kits) {
      const kit = codigo(item.kit);
      const produtoId = codigo(item.produtoId);
      if (!kit || !produtoId) continue;
      const grupo = porKit.get(kit) || [];
      grupo.push(produtoId);
      porKit.set(kit, grupo);
    }
    if (!porKit.size) lacunas.push("Não há kit cadastrado para indicar produto complementar.");
    for (const [kit, ids] of porKit) {
      const unicos = [...new Set(ids)];
      for (let i = 0; i < unicos.length; i += 1) {
        for (let j = i + 1; j < unicos.length; j += 1) {
          const origem = porId.get(unicos[i]) || { id: unicos[i], nome: unicos[i] };
          const destino = porId.get(unicos[j]) || { id: unicos[j], nome: unicos[j] };
          adicionar(base(origem, destino, "complementar_kit", `Os dois códigos estão no kit ${kit}. Isso não confirma compatibilidade técnica.`));
        }
      }
    }
  }

  return {
    pares: pares.slice(0, 200),
    ocultos: Math.max(0, pares.length - 200),
    lacunas: [...new Set(lacunas)].slice(0, 40),
    aviso: "Nenhum par foi confirmado como equivalente só por nome parecido.",
  };
}

function base(origem, destino, tipo, motivo) {
  return {
    id: `${tipo}:${origem.id}:${destino.id}`,
    origemId: origem.id,
    origemNome: origem.nome,
    destinoId: destino.id,
    destinoNome: destino.nome,
    tipo,
    compatibilidade: "nao_confirmada",
    motivo,
  };
}
