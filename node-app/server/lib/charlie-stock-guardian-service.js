import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { readEcommerceStore } from "./ecommerce-intelligence.js";
import { montarGuardian, validarAcao } from "./charlie-stock-guardian.js";

const FILE = "charlie_stock_guardian.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return { acoes: memoria.acoes || {}, historico: memoria.historico || [] };
  const salvo = readJsonConfig(FILE, { acoes: {}, historico: [] });
  return { acoes: salvo.acoes || {}, historico: salvo.historico || [] };
}

function gravar(estado) {
  const enxuto = { acoes: estado.acoes || {}, historico: (estado.historico || []).slice(-400) };
  if (memoria) {
    memoria.acoes = enxuto.acoes;
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

function quantidadeLida(row) {
  if (Number(row?.SEM_QTD) > 0) return null;
  if (row?.QTD == null || row.QTD === "") return null;
  const numero = Number(row.QTD);
  return Number.isFinite(numero) ? numero : null;
}

function exigirGestor(ator) {
  if (!ator?.gerencial) {
    const erro = new Error("Só um usuário gerencial registra ação de estoque.");
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

function empresa(ator, coluna) {
  if (Number(ator?.company) > 0) return { sql: ` AND ${coluna}=?`, params: [Number(ator.company)] };
  return { sql: "", params: [] };
}

export async function lerFatos(deps = {}, ator = {}) {
  const loja = empresa(ator, "d.IDEMPRESA");
  const venda = empresa(ator, "se.IDEMPRESA");
  const ordem = empresa(ator, "o.IDEMPRESA");
  const [produtos, vendas, pendentes, depositos] = await Promise.all([
    consultar(deps.query, `SELECT p.CDPRODUTO, p.PRODUTO, SUM(m.QTDEATUAL) SALDO, SUM(m.QTDEMINIMA) MINIMO, SUM(m.QTDEMAXIMA) MAXIMO, SUM(m.QTDESEGURANCA) SEGURANCA
      FROM PRODUTO p
      JOIN MOVIMENTO m ON m.CDPRODUTO=p.CDPRODUTO
      JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0
      WHERE COALESCE(p.INATIVO,0)=0${loja.sql}
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
    consultar(deps.query, `SELECT m.CDPRODUTO, m.CDDEPOSITO, d.DEPOSITO, SUM(m.QTDEATUAL) SALDO
      FROM MOVIMENTO m
      JOIN DEPOSITO d ON d.CDDEPOSITO=m.CDDEPOSITO AND COALESCE(d.INATIVO,0)=0
      WHERE 1=1${loja.sql}
      GROUP BY m.CDPRODUTO, m.CDDEPOSITO, d.DEPOSITO`, loja.params),
  ]);
  let tray = null;
  try {
    const store = deps.store ? deps.store() : readEcommerceStore();
    tray = trayDoStore(store);
  } catch {
    tray = null;
  }
  return {
    produtos: produtos?.map((row) => ({ id: row.CDPRODUTO, nome: row.PRODUTO, saldo: row.SALDO, minimo: row.MINIMO, maximo: row.MAXIMO, seguranca: row.SEGURANCA })) ?? null,
    vendas: vendas?.map((row) => ({ produtoId: row.CDPRODUTO, quantidade: quantidadeLida(row) })) ?? null,
    pendentes: pendentes?.map((row) => ({ produtoId: row.CDPRODUTO, quantidade: quantidadeLida(row) })) ?? null,
    depositos: depositos?.map((row) => ({ produtoId: row.CDPRODUTO, depositoId: row.CDDEPOSITO, deposito: row.DEPOSITO || String(row.CDDEPOSITO), saldo: row.SALDO })) ?? null,
    tray,
  };
}

function trayDoStore(store) {
  const porReferencia = new Map();
  for (const produto of Object.values(store?.products || {})) {
    const referencia = String(produto.reference || "").trim();
    if (!referencia) continue;
    porReferencia.set(referencia, { referencia, saldo: produto.stock ?? null, canais: [] });
  }
  for (const pedido of Object.values(store?.orders || {})) {
    if (/cancel/i.test(pedido.status || "")) continue;
    const canal = pedido.marketplace || "Loja virtual Tray";
    for (const item of pedido.items || []) {
      const referencia = String(item.reference || "").trim();
      if (!referencia || !porReferencia.has(referencia)) continue;
      const atual = porReferencia.get(referencia);
      const quantidade = item.quantity != null && Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null;
      const linha = atual.canais.find((canalItem) => canalItem.canal === canal);
      if (linha) linha.quantidade = linha.quantidade == null || quantidade == null ? null : linha.quantidade + quantidade;
      else atual.canais.push({ canal, quantidade });
    }
  }
  return [...porReferencia.values()];
}

export async function painelEstoque(deps = {}, opcoes = {}, ator = {}) {
  const fatos = opcoes.fatos || await lerFatos(deps, ator);
  const painel = montarGuardian(fatos, { janelaDias: inteiro(opcoes.janelaDias, 15, 7, 60) });
  const estado = ler();
  painel.itens = painel.itens.map((item) => ({ ...item, acoes: estado.acoes[item.id] || [] }));
  return painel;
}

export async function registrarAcao(id, tipo, ator, deps = {}, opcoes = {}) {
  exigirGestor(ator);
  const painel = await painelEstoque(deps, opcoes, ator);
  const item = painel.itens.find((atual) => atual.id === id);
  if (!item) {
    const erro = new Error("Este produto não está na lista de estoque.");
    erro.status = 404;
    throw erro;
  }
  validarAcao(item, tipo);
  const estado = ler();
  const atuais = estado.acoes[id] || [];
  if (atuais.some((acao) => acao.tipo === tipo)) return { repetida: true, saldo: item.saldo };
  const registro = {
    tipo,
    em: new Date().toISOString(),
    usuario: ator.id || null,
    saldo: item.saldo,
    texto: tipo === "compra" ? item.compra.motivo : tipo === "redistribuicao" ? item.redistribuicao.texto : tipo === "campanha" ? item.campanha.texto : item.situacoes.join(", "),
  };
  estado.acoes[id] = [...atuais, registro];
  estado.historico.push({ em: registro.em, usuario: registro.usuario, tipo, id });
  gravar(estado);
  return { repetida: false, saldo: item.saldo, registro };
}
