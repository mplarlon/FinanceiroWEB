import {
  analisarLote,
  classificarMovimento,
  impressaoDigital,
  normalizarTexto,
  podeExecutarAutomaticamente,
} from "./reconciliation-intelligence.js";

export const VERSAO_ESQUEMA = 1;
export const INTERVALO_MINIMO = 60;
export const MODOS = ["sugestao", "simulacao", "automatico"];

export const CAPACIDADES = {
  pluggy: {
    provedor: "pluggy",
    pessoaJuridica: true,
    saldos: true,
    transacoes: true,
    historico: "O histórico depende da instituição e do consentimento. A Pluggy entrega o que o Open Finance daquela instituição disponibiliza; não há um período único garantido para todos os bancos.",
    atualizacaoAutomatica: true,
    webhooks: ["item/created", "item/updated", "item/error", "item/waiting_user_action", "transactions/created", "transactions/updated", "transactions/deleted"],
    consentimento: "O usuário autoriza no Pluggy Connect e no aplicativo do banco. O consentimento padrão não expira, pode ser revogado no banco e, em conectores como Inter PJ, pode expirar em um ano.",
    senhaBancariaNoErp: false,
    comercializacao: "A Pluggy é a instituição que recebe o consentimento. O ERP pode oferecer a conciliação como funcionalidade, mediante contrato com a Pluggy. O ERP não vira participante direto do Open Finance só por esta integração.",
    custo: "Não há tabela pública fixa. O valor depende de proposta comercial da Pluggy.",
    fontes: [
      "https://docs.pluggy.ai/pt/reference",
      "https://docs.pluggy.ai/pt/docs/connections/consents",
      "https://docs.pluggy.ai/pt/reference/webhooks",
      "https://www.pluggy.ai/casos-de-uso/agregar-dados-pj",
    ],
  },
  belvo: {
    provedor: "belvo",
    pessoaJuridica: true,
    saldos: true,
    transacoes: true,
    historico: "Na criação do link de Open Finance Brasil, a Belvo recupera de forma assíncrona os dados disponibilizados, documentados como os últimos 12 meses de contas e transações quando a instituição os fornece.",
    atualizacaoAutomatica: true,
    webhooks: ["new_accounts_available", "new_transactions_available"],
    consentimento: "Pessoa jurídica informa o CNPJ e o CPF e o nome de um representante com acesso à conta. O consentimento ocorre no widget oficial. O ERP não recebe a senha do banco.",
    senhaBancariaNoErp: false,
    comercializacao: "A Belvo é quem conduz o consentimento regulado. A oferta dentro do ERP depende de contrato com a Belvo.",
    custo: "Não há tabela pública fixa. O valor depende de proposta comercial da Belvo.",
    fontes: [
      "https://developers.belvo.com/products/aggregation_brazil/aggregation-brazil-integration-widget",
      "https://developers.belvo.com/apis/belvoopenapispec/transactions/retrievetransactions",
      "https://developers.belvo.com/pt-br/apis/belvoopenapispec/balances",
    ],
  },
};

export function dia(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const ajuste = new Date(valor.getTime() - valor.getTimezoneOffset() * 60000);
    return ajuste.toISOString().slice(0, 10);
  }
  const texto = String(valor || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

export function valorComSinal({ amount, type, valor, tipo } = {}) {
  const numero = Math.round((Number(amount ?? valor) || 0) * 100) / 100;
  const natureza = String(type || tipo || "").toUpperCase();
  if (["DEBIT", "OUTFLOW", "DEBITO"].includes(natureza)) return -Math.abs(numero);
  if (["CREDIT", "INFLOW", "CREDITO"].includes(natureza)) return Math.abs(numero);
  return numero;
}

export function identificadorPix(valor) {
  const texto = String(valor || "").replace(/\s/g, "").toUpperCase();
  return /^E[A-Z0-9]{31}$/.test(texto) ? texto : null;
}

export function normalizarTransacao(bruto, origem) {
  const base = origem === "belvo" ? normalizarBelvo(bruto) : normalizarPluggy(bruto);
  if (!base.idExterno || !base.data || !base.valor) return null;
  const classe = classificarMovimento({ historico: base.descricao, valor: base.valor, endToEndId: base.e2e, fitid: base.idExterno });
  return {
    ...base,
    natureza: classe.devolucao && classe.natureza === "outros" ? "estorno" : classe.natureza,
    direcao: base.valor > 0 ? "entrada" : base.valor < 0 ? "saida" : "zero",
    moeda: base.moeda || "BRL",
  };
}

function normalizarPluggy(item) {
  const pagamento = item?.paymentData || {};
  const pagador = pagamento.payer || pagamento.receiver || {};
  const documento = pagador.documentNumber?.value || pagador.documentNumber || "";
  const referencia = pagamento.referenceNumber || item?.id || "";
  return {
    idExterno: String(item?.id || "").slice(0, 80),
    contaExterna: String(item?.accountId || "").slice(0, 80),
    data: dia(item?.date),
    dataContabil: dia(item?.balanceDate || item?.date),
    descricao: String(item?.description || item?.descriptionRaw || "Lançamento").slice(0, 255),
    valor: valorComSinal({ amount: item?.amount, type: item?.type }),
    moeda: String(item?.currencyCode || "BRL").slice(0, 3),
    e2e: identificadorPix(referencia) || identificadorPix(item?.description),
    documento: String(documento || "").replace(/\D/g, "").slice(0, 20),
    pagador: String(pagador.name || "").slice(0, 160),
    statusBancario: String(item?.status || "POSTED").slice(0, 20),
    pagamento: String(pagamento.paymentMethod || "").toUpperCase().slice(0, 20),
  };
}

function normalizarBelvo(item) {
  const referencia = item?.reference || item?.internal_identification || "";
  return {
    idExterno: String(item?.id || "").slice(0, 80),
    contaExterna: String(item?.account?.id || item?.account || "").slice(0, 80),
    data: dia(item?.value_date || item?.accounting_date || item?.collected_at),
    dataContabil: dia(item?.accounting_date || item?.value_date),
    descricao: String(item?.description || item?.observations || "Lançamento").slice(0, 255),
    valor: valorComSinal({ amount: item?.amount, type: item?.type }),
    moeda: String(item?.currency || "BRL").slice(0, 3),
    e2e: identificadorPix(referencia) || identificadorPix(item?.description),
    documento: String(item?.counterparty?.document || "").replace(/\D/g, "").slice(0, 20),
    pagador: String(item?.counterparty?.name || item?.merchant?.name || "").slice(0, 160),
    statusBancario: String(item?.status || "PROCESSED").slice(0, 20),
    pagamento: /pix/i.test(`${item?.description || ""} ${item?.category || ""}`) ? "PIX" : "",
  };
}

export function contaDeTransferencia(numero) {
  const partes = String(numero || "").split("/").map((parte) => parte.trim()).filter(Boolean);
  if (partes.length < 3) return { banco: "", agencia: "", numero: String(numero || "").slice(0, 30) };
  return {
    banco: partes[0].replace(/\D/g, "").padStart(3, "0").slice(-3),
    agencia: partes[1].slice(0, 20),
    numero: partes.slice(2).join("/").slice(0, 30),
  };
}

export function proximaTentativaSegundos(tentativa) {
  const expoente = Math.max(0, Number(tentativa || 1) - 1);
  return Math.min(3600, 30 * (2 ** expoente));
}

export function politicaPadrao(empresa) {
  return {
    empresa: Number(empresa),
    modo: "sugestao",
    intervaloMinutos: 360,
    retencaoDias: 730,
    ultimoRelatorio: null,
  };
}

export function validarPolitica(atual, entrada, ator) {
  const proxima = { ...politicaPadrao(atual?.empresa || entrada?.empresa), ...atual };
  if (entrada?.intervaloMinutos != null) {
    const minutos = Number(entrada.intervaloMinutos);
    if (!Number.isFinite(minutos) || minutos < INTERVALO_MINIMO) {
      throw Object.assign(new Error(`O intervalo mínimo é de ${INTERVALO_MINIMO} minutos, para respeitar o limite das APIs.`), { status: 400 });
    }
    proxima.intervaloMinutos = Math.min(24 * 60, Math.round(minutos));
  }
  if (entrada?.retencaoDias != null) {
    const dias = Number(entrada.retencaoDias);
    if (!Number.isFinite(dias) || dias < 30) {
      throw Object.assign(new Error("A retenção mínima dos dados bancários é de 30 dias."), { status: 400 });
    }
    proxima.retencaoDias = Math.min(3650, Math.round(dias));
  }
  if (entrada?.modo != null) {
    if (!MODOS.includes(entrada.modo)) throw Object.assign(new Error("Modo de conciliação inválido."), { status: 400 });
    if (entrada.modo === "automatico") {
      if (entrada.confirmado !== true || !ator?.idusuario) {
        throw Object.assign(new Error("A baixa automática exige confirmação de um administrador."), { status: 409 });
      }
      if (String(ator.perfil || "").toLowerCase() !== "admin") {
        throw Object.assign(new Error("Somente um administrador pode homologar a baixa automática."), { status: 403 });
      }
    }
    proxima.modo = entrada.modo;
  }
  return proxima;
}

export function regraCompativel(regra, movimento) {
  if (!regra?.ativa || Number(regra.empresa) !== Number(movimento?.empresa)) return false;
  const padrao = normalizarTexto(regra.padrao);
  const texto = normalizarTexto(movimento?.descricao || movimento?.historico);
  return Boolean(padrao) && texto.includes(padrao);
}

export function montarAutorizacoes(regras, empresa) {
  return {
    tarifas: (regras || [])
      .filter((regra) => regra.ativa && Number(regra.empresa) === Number(empresa) && regra.criarLancamento && regra.cdfornecedor && regra.cdconta && ["tarifa", "juros", "iof", "encargo"].includes(regra.categoria))
      .map((regra) => ({ padrao: regra.padrao, cdfornecedor: regra.cdfornecedor, cdconta: regra.cdconta, valorMaximo: regra.valorMaximo || null })),
  };
}

export function classeDaDecisao(decisao) {
  if (!decisao) return "nao_identificado";
  if (decisao.cor === "divergencia" || ["duplicado", "estorno_ou_devolucao", "valor_divergente", "empresa_nao_identificada"].includes(decisao.motivo)) return "divergencia";
  if (decisao.automatica && podeExecutarAutomaticamente(decisao)) return "automatica";
  if (decisao.titulos?.length || ["tarifa", "transferencia"].includes(decisao.acao)) return "sugerida";
  return "nao_identificado";
}

function somaTitulos(decisao) {
  return Math.round((decisao?.titulos || []).reduce((total, titulo) => total + Math.abs(Number(titulo.valor) || 0), 0) * 100) / 100;
}

export function podeLiquidar(decisao, politica, origem) {
  if (!decisao) return { aplicar: false, motivo: "sem_decisao" };
  if (origem === "humano") {
    if (decisao.aprovadaPorHumano !== true || decisao.alteraValor || decisao.ambigua) return { aplicar: false, motivo: "regra_financeira" };
    if (decisao.acao === "transferencia" || decisao.acao === "tarifa") {
      return podeExecutarAutomaticamente({ ...decisao, automatica: true })
        ? { aplicar: true, motivo: "aprovacao_humana" }
        : { aplicar: false, motivo: "regra_financeira" };
    }
    if (!decisao.titulos?.length) return { aplicar: false, motivo: "sem_titulo" };
    if (Math.abs(somaTitulos(decisao) - Math.abs(Number(decisao.valor) || 0)) > 0.01) return { aplicar: false, motivo: "valor_diferente" };
    const empresas = new Set(decisao.titulos.map((titulo) => Number(titulo.idempresa || titulo.empresa)));
    if (empresas.size !== 1 || ![...empresas][0] || [...empresas][0] !== Number(decisao.empresa)) return { aplicar: false, motivo: "empresa_diferente" };
    return { aplicar: true, motivo: "aprovacao_humana" };
  }
  if (politica?.modo !== "automatico") return { aplicar: false, motivo: "modo_sugestao" };
  if (!podeExecutarAutomaticamente(decisao)) return { aplicar: false, motivo: "regra_financeira" };
  return { aplicar: true, motivo: "homologado" };
}

export function pontuacao(decisao) {
  if (!decisao) return 0;
  if (classeDaDecisao(decisao) === "automatica" && decisao.nivel === 1) return 95;
  if (classeDaDecisao(decisao) === "automatica") return 80;
  if (classeDaDecisao(decisao) === "sugerida") return 55;
  if (classeDaDecisao(decisao) === "divergencia") return 30;
  return 0;
}

export function textoCharlie(movimento, decisao) {
  const titulo = decisao?.titulos?.[0];
  const pessoa = titulo?.pessoa || "";
  if (decisao?.acao === "transferencia") {
    return "As duas contas da empresa têm lançamentos de mesmo valor em datas compatíveis. Sugestão: vincular como transferência interna, sem tratar como receita ou despesa.";
  }
  if (decisao?.natureza === "tarifa" || /tarifa|cesta/.test(normalizarTexto(movimento?.descricao || movimento?.historico))) {
    return "Movimentação com características de tarifa bancária. Sugestão: classificar como despesa bancária.";
  }
  if (decisao?.natureza === "estorno" || decisao?.motivo === "estorno_ou_devolucao") {
    return "A descrição tem cara de estorno ou devolução. Nenhuma baixa automática foi proposta.";
  }
  if (titulo && decisao?.automatica) {
    return `Correspondência inequívoca com ${pessoa || (titulo.tipo === "receber" ? "um título a receber" : "um título a pagar")} ${titulo.controle}. A baixa só acontece se o modo automático estiver homologado e a validação financeira se repetir na gravação.`;
  }
  if (titulo && titulo.tipo === "receber") {
    return `Possível correspondência identificada${pessoa ? ` com ${pessoa}` : ""}. Verificar identificadores e demais informações antes de conciliar.`;
  }
  if (titulo && titulo.tipo === "pagar") {
    return `Pagamento possivelmente relacionado${pessoa ? ` ao fornecedor ${pessoa}` : " a um título a pagar"}. A confirmação continua obrigatória.`;
  }
  if (decisao?.motivo === "duplicado") return "Há outro lançamento com a mesma identificação. A conciliação ficou parada para evitar baixa duplicada.";
  return "Nenhuma correspondência segura foi encontrada. A movimentação permanece para classificação.";
}

export function divergenciaDe(movimento, decisao, baixados = []) {
  const baixado = (baixados || []).find((titulo) => Number(titulo.empresa || titulo.idempresa) === Number(movimento.empresa) && (
    (movimento.e2e && titulo.endToEndId && movimento.e2e === titulo.endToEndId) ||
    (movimento.documento && titulo.cgc && movimento.documento === titulo.cgc && Math.abs(Math.abs(movimento.valor) - Math.abs(titulo.valor)) <= 0.01)
  ));
  if (baixado) {
    return tipoDivergencia(movimento, "titulo_ja_baixado", "O identificador ou o documento já aparece em título baixado.", "Conferir o título antes de qualquer nova baixa.", baixado);
  }
  if (!decisao || classeDaDecisao(decisao) !== "divergencia") return null;
  const titulo = decisao.titulos?.[0];
  const diferenca = titulo ? Math.round((Math.abs(movimento.valor) - Math.abs(titulo.valor)) * 100) / 100 : 0;
  if (decisao.motivo === "duplicado") return tipoDivergencia(movimento, "duplicidade", "A mesma identificação apareceu mais de uma vez.", "Manter apenas um lançamento e ignorar a cópia.");
  if (decisao.motivo === "estorno_ou_devolucao") return tipoDivergencia(movimento, "estorno", "A descrição indica devolução ou estorno.", "Relacionar ao lançamento original antes de alterar saldos.");
  if (decisao.motivo === "valor_divergente" && diferenca > 0.01) return tipoDivergencia(movimento, "pagamento_superior", "O valor do extrato é maior que o título encontrado.", "Não baixar automaticamente. Conferir juros, agrupamento ou outro título.", titulo);
  if (decisao.motivo === "valor_divergente" && diferenca < -0.01) return tipoDivergencia(movimento, "pagamento_inferior", "O valor do extrato é menor que o título encontrado.", "Tratar como parcial somente com aprovação e regra financeira.", titulo);
  if (decisao.motivo === "regra_ambigua") return tipoDivergencia(movimento, "correspondencias_concorrentes", "Há mais de um título compatível.", "Escolher o título correto.");
  return tipoDivergencia(movimento, decisao.motivo || "inconsistencia", decisao.hipotese?.narracao || "A regra financeira não fechou.", "Revisar os documentos relacionados.");
}

function tipoDivergencia(movimento, tipo, causa, sugestao, titulo) {
  return {
    empresa: Number(movimento.empresa),
    movimentoId: movimento.id,
    tipo,
    valor: Math.round(Math.abs(Number(movimento.valor) || 0) * 100) / 100,
    causa: String(causa).slice(0, 255),
    sugestao: String(sugestao).slice(0, 500),
    documentos: titulo ? `${titulo.tipo || ""} ${titulo.controle || ""}`.trim() : "",
    status: "aberta",
  };
}

export function prepararMovimento(registro, conta) {
  const historico = [registro.descricao, registro.pagador, registro.e2e].filter(Boolean).join(" — ");
  return {
    id: registro.id,
    empresa: registro.empresa,
    data: registro.data,
    valor: registro.valor,
    historico,
    numdoc: registro.e2e || registro.idExterno,
    fitid: registro.e2e || null,
    endToEndId: registro.e2e || null,
    conciliado: registro.status === "conciliado",
    conta: {
      banco: conta?.cdbanco || conta?.banco || "",
      agencia: conta?.agenciaErp || conta?.agencia || "",
      conta: conta?.numcontaErp || conta?.numero || "",
    },
  };
}

export function analisarMovimentos({ movimentos, contas, titulos, contasProprias, baixadosSemBanco, regras, empresa }) {
  const vinculados = new Map((contas || []).filter((conta) => conta.vinculada).map((conta) => [conta.id, conta]));
  const elegiveis = (movimentos || []).filter((movimento) => vinculados.has(movimento.contaId) && movimento.status !== "conciliado" && movimento.status !== "ignorado");
  const motor = elegiveis.map((movimento) => prepararMovimento(movimento, vinculados.get(movimento.contaId)));
  const analise = analisarLote({
    movimentos: motor,
    titulos: titulos || [],
    contasProprias: contasProprias || [],
    baixadosSemBanco: baixadosSemBanco || [],
    configuracao: { autorizacoes: montarAutorizacoes(regras, empresa) },
  });
  const porId = new Map(analise.decisoes.map((decisao) => [decisao.movimentoId, decisao]));
  return elegiveis.map((movimento) => {
    const decisao = porId.get(movimento.id) || null;
    const divergencia = divergenciaDe({ ...movimento, e2e: movimento.e2e, documento: movimento.documento }, decisao, baixadosSemBanco);
    const bloqueada = divergencia?.tipo === "titulo_ja_baixado";
    const efetiva = bloqueada ? { ...decisao, automatica: false, acao: "excecao", cor: "divergencia", motivo: "titulo_ja_baixado" } : decisao;
    const classe = bloqueada ? "divergencia" : classeDaDecisao(efetiva);
    return {
      movimento,
      decisao: efetiva,
      classe,
      confianca: pontuacao(efetiva),
      charlie: textoCharlie(movimento, efetiva),
      divergencia: bloqueada ? divergencia : divergenciaDe(movimento, efetiva, baixadosSemBanco),
      regra: (regras || []).find((regra) => regraCompativel(regra, movimento)) || null,
    };
  });
}

export function montarRelatorio({ empresa, nome, data, movimentos, contas }) {
  const doDia = (movimentos || []).filter((item) => dia(item.data) === data && Number(item.empresa) === Number(empresa));
  const conciliadasAuto = doDia.filter((item) => item.status === "conciliado" && item.origemBaixa === "servico-conciliacao");
  const manuais = doDia.filter((item) => item.status === "conciliado" && item.origemBaixa === "aprovacao-humana");
  const divergencias = doDia.filter((item) => item.classe === "divergencia" && item.status !== "conciliado" && item.status !== "ignorado");
  const pendentes = doDia.filter((item) => !["conciliado", "ignorado"].includes(item.status));
  const soma = (lista, pred) => Math.round(lista.filter(pred).reduce((total, item) => total + Math.abs(Number(item.valor) || 0), 0) * 100) / 100;
  const recebidos = soma(doDia, (item) => Number(item.valor) > 0);
  const pagos = soma(doDia, (item) => Number(item.valor) < 0);
  const saldos = (contas || []).filter((conta) => Number(conta.empresa) === Number(empresa) && conta.saldo != null);
  const saldoBanco = saldos.length ? Math.round(saldos.reduce((total, conta) => total + Number(conta.saldo || 0), 0) * 100) / 100 : null;
  const base = conciliadasAuto.length + pendentes.length;
  const percentual = doDia.length ? Math.round((conciliadasAuto.length / doDia.length) * 10000) / 100 : null;
  const alertas = [];
  if (divergencias.length) alertas.push(`${divergencias.length} divergência(s) pedem revisão.`);
  if (pendentes.length) alertas.push(`${pendentes.length} movimentação(ões) ainda não foram conciliadas.`);
  if (!saldos.length) alertas.push("O provedor não informou saldo nesta leitura.");
  return {
    titulo: "RELATÓRIO FINANCEIRO — CHARLIE",
    empresa: nome || `Empresa ${empresa}`,
    data,
    movimentacoes: doDia.length,
    conciliadasAutomaticamente: conciliadasAuto.length,
    conciliadasManualmente: manuais.length,
    pendentes: pendentes.length,
    divergencias: divergencias.length,
    percentual,
    recebido: recebidos,
    pago: pagos,
    saldoBancario: saldoBanco,
    elegiveis: base,
    alertas,
    recomendacao: divergencias.length ? "Resolver as divergências antes de ampliar a baixa automática." : "As pendências restantes precisam de classificação ou de identificador melhor.",
  };
}

export function saldoDivergente(saldoBanco, saldoErp) {
  if (saldoBanco == null || saldoErp == null) return null;
  const diferenca = Math.round((Number(saldoBanco) - Number(saldoErp)) * 100) / 100;
  return { saldoBanco: Number(saldoBanco), saldoErp: Number(saldoErp), diferenca, diverge: Math.abs(diferenca) > 0.01 };
}

export function periodoRetroativo(pedido, ultima) {
  const hoje = dia(pedido?.ate || new Date()) || dia(new Date());
  const informado = dia(pedido?.de);
  if (informado) return { de: informado, ate: hoje };
  const base = dia(ultima) || hoje;
  const recuo = new Date(`${base}T12:00:00Z`);
  recuo.setUTCDate(recuo.getUTCDate() - 3);
  return { de: recuo.toISOString().slice(0, 10), ate: hoje };
}

export function chaveDuplicidade(movimento) {
  return impressaoDigital({
    empresa: movimento.empresa,
    historico: movimento.descricao,
    valor: movimento.valor,
    data: movimento.data,
    endToEndId: movimento.e2e,
    fitid: movimento.idExterno,
    conta: { banco: movimento.banco || "", agencia: movimento.agencia || "", conta: movimento.numero || "" },
  });
}

export function resumirPainel(movimentos, contas, conexoes, saldos) {
  const abertos = (movimentos || []).filter((item) => !["ignorado"].includes(item.status));
  const auto = abertos.filter((item) => item.status === "conciliado" && item.origemBaixa === "servico-conciliacao");
  const manual = abertos.filter((item) => item.status === "conciliado" && item.origemBaixa === "aprovacao-humana");
  const pendentes = abertos.filter((item) => !["conciliado"].includes(item.status));
  const divergencias = abertos.filter((item) => item.classe === "divergencia" && item.status !== "conciliado");
  const conciliados = auto.length + manual.length;
  return {
    importadas: abertos.length,
    conciliadasAutomaticamente: auto.length,
    conciliadasManualmente: manual.length,
    pendentes: pendentes.length,
    divergencias: divergencias.length,
    percentualAutomacao: abertos.length ? Math.round((auto.length / abertos.length) * 10000) / 100 : null,
    conexoes: (conexoes || []).map((conexao) => ({
      id: conexao.id,
      instituicao: conexao.instituicao,
      status: conexao.status,
      ultimaSincronizacao: conexao.ultimaSync || null,
      consentimentoExpira: conexao.consentimentoExpira || null,
    })),
    contas: (contas || []).length,
    saldos: saldos || [],
    ultimaSincronizacao: (conexoes || []).map((item) => item.ultimaSync).filter(Boolean).sort().at(-1) || null,
    conciliados,
  };
}
