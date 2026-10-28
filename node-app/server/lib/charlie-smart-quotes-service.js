import crypto from "node:crypto";
import ExcelJS from "exceljs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import {
  classificarItem,
  confirmarOrcamento,
  definirQuantidade,
  escolherItem,
  interpretarTabela,
  interpretarTexto,
  resumirOrcamento,
  termoDeBusca,
} from "./charlie-smart-quotes.js";

const FILE = "charlie_smart_quotes.json";
const IMAGENS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return memoria;
  const estado = readJsonConfig(FILE, { orcamentos: [] });
  if (!Array.isArray(estado.orcamentos)) estado.orcamentos = [];
  return estado;
}

function gravar(estado) {
  estado.orcamentos = estado.orcamentos.slice(-100);
  if (memoria) {
    memoria.orcamentos = estado.orcamentos;
    return estado;
  }
  return writeJsonConfig(FILE, estado);
}

function extensao(nome) {
  return String(nome || "").split(".").pop().toLowerCase();
}

export async function lerArquivo(nome, conteudo) {
  const tipo = extensao(nome);
  if (IMAGENS.has(tipo)) {
    return { itens: [], aviso: "Imagem não é lida. Nenhum item foi inventado." };
  }
  const buffer = Buffer.from(String(conteudo || ""), "base64");
  if (!buffer.length) throw Object.assign(new Error("O arquivo chegou vazio."), { status: 400 });
  if (tipo === "xlsx") {
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(buffer);
    const planilha = livro.worksheets[0];
    const linhas = [];
    planilha?.eachRow((row) => linhas.push(row.values.slice(1)));
    return { itens: interpretarTabela(linhas), aviso: "" };
  }
  if (tipo === "pdf") {
    const lido = await pdfParse(buffer);
    return { itens: interpretarTexto(lido?.text || ""), aviso: lido?.text ? "" : "O PDF não trouxe texto. Nenhum item foi inventado." };
  }
  if (["csv", "txt", "tsv"].includes(tipo)) {
    const texto = buffer.toString("utf8");
    const tabela = interpretarTabela(texto.split(/\r?\n/).map((linha) => linha.split(/[;\t,]/)));
    return { itens: tabela.length ? tabela : interpretarTexto(texto), aviso: "" };
  }
  throw Object.assign(new Error("Use texto, CSV, XLSX ou PDF. Outros formatos não são lidos."), { status: 400 });
}

function mapear(row) {
  return {
    codigo: String(row.CDPRODUTO || "").trim(),
    nome: String(row.PRODUTO || "").trim(),
    preco: row.PRECO == null || row.PRECO === "" ? null : Number(row.PRECO),
    estoque: row.ESTOQUE == null || row.ESTOQUE === "" ? null : Number(row.ESTOQUE),
    unidade: String(row.UNIDADE || "").trim() || null,
  };
}

export async function consultarItem(query, pedido) {
  if (!query) return { disponivel: false, produtos: [] };
  const sql = `
    SELECT FIRST 8 p.CDPRODUTO, p.PRODUTO, pp.PRECO,
      COALESCE(NULLIF(TRIM(p.CDUNIDVENDA), ''), NULLIF(TRIM(p.CDUNIDADE), ''), 'UN') UNIDADE,
      (SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO = p.CDPRODUTO) ESTOQUE
    FROM PRODUTO p
    LEFT JOIN PRODUTOPRECO pp ON pp.CDPRODUTO = p.CDPRODUTO
      AND pp.IDPRECO = COALESCE(p.IDPRECO, 1)
      AND pp.CDUNIDADE = COALESCE(NULLIF(TRIM(p.CDUNIDVENDA), ''), NULLIF(TRIM(p.CDUNIDADE), ''), 'UN')
    WHERE (p.INATIVO = 0 OR p.INATIVO IS NULL)`;
  try {
    if (pedido.codigo) {
      const rows = await query(`${sql} AND (UPPER(TRIM(p.CDPRODUTO)) = UPPER(?) OR UPPER(TRIM(COALESCE(p.CDPRODFABR, ''))) = UPPER(?) OR TRIM(COALESCE(p.CODIGOBARRA, '')) = ?)`, [pedido.codigo, pedido.codigo, pedido.codigo]);
      if (rows == null) return { disponivel: false, produtos: [] };
      const produtos = rows.map(mapear).filter((item) => item.codigo);
      return { disponivel: true, exato: produtos[0] || null, produtos };
    }
    const termo = termoDeBusca(pedido.descricao);
    if (!termo) return { disponivel: true, produtos: [] };
    const rows = await query(`${sql} AND p.PRODUTO CONTAINING ?`, [termo]);
    if (rows == null) return { disponivel: false, produtos: [] };
    return { disponivel: true, produtos: rows.map(mapear).filter((item) => item.codigo) };
  } catch {
    return { disponivel: false, produtos: [] };
  }
}

async function montar(pedidos, deps, extra) {
  const itens = [];
  for (const pedido of pedidos) {
    const busca = await consultarItem(deps.query, pedido);
    itens.push(classificarItem(pedido, busca));
  }
  const resumo = resumirOrcamento(itens);
  const orcamento = {
    id: crypto.randomUUID(),
    em: new Date().toISOString(),
    origem: extra.origem || "texto",
    texto: String(extra.texto || "").slice(0, 4000),
    status: "rascunho",
    gravadoNoErp: false,
    motivo: "Rascunho ainda não confirmado. Nada foi gravado em ORCAMENTO.",
    ...resumo,
  };
  const estado = ler();
  estado.orcamentos.push(orcamento);
  gravar(estado);
  return orcamento;
}

export function listarOrcamentos() {
  return ler().orcamentos.slice().reverse();
}

export async function interpretarEntrada(entrada, deps = {}) {
  let pedidos = [];
  let aviso = "";
  if (entrada?.nome && entrada?.conteudo) {
    const arquivo = await lerArquivo(entrada.nome, entrada.conteudo);
    pedidos = arquivo.itens;
    aviso = arquivo.aviso;
  } else {
    pedidos = interpretarTexto(entrada?.texto || "");
  }
  if (!pedidos.length) {
    return { orcamento: null, aviso: aviso || "Nenhum item com produto e quantidade foi identificado. Nada foi inventado." };
  }
  const orcamento = await montar(pedidos, deps, { origem: entrada?.origem || (entrada?.nome ? extensao(entrada.nome) : "texto"), texto: entrada?.texto || entrada?.nome || "" });
  return { orcamento, aviso };
}

function exigir(id) {
  const estado = ler();
  const orcamento = estado.orcamentos.find((item) => item.id === id);
  if (!orcamento) throw Object.assign(new Error("Orçamento não encontrado."), { status: 404 });
  if (orcamento.status === "confirmado") throw Object.assign(new Error("Esse rascunho já foi confirmado."), { status: 400 });
  return { estado, orcamento };
}

export function escolherProduto(id, indice, codigo) {
  const { estado, orcamento } = exigir(id);
  const resumo = escolherItem(orcamento, Number(indice), codigo);
  Object.assign(orcamento, resumo);
  gravar(estado);
  return orcamento;
}

export function ajustarQuantidade(id, indice, quantidade) {
  const { estado, orcamento } = exigir(id);
  const resumo = definirQuantidade(orcamento, Number(indice), quantidade);
  Object.assign(orcamento, resumo);
  gravar(estado);
  return orcamento;
}

export function confirmar(id) {
  const { estado, orcamento } = exigir(id);
  const confirmado = confirmarOrcamento(orcamento);
  Object.assign(orcamento, confirmado, { confirmadoEm: new Date().toISOString() });
  gravar(estado);
  return orcamento;
}
