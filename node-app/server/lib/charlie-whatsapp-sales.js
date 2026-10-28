const PARADAS = new Set("preco valor estoque disponibilidade disponivel prazo produto codigo qual quanto voces voce tem esse essa para pelo pela unidade entrega cadastro consulta quanto custa".split(" "));

export function extrairConsulta(texto) {
  const original = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const normal = original.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!/\b(preco|valor|estoque|disponibilidade|disponivel|prazo|produto|codigo)\b/.test(normal)) return null;
  const codigo = original.match(/\b(?=[A-Za-z0-9./-]*\d)[A-Za-z0-9][A-Za-z0-9./-]{2,30}\b/)?.[0] || "";
  const termos = normal
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((parte) => parte.length >= 4 && !PARADAS.has(parte))
    .slice(0, 3);
  if (!codigo && !termos.length) return null;
  return { codigo, termos };
}

function moeda(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function montarResposta(produtos = [], { disponivel = true } = {}) {
  if (!disponivel) return "Não consegui consultar o ERP. Nada foi enviado e não há preço, estoque nem prazo nesta resposta.";
  if (!produtos.length) return "Não localizei esse item no cadastro do ERP. Por isso não informo preço, estoque nem prazo.";
  const linhas = produtos.slice(0, 5).map((produto) => {
    const preco = produto.preco == null ? "preço não cadastrado na tabela padrão do produto" : `preço de tabela ${moeda(produto.preco)}`;
    const estoque = produto.estoque == null ? "sem saldo de estoque registrado" : `estoque atual ${produto.estoque}`;
    return `${produto.codigo} — ${produto.nome}. ${preco}. ${estoque}. O prazo de entrega não está neste cadastro.`;
  });
  return `${linhas.join("\n")}\nEsta consulta não reserva o estoque.`;
}
