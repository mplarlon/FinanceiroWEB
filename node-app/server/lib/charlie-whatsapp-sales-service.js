import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./json-config.js";
import { extrairConsulta, montarResposta } from "./charlie-whatsapp-sales.js";

const FILE = "charlie_whatsapp_sales.json";
let memoria = null;
export function usarMemoriaDeTeste(estado) { memoria = estado; }

function ler() {
  if (memoria) return memoria;
  const estado = readJsonConfig(FILE, { itens: [] });
  if (!Array.isArray(estado.itens)) estado.itens = [];
  return estado;
}

function gravar(estado) {
  estado.itens = estado.itens.slice(-200);
  if (memoria) {
    memoria.itens = estado.itens;
    return estado;
  }
  return writeJsonConfig(FILE, estado);
}

function falha(mensagem, status = 400) {
  return Object.assign(new Error(mensagem), { status });
}

export async function buscarProdutos(query, consulta) {
  if (!query) return { disponivel: false, produtos: [] };
  const sqlBase = `
    SELECT FIRST 5 p.CDPRODUTO, p.PRODUTO, pp.PRECO,
      (SELECT SUM(m.QTDEATUAL) FROM MOVIMENTO m WHERE m.CDPRODUTO = p.CDPRODUTO) ESTOQUE
    FROM PRODUTO p
    LEFT JOIN PRODUTOPRECO pp ON pp.CDPRODUTO = p.CDPRODUTO
      AND pp.IDPRECO = COALESCE(p.IDPRECO, 1)
      AND pp.CDUNIDADE = COALESCE(NULLIF(TRIM(p.CDUNIDVENDA), ''), NULLIF(TRIM(p.CDUNIDADE), ''), 'UN')
    WHERE (p.INATIVO = 0 OR p.INATIVO IS NULL)`;
  let rows = [];
  if (consulta.codigo) {
    rows = await query(`${sqlBase} AND (UPPER(TRIM(p.CDPRODUTO)) = UPPER(?) OR UPPER(TRIM(COALESCE(p.CDPRODFABR, ''))) = UPPER(?) OR TRIM(COALESCE(p.CODIGOBARRA, '')) = ?)`, [consulta.codigo, consulta.codigo, consulta.codigo]);
  }
  if (!rows?.length && consulta.termos[0]) {
    rows = await query(`${sqlBase} AND p.PRODUTO CONTAINING ?`, [consulta.termos[0].slice(0, 40)]);
  }
  if (rows == null) return { disponivel: false, produtos: [] };
  return {
    disponivel: true,
    produtos: rows.map((row) => ({
      codigo: String(row.CDPRODUTO || "").trim(),
      nome: String(row.PRODUTO || "").trim(),
      preco: row.PRECO == null || row.PRECO === "" ? null : Number(row.PRECO),
      estoque: row.ESTOQUE == null || row.ESTOQUE === "" ? null : Number(row.ESTOQUE),
    })).filter((item) => item.codigo),
  };
}

export function listarConsultas() {
  return ler().itens.slice().reverse();
}

export async function registrarConsulta(mensagem, deps = {}) {
  const consulta = extrairConsulta(mensagem?.text || mensagem?.texto || "");
  if (!consulta) return { comercial: false };
  let busca = { disponivel: false, produtos: [] };
  try {
    busca = await buscarProdutos(deps.query, consulta);
  } catch {
    busca = { disponivel: false, produtos: [] };
  }
  const item = {
    id: crypto.randomUUID(),
    em: new Date().toISOString(),
    from: String(mensagem.from || "").replace(/\D/g, "").slice(0, 20),
    messageId: mensagem.id || null,
    texto: String(mensagem.text || mensagem.texto || "").slice(0, 500),
    consulta,
    produtos: busca.produtos,
    rascunho: montarResposta(busca.produtos, { disponivel: busca.disponivel }),
    status: "aguardando",
    aprovadoPor: null,
    enviadoEm: null,
  };
  const estado = ler();
  estado.itens.push(item);
  gravar(estado);
  return { comercial: true, item };
}

export async function decidirConsulta(id, decisao, ator, deps = {}) {
  if (!ator?.gerencial) throw falha("A aprovação do WhatsApp comercial exige permissão gerencial.", 403);
  const estado = ler();
  const item = estado.itens.find((atual) => atual.id === id);
  if (!item) throw falha("Consulta não encontrada.", 404);
  if (item.status !== "aguardando") throw falha("Essa consulta já foi decidida.");
  if (decisao === "rejeitar") {
    item.status = "rejeitado";
    item.aprovadoPor = ator.id ?? null;
    gravar(estado);
    return item;
  }
  if (decisao !== "aprovar") throw falha("Decisão inválida.");
  if (!deps.sendText) throw falha("O envio do WhatsApp não está disponível.", 503);
  await deps.sendText(item.from, item.rascunho);
  item.status = "enviado";
  item.aprovadoPor = ator.id ?? null;
  item.enviadoEm = new Date().toISOString();
  gravar(estado);
  return item;
}
