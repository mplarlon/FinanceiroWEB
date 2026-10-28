import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { montarCompras } from "./charlie-smart-purchasing.js";

const FILE = "charlie_smart_purchasing.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { solicitacoes: memoria.solicitacoes || {}, emissaoAutorizada: Boolean(memoria.emissaoAutorizada), historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { solicitacoes: {}, emissaoAutorizada: false, historico: [] });
  return { solicitacoes: salvo.solicitacoes || {}, emissaoAutorizada: Boolean(salvo.emissaoAutorizada), historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = { solicitacoes: estado.solicitacoes || {}, emissaoAutorizada: Boolean(estado.emissaoAutorizada), historico: (estado.historico || []).slice(-400) };
  if (memoria) {
    memoria.solicitacoes = enxuto.solicitacoes;
    memoria.emissaoAutorizada = enxuto.emissaoAutorizada;
    memoria.historico = enxuto.historico;
    return enxuto;
  }
  return writeJsonConfig(FILE, enxuto);
}

function exigirGestor(ator) {
  if (!ator?.gerencial) {
    const erro = new Error("Só um usuário gerencial registra solicitação de compra.");
    erro.status = 403;
    throw erro;
  }
}

function inteiroJanela(valor) {
  const numero = Number(valor);
  return [7, 15, 30, 60].includes(numero) ? numero : 15;
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

function filtro(ator, coluna) {
  if (Number(ator?.company) > 0) return { sql: ` AND ${coluna}=?`, params: [Number(ator.company)] };
  return { sql: "", params: [] };
}

function numero(valor) {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function quantidadeLida(row) {
  if (Number(row?.SEM_QTD) > 0) return null;
  if (row?.QTD == null || row.QTD === "") return null;
  return numero(row.QTD);
}

function depositoMenor(linhas) {
  const saida = new Map();
  for (const linha of linhas || []) {
    const saldo = numero(linha.SALDO);
    if (saldo == null) continue;
    const id = String(linha.CDPRODUTO);
    const atual = saida.get(id);
    if (!atual || saldo < atual.saldo || (saldo === atual.saldo && Number(linha.CDDEPOSITO) < Number(atual.depositoId))) {
      saida.set(id, { depositoId: linha.CDDEPOSITO, empresaId: linha.IDEMPRESA, saldo });
    }
  }
  return saida;
}

export async function lerFatos(deps = {}, ator = {}) {
  const loja = filtro(ator, "d.IDEMPRESA");
  const venda = filtro(ator, "se.IDEMPRESA");
  const ordem = filtro(ator, "o.IDEMPRESA");
  const entrada = filtro(ator, "ee.IDEMPRESA");
  const [produtos, vendas, pendentes, depositos, entradas, qualidades] = await Promise.all([
    consultar(deps.query, `SELECT p.CDPRODUTO, p.PRODUTO, SUM(m.QTDEATUAL) SALDO, SUM(m.QTDEMINIMA) MINIMO
      FROM PRODUTO p
      JOIN MOVIMENTO m ON m.CDPRODUTO=p.CDPRODUTO
      JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0
      WHERE COALESCE(p.INATIVO,0)=0 AND (p.INATIVOCOMPRA=0 OR p.INATIVOCOMPRA IS NULL)${loja.sql}
      GROUP BY p.CDPRODUTO, p.PRODUTO`, loja.params),
    consultar(deps.query, `SELECT sp.CDPRODUTO, SUM(sp.QTDPRODUTO) QTD,
        SUM(CASE WHEN sp.QTDPRODUTO IS NULL THEN 1 ELSE 0 END) SEM_QTD
      FROM SAIDAPRODUTO sp
      JOIN SAIDAESTOQUE se ON se.NRPEDIDO=sp.NRPEDIDO AND se.IDEMPRESA=sp.IDEMPRESA
      WHERE se.DTSAIDA>=DATEADD(-90 DAY TO CURRENT_DATE)
        AND se.DTCANCELAMENTO IS NULL
        AND COALESCE(se.STATUS,0) IN (1,3)
        AND (se.STATUS_ORC IS NULL OR se.STATUS_ORC<>0)
        AND COALESCE(sp.STATUSSE,0)=0${venda.sql}
      GROUP BY sp.CDPRODUTO`, venda.params),
    consultar(deps.query, `SELECT op.CDPRODUTO,
        SUM(CASE WHEN op.QTDE IS NULL OR COALESCE(rec.SEM_QTD,0)>0 THEN 0 WHEN op.QTDE-COALESCE(rec.QTD_RECEBIDA,0)>0 THEN op.QTDE-COALESCE(rec.QTD_RECEBIDA,0) ELSE 0 END) QTD,
        SUM(CASE WHEN op.QTDE IS NULL OR COALESCE(rec.SEM_QTD,0)>0 THEN 1 ELSE 0 END) SEM_QTD
      FROM ORDEMCOMPRAPROD op
      JOIN ORDEMCOMPRA o ON o.CDORDEM=op.CDORDEM AND o.IDEMPRESA=op.IDEMPRESA
      LEFT JOIN (
        SELECT ee.CDORDEM, ep.IDEMPRESA, ep.CDPRODUTO, SUM(ep.QTDE) QTD_RECEBIDA,
          SUM(CASE WHEN ep.QTDE IS NULL THEN 1 ELSE 0 END) SEM_QTD
        FROM ENTRESTOQUE ee
        JOIN ENTRPRODUTO ep ON ep.IDENTRADA=ee.IDENTRADA AND ep.IDEMPRESA=ee.IDEMPRESA
        WHERE ee.CDORDEM IS NOT NULL AND ee.DTCANCELAMENTO IS NULL
        GROUP BY ee.CDORDEM, ep.IDEMPRESA, ep.CDPRODUTO
      ) rec ON rec.CDORDEM=op.CDORDEM AND rec.IDEMPRESA=op.IDEMPRESA AND rec.CDPRODUTO=op.CDPRODUTO
      WHERE o.STATUS=1${ordem.sql}
      GROUP BY op.CDPRODUTO`, ordem.params),
    consultar(deps.query, `SELECT m.CDPRODUTO, m.CDDEPOSITO, d.IDEMPRESA, SUM(m.QTDEATUAL) SALDO
      FROM MOVIMENTO m
      JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0
      WHERE 1=1${loja.sql}
      GROUP BY m.CDPRODUTO, m.CDDEPOSITO, d.IDEMPRESA`, loja.params),
    consultar(deps.query, `SELECT FIRST 8000 ep.CDPRODUTO, ep.CDFORNECEDOR, COALESCE(f.FORNECEDOR, f.FANTASIA) FORNECEDOR, ee.DTENTRADA, o.DATA DATA_PEDIDO, ep.VLCUSTO, ep.VLUNIT
      FROM ENTRESTOQUE ee
      JOIN ENTRPRODUTO ep ON ep.IDENTRADA=ee.IDENTRADA AND ep.IDEMPRESA=ee.IDEMPRESA
      LEFT JOIN FORNECEDOR f ON f.CDFORNECEDOR=ep.CDFORNECEDOR
      LEFT JOIN ORDEMCOMPRA o ON o.CDORDEM=ee.CDORDEM AND o.IDEMPRESA=ee.IDEMPRESA
      WHERE ee.DTCANCELAMENTO IS NULL AND ee.DTENTRADA>=DATEADD(-365 DAY TO CURRENT_DATE)${entrada.sql}
      ORDER BY ee.DTENTRADA DESC`, entrada.params),
    consultar(deps.query, "SELECT CDFORNECEDOR, INDICEQUALIDADE FROM AUDITORIA WHERE INDICEQUALIDADE IS NOT NULL", []),
  ]);
  const depositosPorProduto = depositoMenor(depositos);
  return {
    produtos: produtos?.map((row) => {
      const deposito = depositosPorProduto.get(String(row.CDPRODUTO));
      return { id: row.CDPRODUTO, nome: row.PRODUTO, saldo: row.SALDO, minimo: row.MINIMO, depositoId: deposito?.depositoId ?? null, empresaId: deposito?.empresaId ?? null };
    }) ?? null,
    vendas: vendas?.map((row) => ({ produtoId: row.CDPRODUTO, quantidade: quantidadeLida(row) })) ?? null,
    pendentes: pendentes?.map((row) => ({ produtoId: row.CDPRODUTO, quantidade: quantidadeLida(row) })) ?? null,
    entradas: entradas?.map((row) => ({ produtoId: row.CDPRODUTO, fornecedorId: row.CDFORNECEDOR, fornecedor: row.FORNECEDOR, entrada: row.DTENTRADA, pedido: row.DATA_PEDIDO, custo: row.VLCUSTO, preco: row.VLUNIT })) ?? null,
    qualidades: qualidades?.map((row) => ({ fornecedorId: row.CDFORNECEDOR, indice: row.INDICEQUALIDADE })) ?? null,
  };
}

function aplicar(painel, estado) {
  return {
    ...painel,
    emissaoAutorizada: estado.emissaoAutorizada,
    itens: painel.itens.map((item) => {
      const salva = estado.solicitacoes[item.id];
      return salva ? { ...item, solicitacaoId: salva.id, pedidoEmitido: Boolean(salva.pedidoEmitido) } : item;
    }),
  };
}

export async function painelCompras(deps = {}, ator = {}, opcoes = {}) {
  const fatos = opcoes.fatos || await lerFatos(deps, ator);
  const painel = montarCompras(fatos, { janelaDias: inteiroJanela(opcoes.janelaDias) });
  return aplicar(painel, ler());
}

function exigirItemCompleto(item) {
  if (String(item.produtoId).trim().length > 10 || item.fornecedorId == null || item.custoUnitario == null || item.depositoId == null || item.empresaId == null || !(item.quantidade > 0)) {
    const erro = new Error("A solicitação precisa de fornecedor, custo observado, depósito, empresa e quantidade. Nada foi gravado.");
    erro.status = 400;
    throw erro;
  }
}

export async function criarSolicitacao(id, ator, deps = {}, opcoes = {}) {
  exigirGestor(ator);
  const painel = await painelCompras(deps, ator, opcoes);
  const item = painel.itens.find((atual) => atual.id === id);
  if (!item) {
    const erro = new Error("Não há sugestão de compra para este produto.");
    erro.status = 404;
    throw erro;
  }
  const estado = ler();
  if (estado.solicitacoes[id]) return { solicitacaoId: estado.solicitacoes[id].id, repetida: true, pedidoEmitido: Boolean(estado.solicitacoes[id].pedidoEmitido) };
  exigirItemCompleto(item);
  if (!deps.gravarSolicitacao) {
    const erro = new Error("O módulo de compras não gravou a solicitação. Nada foi alterado no ERP.");
    erro.status = 503;
    throw erro;
  }
  const gravada = await deps.gravarSolicitacao(item, ator);
  if (!gravada?.id) {
    const erro = new Error("A solicitação não foi gravada.");
    erro.status = 500;
    throw erro;
  }
  estado.solicitacoes[id] = { id: gravada.id, em: new Date().toISOString(), usuario: ator.id || null, pedidoEmitido: false };
  estado.historico.push({ em: estado.solicitacoes[id].em, usuario: ator.id || null, tipo: "solicitacao", id });
  gravar(estado);
  return { solicitacaoId: gravada.id, repetida: false, pedidoEmitido: false };
}

export async function autorizarEmissao(pedido, ator) {
  exigirGestor(ator);
  const estado = ler();
  estado.emissaoAutorizada = Boolean(pedido?.autorizada);
  estado.historico.push({ em: new Date().toISOString(), usuario: ator.id || null, tipo: "autorizacao", autorizada: estado.emissaoAutorizada });
  gravar(estado);
  return { emissaoAutorizada: estado.emissaoAutorizada };
}

export async function emitirPedido(id, ator, deps = {}) {
  exigirGestor(ator);
  const estado = ler();
  const salva = estado.solicitacoes[id];
  if (!salva) {
    const erro = new Error("Grave a solicitação antes de emitir o pedido.");
    erro.status = 404;
    throw erro;
  }
  if (salva.pedidoEmitido) return { solicitacaoId: salva.id, repetida: true, pedidoEmitido: true };
  if (!estado.emissaoAutorizada) {
    const erro = new Error("A emissão de pedido definitivo não está autorizada.");
    erro.status = 403;
    throw erro;
  }
  if (!deps.emitirPedido) {
    const erro = new Error("O módulo de compras não emitiu o pedido. A solicitação continua como rascunho.");
    erro.status = 503;
    throw erro;
  }
  await deps.emitirPedido(salva.id, ator);
  salva.pedidoEmitido = true;
  estado.historico.push({ em: new Date().toISOString(), usuario: ator.id || null, tipo: "pedido", id });
  gravar(estado);
  return { solicitacaoId: salva.id, repetida: false, pedidoEmitido: true };
}
