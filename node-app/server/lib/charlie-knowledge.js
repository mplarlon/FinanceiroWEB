import { readJsonConfig, writeJsonConfig } from "./json-config.js";

const FILE = "charlie-knowledge.json";
const empty = () => ({ exemplos: [], relacionamentos: [] });

// Regras tiradas das consultas já usadas pelo ERP e das colunas reais do schema.
const RULES = [
  {
    id: "titulo-aberto",
    temas: ["pagar", "receber", "titulo", "venc", "inadimpl", "atras"],
    tabelas: ["CTAPAGAR", "CTARECEBER", "FORNECEDOR", "CLIENTE"],
    texto: "Título em aberto: STATUS=1. Vencido: STATUS=1 e DTVENC menor que CURRENT_DATE. Quitado: STATUS=2. Contas a pagar ficam em CTAPAGAR (CDFORNECEDOR, FORNECEDOR). Contas a receber ficam em CTARECEBER (CDCLIENTE, CLIENTE). Valor em aberto de receber: COALESCE(VALOR,DIVIDA,0). Valor em aberto de pagar: COALESCE(VALOR,TOTAL,0). Parcela é a coluna PARCELA. Não deduzir a situação só pelo nome de um campo.",
  },
  {
    id: "venda-efetiva",
    temas: ["venda", "vendas", "fatur", "pedido", "vendedor"],
    tabelas: ["SAIDAESTOQUE", "SAIDAPRODUTO", "CLIENTE", "VENDEDOR", "PRODUTO"],
    texto: "Venda efetiva: SAIDAESTOQUE.DTCANCELAMENTO IS NULL e SAIDAPRODUTO com COALESCE(STATUSSE,0)=0. Data: SAIDAESTOQUE.DTSAIDA. Valor do item: COALESCE(SAIDAPRODUTO.SUBTOTAL,SAIDAPRODUTO.TOTAL,SAIDAPRODUTO.QTDPRODUTO*SAIDAPRODUTO.VLUNIT,0). Vendedor: SAIDAESTOQUE.CDVENDEDOR = VENDEDOR.CDVENDEDOR. Cliente: SAIDAESTOQUE.CDCLIENTE = CLIENTE.CDCLIENTE. Itens ligam por NRPEDIDO e IDEMPRESA.",
  },
  {
    id: "nota-fiscal",
    temas: ["nota", "fiscal", "nfe", "emitid"],
    tabelas: ["NOTAFISCAL"],
    texto: "A emissão da nota está em NOTAFISCAL.DTEMISS. Não existe DTEMISSAO nessa tabela. Nota cancelada: COALESCE(NFE_CANCELADA,0) diferente de zero. Devolução: DEVOLUCAO. Valor: COALESCE(VLTOTAL,VALOR,0). Cliente: CDCLIENTE. Pedido: NRPEDIDO.",
  },
  {
    id: "estoque",
    temas: ["estoque", "produto", "ruptura", "margem"],
    tabelas: ["PRODUTO", "MOVIMENTO", "PRODUTOPRECO"],
    texto: "Estoque disponível é a soma de MOVIMENTO.QTDEATUAL por CDPRODUTO. Sem estoque: QTDEATUAL<=0. Estoque baixo: QTDEATUAL<=QTDEMINIMA e QTDEMINIMA>0. Produto ativo: COALESCE(PRODUTO.INATIVO,0)=0. Custo médio do cadastro: PRODUTO.VLCUSTOMEDIO. Custo do preço: PRODUTOPRECO.VLCUSTO. Preço de venda: PRODUTOPRECO.PRECO. Não tratar esses três campos como se fossem o mesmo valor.",
  },
  {
    id: "compras",
    temas: ["compra", "fornecedor", "entrada"],
    tabelas: ["ORDEMCOMPRA", "ENTRESTOQUE", "ENTRPRODUTO", "FORNECEDOR"],
    texto: "Compras recebidas usam ENTRESTOQUE e ENTRPRODUTO, com DTCANCELAMENTO IS NULL na entrada. Fornecedor: CDFORNECEDOR = FORNECEDOR.CDFORNECEDOR. Ordem de compra em aberto não é entrada efetivada.",
  },
];

const HINTS = [
  {
    executar: false,
    pergunta: "quais notas fiscais foram emitidas ontem",
    sql: "SELECT FIRST 50 n.NRDOC, n.IDNF, CAST(n.DTEMISS AS DATE) AS EMISSAO, COALESCE(n.VLTOTAL,n.VALOR,0) AS TOTAL, n.CDCLIENTE FROM NOTAFISCAL n WHERE CAST(n.DTEMISS AS DATE) = DATEADD(-1 DAY TO CURRENT_DATE) AND COALESCE(n.NFE_CANCELADA,0)=0",
    tabelas: ["NOTAFISCAL"],
    explicacao: "Emissão é DTEMISS e nota cancelada é NFE_CANCELADA.",
  },
];

function read() {
  return readJsonConfig(FILE, empty());
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokens(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
}

function jaccard(left, right) {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

export function rulesForQuestion(question, tableNames = []) {
  const text = normalize(question);
  const selected = new Set(tableNames.map((name) => String(name).toUpperCase()));
  return RULES
    .map((rule) => ({
      ...rule,
      score: rule.temas.reduce((sum, theme) => sum + (text.includes(theme) ? 2 : 0), 0)
        + rule.tabelas.reduce((sum, table) => sum + (selected.has(table) ? 1 : 0), 0),
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

export function relationshipsFor(tableName) {
  const name = String(tableName || "").toUpperCase();
  return (read().relacionamentos || [])
    .filter((item) => item.validado && String(item.origem || "").toUpperCase() === name)
    .map((item) => ({
      column: String(item.coluna || "").toUpperCase(),
      table: String(item.destino || "").toUpperCase(),
      target: String(item.colunaDestino || item.coluna_destino || "").toUpperCase(),
    }))
    .filter((item) => item.column && item.table && item.target);
}

export function matchExample(question, { executableOnly = false } = {}) {
  const stored = (read().exemplos || []).map((item) => ({ ...item, executar: true }));
  const pool = executableOnly ? stored : [...stored, ...HINTS];
  const ranked = pool
    .map((item) => ({ ...item, score: jaccard(question, item.pergunta) }))
    .filter((item) => item.score >= (executableOnly ? 0.82 : 0.34))
    .sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}

export function listKnowledge() {
  const state = read();
  return {
    regras: RULES.map(({ id, temas, tabelas, texto }) => ({ id, temas, tabelas, texto })),
    exemplos: state.exemplos || [],
    relacionamentos: state.relacionamentos || [],
  };
}

export function saveValidatedKnowledge({ pergunta, sql, tabelas, explicacao, relacionamentos }) {
  const state = read();
  const example = {
    id: (state.exemplos?.length || 0) + 1,
    pergunta: String(pergunta || "").trim().slice(0, 500),
    sql,
    tabelas: [...new Set((tabelas || []).map((item) => String(item).toUpperCase()))],
    explicacao: String(explicacao || "").trim().slice(0, 800),
    validado: true,
    criadoEm: new Date().toISOString(),
  };
  if (!example.pergunta || !example.sql)
    throw Object.assign(new Error("Informe a pergunta e o SQL validado."), { status: 400 });
  state.exemplos = [...(state.exemplos || []), example].slice(-200);
  for (const item of relacionamentos || []) {
    const relation = {
      origem: String(item.origem || "").toUpperCase(),
      coluna: String(item.coluna || "").toUpperCase(),
      destino: String(item.destino || "").toUpperCase(),
      colunaDestino: String(item.colunaDestino || "").toUpperCase(),
      validado: true,
    };
    if (!relation.origem || !relation.coluna || !relation.destino || !relation.colunaDestino) continue;
    const exists = (state.relacionamentos || []).some((current) =>
      current.origem === relation.origem && current.coluna === relation.coluna && current.destino === relation.destino);
    if (!exists) state.relacionamentos = [...(state.relacionamentos || []), relation];
  }
  writeJsonConfig(FILE, state);
  return example;
}
