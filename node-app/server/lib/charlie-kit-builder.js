const MINIMO_PEDIDOS = 2;

function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function codigo(valor) {
  const limpo = texto(valor);
  return limpo ? limpo.toUpperCase() : null;
}

function positivo(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function saldoDe(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function pedidosDe(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= MINIMO_PEDIDOS ? n : null;
}

function kitsPorPar(kits) {
  if (kits == null) return null;
  const mapa = new Map();
  for (const item of kits) {
    const kit = codigo(item.kit);
    const produto = codigo(item.produtoId);
    if (!kit || !produto) continue;
    const grupo = mapa.get(kit) || new Set();
    grupo.add(produto);
    mapa.set(kit, grupo);
  }
  return mapa;
}

function kitExistente(mapa, a, b) {
  if (!mapa) return [];
  const ids = [];
  for (const [kit, produtos] of mapa) if (produtos.has(a) && produtos.has(b)) ids.push(kit);
  return ids;
}

function montarPar(par, cadastro, kits) {
  const a = codigo(par.a);
  const b = codigo(par.b);
  const pedidos = pedidosDe(par.pedidos);
  if (!a || !b || a === b || pedidos == null) return null;
  const itemA = cadastro?.[a] || {};
  const itemB = cadastro?.[b] || {};
  const precoA = positivo(itemA.preco);
  const precoB = positivo(itemB.preco);
  const custoA = positivo(itemA.custo);
  const custoB = positivo(itemB.custo);
  const saldoA = saldoDe(itemA.saldo);
  const saldoB = saldoDe(itemB.saldo);
  const preco = precoA != null && precoB != null ? Math.round((precoA + precoB) * 100) / 100 : null;
  const custo = custoA != null && custoB != null ? Math.round((custoA + custoB) * 100) / 100 : null;
  const margem = preco != null && custo != null ? Math.round((preco - custo) * 100) / 100 : null;
  const [esquerda, direita] = a < b ? [a, b] : [b, a];
  return {
    id: `${esquerda}:${direita}`,
    a,
    nomeA: texto(itemA.nome) || texto(par.nomeA),
    b,
    nomeB: texto(itemB.nome) || texto(par.nomeB),
    pedidos,
    precoA,
    precoB,
    preco,
    custoA,
    custoB,
    custo,
    margem,
    saldoA,
    saldoB,
    estoqueInsuficiente: saldoA != null && saldoB != null ? saldoA <= 0 || saldoB <= 0 : null,
    kits: kitExistente(kits, a, b),
  };
}

export function sugerirKits(fatos = {}) {
  const lacunas = [
    "A sugestão é um par de produtos que saíram no mesmo pedido, pelo menos duas vezes no período lido.",
    "O preço mostrado é a soma dos preços de cadastro, sem desconto.",
    "A margem é preço de cadastro menos custo de cadastro. Imposto, comissão e taxa não entram.",
    "Nenhum kit foi gravado.",
  ];
  if (fatos.pares == null) lacunas.push("As vendas conjuntas não foram consultadas.");
  if (fatos.cadastro == null) lacunas.push("Preço, custo e estoque do cadastro não foram consultados.");
  if (fatos.kits == null) lacunas.push("Os kits já cadastrados não foram consultados.");
  if (fatos.amostra === true) lacunas.push("A leitura trouxe os 200 pares com mais pedidos. Não é o total do ano.");
  const kits = kitsPorPar(fatos.kits);
  const vistos = new Set();
  const montados = [];
  for (const par of fatos.pares || []) {
    const item = montarPar(par, fatos.cadastro, kits);
    if (!item || vistos.has(item.id)) continue;
    vistos.add(item.id);
    montados.push(item);
  }
  montados.sort((a, b) => b.pedidos - a.pedidos || (b.margem ?? -Infinity) - (a.margem ?? -Infinity) || a.id.localeCompare(b.id, "pt-BR"));
  const sugestoes = montados.filter((item) => !item.kits.length);
  const jaCadastrados = montados.filter((item) => item.kits.length);
  return {
    sugestoes: sugestoes.slice(0, 100),
    jaCadastrados: jaCadastrados.slice(0, 50),
    lidos: montados.length,
    semMargem: sugestoes.filter((item) => item.margem == null).length,
    estoqueIncompleto: sugestoes.filter((item) => item.estoqueInsuficiente === true).length,
    lacunas,
    aviso: "Nenhum kit foi gravado. A conta usa somente pedidos e cadastro já existentes.",
  };
}
