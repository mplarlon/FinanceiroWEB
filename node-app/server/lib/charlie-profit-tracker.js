function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function codigo(valor) {
  const limpo = texto(valor);
  return limpo ? limpo.toUpperCase() : null;
}

function dinheiro(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function linhaDe(item) {
  const produtoId = codigo(item.produtoId);
  const canal = texto(item.canal);
  if (!produtoId || !canal) return null;
  return {
    produtoId,
    nome: texto(item.nome),
    canal,
    receita: dinheiro(item.receita),
    custo: dinheiro(item.custo),
    tributos: dinheiro(item.tributos),
    comissao: dinheiro(item.comissao),
    taxa: dinheiro(item.taxa),
  };
}

function fechar(grupo) {
  const faltas = [];
  if (grupo.receita == null) faltas.push("receita");
  if (grupo.custo == null) faltas.push("custo");
  if (grupo.tributos == null) faltas.push("tributos");
  if (grupo.comissao == null) faltas.push("comissao");
  if (grupo.taxa == null) faltas.push("taxa");
  const margem = faltas.length ? null : Math.round((grupo.receita - grupo.custo - grupo.tributos - grupo.comissao - grupo.taxa) * 100) / 100;
  return { ...grupo, faltas, margem, conciliado: faltas.length === 0 };
}

export function acompanharLucro(fatos = {}) {
  const lacunas = [
    "A margem só aparece quando receita, custo, tributos, comissão e taxa do canal são números lidos.",
    "Zero gravado no pedido conta. Campo ausente não vira zero.",
    "A margem desta tela não fecha o resultado da empresa.",
    "Nenhum valor foi gravado.",
  ];
  if (fatos.linhas == null) lacunas.push("As vendas não foram consultadas.");
  if (Object.hasOwn(fatos, "erp") && fatos.erp == null) lacunas.push("As vendas do ERP não foram consultadas.");
  if (fatos.pedidosTray == null) lacunas.push("Os pedidos sincronizados da Tray não foram lidos.");
  lacunas.push("Item sem código não entra na conta.");
  if (fatos.amostra === true) lacunas.push("A leitura do ERP trouxe os 200 produtos de maior receita no período. Não é o total.");
  if (fatos.recorte) lacunas.push(fatos.recorte);
  const grupos = new Map();
  for (const bruto of fatos.linhas || []) {
    const linha = linhaDe(bruto);
    if (!linha) continue;
    const chave = `${linha.canal}:${linha.produtoId}`;
    const atual = grupos.get(chave) || { id: chave, produtoId: linha.produtoId, nome: linha.nome, canal: linha.canal, receita: 0, custo: 0, tributos: 0, comissao: 0, taxa: 0, receitaOk: true, custoOk: true, tributosOk: true, comissaoOk: true, taxaOk: true };
    if (!atual.nome && linha.nome) atual.nome = linha.nome;
    for (const campo of ["receita", "custo", "tributos", "comissao", "taxa"]) {
      if (linha[campo] == null) atual[`${campo}Ok`] = false;
      else atual[campo] = Math.round((atual[campo] + linha[campo]) * 100) / 100;
    }
    grupos.set(chave, atual);
  }
  const itens = [...grupos.values()].map((grupo) => fechar({
    id: grupo.id,
    produtoId: grupo.produtoId,
    nome: grupo.nome,
    canal: grupo.canal,
    receita: grupo.receitaOk ? grupo.receita : null,
    custo: grupo.custoOk ? grupo.custo : null,
    tributos: grupo.tributosOk ? grupo.tributos : null,
    comissao: grupo.comissaoOk ? grupo.comissao : null,
    taxa: grupo.taxaOk ? grupo.taxa : null,
  }));
  itens.sort((a, b) => (b.receita ?? -1) - (a.receita ?? -1) || a.id.localeCompare(b.id, "pt-BR"));
  return {
    itens: itens.slice(0, 200),
    lidos: itens.length,
    conciliados: itens.filter((item) => item.conciliado).length,
    semTaxa: itens.filter((item) => item.faltas.includes("taxa")).length,
    lacunas,
    aviso: "Nenhum valor foi gravado. A margem fica em branco enquanto faltar custo, tributo, comissão ou taxa.",
  };
}
