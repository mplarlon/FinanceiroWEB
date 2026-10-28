const ENCERRADOS = new Set(["CONVERTIDO", "PERDIDO", "DESCARTADO"]);

function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function clienteId(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function dinheiro(valor) {
  if (valor == null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null;
}

function inteiro(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : null;
}

function dataIso(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${valor.getFullYear()}-${mes}-${dia}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor || ""));
  return match ? match[1] : null;
}

function pendencia(ficha, fontes) {
  if (ficha.orcamentosAbertos > 0) return "Orçamento em aberto";
  if (ficha.leadsAbertos.length === 1 && ficha.leadsAbertos[0] === "sem situação") return "Lead registrado sem situação";
  if (ficha.leadsAbertos.length) return `Lead registrado: ${ficha.leadsAbertos.join(", ")}`;
  if (!fontes.orcamentos || !fontes.leads) return null;
  return "Sem pendência registrada";
}

export function montarFichas(fatos = {}) {
  const lacunas = [
    "A ficha repete compra, orçamento em aberto e lead já ligado ao cliente.",
    "Campo ausente não vira zero. Zero gravado conta.",
    "Nenhum contato foi disparado e nenhum cadastro foi gravado.",
  ];
  if (fatos.vendas == null) lacunas.push("As compras não foram consultadas.");
  if (fatos.orcamentos == null) lacunas.push("Os orçamentos não foram consultados.");
  if (fatos.leads == null) lacunas.push("Os leads locais não foram lidos.");
  if (fatos.amostra === true) lacunas.push("A lista para em 100 fichas e a compra lida para nos 200 clientes mais recentes do último ano. Não é a base inteira.");
  lacunas.push("Venda ou orçamento sem código de cliente não entra na ficha.");
  const fontes = { orcamentos: fatos.orcamentos != null, leads: fatos.leads != null, vendas: fatos.vendas != null };
  const fichas = new Map();
  function abrir(id) {
    if (!fichas.has(id)) {
      fichas.set(id, {
        id: String(id),
        clienteId: id,
        nome: null,
        vendedor: null,
        ultimaCompra: null,
        pedidos: fontes.vendas ? 0 : null,
        receita: fontes.vendas ? 0 : null,
        orcamentosAbertos: fontes.orcamentos ? 0 : null,
        valorOrcamentos: fontes.orcamentos ? 0 : null,
        ultimoOrcamento: null,
        leadsAbertos: [],
      });
    }
    return fichas.get(id);
  }
  for (const bruto of fatos.vendas || []) {
    const id = clienteId(bruto.clienteId);
    if (!id) continue;
    const ficha = abrir(id);
    ficha.nome = ficha.nome || texto(bruto.nome);
    ficha.vendedor = ficha.vendedor || texto(bruto.vendedor);
    ficha.ultimaCompra = dataIso(bruto.ultimaCompra);
    ficha.pedidos = inteiro(bruto.pedidos);
    ficha.receita = dinheiro(bruto.receita);
  }
  for (const bruto of fatos.orcamentos || []) {
    const id = clienteId(bruto.clienteId);
    if (!id) continue;
    const ficha = abrir(id);
    ficha.nome = ficha.nome || texto(bruto.nome);
    ficha.orcamentosAbertos = inteiro(bruto.abertos);
    ficha.valorOrcamentos = dinheiro(bruto.valor);
    ficha.ultimoOrcamento = dataIso(bruto.ultimo);
  }
  for (const bruto of fatos.leads || []) {
    const id = clienteId(bruto.clienteId);
    if (!id) continue;
    const status = texto(bruto.status);
    if (status && ENCERRADOS.has(status.toUpperCase())) continue;
    const ficha = abrir(id);
    ficha.nome = ficha.nome || texto(bruto.nome);
    const rotulo = status ? status.toUpperCase() : "sem situação";
    if (!ficha.leadsAbertos.includes(rotulo)) ficha.leadsAbertos.push(rotulo);
  }
  const itens = [...fichas.values()].map((ficha) => ({
    id: ficha.id,
    clienteId: ficha.clienteId,
    nome: ficha.nome,
    vendedor: ficha.vendedor,
    ultimaCompra: ficha.ultimaCompra,
    pedidos: ficha.pedidos,
    receita: ficha.receita,
    orcamentosAbertos: ficha.orcamentosAbertos,
    valorOrcamentos: ficha.valorOrcamentos,
    ultimoOrcamento: ficha.ultimoOrcamento,
    pendencia: pendencia(ficha, fontes),
  }));
  itens.sort((a, b) => Number(b.pendencia === "Orçamento em aberto") - Number(a.pendencia === "Orçamento em aberto")
    || String(b.ultimaCompra || "").localeCompare(String(a.ultimaCompra || ""))
    || a.clienteId - b.clienteId);
  const amostra = fatos.amostra === true || itens.length > 100;
  if (amostra && !lacunas.some((item) => item.startsWith("A lista para"))) {
    lacunas.push("A lista para em 100 fichas. Não é a base inteira.");
  }
  return {
    itens: itens.slice(0, 100),
    lidos: itens.length,
    comOrcamento: itens.filter((item) => item.pendencia === "Orçamento em aberto").length,
    semPendencia: itens.filter((item) => item.pendencia === "Sem pendência registrada").length,
    lacunas,
    aviso: "Nenhum cadastro foi gravado. A pendência é o orçamento em aberto ou o lead já ligado ao cliente.",
  };
}
