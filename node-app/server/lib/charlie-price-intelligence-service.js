import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { createEcommerceAction, ecommerceControl } from "./ecommerce-advanced.js";
import { avaliarProposta, painelPrecos, simularPreco, vendasDoProduto } from "./charlie-price-intelligence.js";

const FILE = "charlie_price_rules.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function lerRegras() {
  if (memoria) return { pisos: memoria.pisos || {}, canais: memoria.canais || {}, historico: Array.isArray(memoria.historico) ? memoria.historico : [] };
  const salvo = readJsonConfig(FILE, { pisos: {}, canais: {}, historico: [] });
  return { pisos: salvo.pisos || {}, canais: salvo.canais || {}, historico: Array.isArray(salvo.historico) ? salvo.historico : [] };
}

function gravarRegras(regras) {
  const enxuto = { pisos: regras.pisos || {}, canais: regras.canais || {}, historico: (regras.historico || []).slice(-100) };
  if (memoria) {
    memoria.pisos = enxuto.pisos;
    memoria.canais = enxuto.canais;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function registrarPreco(regras, tipo, referencia, de, para) {
  regras.historico = [...(regras.historico || []), { em: new Date().toISOString(), tipo, id: String(referencia), de: de ?? null, para: para ?? null, usuario: null }].slice(-100);
}

export function regrasAtuais(control = ecommerceControl()) {
  const salvas = lerRegras();
  return {
    mode: control.settings?.mode || "analysis",
    minimumMargin: control.settings?.minimumMargin ?? 15,
    maximumAutomaticChange: control.settings?.maximumAutomaticChange ?? 5,
    protegidos: control.settings?.protectedProducts || [],
    pisos: salvas.pisos,
    canais: salvas.canais,
  };
}

export function montarPainel(store = readEcommerceStore(), control = ecommerceControl()) {
  const regras = regrasAtuais(control);
  return { mode: regras.mode, minimumMargin: regras.minimumMargin, maximumAutomaticChange: regras.maximumAutomaticChange, produtos: painelPrecos(store, regras), componentes: "Imposto, comissão, taxa e frete continuam de fora até serem conciliados." };
}

export function simular(productId, pedido = {}, store = readEcommerceStore(), control = ecommerceControl()) {
  const produto = store.products?.[productId];
  if (!produto) throw Object.assign(new Error("Produto não encontrado na loja sincronizada."), { status: 404 });
  const regras = regrasAtuais(control);
  const simulacao = simularPreco({ id: productId, nome: produto.name, preco: produto.price, custo: produto.cost }, pedido, regras);
  return { simulacao, decisao: avaliarProposta(simulacao, regras.mode), canais: vendasDoProduto(store, productId) };
}

export function definirPiso(productId, preco, store = readEcommerceStore()) {
  if (!store.products?.[productId]) throw Object.assign(new Error("Produto não encontrado na loja sincronizada."), { status: 404 });
  const valor = Number(preco);
  if (!Number.isFinite(valor) || valor < 0) throw Object.assign(new Error("Informe um preço mínimo igual ou maior que zero."), { status: 400 });
  const regras = lerRegras();
  const anterior = regras.pisos[productId] ?? null;
  regras.pisos[productId] = Math.round(valor * 100) / 100;
  registrarPreco(regras, "piso", productId, anterior, regras.pisos[productId]);
  gravarRegras(regras);
  return regras.pisos[productId];
}

export function definirCanal(canal, margem, store = readEcommerceStore()) {
  const nome = String(canal || "").trim();
  const conhecidos = new Set(Object.values(store.orders || {}).map((order) => order.marketplace || "Loja virtual Tray"));
  if (!nome || !conhecidos.has(nome)) throw Object.assign(new Error("Esse canal não aparece nos pedidos sincronizados."), { status: 400 });
  const valor = Number(margem);
  if (!Number.isFinite(valor) || valor < 0 || valor >= 100) throw Object.assign(new Error("A margem do canal precisa ficar entre 0 e 100."), { status: 400 });
  const regras = lerRegras();
  const anterior = regras.canais[nome] ?? null;
  regras.canais[nome] = Math.round(valor * 10) / 10;
  registrarPreco(regras, "canal", nome, anterior, regras.canais[nome]);
  gravarRegras(regras);
  return regras.canais[nome];
}

export function propor(productId, pedido, ator, store = readEcommerceStore(), control = ecommerceControl()) {
  const { simulacao, decisao } = simular(productId, pedido, store, control);
  if (!decisao.gravar) throw Object.assign(new Error(decisao.motivo), { status: 400 });
  const criada = createEcommerceAction({
    type: "price",
    productId,
    description: `Simulação de preço de ${simulacao.nome}: ${simulacao.preco} para ${simulacao.proposto}.`,
    previousValue: simulacao.preco,
    newValue: simulacao.proposto,
    justification: decisao.motivo,
    idempotencyKey: `price:${productId}:${simulacao.proposto}`,
  }, ator);
  return { simulacao, decisao, acao: criada.action, duplicada: criada.duplicate };
}
