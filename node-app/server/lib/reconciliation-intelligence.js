const CAUSAS = [
  "desconto_concedido",
  "tarifa_financeira",
  "retencao",
  "pagamento_parcial",
  "divergencia_valor",
  "transferencia_interna",
  "pagamento_agrupado",
  "sem_evidencia",
];

const PARADAS = new Set(["de", "da", "do", "dos", "das", "e", "ltda", "me", "epp", "sa", "comercio", "comercial", "industria"]);

export const CONFIGURACAO_PADRAO = {
  ativo: true,
  intervaloMinutos: 15,
  janelaDias: 3,
  metaPercentual: 95,
  minutosPorManual: 3,
  maxCharlie: 8,
  maxMovimentos: 500,
  autorizacoes: { retencao: false, tarifas: [] },
  contratoCartao: null,
  notificacoes: {
    interno: true,
    email: false,
    whatsapp: false,
    envioReal: false,
    destinatarios: [],
    horario: "08:00",
    prioridades: ["alta", "normal"],
  },
  perfisAprovacao: ["financeiro", "admin", "gerente"],
};

const arredondar = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

export function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dia(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return new Date(valor.getTime() - valor.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  const texto = String(valor || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

function distanciaDias(esquerda, direita) {
  const a = dia(esquerda);
  const b = dia(direita);
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
}

function empresaDe(registro) {
  const valor = Number(registro?.empresa ?? registro?.idempresa ?? 0);
  return valor > 0 ? valor : null;
}

function mesmaEmpresa(movimento, titulo) {
  const empresa = empresaDe(movimento);
  const outra = empresaDe(titulo);
  return Boolean(empresa && outra && empresa === outra);
}

function direcaoValor(valor) {
  const numero = Number(valor) || 0;
  if (numero > 0) return "receber";
  if (numero < 0) return "pagar";
  return "zero";
}

function chaveTitulo(titulo) {
  return `${titulo.tipo}:${empresaDe(titulo)}:${Number(titulo.controle)}`;
}

function contaDe(movimento) {
  const conta = movimento?.conta || {};
  return {
    banco: String(conta.banco ?? movimento?.banco ?? "").trim(),
    agencia: String(conta.agencia ?? movimento?.agencia ?? "").trim(),
    conta: String(conta.conta ?? movimento?.numconta ?? "").trim(),
  };
}

function chaveConta(movimento) {
  const conta = contaDe(movimento);
  return `${conta.banco}|${conta.agencia}|${conta.conta}`;
}

function idLimpo(valor) {
  const texto = String(valor || "").replace(/\W/g, "").toUpperCase();
  return texto.length >= 5 ? texto : null;
}

export function extrairIdentificadores(texto) {
  const fonte = String(texto || "");
  return {
    endToEndId: fonte.match(/\bE[A-Za-z0-9]{31}\b/)?.[0]?.toUpperCase() || null,
    nossoNumero: fonte.match(/nosso\s*n[uú]mero\s*[:\-]?\s*([A-Za-z0-9-]{5,30})/i)?.[1] || null,
    cobrancaId: fonte.match(/cobran[cç]a\s*[:\-]?\s*([A-Za-z0-9-]{5,40})/i)?.[1] || null,
    pedido: fonte.match(/pedido\s*[:\-]?\s*([A-Za-z0-9-]{5,30})/i)?.[1] || null,
  };
}

export function classificarMovimento(movimento) {
  const historico = normalizarTexto(movimento?.historico);
  const ids = identificadoresDoMovimento(movimento);
  let natureza = "outros";
  if (historico.includes("pix") || ids.endToEndId) natureza = "pix";
  else if (/boleto|cobranca/.test(historico) || ids.nossoNumero) natureza = "boleto";
  else if (/tarifa|taxa banc|cesta de/.test(historico)) natureza = "tarifa";
  else if (/darf|gps|\bdas\b|tribut|imposto|fgts/.test(historico)) natureza = "tributo";
  else if (/folha|salario|adiantamento salarial/.test(historico)) natureza = "folha";
  else if (/mercado livre|mercadolivre|shopee|amazon|tray/.test(historico)) natureza = "marketplace";
  else if (/cartao|cielo|rede|stone|pagbank|getnet|visa|master/.test(historico)) natureza = "cartao";
  else if (/transf|ted|entre contas/.test(historico)) natureza = "transferencia";
  const devolucao = /estorn|devolu/.test(historico);
  if (devolucao && natureza === "outros") natureza = "estorno";
  return { natureza, devolucao, direcao: direcaoValor(movimento?.valor), ...ids };
}

function identificadoresDoMovimento(movimento) {
  const extra = extrairIdentificadores(`${movimento?.historico || ""} ${movimento?.numdoc || ""} ${movimento?.fitid || ""}`);
  return {
    endToEndId: idLimpo(movimento?.endToEndId || extra.endToEndId),
    nossoNumero: idLimpo(movimento?.nossoNumero || extra.nossoNumero),
    cobrancaId: idLimpo(movimento?.cobrancaId || extra.cobrancaId),
    fitid: idLimpo(movimento?.fitid),
    pedido: idLimpo(movimento?.pedido || extra.pedido),
    numdoc: idLimpo(movimento?.numdoc),
  };
}

function idsDoTitulo(titulo) {
  return {
    endToEndId: idLimpo(titulo?.endToEndId),
    nossoNumero: idLimpo(titulo?.nossoNumero),
    cobrancaId: idLimpo(titulo?.cobrancaId),
    pedido: idLimpo(titulo?.pedido),
    nrdoc: idLimpo(titulo?.nrdoc),
    nrdoc2: idLimpo(titulo?.nrdoc2),
  };
}

export function impressaoDigital(movimento) {
  const ids = identificadoresDoMovimento(movimento);
  const conta = chaveConta(movimento);
  const empresa = empresaDe(movimento) || 0;
  if (ids.endToEndId) return `${empresa}|e2e|${ids.endToEndId}`;
  if (ids.fitid) return `${empresa}|${conta}|fitid|${ids.fitid}`;
  const historico = normalizarTexto(movimento?.historico);
  if (historico.length < 8) return null;
  return `${empresa}|${conta}|${dia(movimento?.data) || ""}|${arredondar(movimento?.valor).toFixed(2)}|${historico}`;
}

export function detectarDuplicados(movimentos) {
  const grupos = new Map();
  for (const movimento of movimentos || []) {
    if (movimento?.conciliado) continue;
    const chave = impressaoDigital(movimento);
    if (!chave) continue;
    const grupo = grupos.get(chave) || [];
    grupo.push(movimento);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()]
    .filter((grupo) => grupo.length > 1)
    .map((grupo) => ({
      chave: impressaoDigital(grupo[0]),
      ids: grupo.map((item) => item.id),
      valor: arredondar(grupo[0].valor),
      empresa: empresaDe(grupo[0]),
    }));
}

export function selecionarIncrementais(movimentos, cursor = {}) {
  const ultimo = Number(cursor.ultimoId || 0);
  let maximo = ultimo;
  const novos = [];
  const pendentes = [];
  for (const movimento of movimentos || []) {
    const id = Number(movimento.id) || 0;
    if (id > maximo) maximo = id;
    if (movimento.conciliado) continue;
    if (id > ultimo) novos.push(movimento);
    else pendentes.push(movimento);
  }
  return {
    novos,
    pendentes,
    processar: [...novos, ...pendentes],
    proximoCursor: { ultimoId: maximo, em: new Date().toISOString() },
  };
}

export function separarJaImportados(itens, chavesExistentes = []) {
  const conhecidas = new Set((chavesExistentes || []).map((chave) => String(chave || "").trim()).filter(Boolean));
  const vistas = new Set();
  const novos = [];
  const duplicados = [];
  for (const item of itens || []) {
    const chave = String(item?.fitid || item?.numdoc || "").trim();
    if (chave && (conhecidas.has(chave) || vistas.has(chave))) duplicados.push(item);
    else {
      if (chave) vistas.add(chave);
      novos.push(item);
    }
  }
  return { novos, duplicados };
}

function fragmentoPagador(historico) {
  const trecho = String(historico || "").match(/\b(?:REM|DES)\s*:\s*(.+)/i)?.[1] || "";
  return normalizarTexto(trecho).replace(/\b\d{2}\s+\d{2}\b.*/, "").trim();
}

function umNomeNoHistorico(pessoa, historico) {
  const nome = normalizarTexto(pessoa);
  const texto = normalizarTexto(historico);
  if (!nome || !texto) return false;
  if (nome.length >= 8 && texto.includes(nome)) return true;
  const tokens = nome.split(" ").filter((token) => token.length >= 4 && !PARADAS.has(token));
  if (tokens.length >= 2 && tokens.every((token) => texto.includes(token))) return true;
  if (tokens.length === 1 && tokens[0].length >= 8 && texto.includes(tokens[0])) return true;
  const doBanco = fragmentoPagador(historico).split(" ").filter((token) => token.length >= 4 && !PARADAS.has(token));
  return doBanco.length >= 2 && doBanco.every((token) => nome.includes(token));
}

function pessoaNoHistorico(pessoa, historico) {
  const nomes = Array.isArray(pessoa) ? pessoa : [pessoa];
  return nomes.some((nome) => umNomeNoHistorico(nome, historico));
}

function cgcNoHistorico(titulo, movimento) {
  const digitos = String(titulo?.cgc || "").replace(/\D/g, "");
  if (digitos.length < 11) return false;
  const texto = `${movimento?.historico || ""} ${movimento?.numdoc || ""}`.replace(/\D/g, "");
  return texto.includes(digitos);
}

function historicoConflita(movimento, titulo) {
  const pagador = fragmentoPagador(movimento?.historico);
  const tokens = pagador.split(" ").filter((token) => token.length >= 4 && !PARADAS.has(token));
  const nomes = titulo?.nomes?.length ? titulo.nomes : titulo?.pessoa;
  if (tokens.length >= 2 && !pessoaNoHistorico(nomes, movimento?.historico)) return true;
  const digitos = String(movimento?.historico || "").replace(/\D/g, "");
  const cgc = String(titulo?.cgc || "").replace(/\D/g, "");
  return (digitos.match(/\d{14}|\d{11}/g) || []).some((documento) => documento !== cgc);
}

function documentoNoHistorico(titulo, movimento) {
  const texto = normalizarTexto(`${movimento?.historico || ""} ${movimento?.numdoc || ""}`).replace(/\s/g, "");
  const ids = idsDoTitulo(titulo);
  return [ids.nrdoc, ids.nrdoc2, ids.pedido, ids.nossoNumero, ids.cobrancaId].some((id) => id && texto.includes(id.toLowerCase()));
}

function idsCompativeis(movimento, titulo, pares) {
  const origem = identificadoresDoMovimento(movimento);
  const destino = idsDoTitulo(titulo);
  return pares.some(([esquerda, direita]) => origem[esquerda] && destino[direita] && origem[esquerda] === destino[direita]);
}

function idForte(movimento, titulo) {
  return idsCompativeis(movimento, titulo, [
    ["endToEndId", "endToEndId"],
    ["nossoNumero", "nossoNumero"],
    ["cobrancaId", "cobrancaId"],
    ["fitid", "endToEndId"],
  ]);
}

function documentoConfiavel(valor) {
  const texto = String(valor || "");
  return /[A-Z]/.test(texto) || texto.length >= 12;
}

function idDocumento(movimento, titulo) {
  const pares = [
    ["pedido", "pedido"],
    ["pedido", "nrdoc"],
  ];
  const origem = identificadoresDoMovimento(movimento);
  if (documentoConfiavel(origem.numdoc)) pares.push(["numdoc", "nrdoc"], ["numdoc", "nrdoc2"]);
  if (documentoConfiavel(origem.fitid)) pares.push(["fitid", "nrdoc"]);
  return idsCompativeis(movimento, titulo, pares);
}

function valorExato(movimento, titulo) {
  return Math.abs(arredondar(Math.abs(movimento.valor) - Math.abs(titulo.valor))) <= 0.01;
}

function prioridadeDe(valor, risco) {
  const absoluto = Math.abs(Number(valor) || 0);
  if (risco === "alto" || absoluto >= 5000) return "alta";
  if (risco === "medio" || absoluto >= 500) return "media";
  return "baixa";
}

function decisaoBase(movimento, extra) {
  const risco = extra.risco || "baixo";
  const valor = arredondar(movimento?.valor || extra.valor || 0);
  return {
    movimentoId: movimento?.id ?? null,
    empresa: empresaDe(movimento) || extra.empresa || null,
    conta: contaDe(movimento),
    data: dia(movimento?.data),
    valor,
    historico: String(movimento?.historico || "").slice(0, 255),
    nivel: extra.nivel ?? null,
    acao: extra.acao,
    automatica: extra.automatica === true,
    ambigua: extra.ambigua === true,
    alteraValor: extra.alteraValor === true,
    titulos: extra.titulos || [],
    motivo: extra.motivo,
    evidencias: extra.evidencias || [],
    evidenciaSuficiente: extra.evidenciaSuficiente === true,
    aprovavelEmLote: extra.aprovavelEmLote === true && extra.ambigua !== true && extra.alteraValor !== true,
    impacto: Math.abs(valor),
    risco,
    prioridade: prioridadeDe(valor, risco),
    cor: extra.cor || (extra.automatica ? "auto" : "analise"),
    hipotese: extra.hipotese || null,
    natureza: extra.natureza || classificarMovimento(movimento || {}).natureza,
    espelhoId: extra.espelhoId || null,
    fornecedor: extra.fornecedor || null,
    cdconta: extra.cdconta || null,
    taxa: extra.taxa ?? null,
  };
}

function evidencia(id, descricao) {
  return { id, descricao: String(descricao || "").slice(0, 240) };
}

export function reconhecerTransferencias(movimentos, contasProprias = []) {
  const proprias = new Set((contasProprias || []).map((conta) => `${conta.banco}|${conta.agencia || ""}|${conta.conta}`));
  const abertos = (movimentos || []).filter((movimento) => !movimento.conciliado && direcaoValor(movimento.valor) !== "zero");
  const usados = new Set();
  const pares = [];
  for (const origem of abertos) {
    if (usados.has(origem.id)) continue;
    const classe = classificarMovimento(origem);
    if (!/transf|ted|entre contas/.test(normalizarTexto(origem.historico))) continue;
    if (!["transferencia", "pix", "outros"].includes(classe.natureza)) continue;
    const contaOrigem = chaveConta(origem);
    if (!proprias.size || !proprias.has(contaOrigem)) continue;
    const contrapartes = abertos.filter((destino) => {
      if (destino.id === origem.id || usados.has(destino.id)) return false;
      if (!mesmaEmpresa(origem, destino)) return false;
      if (chaveConta(destino) === contaOrigem) return false;
      if (proprias.size && !proprias.has(chaveConta(destino))) return false;
      if (Math.abs(arredondar(origem.valor) + arredondar(destino.valor)) > 0.01) return false;
      return distanciaDias(origem.data, destino.data) <= 1;
    });
    if (contrapartes.length !== 1) continue;
    usados.add(origem.id);
    usados.add(contrapartes[0].id);
    pares.push({
      ids: [origem.id, contrapartes[0].id],
      empresa: empresaDe(origem),
      valor: arredondar(origem.valor),
      automatica: true,
    });
  }
  return pares;
}

function referencias(movimento) {
  const texto = `${movimento?.historico || ""} ${movimento?.numdoc || ""}`;
  const encontrados = new Set();
  for (const match of texto.matchAll(/\b[A-Za-z0-9-]{5,30}\b/g)) encontrados.add(idLimpo(match[0]));
  const extra = identificadoresDoMovimento(movimento);
  for (const valor of Object.values(extra)) if (valor) encontrados.add(valor);
  return [...encontrados].filter(Boolean);
}

function tentarGrupo(movimento, titulos) {
  const refs = new Set(referencias(movimento));
  if (movimento?.lote) {
    const lote = String(movimento.lote);
    const doLote = titulos.filter((titulo) => String(titulo.lote || "") === lote);
    if (doLote.length >= 2 && Math.abs(arredondar(doLote.reduce((soma, titulo) => soma + Math.abs(titulo.valor), 0)) - Math.abs(movimento.valor)) <= 0.01) {
      return doLote;
    }
  }
  const escolhidos = [];
  for (const ref of refs) {
    const achados = titulos.filter((titulo) => [idsDoTitulo(titulo).pedido, idsDoTitulo(titulo).nrdoc, idsDoTitulo(titulo).nrdoc2].includes(ref));
    if (achados.length !== 1) continue;
    if (!escolhidos.some((titulo) => chaveTitulo(titulo) === chaveTitulo(achados[0]))) escolhidos.push(achados[0]);
  }
  if (escolhidos.length < 2) return null;
  const soma = arredondar(escolhidos.reduce((total, titulo) => total + Math.abs(titulo.valor), 0));
  return Math.abs(soma - Math.abs(movimento.valor)) <= 0.01 ? escolhidos : null;
}

export function conciliarCartao({ bruto, taxa, credito, contrato, valorTitulo }) {
  const liquido = arredondar(Math.abs(bruto) - Math.abs(taxa));
  const creditado = arredondar(Math.abs(credito));
  if (bruto == null || taxa == null) return { acao: "excecao", motivo: "sem_demonstrativo", automatica: false };
  if (Math.abs(liquido - creditado) > 0.01) return { acao: "excecao", motivo: "liquido_divergente", automatica: false, liquido };
  if (!contrato?.autorizado || !contrato?.demonstrativo || !contrato?.contaTaxa) {
    return { acao: "excecao", motivo: "cartao_sem_contrato", automatica: false, liquido, taxa: arredondar(Math.abs(taxa)) };
  }
  const taxaAutorizada = arredondar(Math.abs(taxa));
  const brutoTitulo = arredondar(Math.abs(valorTitulo));
  if (Math.abs(brutoTitulo - creditado) <= 0.01) {
    return {
      acao: "conciliar",
      automatica: true,
      motivo: "cartao_liquido_autorizado",
      liquido,
      taxa: taxaAutorizada,
      contaTaxa: contrato.contaTaxa,
    };
  }
  if (Math.abs(brutoTitulo - Math.abs(bruto)) <= 0.01 && Math.abs(arredondar(brutoTitulo - taxaAutorizada) - creditado) <= 0.01) {
    return {
      acao: "cartao",
      automatica: true,
      motivo: "cartao_bruto_com_taxa_autorizada",
      liquido,
      taxa: taxaAutorizada,
      contaTaxa: contrato.contaTaxa,
    };
  }
  return { acao: "excecao", motivo: "titulo_difere_do_liquido", automatica: false, alteraValor: true, liquido };
}

export function conciliarRepasse(repasse, pedidos) {
  const grupo = (pedidos || []).filter((pedido) => mesmaEmpresa(repasse, pedido) && (!repasse.lote || String(pedido.lote) === String(repasse.lote)));
  const soma = arredondar(grupo.reduce((total, pedido) => total + Math.abs(pedido.liquido ?? pedido.valor), 0));
  if (grupo.length < 2 || Math.abs(soma - Math.abs(repasse.valor)) > 0.01) {
    return { acao: "excecao", motivo: "repasse_sem_correspondencia_unica", automatica: false };
  }
  return {
    acao: "conciliar_agrupado",
    automatica: true,
    motivo: "repasse_comprovado",
    pedidos: grupo,
    comissao: arredondar(grupo.reduce((total, pedido) => total + Math.abs(pedido.comissao || 0), 0)),
    frete: arredondar(grupo.reduce((total, pedido) => total + Math.abs(pedido.frete || 0), 0)),
    taxas: arredondar(grupo.reduce((total, pedido) => total + Math.abs(pedido.taxas || 0), 0)),
  };
}

export function tarifaForaDoPadrao(valor, historico) {
  const amostra = (historico || []).map((item) => Math.abs(Number(item) || 0)).filter((item) => item > 0).sort((a, b) => a - b);
  if (amostra.length < 3) return { alerta: false, motivo: "amostra_insuficiente", mediana: null };
  const mediana = amostra[Math.floor(amostra.length / 2)];
  const atual = Math.abs(Number(valor) || 0);
  const alerta = atual > mediana * 1.5 && atual - mediana >= 1;
  return { alerta, mediana: arredondar(mediana), motivo: alerta ? "tarifa_acima_do_padrao" : "dentro_do_padrao" };
}

function regraTarifa(movimento, configuracao) {
  const historico = normalizarTexto(movimento.historico);
  return (configuracao.autorizacoes?.tarifas || []).find((regra) => {
    const padrao = normalizarTexto(regra?.padrao);
    return padrao && historico.includes(padrao) && regra.cdfornecedor && regra.cdconta;
  }) || null;
}

export function montarFatos(movimento, titulos, extras = {}) {
  const evidencias = [];
  const classe = classificarMovimento(movimento);
  if (classe.endToEndId) evidencias.push(evidencia("e2e", classe.endToEndId));
  if (classe.nossoNumero) evidencias.push(evidencia("nosso-numero", classe.nossoNumero));
  if (classe.pedido) evidencias.push(evidencia("pedido", classe.pedido));
  const retencoes = (titulos || []).filter((titulo) => titulo.retencao != null && Math.abs(Number(titulo.retencao)) > 0);
  for (const titulo of retencoes) evidencias.push(evidencia(`retencao-${titulo.controle}`, `Retenção cadastrada de ${arredondar(titulo.retencao)}`));
  if (extras.contratoTarifa) evidencias.push(evidencia("contrato-tarifa", "Contrato de tarifa autorizado"));
  if (extras.descontoDocumentado) evidencias.push(evidencia("desconto-documentado", `Desconto documentado de ${arredondar(extras.descontoDocumentado)}`));
  if (extras.espelhoId) evidencias.push(evidencia("espelho", `Espelho ${extras.espelhoId}`));
  const soma = arredondar((titulos || []).reduce((total, titulo) => total + Math.abs(titulo.valor), 0));
  const referencia = titulos?.length === 1 ? Math.abs(titulos[0].valor) : soma;
  return {
    movimento: { id: movimento.id, valor: arredondar(movimento.valor), data: dia(movimento.data), historico: movimento.historico },
    titulos: (titulos || []).map((titulo) => ({ controle: titulo.controle, tipo: titulo.tipo, valor: arredondar(titulo.valor), pessoa: titulo.pessoa || null })),
    evidencias,
    diferenca: arredondar(Math.abs(movimento.valor) - referencia),
    soma,
    valor: Math.abs(arredondar(movimento.valor)),
    retencao: retencoes.length === 1 ? arredondar(Math.abs(retencoes[0].retencao)) : null,
    descontoDocumentado: extras.descontoDocumentado ? arredondar(extras.descontoDocumentado) : null,
    contratoTarifa: Boolean(extras.contratoTarifa),
    espelho: Boolean(extras.espelhoId),
    natureza: classe.natureza,
  };
}

export function hipoteseDeterministica(fatos) {
  const evidencias = (fatos?.evidencias || []).map((item) => item.id);
  if (fatos?.retencao != null && Math.abs(Math.abs(fatos.diferenca) - Math.abs(fatos.retencao)) <= 0.01) {
    return { aceita: true, causa: "retencao", evidencias, automatica: false, alterarValor: true, narracao: "A diferença coincide com a retenção já cadastrada no título. A baixa automática não altera o valor." };
  }
  if (fatos?.descontoDocumentado && Math.abs(Math.abs(fatos.diferenca) - fatos.descontoDocumentado) <= 0.01) {
    return { aceita: true, causa: "desconto_concedido", evidencias, automatica: false, alterarValor: true, narracao: "Há desconto documentado no mesmo valor da diferença. A gravação depende de aprovação humana." };
  }
  if (fatos?.contratoTarifa && fatos.natureza === "tarifa") {
    return { aceita: true, causa: "tarifa_financeira", evidencias, automatica: false, alterarValor: false, narracao: "O lançamento tem cara de tarifa e existe contrato autorizado." };
  }
  if ((fatos?.titulos || []).length >= 2 && Math.abs((fatos.soma || 0) - (fatos.valor || 0)) <= 0.01) {
    return { aceita: true, causa: "pagamento_agrupado", evidencias, automatica: false, alterarValor: false, narracao: "A soma dos títulos relacionados fecha com o valor do extrato." };
  }
  if ((fatos?.titulos || []).length === 1 && fatos.valor > 0 && fatos.valor + 0.009 < Math.abs(fatos.titulos[0].valor)) {
    return { aceita: true, causa: "pagamento_parcial", evidencias, automatica: false, alterarValor: true, narracao: "O crédito é menor que o título e não há desconto, retenção ou tarifa documentados para a diferença." };
  }
  if ((fatos?.titulos || []).length === 1 && Math.abs(fatos.diferenca) > 0.01) {
    return { aceita: true, causa: "divergencia_valor", evidencias, automatica: false, alterarValor: true, narracao: "O identificador encontra um título, mas o valor não fecha. Nenhuma justificativa documentada foi encontrada." };
  }
  if ((fatos?.titulos || []).length > 1) {
    return { aceita: true, causa: "divergencia_valor", evidencias, automatica: false, alterarValor: false, narracao: "Há mais de um título possível. A escolha fica com o usuário." };
  }
  return { aceita: true, causa: "sem_evidencia", evidencias, automatica: false, alterarValor: false, narracao: "Não há evidência suficiente para indicar uma causa ou um título." };
}

function interpretarJson(texto) {
  if (!texto) return null;
  const limpo = String(texto).trim().replace(/^```json\s*/i, "").replace(/```$/i, "");
  try {
    const valor = JSON.parse(limpo);
    return valor && typeof valor === "object" ? valor : null;
  } catch {
    return null;
  }
}

export function aceitarHipoteseCharlie(resposta, fatos) {
  const parsed = typeof resposta === "string" ? interpretarJson(resposta) : resposta;
  if (!parsed || typeof parsed !== "object") return { aceita: false, motivo: "resposta_invalida" };
  if (parsed.executar || parsed.alterarValor) return { aceita: false, motivo: "ia_nao_executa" };
  if (!CAUSAS.includes(parsed.causa)) return { aceita: false, motivo: "causa_nao_permitida" };
  const conhecidas = new Set((fatos?.evidencias || []).map((item) => item.id));
  const citadas = Array.isArray(parsed.evidencias) ? parsed.evidencias.map((item) => String(item)) : [];
  if (citadas.some((id) => !conhecidas.has(id))) return { aceita: false, motivo: "evidencia_inventada" };
  if (parsed.causa === "desconto_concedido" && !(fatos?.descontoDocumentado > 0)) return { aceita: false, motivo: "desconto_sem_documento" };
  if (parsed.causa === "tarifa_financeira" && !fatos?.contratoTarifa) return { aceita: false, motivo: "tarifa_sem_contrato" };
  if (parsed.causa === "retencao" && fatos?.retencao == null) return { aceita: false, motivo: "retencao_sem_cadastro" };
  if (parsed.causa === "pagamento_agrupado" && Math.abs((fatos?.soma || 0) - (fatos?.valor || 0)) > 0.01) return { aceita: false, motivo: "agrupamento_sem_soma" };
  if (parsed.causa === "transferencia_interna" && !fatos?.espelho) return { aceita: false, motivo: "transferencia_sem_espelho" };
  if (parsed.causa === "pagamento_parcial" && !((fatos?.titulos || []).length === 1 && fatos.valor + 0.009 < Math.abs(fatos.titulos[0].valor))) {
    return { aceita: false, motivo: "parcial_sem_titulo" };
  }
  return {
    aceita: true,
    causa: parsed.causa,
    evidencias: citadas,
    automatica: false,
    executar: false,
    alterarValor: false,
    narracao: String(parsed.narracao || "").slice(0, 500),
  };
}

export async function investigar(fatos, narrar) {
  const base = hipoteseDeterministica(fatos);
  if (!narrar) return { ...base, origem: "regras" };
  let texto = null;
  try {
    texto = await narrar(fatos);
  } catch {
    texto = null;
  }
  const aceite = aceitarHipoteseCharlie(texto, fatos);
  if (!aceite.aceita) return { ...base, origem: "regras", recusaCharlie: aceite.motivo };
  return { ...base, ...aceite, origem: "charlie", automatica: false, executar: false, alterarValor: base.alterarValor === true };
}

export function registrarAprendizado(padroes, decisao, agora = new Date().toISOString()) {
  const historico = normalizarTexto(decisao?.historico);
  const pessoa = normalizarTexto(decisao?.pessoa);
  if (!historico || !pessoa || !empresaDe(decisao)) return padroes || [];
  const chave = `${empresaDe(decisao)}|${historico}|${pessoa}|${decisao.tipo || ""}`;
  const lista = [...(padroes || [])];
  const atual = lista.find((item) => item.chave === chave) || {
    chave,
    empresa: empresaDe(decisao),
    historico,
    pessoa,
    tipo: decisao.tipo || null,
    acertos: 0,
    erros: 0,
  };
  if (decisao.erro) atual.erros += 1;
  else atual.acertos += 1;
  atual.autorizaSozinho = false;
  atual.atualizadoEm = agora;
  const restante = lista.filter((item) => item.chave !== chave);
  restante.push(atual);
  return restante.slice(-1000);
}

export function sugerirPorAprendizado(padroes, movimento, titulos) {
  const historico = normalizarTexto(movimento?.historico);
  const empresa = empresaDe(movimento);
  const compativeis = (padroes || []).filter((padrao) => padrao.empresa === empresa && padrao.historico === historico && padrao.acertos > 0 && padrao.erros === 0 && padrao.autorizaSozinho !== true);
  const titulosAchados = [];
  for (const padrao of compativeis) {
    for (const titulo of titulos || []) {
      if (normalizarTexto(titulo.pessoa) === padrao.pessoa && valorExato(movimento, titulo)) titulosAchados.push(titulo);
    }
  }
  const unicos = [...new Map(titulosAchados.map((titulo) => [chaveTitulo(titulo), titulo])).values()];
  return unicos.length === 1 ? unicos[0] : null;
}

export function calcularMetricas(decisoes, { minutosPorManual = 3, incorretas = 0, aplicadas = 0 } = {}) {
  const lista = decisoes || [];
  const elegiveis = lista.filter((item) => item.evidenciaSuficiente);
  const automaticas = elegiveis.filter((item) => item.automatica);
  const divergencias = lista.filter((item) => item.cor === "divergencia");
  const percentual = elegiveis.length ? arredondar((automaticas.length / elegiveis.length) * 100) : null;
  const contas = new Map();
  for (const item of lista) {
    const chave = `${item.conta?.banco || ""}/${item.conta?.conta || ""}`;
    const atual = contas.get(chave) || { conta: chave, total: 0, automaticas: 0 };
    atual.total += 1;
    if (item.automatica) atual.automaticas += 1;
    contas.set(chave, atual);
  }
  return {
    total: lista.length,
    elegiveis: elegiveis.length,
    automaticas: automaticas.length,
    percentualElegiveis: percentual,
    percentualGeral: lista.length ? arredondar((automaticas.length / lista.length) * 100) : null,
    meta: 95,
    metaAtingida: percentual != null && percentual >= 95,
    manuaisEvitadas: automaticas.length,
    tempoEconomizadoMinutos: automaticas.length * minutosPorManual,
    tempoEconomizadoEstimado: true,
    incorretas,
    aplicadas,
    taxaIncorretas: aplicadas ? arredondar((incorretas / aplicadas) * 100) : 0,
    divergencias: divergencias.length,
    valorDivergencias: arredondar(divergencias.reduce((total, item) => total + Math.abs(item.valor || 0), 0)),
    aguardando: lista.filter((item) => item.cor === "analise").length,
    valorPendente: arredondar(lista.filter((item) => !item.automatica).reduce((total, item) => total + Math.abs(item.valor || 0), 0)),
    porConta: [...contas.values()],
  };
}

export function podeExecutarAutomaticamente(decisao) {
  if (!decisao || decisao.automatica !== true || decisao.alteraValor || decisao.ambigua || decisao.acao === "excecao") return false;
  if (!empresaDe(decisao)) return false;
  const empresas = new Set((decisao.titulos || []).map((titulo) => empresaDe(titulo)).filter(Boolean));
  if ([...empresas].some((empresa) => empresa !== empresaDe(decisao))) return false;
  if (decisao.acao === "cartao") {
    if (decisao.titulos?.length !== 1 || !(Number(decisao.taxa) > 0) || !decisao.cdconta) return false;
    const bruto = Math.abs(decisao.titulos[0].valor);
    return Math.abs(arredondar(bruto - Number(decisao.taxa)) - Math.abs(decisao.valor)) <= 0.01;
  }
  if (decisao.acao === "conciliar" || decisao.acao === "conciliar_agrupado") {
    if (!decisao.titulos?.length) return false;
    const soma = arredondar(decisao.titulos.reduce((total, titulo) => total + Math.abs(titulo.valor), 0));
    if (Math.abs(soma - Math.abs(decisao.valor)) > 0.01) return false;
  }
  if (decisao.acao === "tarifa" && (!decisao.fornecedor || !decisao.cdconta)) return false;
  if (decisao.acao === "transferencia" && !decisao.espelhoId) return false;
  return true;
}

export function podeAprovarEscolha(decisao, escolha, ator) {
  if (!ator?.idusuario || !escolha?.confirmado) return { ok: false, motivo: "confirmacao_ausente" };
  const perfis = (escolha?.perfis || CONFIGURACAO_PADRAO.perfisAprovacao).map((perfil) => String(perfil).toLowerCase());
  if (ator.perfil && !perfis.includes(String(ator.perfil).toLowerCase())) return { ok: false, motivo: "perfil_sem_permissao" };
  if (!decisao || decisao.alteraValor) return { ok: false, motivo: "altera_valor" };
  const titulo = (decisao.titulos || []).find((item) => Number(item.controle) === Number(escolha.controle) && item.tipo === escolha.tipo && mesmaEmpresa(decisao, item));
  if (!titulo) return { ok: false, motivo: "titulo_fora_das_opcoes" };
  if (Math.abs(Math.abs(titulo.valor) - Math.abs(decisao.valor)) > 0.01) return { ok: false, motivo: "valor_diferente" };
  return { ok: true, titulo };
}

export function loteSeguro(decisoes) {
  return (decisoes || []).length > 0 && decisoes.every((item) => item.aprovavelEmLote && !item.ambigua && !item.alteraValor && !item.automatica && valorExato(item, { valor: (item.titulos || []).reduce((total, titulo) => total + Math.abs(titulo.valor), 0) }));
}

export function chaveIdempotencia(decisao) {
  const titulos = (decisao?.titulos || []).map((titulo) => `${titulo.tipo}:${empresaDe(titulo)}:${titulo.controle}`).sort().join(",");
  return `${empresaDe(decisao) || 0}|${decisao?.movimentoId}|${decisao?.acao}|${titulos}|v1`;
}

export function desfazerPermitido(registro, pedido) {
  if (!registro || registro.desfeito) return { ok: false, motivo: "ja_desfeito_ou_inexistente" };
  if (!pedido?.confirmado) return { ok: false, motivo: "confirmacao_ausente" };
  if (!pedido?.idusuario) return { ok: false, motivo: "usuario_ausente" };
  if (!["servico-conciliacao", "aprovacao-humana"].includes(registro.origem)) return { ok: false, motivo: "origem_nao_auditada" };
  if (pedido.empresa && Number(registro.empresa) !== Number(pedido.empresa)) return { ok: false, motivo: "empresa_diferente" };
  if (!registro.movimentos?.length || !registro.movimentoId) return { ok: false, motivo: "sem_rastreio" };
  return { ok: true };
}

export function descreverFontes(contas = []) {
  const autorizadas = (contas || []).filter((conta) => conta.extratoAutorizado && conta.consentimento);
  return {
    arquivos: ["OFX", "CSV", "CNAB240"],
    contas: (contas || []).map((conta) => ({
      banco: conta.banco,
      conta: conta.conta,
      extratoAutomatico: Boolean(conta.extratoAutorizado && conta.consentimento),
      openFinance: conta.openFinanceConsentido ? "autorizado" : "aguardando_consentimento",
    })),
    dependeDeArquivo: autorizadas.length === 0,
    aviso: autorizadas.length
      ? "A sincronização usa a integração de extrato com consentimento."
      : "Não há consentimento de Open Finance nem API de extrato autorizada. OFX, CSV e CNAB seguem disponíveis, e a rotina concilia o que já entrou no ERP.",
  };
}

export function notificacoesDoCiclo(metricas, decisoes, configuracao = CONFIGURACAO_PADRAO) {
  const permitidas = new Set(configuracao.notificacoes?.prioridades || ["alta", "normal"]);
  const mensagens = [];
  if (metricas?.elegiveis) {
    mensagens.push({
      prioridade: "normal",
      texto: `Conciliação bancária concluída. Foram conciliadas automaticamente ${metricas.automaticas} de ${metricas.elegiveis} movimentações elegíveis. ${metricas.aguardando + metricas.divergencias} precisam de análise.`,
    });
  }
  for (const item of (decisoes || []).filter((decisao) => decisao.motivo === "duplicado")) {
    mensagens.push({ prioridade: "alta", texto: `Foi identificado um possível lançamento duplicado de ${moeda(item.valor)}.` });
  }
  const recebimentos = (decisoes || []).filter((item) => item.motivo === "sem_origem" && item.valor > 0);
  const valor = arredondar(recebimentos.reduce((total, item) => total + item.valor, 0));
  if (valor > 0) mensagens.push({ prioridade: "normal", texto: `Existem ${moeda(valor)} em recebimentos ainda não identificados.` });
  return mensagens.filter((mensagem) => permitidas.has(mensagem.prioridade));
}

function moeda(valor) {
  return arredondar(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function montarPreFechamento({ data, movimentos = [], analise, saldos = [], diasEsperados = [] }) {
  const dias = [...new Set((movimentos || []).map((item) => dia(item.data)).filter(Boolean))].sort();
  const ausentes = (diasEsperados || []).filter((diaEsperado) => !dias.includes(diaEsperado));
  const saldosConferidos = (saldos || []).map((saldo) => {
    const soma = arredondar(saldo.soma ?? (movimentos || []).filter((item) => chaveConta(item) === `${saldo.banco}|${saldo.agencia || ""}|${saldo.conta}`).reduce((total, item) => total + Number(item.valor || 0), 0));
    const confere = saldo.saldoInicial == null || saldo.saldoFinal == null || Math.abs(arredondar(saldo.saldoInicial + soma) - arredondar(saldo.saldoFinal)) <= 0.01;
    return { ...saldo, soma, confere };
  });
  const divergencias = (analise?.decisoes || []).filter((item) => !item.automatica);
  const resumo = [
    `Pré-fechamento de ${data}.`,
    `${(analise?.metricas?.automaticas) || 0} conciliações seguras e ${divergencias.length} pendências.`,
    ausentes.length ? `Dias sem movimentação importada: ${ausentes.join(", ")}.` : "Não há dia esperado sem movimentação importada.",
    saldosConferidos.every((saldo) => saldo.confere) ? "Os saldos informados fecham com a soma dos lançamentos." : "Há saldo que não fecha com a soma dos lançamentos.",
  ].join(" ");
  return {
    data,
    fechamentoDefinitivo: false,
    resumo,
    divergencias: divergencias.length,
    saldoConfere: saldosConferidos.every((saldo) => saldo.confere),
    saldos: saldosConferidos,
    diasAusentes: ausentes,
    divergenciasAltas: divergencias.filter((item) => item.risco === "alto").length,
    metricas: analise?.metricas || null,
  };
}

export function podeFecharDefinitivo(fechamento, ator, perfis = CONFIGURACAO_PADRAO.perfisAprovacao) {
  if (!ator?.idusuario || ator.confirmado !== true) return { ok: false, motivo: "confirmacao_ausente" };
  const permitidos = (perfis || []).map((perfil) => String(perfil).toLowerCase());
  if (ator.perfil && !permitidos.includes(String(ator.perfil).toLowerCase())) return { ok: false, motivo: "perfil_sem_permissao" };
  if (Number(fechamento?.divergenciasAltas || 0) > 0) return { ok: false, motivo: "divergencia_alta" };
  if (fechamento?.saldoConfere === false) return { ok: false, motivo: "saldo_nao_confere" };
  return { ok: true };
}

export function proximaFila(ids, cursor = 0, limite = 250) {
  const ordenados = [...new Set((ids || []).map((id) => Number(id)).filter((id) => id > 0))].sort((a, b) => a - b);
  const quantidade = Math.max(1, Number(limite) || 250);
  const seguintes = ordenados.filter((id) => id > Number(cursor || 0)).slice(0, quantidade);
  const voltou = seguintes.length < quantidade;
  const escolhidos = voltou ? [...seguintes, ...ordenados.slice(0, quantidade - seguintes.length)] : seguintes;
  const unicos = [...new Set(escolhidos)];
  return { ids: unicos, proximo: voltou || !unicos.length ? 0 : unicos[unicos.length - 1] };
}

export function interpretarLancamentosApi(payload) {
  const lista = Array.isArray(payload) ? payload : payload?.lancamentos || payload?.transactions || [];
  const itens = [];
  for (const item of lista) {
    const data = dia(item?.data || item?.date || item?.dtLancamento);
    const valor = arredondar(item?.valor ?? item?.amount);
    if (!data || !valor) continue;
    const historico = String(item?.historico || item?.descricao || item?.description || "Lancamento de extrato").slice(0, 255);
    const documento = String(item?.fitid || item?.endToEndId || item?.id || item?.documento || "").slice(0, 40);
    itens.push({ data, valor, historico, fitid: documento, numdoc: documento });
  }
  return itens;
}

export function aceitarResumo(texto, fatos) {
  if (!texto) return null;
  const numeros = String(texto).match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2}/g) || [];
  const permitidos = new Set((fatos?.valores || []).map((valor) => arredondar(valor)));
  for (const numero of numeros) {
    const normal = Number(numero.includes(",") ? numero.replace(/\./g, "").replace(",", ".") : numero);
    if (![...permitidos].some((valor) => Math.abs(valor - normal) <= 0.001)) return null;
  }
  return String(texto).slice(0, 800);
}

function candidatosDe(movimento, titulos, usados) {
  const direcao = direcaoValor(movimento.valor);
  return (titulos || []).filter((titulo) => !titulo.conciliado && !usados.has(chaveTitulo(titulo)) && titulo.tipo === direcao && mesmaEmpresa(movimento, titulo));
}

function tituloResumo(titulo) {
  return {
    tipo: titulo.tipo,
    controle: Number(titulo.controle),
    idempresa: empresaDe(titulo),
    valor: arredondar(titulo.valor),
    pessoa: titulo.pessoa || "",
    nrdoc: titulo.nrdoc || "",
    dtvenc: dia(titulo.dtvenc),
  };
}

export function analisarLote({ movimentos = [], titulos = [], contasProprias = [], padroes = [], configuracao = {}, baixadosSemBanco = [], tarifasHistoricas = [] } = {}) {
  const cfg = { ...CONFIGURACAO_PADRAO, ...configuracao, autorizacoes: { ...CONFIGURACAO_PADRAO.autorizacoes, ...(configuracao.autorizacoes || {}) } };
  const abertos = (movimentos || []).filter((movimento) => !movimento.conciliado);
  const processados = selecionarIncrementais(abertos, {});
  const duplicados = detectarDuplicados(processados.processar);
  const idsDuplicados = new Set(duplicados.flatMap((grupo) => grupo.ids));
  const transferencias = reconhecerTransferencias(processados.processar.filter((movimento) => !idsDuplicados.has(movimento.id)), contasProprias);
  const idsTransferencia = new Map(transferencias.flatMap((par) => par.ids.map((id) => [id, par])));
  const usados = new Set();
  const decisoes = [];
  const proativas = [];

  const registrar = (movimento, extra) => {
    const item = decisaoBase(movimento, extra);
    decisoes.push(item);
    return item;
  };

  for (const movimento of processados.processar) {
    if (direcaoValor(movimento.valor) === "zero") {
      registrar(movimento, { acao: "ignorar", motivo: "valor_zero", cor: "analise" });
      continue;
    }
    if (!empresaDe(movimento)) {
      registrar(movimento, { acao: "excecao", motivo: "empresa_nao_identificada", risco: "alto", cor: "divergencia" });
      continue;
    }
    if (idsDuplicados.has(movimento.id)) {
      registrar(movimento, { acao: "excecao", motivo: "duplicado", risco: "alto", cor: "divergencia", natureza: classificarMovimento(movimento).natureza });
      continue;
    }
    const par = idsTransferencia.get(movimento.id);
    if (par) {
      const espelho = par.ids.find((id) => id !== movimento.id);
      registrar(movimento, {
        acao: "transferencia",
        automatica: true,
        nivel: 1,
        motivo: "transferencia_entre_contas",
        evidenciaSuficiente: true,
        cor: "auto",
        espelhoId: espelho,
        evidencias: [evidencia("espelho", `Contrapartida ${espelho}`)],
        natureza: "transferencia",
      });
    }
  }

  const restantes = processados.processar.filter((movimento) => !decisoes.some((item) => item.movimentoId === movimento.id));
  const nivelUm = [];
  for (const movimento of restantes) {
    const classe = classificarMovimento(movimento);
    if (classe.devolucao) {
      registrar(movimento, {
        acao: "excecao",
        motivo: "estorno_ou_devolucao",
        risco: "alto",
        cor: "divergencia",
        natureza: classe.natureza,
        hipotese: { causa: "sem_evidencia", narracao: "Devolução ou estorno não gera baixa automática.", origem: "regras", aceita: true },
      });
      continue;
    }
    if (classe.natureza === "tarifa") {
      const comparacao = tarifaForaDoPadrao(movimento.valor, tarifasHistoricas);
      const regra = regraTarifa(movimento, cfg);
      const automatica = Boolean(regra && !comparacao.alerta && (!regra.valorMaximo || Math.abs(movimento.valor) <= Number(regra.valorMaximo)));
      if (comparacao.alerta) {
        proativas.push({ tipo: "tarifa_acima_do_padrao", movimentoId: movimento.id, valor: arredondar(movimento.valor), mediana: comparacao.mediana });
      }
      registrar(movimento, {
        acao: automatica ? "tarifa" : "excecao",
        automatica,
        nivel: automatica ? 2 : 3,
        motivo: comparacao.alerta ? "tarifa_acima_do_padrao" : automatica ? "tarifa_autorizada" : "tarifa_sem_autorizacao",
        evidenciaSuficiente: automatica,
        cor: automatica ? "auto" : comparacao.alerta ? "divergencia" : "analise",
        risco: comparacao.alerta ? "alto" : "baixo",
        fornecedor: automatica ? Number(regra.cdfornecedor) : null,
        cdconta: automatica ? Number(regra.cdconta) : null,
        natureza: "tarifa",
        evidencias: [evidencia("historico", movimento.historico || "Tarifa")],
      });
      continue;
    }
    const candidatos = candidatosDe(movimento, titulos, usados);
    const fortes = candidatos.filter((titulo) => idForte(movimento, titulo));
    const oficiais = fortes.length ? fortes : candidatos.filter((titulo) => idDocumento(movimento, titulo) && valorExato(movimento, titulo));
    if (oficiais.length === 1 && valorExato(movimento, oficiais[0])) {
      const cartao = classe.natureza === "cartao" ? conciliarCartao({
        bruto: oficiais[0].bruto,
        taxa: oficiais[0].taxa,
        credito: movimento.valor,
        contrato: cfg.contratoCartao,
        valorTitulo: oficiais[0].valor,
      }) : null;
      if (cartao && !cartao.automatica && oficiais[0].bruto != null) {
        nivelUm.push({ movimento, oficiais, cartao, classe });
        continue;
      }
      usados.add(chaveTitulo(oficiais[0]));
      registrar(movimento, {
        acao: "conciliar",
        automatica: true,
        nivel: 1,
        motivo: cartao?.motivo || "identificador_unico",
        evidenciaSuficiente: true,
        cor: "auto",
        titulos: [tituloResumo(oficiais[0])],
        taxa: cartao?.taxa ?? null,
        cdconta: cartao?.contaTaxa || null,
        natureza: classe.natureza,
        evidencias: [evidencia("identificador", "Identificador oficial único e valor idêntico")],
      });
      if (dia(oficiais[0].dtvenc) && dia(oficiais[0].dtvenc) < dia(movimento.data)) {
        proativas.push({ tipo: "titulo_vencido_pago_no_extrato", movimentoId: movimento.id, controle: oficiais[0].controle });
      }
      continue;
    }
    if (oficiais.length === 1 || oficiais.length > 1) nivelUm.push({ movimento, oficiais, classe });
    else nivelUm.push({ movimento, oficiais: [], classe, candidatos });
  }

  for (const item of nivelUm) {
    if (decisoes.some((decisao) => decisao.movimentoId === item.movimento.id)) continue;
    const movimento = item.movimento;
    const oficiais = (item.oficiais || []).filter((titulo) => !usados.has(chaveTitulo(titulo)));
    if (oficiais.length === 1 && valorExato(movimento, oficiais[0]) && !item.cartao) {
      usados.add(chaveTitulo(oficiais[0]));
      registrar(movimento, {
        acao: "conciliar",
        automatica: true,
        nivel: 1,
        motivo: "identificador_unico",
        evidenciaSuficiente: true,
        cor: "auto",
        titulos: [tituloResumo(oficiais[0])],
        natureza: item.classe.natureza,
        evidencias: [evidencia("identificador", "Identificador oficial único e valor idêntico")],
      });
      continue;
    }
    if (oficiais.length === 1 && !valorExato(movimento, oficiais[0])) {
      if (item.classe.natureza === "cartao") {
        const cartao = conciliarCartao({
          bruto: oficiais[0].bruto ?? oficiais[0].valor,
          taxa: oficiais[0].taxa,
          credito: Math.abs(movimento.valor),
          contrato: cfg.contratoCartao,
          valorTitulo: oficiais[0].valor,
        });
        if (cartao.acao === "cartao" && cartao.automatica) {
          usados.add(chaveTitulo(oficiais[0]));
          registrar(movimento, {
            acao: "cartao",
            automatica: true,
            nivel: 1,
            motivo: cartao.motivo,
            evidenciaSuficiente: true,
            alteraValor: false,
            cor: "auto",
            titulos: [tituloResumo(oficiais[0])],
            taxa: cartao.taxa,
            cdconta: cartao.contaTaxa,
            natureza: "cartao",
            evidencias: [evidencia("cartao", "O crédito bancário é o líquido e a taxa autorizada explica o valor bruto do título.")],
          });
          continue;
        }
      }
      const fatos = montarFatos(movimento, oficiais);
      registrar(movimento, {
        acao: "excecao",
        nivel: 3,
        motivo: "valor_divergente",
        risco: "alto",
        cor: "divergencia",
        alteraValor: true,
        titulos: [tituloResumo(oficiais[0])],
        natureza: item.classe.natureza,
        evidencias: fatos.evidencias,
        hipotese: hipoteseDeterministica(fatos),
      });
      continue;
    }
    if (oficiais.length > 1) {
      proativas.push({ tipo: "varias_possibilidades", movimentoId: movimento.id, quantidade: oficiais.length });
      registrar(movimento, {
        acao: "excecao",
        nivel: 3,
        motivo: "identificador_ambiguo",
        ambigua: true,
        risco: "alto",
        cor: "divergencia",
        titulos: oficiais.slice(0, 5).map(tituloResumo),
        natureza: item.classe.natureza,
        hipotese: { causa: "divergencia_valor", narracao: "O identificador aparece em mais de um título. Confirme qual deles recebe o lançamento.", origem: "regras", aceita: true },
      });
      continue;
    }
    if (item.cartao && !item.cartao.automatica) {
      registrar(movimento, {
        acao: "excecao",
        nivel: 3,
        motivo: item.cartao.motivo,
        alteraValor: item.cartao.alteraValor === true,
        risco: "medio",
        cor: "analise",
        titulos: oficiais.slice(0, 1).map(tituloResumo),
        natureza: "cartao",
        taxa: item.cartao.taxa ?? null,
      });
      continue;
    }
    const candidatos = candidatosDe(movimento, item.candidatos || titulos, usados);
    const mesmoValor = candidatos.filter((titulo) => valorExato(movimento, titulo));
    const porValor = mesmoValor.filter((titulo) => distanciaDias(movimento.data, titulo.dtvenc) <= cfg.janelaDias);
    const nomesDo = (titulo) => (titulo.nomes?.length ? titulo.nomes : titulo.pessoa);
    const comprovados = mesmoValor.filter((titulo) => pessoaNoHistorico(nomesDo(titulo), movimento.historico) || documentoNoHistorico(titulo, movimento) || cgcNoHistorico(titulo, movimento));
    if (comprovados.length === 1) {
      usados.add(chaveTitulo(comprovados[0]));
      registrar(movimento, {
        acao: "conciliar",
        automatica: true,
        nivel: 2,
        motivo: "regra_unica",
        evidenciaSuficiente: true,
        cor: "auto",
        titulos: [tituloResumo(comprovados[0])],
        natureza: item.classe.natureza,
        evidencias: [evidencia("regra", "O valor e o cliente, documento ou CNPJ formam uma correspondência única")],
      });
      if (dia(comprovados[0].dtvenc) && dia(comprovados[0].dtvenc) < dia(movimento.data)) {
        proativas.push({ tipo: "titulo_vencido_pago_no_extrato", movimentoId: movimento.id, controle: comprovados[0].controle });
      }
      continue;
    }
    if (comprovados.length > 1) {
      proativas.push({ tipo: "varias_possibilidades", movimentoId: movimento.id, quantidade: comprovados.length });
      registrar(movimento, {
        acao: "excecao",
        nivel: 2,
        motivo: "regra_ambigua",
        ambigua: true,
        risco: "medio",
        cor: "divergencia",
        titulos: comprovados.slice(0, 5).map(tituloResumo),
        natureza: item.classe.natureza,
      });
      continue;
    }
    const grupo = tentarGrupo(movimento, candidatos);
    if (grupo) {
      for (const titulo of grupo) usados.add(chaveTitulo(titulo));
      const repasse = conciliarRepasse({ ...movimento, lote: movimento.lote }, grupo.map((titulo) => ({ ...titulo, liquido: titulo.valor })));
      registrar(movimento, {
        acao: "conciliar_agrupado",
        automatica: true,
        nivel: 2,
        motivo: repasse.motivo || "pagamento_agrupado",
        evidenciaSuficiente: true,
        cor: "auto",
        titulos: grupo.map(tituloResumo),
        natureza: item.classe.natureza === "outros" ? "marketplace" : item.classe.natureza,
        evidencias: [evidencia("grupo", `${grupo.length} títulos somam o valor do crédito`)],
      });
      proativas.push({ tipo: "recebimento_agrupado", movimentoId: movimento.id, quantidade: grupo.length });
      continue;
    }
    const aprendido = sugerirPorAprendizado(padroes, movimento, porValor.length ? porValor : candidatos.filter((titulo) => valorExato(movimento, titulo)));
    if (aprendido && !usados.has(chaveTitulo(aprendido))) {
      registrar(movimento, {
        acao: "excecao",
        nivel: 3,
        motivo: "padrao_aprendido",
        aprovavelEmLote: true,
        cor: "analise",
        titulos: [tituloResumo(aprendido)],
        natureza: item.classe.natureza,
        evidencias: [evidencia("aprendizado", "Associação feita antes por um usuário. Não autoriza baixa sozinha.")],
        hipotese: { causa: "sem_evidencia", narracao: "O histórico já foi associado a esta pessoa. A sugestão espera confirmação.", origem: "regras", aceita: true },
      });
      continue;
    }
    if (porValor.length === 1) {
      registrar(movimento, {
        acao: "excecao",
        nivel: 2,
        motivo: "unico_valor_data",
        aprovavelEmLote: !historicoConflita(movimento, porValor[0]),
        cor: "analise",
        titulos: [tituloResumo(porValor[0])],
        natureza: item.classe.natureza,
        evidencias: [evidencia("valor-data", "Único título com o mesmo valor dentro da janela. Falta cliente ou documento no histórico.")],
      });
      continue;
    }
    if (porValor.length > 1) {
      proativas.push({ tipo: "varias_possibilidades", movimentoId: movimento.id, quantidade: porValor.length });
      registrar(movimento, {
        acao: "excecao",
        nivel: 3,
        motivo: "varios_titulos",
        ambigua: true,
        risco: "medio",
        cor: "divergencia",
        titulos: porValor.slice(0, 5).map(tituloResumo),
        natureza: item.classe.natureza,
        hipotese: { causa: "divergencia_valor", narracao: "O valor aparece em mais de um título. Nenhuma opção foi escolhida.", origem: "regras", aceita: true },
      });
      continue;
    }
    const documentos = candidatos.filter((titulo) => idDocumento(movimento, titulo));
    if (documentos.length === 1 && item.classe.natureza === "cartao") {
      const cartao = conciliarCartao({
        bruto: documentos[0].bruto ?? documentos[0].valor,
        taxa: documentos[0].taxa,
        credito: Math.abs(movimento.valor),
        contrato: cfg.contratoCartao,
        valorTitulo: documentos[0].valor,
      });
      if (cartao.acao === "cartao" && cartao.automatica) {
        usados.add(chaveTitulo(documentos[0]));
        registrar(movimento, {
          acao: "cartao",
          automatica: true,
          nivel: 1,
          motivo: cartao.motivo,
          evidenciaSuficiente: true,
          alteraValor: false,
          cor: "auto",
          titulos: [tituloResumo(documentos[0])],
          taxa: cartao.taxa,
          cdconta: cartao.contaTaxa,
          natureza: "cartao",
          evidencias: [evidencia("cartao", "O crédito bancário é o líquido e a taxa autorizada explica o valor bruto do título.")],
        });
        continue;
      }
    }
    if (documentos.length === 1) {
      const fatos = montarFatos(movimento, documentos);
      registrar(movimento, {
        acao: "excecao",
        nivel: 3,
        motivo: "valor_divergente",
        risco: "alto",
        cor: "divergencia",
        alteraValor: true,
        titulos: [tituloResumo(documentos[0])],
        natureza: item.classe.natureza,
        evidencias: fatos.evidencias,
        hipotese: hipoteseDeterministica(fatos),
      });
      continue;
    }
    const fatos = montarFatos(movimento, []);
    registrar(movimento, {
      acao: "excecao",
      nivel: 3,
      motivo: "sem_origem",
      risco: "medio",
      cor: "analise",
      natureza: item.classe.natureza,
      evidencias: fatos.evidencias,
      hipotese: hipoteseDeterministica(fatos),
    });
  }

  for (const titulo of baixadosSemBanco || []) {
    if (!empresaDe(titulo)) continue;
    decisoes.push(decisaoBase({ id: null, empresa: empresaDe(titulo), valor: titulo.valor, historico: titulo.pessoa || "" }, {
      acao: "excecao",
      motivo: "baixado_sem_banco",
      risco: "medio",
      cor: "divergencia",
      titulos: [tituloResumo(titulo)],
      empresa: empresaDe(titulo),
    }));
  }

  const ocupados = new Set();
  for (const item of decisoes) {
    if (!item.automatica) continue;
    for (const titulo of item.titulos) ocupados.add(`${titulo.tipo}:${titulo.idempresa}:${titulo.controle}`);
  }
  const finais = decisoes.filter((item) => item.automatica || item.titulos.every((titulo) => !ocupados.has(`${titulo.tipo}:${titulo.idempresa}:${titulo.controle}`)));
  return {
    decisoes: finais,
    duplicados,
    transferencias,
    proativas,
    metricas: calcularMetricas(finais, { minutosPorManual: cfg.minutosPorManual }),
    incremental: { novos: processados.novos.length, pendentes: processados.pendentes.length },
  };
}

function csvCelulas(linha, delimitador) {
  const valores = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const caractere = linha[i];
    if (caractere === '"' && aspas && linha[i + 1] === '"') {
      atual += '"';
      i += 1;
    } else if (caractere === '"') aspas = !aspas;
    else if (caractere === delimitador && !aspas) {
      valores.push(atual.trim());
      atual = "";
    } else atual += caractere;
  }
  valores.push(atual.trim());
  return valores;
}

function dinheiroPlanilha(valor) {
  const texto = String(valor || "").replace(/R\$\s?/gi, "").trim();
  if (!texto) return 0;
  const normal = texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto;
  return arredondar(normal);
}

function dataPlanilha(valor) {
  const brasileira = String(valor || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (brasileira) return `${brasileira[3]}-${brasileira[2]}-${brasileira[1]}`;
  return dia(valor);
}

export function parseCsvExtrato(texto) {
  const linhas = String(texto || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((linha) => linha.trim());
  if (!linhas.length) return { itens: [], erros: ["Arquivo CSV vazio."], formato: "CSV" };
  const delimitador = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ";" : ",";
  const cabecalho = csvCelulas(linhas.shift(), delimitador).map((coluna) => normalizarTexto(coluna));
  const indice = (...nomes) => cabecalho.findIndex((coluna) => nomes.includes(coluna));
  const colunas = {
    data: indice("data", "dtposted", "dtlancamento"),
    valor: indice("valor", "trnamt", "amount"),
    historico: indice("historico", "descricao", "memo", "name"),
    fitid: indice("fitid", "id", "identificador"),
    documento: indice("documento", "numdoc", "numero"),
    tipo: indice("tipo", "trntype"),
  };
  if (colunas.data < 0 || colunas.valor < 0) return { itens: [], erros: ["O CSV precisa das colunas data e valor."], formato: "CSV" };
  const itens = [];
  const erros = [];
  for (const linha of linhas) {
    const celulas = csvCelulas(linha, delimitador);
    const data = dataPlanilha(celulas[colunas.data]);
    const valor = dinheiroPlanilha(celulas[colunas.valor]);
    if (!data || !valor) {
      erros.push("Linha de CSV ignorada sem data ou valor.");
      continue;
    }
    const tipo = normalizarTexto(celulas[colunas.tipo] || "");
    const sinal = /debit|debito|d|saida/.test(tipo) && valor > 0 ? -valor : valor;
    itens.push({
      data,
      valor: sinal,
      historico: celulas[colunas.historico] || "Lancamento CSV",
      fitid: celulas[colunas.fitid] || "",
      numdoc: celulas[colunas.documento] || celulas[colunas.fitid] || "",
    });
  }
  return { itens, erros, formato: "CSV" };
}

function dataCnab(texto) {
  const digitos = String(texto || "");
  if (!/^\d{8}$/.test(digitos)) return null;
  return `${digitos.slice(4)}-${digitos.slice(2, 4)}-${digitos.slice(0, 2)}`;
}

export function parseCnabExtrato(texto) {
  const itens = [];
  const erros = [];
  for (const linha of String(texto || "").split(/\r?\n/)) {
    if (linha.length < 221 || linha[7] !== "3" || linha[13] !== "E") continue;
    const data = dataCnab(linha.slice(142, 150));
    const centavos = Number(linha.slice(150, 168).trim());
    const natureza = linha[168];
    if (!data || !Number.isFinite(centavos) || (natureza !== "C" && natureza !== "D")) {
      erros.push("Lançamento CNAB ignorado por data, valor ou natureza inválidos.");
      continue;
    }
    itens.push({
      data,
      valor: arredondar((natureza === "D" ? -1 : 1) * (centavos / 100)),
      historico: linha.slice(169, 201).trim() || "Lancamento CNAB",
      numdoc: linha.slice(201, 221).trim(),
      fitid: linha.slice(201, 221).trim(),
      tipo: natureza === "C" ? "CREDIT" : "DEBIT",
    });
  }
  return { itens, erros, formato: "CNAB240" };
}
