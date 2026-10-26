import {
  analisarLead,
  atribuirVendedor,
  consultarCnpj,
  consultarSaldo,
  criarLead,
  criarOportunidade,
  distribuirLeads,
  listarLeads,
  pesquisarEmpresas,
  relatorio,
  sugerirProdutos,
} from "./charlie-leads-service.js";
import { localizarCliente } from "./charlie-leads-erp.js";

function linhas(resumo, dados) {
  const lista = Array.isArray(dados) ? dados : dados ? [dados] : [];
  return { linhas: lista, quantidade: lista.length, resumo };
}

export const LEAD_RUNNERS = {
  "leads.buscar_empresas": async (deps, params) => linhas("Pesquisa de empresas.", (await pesquisarEmpresas(params, deps.actor, deps)).empresas),
  "leads.consultar_cnpj": async (deps, params) => linhas("Consulta de CNPJ.", await consultarCnpj(params.cnpj, deps.actor, deps)),
  "leads.verificar_saldo": async (deps) => linhas("Saldo da API.", await consultarSaldo(deps.actor, deps)),
  "leads.analisar_lead": async (deps, params) => linhas("Análise do lead.", await analisarLead(params.id, deps.actor, deps)),
  "leads.qualificar_lead": async (deps, params) => linhas("Qualificação do lead.", await analisarLead(params.id, deps.actor, deps)),
  "leads.verificar_cliente": async (deps, params) => linhas("Comparação com o cadastro.", await localizarCliente(deps.query, params.cnpj)),
  "leads.sugerir_produtos": async (deps, params) => linhas("Produtos do cadastro.", (await sugerirProdutos(params.id, deps.actor, deps)).produtos),
  "leads.criar_lead": async (deps, params) => linhas("Lead gravado.", (await criarLead(params, deps.actor, deps)).lead),
  "leads.atribuir_vendedor": async (deps, params) => linhas("Distribuição de leads.", await distribuirLeads(params, deps.actor)),
  "leads.criar_oportunidade": async (deps, params) => linhas("Oportunidade registrada.", await criarOportunidade(params.id, deps.actor)),
  "leads.historico_comercial": async (deps, params) => linhas("Histórico do lead.", listarLeads({}, deps.actor).find((item) => item.id === params.id) || null),
  "leads.relatorio_prospeccao": async (deps) => linhas("Relatório de prospecção.", relatorio({}, deps.actor)),
};
