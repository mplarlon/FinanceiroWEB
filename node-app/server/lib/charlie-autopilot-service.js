import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { ecommerceControl, ecommerceResults } from "./ecommerce-advanced.js";
import { aplicarDecisao, montarCiclo } from "./charlie-autopilot.js";

const FILE = "charlie_autopilot.json";
const CAMPANHAS = "charlie_smart_campaigns.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { baixoAutomatico: Boolean(memoria.baixoAutomatico), itens: memoria.itens || [], historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { baixoAutomatico: false, itens: [], historico: [] });
  return { baixoAutomatico: Boolean(salvo.baixoAutomatico), itens: salvo.itens || [], historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = { baixoAutomatico: Boolean(estado.baixoAutomatico), itens: estado.itens || [], historico: (estado.historico || []).slice(-40) };
  if (memoria) {
    memoria.baixoAutomatico = enxuto.baixoAutomatico;
    memoria.itens = enxuto.itens;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function exigirGestor(ator) {
  if (!ator?.gerencial) {
    const erro = new Error("Só um usuário gerencial roda o Autopilot.");
    erro.status = 403;
    throw erro;
  }
}

function lerFontes(opcoes = {}) {
  if (opcoes.fontes) return opcoes.fontes;
  const controle = ecommerceControl();
  const campanhas = readJsonConfig(CAMPANHAS, { campanhas: {} });
  return {
    oportunidades: Object.values(controle.opportunities || {}),
    acoes: Object.values(controle.actions || {}),
    campanhas: Object.values(campanhas.campanhas || {}),
    resultados: ecommerceResults(controle),
  };
}

export function painelAutopilot(opcoes = {}) {
  const estado = ler();
  const ciclo = montarCiclo(lerFontes(opcoes), { baixoAutomatico: false });
  ciclo.baixoAutomatico = estado.baixoAutomatico;
  ciclo.historico = estado.historico;
  ciclo.executadas = estado.itens.filter((item) => item.etapa === "executada");
  ciclo.rejeitadas = estado.itens.filter((item) => item.etapa === "rejeitada");
  return ciclo;
}

export function rodarCiclo(ator, opcoes = {}) {
  exigirGestor(ator);
  const estado = ler();
  const ciclo = montarCiclo(lerFontes(opcoes), { baixoAutomatico: estado.baixoAutomatico });
  const em = new Date().toISOString();
  estado.itens = ciclo.propostas;
  estado.historico.push({ em, usuario: ator.id || null, propostas: ciclo.propostas.length, executadas: ciclo.executadas.length, bloqueadas: ciclo.propostas.filter((item) => item.etapa === "bloqueada").length });
  gravar(estado);
  return { ...ciclo, baixoAutomatico: estado.baixoAutomatico, historico: estado.historico };
}

export function decidirAutopilot(id, decisao, ator, opcoes = {}) {
  exigirGestor(ator);
  const estado = ler();
  const atual = estado.itens.find((item) => item.id === id) || montarCiclo(lerFontes(opcoes), { baixoAutomatico: false }).propostas.find((item) => item.id === id);
  const decidido = aplicarDecisao(atual, decisao, estado.baixoAutomatico);
  estado.itens = [...estado.itens.filter((item) => item.id !== id), decidido];
  estado.historico.push({ em: new Date().toISOString(), usuario: ator.id || null, tipo: decisao, id });
  gravar(estado);
  return decidido;
}

export function autorizarBaixoRisco(ligado, ator) {
  exigirGestor(ator);
  const estado = ler();
  estado.baixoAutomatico = Boolean(ligado);
  estado.historico.push({ em: new Date().toISOString(), usuario: ator.id || null, tipo: "baixo_risco", ligado: estado.baixoAutomatico });
  gravar(estado);
  return { baixoAutomatico: estado.baixoAutomatico };
}
