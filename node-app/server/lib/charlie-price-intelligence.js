function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function dinheiro(valor) {
  const n = numero(valor);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

export function margemSobrePreco(preco, custo) {
  const precoNumero = numero(preco);
  const custoNumero = numero(custo);
  if (!(precoNumero > 0) || custoNumero == null) return null;
  return Math.round((((precoNumero - custoNumero) / precoNumero) * 100) * 10) / 10;
}

export function precoMinimo(custo, margemMinima) {
  const custoNumero = numero(custo);
  const margem = numero(margemMinima);
  if (custoNumero == null || custoNumero < 0 || margem == null || margem < 0 || margem >= 100) return null;
  return dinheiro(custoNumero / (1 - margem / 100));
}

export const COMPONENTES_AUSENTES = "Imposto, comissão, taxa financeira e frete não estão conciliados. A conta usa só preço e custo.";

export function simularPreco(produto = {}, pedido = {}, regras = {}) {
  const preco = numero(produto.preco);
  if (!(preco > 0)) throw Object.assign(new Error("O produto não tem preço cadastrado."), { status: 400 });
  const desconto = numero(pedido.desconto);
  const reajuste = numero(pedido.reajuste);
  if (desconto != null && reajuste != null) throw Object.assign(new Error("Informe desconto ou reajuste, não os dois."), { status: 400 });
  if (desconto != null && (!(desconto >= 0) || desconto >= 100)) throw Object.assign(new Error("O desconto precisa ficar entre 0 e 100, sem incluir 100."), { status: 400 });
  if (reajuste != null && (!(reajuste > -100) || reajuste > 200)) throw Object.assign(new Error("O reajuste precisa ficar entre -100 e 200."), { status: 400 });
  const proposto = dinheiro(desconto != null ? preco * (1 - desconto / 100) : reajuste != null ? preco * (1 + reajuste / 100) : preco);
  const variacao = Math.round((((proposto - preco) / preco) * 100) * 10) / 10;
  const custo = numero(produto.custo);
  const canal = String(pedido.canal || "").trim();
  const margemCanal = canal ? numero(regras.canais?.[canal]) : null;
  const margemAlvo = margemCanal ?? numero(regras.minimumMargin) ?? 0;
  const piso = numero(regras.pisos?.[produto.id]);
  const teto = numero(regras.maximumAutomaticChange) ?? 0;
  const bloqueado = (regras.protegidos || []).map(String).includes(String(produto.id));
  const margemProposta = margemSobrePreco(proposto, custo);
  return {
    id: produto.id,
    nome: produto.nome || "",
    preco,
    custo,
    proposto,
    variacao,
    margemAtual: margemSobrePreco(preco, custo),
    margemProposta,
    precoMinimo: precoMinimo(custo, margemAlvo),
    margemAlvo,
    canal: canal || null,
    abaixoDaMargem: margemProposta != null && margemProposta < margemAlvo,
    abaixoDoPiso: piso != null && proposto < piso,
    excedeuTeto: Math.abs(variacao) > teto + 0.05,
    bloqueado,
    componentes: { imposto: null, comissao: null, taxa: null, frete: null, motivo: COMPONENTES_AUSENTES },
  };
}

export function avaliarProposta(simulacao, mode) {
  if (mode === "analysis") return { gravar: false, motivo: "Modo somente análise. Nenhuma alteração foi gravada." };
  if (simulacao.bloqueado) return { gravar: false, motivo: "O produto está bloqueado para alteração de preço." };
  if (simulacao.abaixoDoPiso) return { gravar: false, motivo: "O preço proposto está abaixo do mínimo configurado." };
  if (simulacao.custo == null) return { gravar: false, motivo: "Sem custo no cadastro não há proposta de preço." };
  if (mode === "automatic" && (simulacao.excedeuTeto || simulacao.abaixoDaMargem)) return { gravar: false, motivo: "Fora da margem mínima ou do teto de reajuste. Nenhuma execução automática foi feita." };
  return { gravar: true, motivo: "A proposta fica pendente na central de ações. O preço só muda depois da aprovação e da execução." };
}

export function rentabilidadePorCanal(canais = [], custo) {
  const custoNumero = numero(custo);
  return canais.map((canal) => {
    const quantidade = numero(canal.quantidade);
    const receita = dinheiro(canal.receita);
    const custoEstimado = custoNumero == null || quantidade == null ? null : dinheiro(custoNumero * quantidade);
    return {
      canal: canal.canal || "Loja virtual Tray",
      quantidade,
      receita,
      custoEstimado,
      contribuicao: custoEstimado == null || receita == null ? null : dinheiro(receita - custoEstimado),
      taxa: null,
      observacao: canal.observacao || null,
      aviso: "A contribuição desconta só o custo do cadastro. Taxa, imposto, comissão e frete do canal não entraram.",
    };
  });
}

export function vendasDoProduto(store = {}, productId) {
  const mapa = new Map();
  for (const order of Object.values(store.orders || {})) {
    if (/cancel/i.test(String(order.status || ""))) continue;
    for (const item of order.items || []) {
      const codigo = item.externalId || item.reference;
      if (codigo !== productId) continue;
      const canal = order.marketplace || "Loja virtual Tray";
      const atual = mapa.get(canal) || { canal, linhas: 0, comQuantidade: 0, quantidade: 0, comValor: 0, soma: 0 };
      atual.linhas += 1;
      if (item.quantity != null && Number.isFinite(Number(item.quantity))) {
        atual.comQuantidade += 1;
        atual.quantidade += Number(item.quantity);
      }
      if (item.total != null && Number.isFinite(Number(item.total))) {
        atual.comValor += 1;
        atual.soma += Number(item.total);
      }
      mapa.set(canal, atual);
    }
  }
  return [...mapa.values()].map((atual) => ({
    canal: atual.canal,
    quantidade: atual.comQuantidade === atual.linhas ? atual.quantidade : null,
    receita: atual.comValor === atual.linhas ? atual.soma : null,
    observacao: atual.comValor > 0 && atual.comValor < atual.linhas
      ? "Há item sem valor neste canal."
      : atual.comValor === 0 ? "O item deste canal não tem valor." : null,
  }));
}

function fotoTray(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" || parsed.hostname !== "images.tcdn.com.br") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function painelPrecos(store = {}, regras = {}) {
  return Object.values(store.products || {}).map((produto) => {
    const id = produto.externalId;
    const canais = rentabilidadePorCanal(vendasDoProduto(store, id), produto.cost);
    return {
      id,
      nome: produto.name,
      imagem: fotoTray(produto.imageUrl),
      preco: numero(produto.price),
      custo: numero(produto.cost),
      margem: margemSobrePreco(produto.price, produto.cost),
      precoMinimo: precoMinimo(produto.cost, regras.minimumMargin),
      piso: numero(regras.pisos?.[id]),
      bloqueado: (regras.protegidos || []).map(String).includes(String(id)),
      canais,
    };
  });
}
