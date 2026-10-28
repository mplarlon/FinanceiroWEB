import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { compararReferencia, validarConcorrente, validarConsulta } from "./charlie-competitor-radar.js";

const FILE = "charlie_competitor_radar.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { referencias: memoria.referencias || [], historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { referencias: [], historico: [] });
  return { referencias: salvo.referencias || [], historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = { referencias: estado.referencias || [], historico: (estado.historico || []).slice(-400) };
  if (memoria) {
    memoria.referencias = enxuto.referencias;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function produtoNosso(produto, modeloInformado) {
  return {
    id: String(produto.id),
    nome: produto.name || produto.reference || String(produto.id),
    marca: produto.brand || null,
    codigo: produto.reference || null,
    modelo: modeloInformado || null,
    preco: Number(produto.price) > 0 ? Number(produto.price) : null,
  };
}

function acharProduto(store, productId) {
  const produto = (store.products || []).find((item) => String(item.id) === String(productId));
  if (!produto) {
    const erro = new Error("Produto sincronizado não encontrado.");
    erro.status = 404;
    throw erro;
  }
  return produto;
}

export function montarRadar(store = readEcommerceStore()) {
  const estado = ler();
  const referencias = estado.referencias.map((referencia) => {
    const produto = (store.products || []).find((item) => String(item.id) === String(referencia.productId));
    const nosso = produto ? produtoNosso(produto, referencia.modeloNosso) : { id: referencia.productId, nome: referencia.nomeNosso || referencia.productId, marca: null, codigo: null, modelo: referencia.modeloNosso || null, preco: null };
    return { ...referencia, nosso, comparacao: compararReferencia(nosso, referencia), modeloOrigem: referencia.modeloNosso ? "informado no cadastro" : null };
  });
  return {
    aviso: "O Charlie não consulta a internet. Cada linha é uma observação cadastrada, com a fonte e a data informadas.",
    produtos: (store.products || []).map((produto) => ({
      id: String(produto.id),
      nome: produto.name || produto.reference || String(produto.id),
      marca: produto.brand || null,
      codigo: produto.reference || null,
      preco: Number(produto.price) > 0 ? Number(produto.price) : null,
    })),
    referencias,
    alertas: referencias.filter((item) => item.comparacao.alerta).map((item) => ({
      id: item.id,
      texto: item.comparacao.alerta,
      fonte: item.comparacao.fonte,
      consultadoEm: item.comparacao.consultadoEm,
      confianca: item.comparacao.confianca,
    })),
  };
}

export function cadastrarReferencia(pedido, ator, store = readEcommerceStore()) {
  const produto = acharProduto(store, pedido.productId);
  const fonteNome = String(pedido.fonte?.nome || pedido.fonte || "").trim();
  if (!fonteNome) {
    const erro = new Error("Informe a fonte da consulta.");
    erro.status = 400;
    throw erro;
  }
  const concorrente = validarConcorrente(pedido.concorrente || {});
  const consulta = validarConsulta(pedido.consulta || {});
  const modeloNosso = String(pedido.modeloNosso || "").trim() || null;
  const referencia = {
    id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    productId: String(produto.id),
    nomeNosso: produto.name || produto.reference || String(produto.id),
    modeloNosso,
    concorrente,
    fonte: { nome: fonteNome, url: String(pedido.fonte?.url || "").trim() || null },
    consulta,
    alteracao: null,
    criadaEm: new Date().toISOString(),
  };
  const estado = ler();
  estado.referencias.unshift(referencia);
  estado.historico.push({ em: referencia.criadaEm, usuario: ator?.idusuario || null, tipo: "cadastro", id: referencia.id });
  gravar(estado);
  return referencia;
}

export function registrarConsulta(id, pedido, ator, store = readEcommerceStore()) {
  const estado = ler();
  const referencia = estado.referencias.find((item) => item.id === id);
  if (!referencia) {
    const erro = new Error("Referência não encontrada.");
    erro.status = 404;
    throw erro;
  }
  acharProduto(store, referencia.productId);
  const consulta = validarConsulta(pedido || {});
  const anterior = referencia.consulta?.preco;
  referencia.alteracao = anterior != null && consulta.preco != null && anterior !== consulta.preco
    ? { de: anterior, para: consulta.preco, em: consulta.em }
    : referencia.alteracao;
  referencia.consulta = consulta;
  estado.historico.push({ em: new Date().toISOString(), usuario: ator?.idusuario || null, tipo: "consulta", id, de: anterior ?? null, para: consulta.preco });
  gravar(estado);
  return referencia;
}
