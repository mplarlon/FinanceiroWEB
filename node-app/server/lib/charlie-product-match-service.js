import { compararProdutos } from "./charlie-product-match.js";

function texto(valor) {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

async function consultar(query, sql, params = []) {
  if (!query) return null;
  try {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export async function lerCadastro(deps = {}) {
  const produtos = await consultar(deps.query, `SELECT FIRST 2000 p.CDPRODUTO, p.PRODUTO, p.MARCA, p.CDPRODFABR, p.PRODSIMILAR, p.COMPRIMENTO, p.LARGURA, p.ESPESSURA
    FROM PRODUTO p
    WHERE COALESCE(p.INATIVO, 0) = 0
      AND (NULLIF(TRIM(p.CDPRODFABR), '') IS NOT NULL OR NULLIF(TRIM(p.PRODSIMILAR), '') IS NOT NULL)
    ORDER BY p.CDPRODUTO`);
  const kits = await consultar(deps.query, "SELECT CDKIT, CDPRODUTO FROM PRODKIT");
  return {
    produtos: produtos?.map((row) => ({
      id: row.CDPRODUTO,
      nome: row.PRODUTO,
      marca: texto(row.MARCA),
      codigoFabricante: texto(row.CDPRODFABR),
      similar: texto(row.PRODSIMILAR),
      comprimento: row.COMPRIMENTO,
      largura: row.LARGURA,
      espessura: row.ESPESSURA,
    })) ?? null,
    kits: kits?.map((row) => ({ kit: row.CDKIT, produtoId: row.CDPRODUTO })) ?? null,
  };
}

export async function painelCorrespondencia(deps = {}, opcoes = {}) {
  const fatos = opcoes.produtos ? { produtos: opcoes.produtos, kits: opcoes.kits ?? null } : await lerCadastro(deps);
  if (fatos.produtos == null) {
    return { pares: [], lacunas: ["O cadastro de produtos não foi consultado."], aviso: "Nenhum par foi confirmado como equivalente só por nome parecido." };
  }
  const painel = compararProdutos(fatos.produtos, fatos.kits);
  const filtro = texto(opcoes.codigo);
  if (!filtro) return painel;
  const alvo = filtro.toUpperCase();
  return { ...painel, pares: painel.pares.filter((item) => item.origemId === alvo || item.destinoId === alvo || item.origemNome.toUpperCase().includes(alvo) || item.destinoNome.toUpperCase().includes(alvo)) };
}
