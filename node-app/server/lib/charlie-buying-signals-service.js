import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { segmentosPadrao } from "./charlie-leads-store.js";
import { upsertOpportunities } from "./charlie-commercial-store.js";
import { avaliarSinal, validarSinal } from "./charlie-buying-signals.js";

const FILE = "charlie_buying_signals.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { sinais: memoria.sinais || [], oportunidades: memoria.oportunidades || {}, historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { sinais: [], oportunidades: {}, historico: [] });
  return { sinais: salvo.sinais || [], oportunidades: salvo.oportunidades || {}, historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = { sinais: estado.sinais || [], oportunidades: estado.oportunidades || {}, historico: (estado.historico || []).slice(-400) };
  if (memoria) {
    memoria.sinais = enxuto.sinais;
    memoria.oportunidades = enxuto.oportunidades;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function exigirGestor(ator) {
  if (!ator?.gerencial) {
    const erro = new Error("Só um usuário gerencial registra sinal ou oportunidade.");
    erro.status = 403;
    throw erro;
  }
}

async function produtosPorCodigo(deps, codigos) {
  if (!codigos.length || !deps.query) return [];
  const marcas = codigos.map(() => "?").join(", ");
  try {
    const rows = await deps.query(`SELECT CDPRODUTO, PRODUTO FROM PRODUTO WHERE UPPER(TRIM(CDPRODUTO)) IN (${marcas}) AND (INATIVO = 0 OR INATIVO IS NULL)`, codigos.map((item) => item.toUpperCase()));
    return (rows || []).map((row) => ({ codigo: String(row.CDPRODUTO || "").trim(), nome: String(row.PRODUTO || "").trim() }));
  } catch {
    return null;
  }
}

function completar(sinal, produtos) {
  const avaliacao = avaliarSinal(sinal, { segmentos: segmentosPadrao(), produtos: produtos || [] });
  return { ...sinal, ...avaliacao, produtosIndisponiveis: produtos == null };
}

export async function painelSinais(deps = {}, opcoes = {}) {
  const estado = ler();
  const sinais = [];
  for (const sinal of opcoes.sinais || estado.sinais) {
    const produtos = opcoes.produtos || await produtosPorCodigo(deps, sinal.codigos || []);
    sinais.push({ ...completar(sinal, produtos), oportunidadeId: estado.oportunidades[sinal.id]?.id || null });
  }
  return {
    sinais,
    aviso: "O Charlie não consulta licitação, edital ou notícia na internet. Cada linha é um registro informado, com fonte e data.",
  };
}

export async function cadastrarSinal(pedido, ator, deps = {}, opcoes = {}) {
  exigirGestor(ator);
  const valido = validarSinal(pedido);
  const sinal = { id: `sinal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...valido, criadaEm: new Date().toISOString(), usuario: ator.id || null };
  const estado = ler();
  estado.sinais.unshift(sinal);
  estado.historico.push({ em: sinal.criadaEm, usuario: ator.id || null, tipo: "cadastro", id: sinal.id });
  gravar(estado);
  const produtos = opcoes.produtos || await produtosPorCodigo(deps, sinal.codigos);
  return completar(sinal, produtos);
}

export async function criarOportunidade(id, ator, deps = {}, opcoes = {}) {
  exigirGestor(ator);
  const estado = ler();
  const sinal = estado.sinais.find((item) => item.id === id);
  if (!sinal) {
    const erro = new Error("Sinal não encontrado.");
    erro.status = 404;
    throw erro;
  }
  if (estado.oportunidades[id]) return { oportunidadeId: estado.oportunidades[id].id, repetida: true };
  const produtos = opcoes.produtos || await produtosPorCodigo(deps, sinal.codigos || []);
  const avaliado = completar(sinal, produtos);
  const gravarOportunidade = deps.gravarOportunidade || upsertOpportunities;
  const gravada = gravarOportunidade([{
    key: id,
    customerId: null,
    customer: sinal.empresa,
    sellerId: null,
    seller: "Sem vendedor",
    type: "sinal_publico",
    reason: avaliado.motivo,
    score: avaliado.relevancia.pontos,
    priority: avaliado.relevancia.rotulo === "alta" ? "relevante" : avaliado.relevancia.rotulo === "media" ? "moderada" : "acompanhamento",
    metrics: { meaning: "prioridade_de_abordagem", source: sinal.fonte.nome, date: sinal.data },
    evidence: { sources: [sinal.fonte.nome], metrics: { data: sinal.data, produtos: avaliado.produtos } },
  }], ator)?.[0];
  if (!gravada?.id) {
    const erro = new Error("A oportunidade não foi gravada.");
    erro.status = 500;
    throw erro;
  }
  estado.oportunidades[id] = { id: gravada.id, em: new Date().toISOString(), usuario: ator.id || null };
  estado.historico.push({ em: estado.oportunidades[id].em, usuario: ator.id || null, tipo: "oportunidade", id });
  gravar(estado);
  return { oportunidadeId: gravada.id, repetida: false, enviada: false };
}
