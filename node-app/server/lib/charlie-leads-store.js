import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "../config.js";
import { DEFAULT_PESOS } from "./charlie-leads-qualify.js";

export const FILE = "charlie-leads.json";
export const SCHEMA_VERSION = 1;

let diretorioTeste = null;
export function usarDiretorioDeTeste(diretorio) { diretorioTeste = diretorio; }
function arquivoLeads() { return path.join(diretorioTeste || dataDir, FILE); }

const agora = () => new Date().toISOString();

export function segmentosPadrao() {
  return [
    {
      id: "construcao-edificios",
      nome: "Construção de edifícios",
      cnaes: ["4120400"],
      termos: ["construtora", "construtoras", "construcao", "construção", "edificio", "edifício"],
      termosProduto: [],
    },
    {
      id: "instalacao-eletrica",
      nome: "Instalações elétricas",
      cnaes: ["4321500"],
      termos: ["eletrica", "elétrica", "material eletrico", "material elétrico"],
      termosProduto: [],
    },
    {
      id: "engenharia",
      nome: "Serviços de engenharia",
      cnaes: ["7112000"],
      termos: ["engenharia"],
      termosProduto: [],
    },
  ];
}

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    config: {
      ativa: false,
      apiKey: "",
      webhookToken: "",
      limiteDiario: 20,
      limiteMensal: 200,
      reservaMinima: 0,
      bloquearAoAtingir: true,
      alertaPercentual: 80,
      autorizarLote: false,
      autorizarAutomatico: false,
      consultasPagasAutorizadas: false,
      custoPorCredito: null,
      retencaoDias: 730,
      regioesAtendidas: [],
      exigirAprovacaoContato: true,
    },
    pesos: { ...DEFAULT_PESOS },
    segmentos: segmentosPadrao(),
    distribuicao: { modo: "manual", regras: [] },
    automacao: {
      ativa: false,
      hora: "07:00",
      diasSemana: [1, 2, 3, 4, 5],
      ufs: [],
      municipios: [],
      cnaes: [],
      limiteConsultas: 5,
      limiteLeads: 20,
      scoreMinimo: 50,
      distribuir: false,
      ultimaExecucao: null,
    },
    leads: [],
    pesquisas: [],
    execucoes: [],
    consumo: [],
    webhooks: [],
    fila: [],
    erros: [],
    auditoria: [],
    pendencias: [],
    lock: null,
    ultimoSaldo: null,
    ultimaConsulta: null,
    ultimaSincronizacao: null,
  };
}

function migrar(estado) {
  const base = emptyState();
  const atual = estado && typeof estado === "object" ? estado : {};
  return {
    ...base,
    ...atual,
    schemaVersion: SCHEMA_VERSION,
    config: { ...base.config, ...(atual.config || {}) },
    pesos: { ...base.pesos, ...(atual.pesos || {}) },
    segmentos: Array.isArray(atual.segmentos) && atual.segmentos.length ? atual.segmentos : base.segmentos,
    distribuicao: { ...base.distribuicao, ...(atual.distribuicao || {}) },
    automacao: { ...base.automacao, ...(atual.automacao || {}) },
    leads: Array.isArray(atual.leads) ? atual.leads : [],
    pesquisas: Array.isArray(atual.pesquisas) ? atual.pesquisas : [],
    execucoes: Array.isArray(atual.execucoes) ? atual.execucoes : [],
    consumo: Array.isArray(atual.consumo) ? atual.consumo : [],
    webhooks: Array.isArray(atual.webhooks) ? atual.webhooks : [],
    fila: Array.isArray(atual.fila) ? atual.fila : [],
    erros: Array.isArray(atual.erros) ? atual.erros : [],
    auditoria: Array.isArray(atual.auditoria) ? atual.auditoria : [],
    pendencias: Array.isArray(atual.pendencias) ? atual.pendencias : [],
  };
}

export function loadState() {
  try { return migrar(JSON.parse(fs.readFileSync(arquivoLeads(), "utf8"))); }
  catch { return migrar(emptyState()); }
}

export function saveState(estado) {
  estado.leads = estado.leads.slice(-5000);
  estado.pesquisas = estado.pesquisas.slice(-500);
  estado.consumo = estado.consumo.slice(-5000);
  estado.webhooks = estado.webhooks.slice(-1000);
  estado.fila = estado.fila.slice(-2000);
  estado.erros = estado.erros.slice(-200);
  estado.auditoria = estado.auditoria.slice(-2000);
  estado.execucoes = estado.execucoes.slice(-400);
  fs.mkdirSync(path.dirname(arquivoLeads()), { recursive: true });
  const temporario = `${arquivoLeads()}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, `${JSON.stringify(estado, null, 2)}\n`, "utf8");
  fs.renameSync(temporario, arquivoLeads());
  return estado;
}

let fila = Promise.resolve();
export function updateState(mutator) {
  const execucao = fila.then(async () => {
    const estado = loadState();
    const resultado = await mutator(estado);
    saveState(estado);
    return resultado;
  });
  fila = execucao.then(() => undefined, () => undefined);
  return execucao;
}

export function auditar(estado, usuarioId, acao, detalhe = {}) {
  estado.auditoria.push({
    id: crypto.randomUUID(),
    em: agora(),
    usuarioId: usuarioId ?? null,
    acao,
    detalhe,
  });
}

export function registrarErro(estado, operacao, error) {
  const mensagem = String(error?.message || "Falha na integração.")
    .replace(/api-key\s*[:=]\s*\S+/gi, "api-key [omitida]")
    .slice(0, 300);
  estado.erros.push({ id: crypto.randomUUID(), em: agora(), operacao, mensagem, status: error?.status || null });
}

export function configPublica(estado = loadState()) {
  const { apiKey, webhookToken, ...resto } = estado.config;
  return {
    ...resto,
    chaveConfigurada: Boolean(apiKey),
    chaveMascarada: apiKey ? `${String(apiKey).slice(0, 2)}********` : "",
    tokenWebhookConfigurado: Boolean(webhookToken),
    pesos: estado.pesos,
    segmentos: estado.segmentos,
    distribuicao: estado.distribuicao,
    automacao: { ...estado.automacao },
    ultimoSaldo: estado.ultimoSaldo,
    ultimaConsulta: estado.ultimaConsulta,
    ultimaSincronizacao: estado.ultimaSincronizacao,
    erros: estado.erros.slice(-20).reverse(),
    fila: resumoFila(estado),
  };
}

function resumoFila(estado) {
  const contagem = {};
  for (const item of estado.fila || []) {
    const chave = item.situacaoFila || "pendente";
    contagem[chave] = (contagem[chave] || 0) + 1;
  }
  return {
    contagem,
    recentes: (estado.fila || []).slice(-20).reverse().map((item) => ({
      id: item.id,
      em: item.em,
      cnpj: item.cnpj,
      razaoSocial: item.razaoSocial || null,
      situacao: item.situacao || null,
      situacaoFila: item.situacaoFila || "pendente",
    })),
  };
}

export function leadVisivel(lead, ator = {}) {
  if (ator.gerencial) return true;
  if (ator.vendedorId && Number(lead.vendedorId) === Number(ator.vendedorId)) return true;
  return false;
}

export function inicioDia(data = new Date()) {
  const copia = new Date(data);
  copia.setHours(0, 0, 0, 0);
  return copia.toISOString();
}

export function inicioMes(data = new Date()) {
  const copia = new Date(data);
  copia.setDate(1);
  copia.setHours(0, 0, 0, 0);
  return copia.toISOString();
}

export function consumoDesde(estado, inicio) {
  return estado.consumo.filter((item) => item.paga && item.status === "sucesso" && item.em >= inicio).length;
}
