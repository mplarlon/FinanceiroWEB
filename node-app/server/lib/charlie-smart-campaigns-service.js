import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { decidirRascunho, identificarCampanhas, publicarRascunho } from "./charlie-smart-campaigns.js";

const FILE = "charlie_smart_campaigns.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { campanhas: memoria.campanhas || {}, autorizada: Boolean(memoria.autorizada), historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { campanhas: {}, autorizada: false, historico: [] });
  return { campanhas: salvo.campanhas || {}, autorizada: Boolean(salvo.autorizada), historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = { campanhas: estado.campanhas || {}, autorizada: Boolean(estado.autorizada), historico: (estado.historico || []).slice(-400) };
  if (memoria) {
    memoria.campanhas = enxuto.campanhas;
    memoria.autorizada = enxuto.autorizada;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function exigirGestor(ator) {
  if (!ator?.gerencial) {
    const erro = new Error("Só um usuário gerencial decide campanha.");
    erro.status = 403;
    throw erro;
  }
}

export function painelCampanhas(store = readEcommerceStore(), opcoes = {}) {
  const estado = ler();
  const painel = identificarCampanhas(store, opcoes);
  const salvas = Object.values(estado.campanhas);
  return {
    ...painel,
    sugestoes: painel.sugestoes.filter((item) => !estado.campanhas[item.id]),
    campanhas: salvas,
    autorizada: estado.autorizada,
  };
}

export function criarCampanha(id, ator, store = readEcommerceStore(), opcoes = {}) {
  exigirGestor(ator);
  const estado = ler();
  if (estado.campanhas[id] && estado.campanhas[id].status !== "rejeitada") return { campanha: estado.campanhas[id], repetida: true };
  const sugestao = identificarCampanhas(store, opcoes).sugestoes.find((item) => item.id === id);
  if (!sugestao) {
    const erro = new Error("Sugestão de campanha não encontrada.");
    erro.status = 404;
    throw erro;
  }
  const campanha = { ...sugestao, status: "rascunho", publicada: false, criadaEm: new Date().toISOString(), usuario: ator.id || null };
  estado.campanhas[id] = campanha;
  estado.historico.push({ em: campanha.criadaEm, usuario: ator.id || null, tipo: "rascunho", id });
  gravar(estado);
  return { campanha, repetida: false };
}

export function decidirCampanha(id, decisao, ator) {
  exigirGestor(ator);
  const estado = ler();
  const campanha = decidirRascunho(estado.campanhas[id], decisao);
  campanha.decididaEm = new Date().toISOString();
  campanha.usuarioDecisao = ator.id || null;
  estado.campanhas[id] = campanha;
  estado.historico.push({ em: campanha.decididaEm, usuario: ator.id || null, tipo: decisao, id });
  gravar(estado);
  return campanha;
}

export function autorizarPublicacao(autorizada, ator) {
  exigirGestor(ator);
  const estado = ler();
  estado.autorizada = Boolean(autorizada);
  estado.historico.push({ em: new Date().toISOString(), usuario: ator.id || null, tipo: "autorizacao", autorizada: estado.autorizada });
  gravar(estado);
  return { autorizada: estado.autorizada };
}

export function publicarCampanha(id, ator) {
  exigirGestor(ator);
  const estado = ler();
  const campanha = publicarRascunho(estado.campanhas[id], estado.autorizada);
  campanha.publicadaEm = new Date().toISOString();
  estado.campanhas[id] = campanha;
  estado.historico.push({ em: campanha.publicadaEm, usuario: ator.id || null, tipo: "publicacao", id });
  gravar(estado);
  return campanha;
}
