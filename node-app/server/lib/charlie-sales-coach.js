function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function somar(valores) {
  if (valores == null) return null;
  if (!valores.length) return 0;
  if (valores.some((valor) => numero(valor) == null)) return null;
  return Math.round(valores.reduce((soma, valor) => soma + numero(valor), 0) * 100) / 100;
}

function diaUtc(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
  const encontrado = String(valor ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!encontrado) return null;
  return Date.UTC(Number(encontrado[1]), Number(encontrado[2]) - 1, Number(encontrado[3]));
}

function diasDesde(data, hoje) {
  const inicio = diaUtc(data);
  const fim = diaUtc(hoje);
  if (inicio == null || fim == null || fim < inicio) return null;
  return Math.round((fim - inicio) / 86400000);
}

function metaDoVendedor(metas, id) {
  const valor = numero(metas?.vendedores?.[id] ?? metas?.vendedores?.[String(id)]);
  return valor != null && valor > 0 ? valor : null;
}

function contaMeta(meta, realizado) {
  if (!(meta > 0) || realizado == null) return { valor: meta > 0 ? meta : null, realizado, atingimento: null, faltam: null };
  return {
    valor: meta,
    realizado,
    atingimento: Math.round((realizado / meta) * 1000) / 10,
    faltam: Math.round(Math.max(0, meta - realizado) * 100) / 100,
  };
}

export function montarCoach(fatos = {}, visao = {}) {
  const lacunas = [
    "O tempo de resposta fica em branco. O orçamento não tem data de resposta do cliente.",
    "Não há meta diária por vendedor. A meta diária da loja não foi atribuída à carteira.",
    "O par lista dois produtos que estiveram no mesmo pedido pelo menos 3 vezes nos últimos 365 dias. Isso não confirma compatibilidade.",
  ];
  if (fatos.complementos == null) lacunas.push("Os pares no mesmo pedido não foram consultados.");
  if (fatos.orcamentos == null) lacunas.push("Os orçamentos do mês não foram consultados.");
  if (fatos.vendasMes == null) lacunas.push("As vendas do mês não foram consultadas.");
  if (fatos.vendasDia == null) lacunas.push("As vendas do dia não foram consultadas.");
  if (fatos.inativos == null || fatos.inativoDias == null) lacunas.push("Os clientes inativos não foram consultados.");
  if (fatos.metas == null) lacunas.push("As metas do Charlie Daily não foram lidas.");
  if ([...(fatos.vendasMes || []), ...(fatos.vendasDia || [])].some((item) => numero(item.valor) == null)) {
    lacunas.push("Há item sem valor. O faturamento desse vendedor não foi somado.");
  }

  const equipe = Boolean(visao.gerencial) && (visao.vendedorId == null || visao.todos);
  const lista = fatos.vendedores || [];
  const vendedores = !equipe && visao.vendedorId != null
    ? [lista.find((item) => Number(item.id) === Number(visao.vendedorId)) || { id: visao.vendedorId, nome: "Carteira vinculada" }]
    : equipe ? lista : [];

  const cartoes = vendedores.map((vendedor) => cartao(vendedor, fatos)).slice(0, 80);
  const metaMensalLoja = numero(fatos.metas?.mensal);
  const metaDiariaLoja = numero(fatos.metas?.diaria);
  return {
    escopo: equipe ? "equipe" : visao.vendedorId != null ? "carteira" : "nenhum",
    podeVerEquipe: Boolean(visao.gerencial),
    vendedores: cartoes,
    loja: equipe ? {
      metaMensal: metaMensalLoja > 0 ? metaMensalLoja : null,
      metaDiaria: metaDiariaLoja > 0 ? metaDiariaLoja : null,
      aviso: "Meta da loja. Não foi dividida entre vendedores.",
    } : null,
    lacunas,
    aviso: "A taxa é a conta do período. Não é probabilidade de fechar o próximo orçamento. A consulta não grava tarefa nem envia mensagem.",
  };
}

function cartao(vendedor, fatos) {
  const id = vendedor.id;
  const orcamentos = (fatos.orcamentos || []).filter((item) => Number(item.vendedorId) === Number(id));
  const contados = orcamentos.filter((item) => item.status === 0 || item.status === 1);
  const convertidos = contados.filter((item) => item.status === 1).length;
  const semContato = contados.filter((item) => item.status === 0 && !String(item.contato || "").trim()).slice(0, 20);
  const oportunidades = contados.filter((item) => item.status === 0)
    .sort((a, b) => {
      const esquerda = numero(a.valor);
      const direita = numero(b.valor);
      if (esquerda == null && direita == null) return 0;
      if (esquerda == null) return 1;
      if (direita == null) return -1;
      return direita - esquerda;
    })
    .slice(0, 20);
  const vendasMes = fatos.vendasMes == null ? null : somar(fatos.vendasMes.filter((item) => Number(item.vendedorId) === Number(id)).map((item) => item.valor));
  const vendasDia = fatos.vendasDia == null ? null : somar(fatos.vendasDia.filter((item) => Number(item.vendedorId) === Number(id)).map((item) => item.valor));
  const meta = contaMeta(metaDoVendedor(fatos.metas, id), vendasMes);
  const inativos = fatos.inativos == null ? null : fatos.inativos.filter((item) => Number(item.vendedorId) === Number(id) && diasDesde(item.ultimaCompra, fatos.hoje) != null && fatos.inativoDias != null && diasDesde(item.ultimaCompra, fatos.hoje) > fatos.inativoDias).slice(0, 20);
  const complementos = fatos.complementos == null ? null : fatos.complementos.filter((item) => Number(item.vendedorId) === Number(id) && Number(item.suporte) >= 3).slice(0, 10);
  const recomendacoes = [];
  if (fatos.orcamentos != null && !contados.length) recomendacoes.push("Não há orçamento aberto ou finalizado no mês.");
  if (semContato.length) recomendacoes.push(`Há ${semContato.length} orçamento(s) aberto(s) sem nome de contato no cadastro.`);
  if (inativos?.length) recomendacoes.push(`Há ${inativos.length} cliente(s) da carteira sem compra dentro do prazo configurado.`);
  if (meta.valor != null && meta.faltam > 0) recomendacoes.push("O resultado do mês está abaixo da meta deste vendedor.");
  if (!recomendacoes.length) recomendacoes.push("Nada além dos números lidos pede acompanhamento.");
  return {
    id,
    nome: vendedor.nome || `Vendedor ${id}`,
    orcamentos: fatos.orcamentos == null ? null : contados.length,
    convertidos: fatos.orcamentos == null ? null : convertidos,
    taxaConversao: fatos.orcamentos == null || !contados.length ? null : Math.round((convertidos / contados.length) * 1000) / 10,
    tempoResposta: null,
    vendasDia,
    vendasMes,
    metaMensal: meta,
    metaDiaria: null,
    semContato: semContato.map((item) => ({ numero: item.numero, cliente: item.cliente, valor: numero(item.valor) })),
    oportunidades: oportunidades.map((item) => ({ numero: item.numero, cliente: item.cliente, valor: numero(item.valor), prioridade: numero(item.valor) == null ? "orçamento sem valor" : "valor do orçamento" })),
    inativos: inativos?.map((item) => ({ clienteId: item.clienteId, cliente: item.cliente, ultimaCompra: String(item.ultimaCompra).slice(0, 10) })) ?? null,
    complementos: complementos == null ? null : complementos.map((item) => ({ produto: item.produto, junto: item.junto || null, suporte: item.suporte, aviso: "Os dois apareceram no mesmo pedido. Não confirma compatibilidade." })),
    recomendacoes,
    tarefas: recomendacoes.map((texto) => ({ texto, gravada: false, enviada: false })),
  };
}
