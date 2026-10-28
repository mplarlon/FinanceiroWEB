const PARADAS = new Set("preco valor estoque prazo produto codigo unidade peca pecas metro metros para pelo pela com sem esse essa item itens lista material pedido orcamento solicitacao favor enviar preciso obrigado".split(" "));

function numero(valor) {
  const texto = String(valor ?? "").trim().replace(/\s/g, "");
  if (!/^\d+(?:[.,]\d+)?$/.test(texto)) return null;
  const normal = texto.includes(",") ? texto.replace(",", ".") : texto;
  const quantidade = Number(normal);
  if (!Number.isFinite(quantidade) || quantidade <= 0 || quantidade > 999999) return null;
  return Math.round(quantidade * 1000) / 1000;
}

function semAcento(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function codigoNoTexto(texto) {
  return String(texto || "").match(/\b(?=[A-Za-z0-9./-]*\d)[A-Za-z0-9][A-Za-z0-9./-]{1,30}\b/)?.[0] || "";
}

function temProduto(texto) {
  return semAcento(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .some((parte) => parte.length >= 3 && !PARADAS.has(parte) && /[a-z]/.test(parte));
}

export function linhaDePedido(texto) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!limpo) return null;
  const colunas = limpo.split(/\t|;/).map((parte) => parte.trim()).filter(Boolean);
  if (colunas.length >= 2) {
    const quantidade = numero(colunas[colunas.length - 1]);
    const descricao = colunas.slice(0, -1).join(" ");
    if (quantidade && temProduto(descricao)) {
      return { codigo: codigoNoTexto(colunas[0]) || codigoNoTexto(descricao), descricao, quantidade, origem: limpo };
    }
  }
  const inicio = limpo.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|un|pc|pcs|pç|pecas|peças)?\s+(.+)$/i);
  if (inicio && temProduto(inicio[2])) {
    return { codigo: codigoNoTexto(inicio[2]), descricao: inicio[2].trim(), quantidade: numero(inicio[1]), origem: limpo };
  }
  const fim = limpo.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);
  if (fim && temProduto(fim[1]) && !/r\$/i.test(limpo)) {
    return { codigo: codigoNoTexto(fim[1]), descricao: fim[1].trim(), quantidade: numero(fim[2]), origem: limpo };
  }
  const codigo = codigoNoTexto(limpo);
  if (codigo && limpo === codigo) return { codigo, descricao: codigo, quantidade: null, origem: limpo };
  return null;
}

export function interpretarTexto(texto) {
  return String(texto || "")
    .split(/\r?\n/)
    .map(linhaDePedido)
    .filter(Boolean)
    .slice(0, 80);
}

function celula(valor) {
  if (valor == null) return "";
  if (typeof valor === "object") return String(valor.text || valor.result || "").trim();
  return String(valor).trim();
}

export function interpretarTabela(linhas = []) {
  const rows = linhas.map((linha) => (Array.isArray(linha) ? linha : [linha]).map(celula)).filter((linha) => linha.some(Boolean));
  if (!rows.length) return [];
  const cabecalho = rows[0].map((item) => item.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  const codigo = cabecalho.findIndex((item) => /codigo/.test(item));
  const descricao = cabecalho.findIndex((item) => /descr|produto|item/.test(item));
  const quantidade = cabecalho.findIndex((item) => /qtd|quant/.test(item));
  if (quantidade >= 0 || codigo >= 0 || descricao >= 0) {
    return rows.slice(1).map((linha) => {
      const descricaoTexto = [descricao >= 0 ? linha[descricao] : "", codigo >= 0 ? linha[codigo] : ""].filter(Boolean).join(" ");
      const qtd = quantidade >= 0 ? numero(linha[quantidade]) : null;
      if (!temProduto(descricaoTexto)) return null;
      return { codigo: codigoNoTexto(codigo >= 0 ? linha[codigo] : descricaoTexto), descricao: descricaoTexto, quantidade: qtd, origem: linha.filter(Boolean).join(" ") };
    }).filter(Boolean).slice(0, 80);
  }
  return interpretarTexto(rows.map((linha) => linha.join(" ")).join("\n"));
}

export function termoDeBusca(descricao) {
  const palavras = semAcento(descricao)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((parte) => parte.length >= 4 && !PARADAS.has(parte) && !/^\d+$/.test(parte));
  return palavras.sort((a, b) => b.length - a.length)[0]?.slice(0, 40) || "";
}

export function dinheiro(valor) {
  const numeroValor = Number(valor);
  if (!Number.isFinite(numeroValor)) return null;
  return Math.round(numeroValor * 100) / 100;
}

export function classificarItem(pedido, busca = {}) {
  const base = {
    codigo: pedido.codigo || "",
    descricao: pedido.descricao || "",
    quantidade: pedido.quantidade ?? null,
    origem: pedido.origem || "",
    produto: null,
    candidatos: [],
    aviso: "",
  };
  if (!busca.disponivel) return { ...base, situacao: "erp_indisponivel", aviso: "O ERP não foi consultado. Preço e estoque não foram preenchidos." };
  if (pedido.codigo) {
    if (busca.exato) return { ...base, situacao: "encontrado", produto: busca.exato, aviso: "Código localizado no cadastro. Nenhum substituto foi usado." };
    return { ...base, situacao: "nao_encontrado", aviso: "O código não está no cadastro. Não há equivalência técnica para substituir o item." };
  }
  const produtos = Array.isArray(busca.produtos) ? busca.produtos.slice(0, 8) : [];
  if (!produtos.length) return { ...base, situacao: "nao_encontrado", aviso: "Nenhum produto do cadastro contém esse termo. Nenhum substituto foi escolhido." };
  if (produtos.length === 1) return { ...base, situacao: "revisar", candidatos: produtos, aviso: "Há um nome parecido. Ele só entra no orçamento se for escolhido." };
  return { ...base, situacao: "ambiguo", candidatos: produtos, aviso: "Há produtos parecidos. Nenhum foi escolhido no lugar do outro." };
}

export function valorDoItem(item) {
  if (!["encontrado", "escolhido"].includes(item?.situacao)) return null;
  if (item.quantidade == null || item.produto?.preco == null) return null;
  return dinheiro(item.quantidade * item.produto.preco);
}

export function resumirOrcamento(itens = []) {
  const valores = itens.map(valorDoItem);
  const somaveis = valores.filter((valor) => valor != null);
  return {
    itens: itens.map((item, indice) => ({ ...item, indice, valor: valorDoItem(item) })),
    total: somaveis.length ? dinheiro(somaveis.reduce((soma, valor) => soma + valor, 0)) : null,
    totalParcial: itens.some((item) => ["encontrado", "escolhido"].includes(item.situacao) && valorDoItem(item) == null),
    pendentes: itens.filter((item) => ["ambiguo", "revisar", "nao_encontrado", "erp_indisponivel"].includes(item.situacao)).length,
  };
}

export function escolherItem(orcamento, indice, codigo) {
  const itens = orcamento.itens.map((item) => ({ ...item }));
  const item = itens[indice];
  if (!item) throw Object.assign(new Error("Item não encontrado."), { status: 404 });
  const candidato = (item.candidatos || []).find((atual) => atual.codigo === codigo);
  if (!candidato) throw Object.assign(new Error("Esse produto não está entre as opções encontradas."), { status: 400 });
  itens[indice] = { ...item, produto: candidato, situacao: "escolhido", aviso: "Produto escolhido entre as opções do cadastro." };
  return resumirOrcamento(itens);
}

export function definirQuantidade(orcamento, indice, quantidade) {
  const itens = orcamento.itens.map((item) => ({ ...item }));
  const item = itens[indice];
  if (!item) throw Object.assign(new Error("Item não encontrado."), { status: 404 });
  const valor = numero(quantidade);
  if (valor == null) throw Object.assign(new Error("Informe uma quantidade maior que zero."), { status: 400 });
  itens[indice] = { ...item, quantidade: valor };
  return resumirOrcamento(itens);
}

export const MOTIVO_SEM_GRAVACAO = "A confirmação não grava ORCAMENTO nem ORCPROD. O orçamento oficial continua no Automec, que calcula ICMS, ST, custo e comissão do item.";

export function confirmarOrcamento(orcamento) {
  const resumo = resumirOrcamento(orcamento.itens || []);
  if (resumo.itens.some((item) => ["ambiguo", "revisar"].includes(item.situacao))) {
    throw Object.assign(new Error("Escolha o produto de cada item parecido antes de confirmar."), { status: 400 });
  }
  if (resumo.itens.some((item) => ["encontrado", "escolhido"].includes(item.situacao) && item.quantidade == null)) {
    throw Object.assign(new Error("Informe a quantidade dos itens encontrados."), { status: 400 });
  }
  if (!resumo.itens.some((item) => ["encontrado", "escolhido"].includes(item.situacao))) {
    throw Object.assign(new Error("Nenhum item foi localizado no cadastro."), { status: 400 });
  }
  return {
    ...orcamento,
    ...resumo,
    status: "confirmado",
    gravadoNoErp: false,
    motivo: MOTIVO_SEM_GRAVACAO,
  };
}
