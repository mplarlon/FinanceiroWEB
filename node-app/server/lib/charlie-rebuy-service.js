import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { saveTask } from "./charlie-task-store.js";
import { upsertOpportunities } from "./charlie-commercial-store.js";
import { montarRecompra, oportunidadeDeRecompra } from "./charlie-rebuy.js";

const FILE = "charlie_rebuy.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { oportunidades: memoria.oportunidades || {}, tarefas: memoria.tarefas || {}, historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { oportunidades: {}, tarefas: {}, historico: [] });
  return { oportunidades: salvo.oportunidades || {}, tarefas: salvo.tarefas || {}, historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = {
    oportunidades: estado.oportunidades || {},
    tarefas: estado.tarefas || {},
    historico: (estado.historico || []).slice(-400),
  };
  if (memoria) {
    memoria.oportunidades = enxuto.oportunidades;
    memoria.tarefas = enxuto.tarefas;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function inteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, numero));
}

function exigirGestor(ator) {
  if (!ator?.gerencial) {
    const erro = new Error("Só um usuário gerencial cria oportunidade ou tarefa de recompra.");
    erro.status = 403;
    throw erro;
  }
}

async function consultar(query, sql, params) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export async function lerVendas(deps = {}, opcoes = {}, ator = {}) {
  const historico = inteiro(opcoes.historicoDias, 365, 180, 1095);
  const params = [-historico];
  const filtros = [];
  if (Number(ator.company) > 0) {
    filtros.push("se.IDEMPRESA=?");
    params.push(Number(ator.company));
  }
  if (Number(ator.branch) > 0) {
    filtros.push("se.IDFILIAL=?");
    params.push(Number(ator.branch));
  }
  const rows = await consultar(deps.query, `SELECT FIRST 10000 se.NRPEDIDO PEDIDO, se.DTSAIDA DATA, se.CDCLIENTE,
    COALESCE(c.CLIENTE, se.CLIENTE) CLIENTE, c.CDVENDEDOR, COALESCE(v.VENDEDOR, 'Sem vendedor') VENDEDOR,
    sp.CDPRODUTO, COALESCE(p.PRODUTO, sp.DESCRICAO, 'Produto') PRODUTO, sp.QTDPRODUTO,
    COALESCE(sp.SUBTOTAL, sp.TOTAL, CASE WHEN sp.QTDPRODUTO IS NOT NULL AND sp.VLUNIT IS NOT NULL THEN sp.QTDPRODUTO * sp.VLUNIT END) RECEITA
    FROM SAIDAESTOQUE se
    JOIN SAIDAPRODUTO sp ON sp.NRPEDIDO=se.NRPEDIDO AND sp.IDEMPRESA=se.IDEMPRESA
    LEFT JOIN CLIENTE c ON c.CDCLIENTE=se.CDCLIENTE
    LEFT JOIN VENDEDOR v ON v.CDVENDEDOR=c.CDVENDEDOR
    LEFT JOIN PRODUTO p ON p.CDPRODUTO=sp.CDPRODUTO
    WHERE se.DTSAIDA>=DATEADD(? DAY TO CURRENT_DATE)
      AND se.DTCANCELAMENTO IS NULL
      AND COALESCE(se.STATUS, 0) IN (1, 3)
      AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
      AND COALESCE(sp.STATUSSE, 0)=0
      ${filtros.length ? `AND ${filtros.join(" AND ")}` : ""}
    ORDER BY se.DTSAIDA`, params);
  if (!rows) return null;
  return {
    linhas: rows.map((row) => ({
      pedido: row.PEDIDO,
      data: row.DATA,
      clienteId: row.CDCLIENTE,
      cliente: row.CLIENTE,
      vendedorId: row.CDVENDEDOR,
      vendedor: row.VENDEDOR,
      produtoId: row.CDPRODUTO,
      produto: row.PRODUTO,
      quantidade: row.QTDPRODUTO,
      valor: row.RECEITA,
    })),
    truncado: rows.length === 10000,
    historico,
  };
}

export async function painelRecompra(deps = {}, opcoes = {}, ator = {}) {
  const vendas = opcoes.linhas !== undefined
    ? { linhas: opcoes.linhas, truncado: false, historico: inteiro(opcoes.historicoDias, 365, 180, 1095) }
    : await lerVendas(deps, opcoes, ator);
  const painel = montarRecompra(vendas?.linhas ?? null, {
    hoje: opcoes.hoje,
    janelaDias: inteiro(opcoes.janelaDias, 7, 1, 30),
    truncado: vendas?.truncado,
  });
  const estado = ler();
  painel.historicoDias = vendas?.historico ?? null;
  painel.itens = painel.itens.map((item) => ({
    ...item,
    oportunidadeId: estado.oportunidades[item.id]?.id || null,
    tarefaId: estado.tarefas[item.id]?.id || null,
  }));
  return painel;
}

function acharItem(painel, id) {
  const item = painel.itens.find((atual) => atual.id === id);
  if (!item) {
    const erro = new Error("Este cliente e produto não estão na janela de recompra.");
    erro.status = 404;
    throw erro;
  }
  return item;
}

export async function criarOportunidade(id, ator, deps = {}, opcoes = {}) {
  exigirGestor(ator);
  const painel = await painelRecompra(deps, opcoes, ator);
  const item = acharItem(painel, id);
  const estado = ler();
  if (estado.oportunidades[id]) return { oportunidadeId: estado.oportunidades[id].id, repetida: true };
  const gravarOportunidade = deps.gravarOportunidade || upsertOpportunities;
  const gravada = gravarOportunidade([oportunidadeDeRecompra(item)], ator)?.[0];
  if (!gravada?.id) {
    const erro = new Error("A oportunidade não foi gravada.");
    erro.status = 500;
    throw erro;
  }
  estado.oportunidades[id] = { id: gravada.id, em: new Date().toISOString(), usuario: ator.id || null };
  estado.historico.push({ em: estado.oportunidades[id].em, usuario: ator.id || null, tipo: "oportunidade", id });
  gravar(estado);
  return { oportunidadeId: gravada.id, repetida: false };
}

export async function criarTarefa(id, ator, deps = {}, opcoes = {}) {
  exigirGestor(ator);
  const painel = await painelRecompra(deps, opcoes, ator);
  const item = acharItem(painel, id);
  const estado = ler();
  if (estado.tarefas[id]) return { tarefaId: estado.tarefas[id].id, repetida: true };
  const tarefa = saveTask({
    usuario: Number(ator.id || 0),
    status: "planejada",
    titulo: "Acompanhar recompra",
    acao: "comercial.recompra_acompanhamento",
    operacao: "Tarefa de recompra. Não gera pedido e não envia mensagem.",
    nivel: 1,
    resumo: `${item.cliente} · ${item.produto}. Intervalo mediano de ${item.intervalo} dias. Data pelo intervalo: ${item.prevista}. Vendedor do cadastro: ${item.vendedor}.`,
    confirmacaoNecessaria: false,
    podeConfirmar: false,
    podeCancelar: true,
    quantidade: 0,
    amostra: [{ cliente: item.cliente, produto: item.produto, prevista: item.prevista, vendedor: item.vendedor }],
    rebuyId: id,
  }, deps);
  estado.tarefas[id] = { id: tarefa.id, em: new Date().toISOString(), usuario: ator.id || null };
  estado.historico.push({ em: estado.tarefas[id].em, usuario: ator.id || null, tipo: "tarefa", id, tarefaId: tarefa.id });
  gravar(estado);
  return { tarefaId: tarefa.id, repetida: false };
}
