import crypto from "node:crypto";
import { semAcento } from "./charlie-leads-cnpj.js";
import { loadState, updateState } from "./charlie-leads-store.js";
import { segmentosPadrao } from "./charlie-leads-store.js";
import {
  analisarLead,
  atribuirVendedor,
  consultarCnpj,
  consultarSaldo,
  criarLead,
  criarOportunidade,
  distribuirLeads,
  empresasSemelhantes,
  executarAutomacao,
  indicadores,
  listarLeads,
  pesquisarEmpresas,
  prepararMensagem,
  relatorio,
  sugerirProdutos,
} from "./charlie-leads-service.js";

const UFS = {
  acre: "ac", alagoas: "al", amapa: "ap", amazonas: "am", bahia: "ba", ceara: "ce", "distrito federal": "df",
  "espirito santo": "es", goias: "go", maranhao: "ma", "mato grosso do sul": "ms", "mato grosso": "mt",
  "minas gerais": "mg", para: "pa", paraiba: "pb", parana: "pr", pernambuco: "pe", piaui: "pi",
  "rio de janeiro": "rj", "rio grande do norte": "rn", "rio grande do sul": "rs", rondonia: "ro",
  roraima: "rr", "santa catarina": "sc", "sao paulo": "sp", sergipe: "se", tocantins: "to",
  rj: "rj", sp: "sp", mg: "mg", es: "es", pr: "pr", sc: "sc", rs: "rs", ba: "ba",
};

export function normalizarPedido(valor) {
  return semAcento(String(valor || "").replace(/^charlie[,:\s]+/i, ""));
}

export function pareceLeads(texto) {
  return /\bleads?\b/.test(texto)
    || /\b(casa dos dados|prospeccao)\b/.test(texto)
    || (/\b(encontre|buscar|busque|pesquise|procure)\b/.test(texto) && /\b(empresas?|construtoras?|cnpj|estabelecimentos?)\b/.test(texto));
}

function ufDe(texto) {
  const chaves = Object.keys(UFS).sort((a, b) => b.length - a.length);
  const encontrada = chaves.find((chave) => new RegExp(`\\b${chave}\\b`).test(texto));
  return encontrada ? UFS[encontrada] : null;
}

function segmentoDe(texto, segmentos) {
  return segmentos.find((item) => (item.termos || []).some((termo) => texto.includes(semAcento(termo)))) || null;
}

function cidadeDe(texto) {
  const marcada = texto.match(/\bem\s+([a-z][a-z\s]{2,40}?)(?=\s+(?:com|abertas|que|para|no|na|de cnae)\b|$)/);
  if (!marcada) return null;
  const cidade = marcada[1].trim();
  if (UFS[cidade] || cidade.startsWith("os ") || cidade.startsWith("as ")) return null;
  return cidade;
}

export function interpretarPedido(pergunta, segmentos = segmentosPadrao()) {
  const texto = normalizarPedido(pergunta);
  if (!pareceLeads(texto)) return null;
  const limite = Math.max(1, Math.min(1000, Number(texto.match(/\b(\d{1,4})\b/)?.[1] || 10)));
  const uf = ufDe(texto);
  const segmento = segmentoDe(texto, segmentos);
  const ultimos = texto.match(/ultimos\s+(\d{1,4})\s+dias/);
  const cidade = !uf || !texto.includes(uf) ? cidadeDe(texto) : cidadeDe(texto.replace(uf, ""));
  if (/\b(maior potencial|mais potencial)\b/.test(texto)) return { acao: "leads.listar", pago: false, criterios: { ordem: "score" } };
  if (/\bnao foram atendid|ainda nao foram|sem atendimento\b/.test(texto)) return { acao: "leads.listar", pago: false, criterios: { naoAtendidos: true } };
  if (/\bja sao clientes|ja e cliente|ja sao cliente\b/.test(texto)) return { acao: "leads.listar", pago: false, criterios: { clientes: true } };
  if (/\bdistribua\b/.test(texto)) return { acao: "leads.atribuir_vendedor", pago: false, criterios: { quantidade: limite } };
  if (/\banalis[ae]\b/.test(texto) && /\bhoje\b/.test(texto)) return { acao: "leads.qualificar_lead", pago: false, criterios: { hoje: true } };
  if (/\bsemelhantes?\b/.test(texto) && /\bclientes\b/.test(texto)) return { acao: "leads.buscar_empresas", pago: true, criterios: { modo: "semelhantes", limite: Math.min(limite, 20) } };
  if (/\b(nossos produtos|comprar nossos|possam comprar)\b/.test(texto)) {
    return { acao: "leads.sugerir_produtos", pago: true, criterios: { modo: "produtos", limite: Math.min(limite, 20), cnae: segmentos.flatMap((item) => item.cnaes).slice(0, 10), situacao: ["ATIVA"] } };
  }
  if (/\bsaldo\b/.test(texto) && /\b(casa dos dados|api)\b/.test(texto)) return { acao: "leads.verificar_saldo", pago: false, criterios: {} };
  const criterios = {
    limite,
    pagina: 1,
    situacao: ["ATIVA"],
    ...(uf ? { uf: [uf] } : {}),
    ...(cidade ? { municipio: [cidade] } : {}),
    ...(segmento ? { cnae: segmento.cnaes, segmento: segmento.nome } : {}),
    ...(ultimos ? { ultimosDias: Math.min(3650, Number(ultimos[1])) } : {}),
    ...(texto.includes("telefone") ? { comTelefone: true } : {}),
    ...(texto.includes("e-mail") || texto.includes("email") ? { comEmail: true } : {}),
  };
  return { acao: "leads.buscar_empresas", pago: true, criterios };
}

function descrever(criterios) {
  const partes = [];
  if (criterios.segmento) partes.push(`segmento ${criterios.segmento}`);
  if (criterios.cnae) partes.push(`CNAE ${[].concat(criterios.cnae).join(", ")}`);
  if (criterios.uf) partes.push(`UF ${[].concat(criterios.uf).join(", ")}`);
  if (criterios.municipio) partes.push(`município ${[].concat(criterios.municipio).join(", ")}`);
  if (criterios.ultimosDias) partes.push(`abertas nos últimos ${criterios.ultimosDias} dias`);
  if (criterios.situacao) partes.push(`situação ${criterios.situacao.join(", ")}`);
  if (criterios.comTelefone) partes.push("com telefone");
  partes.push(`limite ${criterios.limite || 10}`);
  return partes.join("; ");
}

function resposta(texto, dados = [], extra = {}) {
  return {
    resposta: texto,
    intencao: { type: "charlie_leads", acao: extra.acao || null, interpretador: "regras" },
    dados,
    origem: extra.origem || "casa_dos_dados",
    sugestoes: extra.sugestoes || ["Mostre os leads com maior potencial", "Quais leads ainda não foram atendidos?"],
    ...extra,
  };
}

async function executarBusca(criterios, ator, deps, pontual) {
  if (criterios.modo === "semelhantes") {
    const plano = await empresasSemelhantes(ator, deps);
    const pesquisa = await pesquisarEmpresas({ ...plano.criterios, autorizacaoPontual: pontual }, ator, deps);
    return resposta(`${plano.aviso} Encontrei ${pesquisa.empresas.length} empresa(s) nas UF dos maiores clientes.`, pesquisa.empresas, { acao: "leads.buscar_empresas" });
  }
  const pesquisa = await pesquisarEmpresas({ ...criterios, autorizacaoPontual: pontual }, ator, deps);
  const aviso = pesquisa.reutilizado ? "Reutilizei uma pesquisa idêntica feita há poucos minutos, sem nova consulta paga. " : "";
  return resposta(`${aviso}A Casa dos Dados retornou ${pesquisa.empresas.length} empresa(s) válida(s)${pesquisa.total != null ? ` de um total informado de ${pesquisa.total}` : ""}. Nenhuma foi cadastrada como cliente.`, pesquisa.empresas, { acao: "leads.buscar_empresas" });
}

export async function responderLeads(pergunta, ator, deps = {}, contexto = {}) {
  const texto = normalizarPedido(pergunta);
  const estado = loadState();
  const pendente = (estado.pendencias || []).find((item) => Number(item.usuarioId) === Number(ator?.id) && Date.parse(item.expira) > Date.now());
  if (pendente && /^(sim|autorizo|confirmo|pode pesquisar)\b/.test(texto)) {
    if (contexto?.pendente?.id && !/pesquisa|credito|lead|empresa|cnpj/.test(texto)) return null;
    if (!ator?.gerencial) return resposta("Só um administrador pode autorizar o consumo de créditos.", [], { acao: pendente.acao });
    await updateState((atual) => { atual.pendencias = atual.pendencias.filter((item) => item.id !== pendente.id); });
    try {
      return await executarBusca(pendente.criterios, ator, deps, true);
    } catch (error) {
      return resposta(error.message, [], { acao: pendente.acao });
    }
  }
  const comando = interpretarPedido(pergunta, estado.segmentos);
  if (!comando) return null;
  try {
    if (comando.acao === "leads.listar") {
      const filtro = { ...comando.criterios };
      if (filtro.hoje) {
        const inicio = new Date();
        inicio.setHours(0, 0, 0, 0);
        filtro.desde = inicio.toISOString();
      }
      const leads = listarLeads(filtro, ator);
      return resposta(leads.length ? `Encontrei ${leads.length} lead(s) no cadastro do Charlie Leads.` : "Não há leads nesses critérios.", leads, { acao: comando.acao, origem: "banco" });
    }
    if (comando.acao === "leads.qualificar_lead") {
      const inicio = new Date();
      inicio.setHours(0, 0, 0, 0);
      const leads = listarLeads({ desde: inicio.toISOString(), ordem: "score" }, ator).slice(0, 20);
      const analisados = [];
      for (const lead of leads) analisados.push(await analisarLead(lead.id, ator, deps));
      return resposta(analisados.length ? `Analisei ${analisados.length} lead(s) encontrado(s) hoje. A pontuação é determinística; o texto só organiza os motivos já calculados.` : "Não há leads encontrados hoje para analisar.", analisados, { acao: comando.acao, origem: "banco" });
    }
    if (comando.acao === "leads.atribuir_vendedor") {
      const resultado = await distribuirLeads({ quantidade: comando.criterios.quantidade }, ator);
      return resposta(`Distribuí ${resultado.quantidade} lead(s) conforme as regras de vendedor. Nenhum lead que já tinha responsável foi reatribuído.`, [], { acao: comando.acao, origem: "banco" });
    }
    if (comando.acao === "leads.verificar_saldo") {
      const saldo = await consultarSaldo(ator, deps);
      return resposta(`O saldo informado pela Casa dos Dados é ${saldo.saldo}.`, [saldo], { acao: comando.acao });
    }
    if (!comando.pago) return resposta("Não identifiquei uma pesquisa paga nesse pedido.", [], { acao: comando.acao });
    if (!ator?.gerencial) return resposta("A pesquisa na Casa dos Dados exige permissão gerencial.", [], { acao: comando.acao });
    const autorizado = estado.config.consultasPagasAutorizadas && estado.config.ativa && estado.config.apiKey;
    if (!autorizado) {
      if (!estado.config.apiKey) return resposta("A API Key da Casa dos Dados ainda não está configurada. Nenhuma consulta foi feita. Abra E-commerce, Charlie Leads, Configurações, e grave a chave.", [], { acao: comando.acao });
      const id = crypto.randomUUID();
      await updateState((atual) => {
        atual.pendencias = atual.pendencias.filter((item) => Number(item.usuarioId) !== Number(ator.id));
        atual.pendencias.push({ id, usuarioId: ator.id, criterios: comando.criterios, acao: comando.acao, expira: new Date(Date.now() + 15 * 60_000).toISOString() });
      });
      return resposta(`Vou usar estes critérios: ${descrever(comando.criterios)}. A correspondência de CNAE não comprova intenção de compra. Esta pesquisa consome créditos e ainda não está autorizada. Responda "autorizo" para executar somente esta consulta.`, [], { acao: comando.acao });
    }
    if (comando.acao === "leads.sugerir_produtos") {
      return executarBusca({ ...comando.criterios, limite: comando.criterios.limite }, ator, deps, false);
    }
    return executarBusca(comando.criterios, ator, deps, false);
  } catch (error) {
    return resposta(error.message || "Não foi possível concluir a operação de leads.", [], { acao: comando.acao });
  }
}

export const FERRAMENTAS_LEADS = {
  buscar_empresas: pesquisarEmpresas,
  consultar_cnpj: consultarCnpj,
  verificar_saldo_api: consultarSaldo,
  analisar_lead: analisarLead,
  qualificar_lead: analisarLead,
  verificar_cliente_existente: listarLeads,
  sugerir_produtos: sugerirProdutos,
  criar_lead: criarLead,
  atribuir_vendedor: atribuirVendedor,
  criar_oportunidade: criarOportunidade,
  consultar_historico_comercial: listarLeads,
  gerar_relatorio_prospeccao: relatorio,
  preparar_mensagem: prepararMensagem,
  executar_automacao: executarAutomacao,
};
