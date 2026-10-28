import { semAcento, textoLimpo } from "./charlie-leads-cnpj.js";

const PORTES = new Set(["01", "03", "05"]);
const SITUACOES = new Set(["ATIVA", "BAIXADA", "INAPTA", "NULA", "SUSPENSA"]);

function cnae(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length === 7 ? digitos : "";
}

function listaCnae(valor) {
  const bruto = Array.isArray(valor) ? valor : String(valor || "").split(/[;,|]/);
  return [...new Set(bruto.map(cnae).filter(Boolean))].slice(0, 30);
}

export function localizarSegmento(entrada = {}, segmentos = []) {
  const id = textoLimpo(entrada.segmentoId, 40);
  if (id) {
    const porId = segmentos.find((item) => item.id === id);
    if (porId) return porId;
  }
  const texto = semAcento(entrada.segmento || entrada.atividade || "");
  if (!texto) return null;
  return segmentos.find((item) => {
    const nome = semAcento(item.nome);
    if (nome && (nome === texto || texto.includes(nome) || nome.includes(texto))) return true;
    return (item.termos || []).some((termo) => {
      const normal = semAcento(termo);
      return normal && (texto === normal || texto.includes(normal));
    });
  }) || null;
}

export function planoDeCaca(entrada = {}, segmentos = []) {
  const segmento = localizarSegmento(entrada, segmentos);
  const cnaes = [...new Set([...listaCnae(entrada.cnae), ...(segmento?.cnaes || []).map(cnae)])];
  const uf = textoLimpo(entrada.uf, 2).toLowerCase();
  const municipio = textoLimpo(entrada.municipio, 80);
  const porte = textoLimpo(entrada.porte, 2);
  const situacao = textoLimpo(entrada.situacao, 20).toUpperCase();
  const erros = [];
  if (!cnaes.length && !uf && !municipio) erros.push("Informe segmento, CNAE, município ou UF.");
  if (porte && !PORTES.has(porte)) erros.push("O porte deve ser 01, 03 ou 05.");
  if (situacao && !SITUACOES.has(situacao)) erros.push("A situação cadastral não é aceita pela fonte.");
  const limite = Number(entrada.limite);
  return {
    segmento: segmento ? { id: segmento.id, nome: segmento.nome, cnaes: segmento.cnaes || [] } : null,
    erros,
    pesquisa: {
      uf: uf || undefined,
      municipio: municipio || undefined,
      codigo_atividade_principal: cnaes,
      situacao: situacao ? [situacao] : ["ATIVA"],
      porte: porte || undefined,
      limite: Number.isInteger(limite) && limite >= 1 && limite <= 20 ? limite : 10,
      pagina: 1,
      naoCadastradas: entrada.somenteNovos === true,
    },
  };
}

export function rascunhoAbordagem(empresa = {}) {
  const nome = textoLimpo(empresa.nomeFantasia || empresa.razaoSocial, 120) || "a empresa";
  const lugar = [textoLimpo(empresa.municipio, 80), textoLimpo(empresa.uf, 2).toUpperCase()].filter(Boolean).join("/");
  const atividade = textoLimpo(empresa.cnaeDescricao || empresa.segmentoNome, 160) || (empresa.cnae ? `CNAE ${empresa.cnae}` : "");
  const partes = [`Olá. Encontrei o cadastro de ${nome}`];
  if (lugar) partes.push(`em ${lugar}`);
  let texto = partes.join(" ");
  if (atividade) texto += `, com a atividade informada pela fonte: ${atividade}`;
  texto += ". Posso apresentar itens do nosso cadastro ligados a esse segmento, se isso fizer sentido para vocês.";
  return texto;
}

export function classificarCaca(empresas = [], { scoreMinimo = 0, segmento = null } = {}) {
  const minimo = Number.isFinite(Number(scoreMinimo)) ? Math.max(0, Math.min(100, Number(scoreMinimo))) : 0;
  return empresas.map((empresa) => {
    const duplicado = Boolean(empresa?.leadId);
    const cliente = empresa?.vinculo?.existe === true;
    const verificado = empresa?.vinculo?.verificado === true;
    const pontuacao = Number.isFinite(Number(empresa?.pontuacao)) ? Number(empresa.pontuacao) : null;
    let destino = "elegivel";
    if (duplicado) destino = "duplicado";
    else if (cliente) destino = "ja_cliente";
    else if (!verificado) destino = "cadastro_nao_verificado";
    else if (pontuacao == null || pontuacao < minimo) destino = "abaixo_da_priorizacao";
    return {
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial || null,
      nomeFantasia: empresa.nomeFantasia || null,
      uf: empresa.uf || null,
      municipio: empresa.municipio || null,
      cnae: empresa.cnae || null,
      cnaeDescricao: empresa.cnaeDescricao || null,
      cnaeFiltro: empresa.cnaeFiltro || null,
      cnaeConfirmado: empresa.cnaeConfirmado === true,
      porte: empresa.porte || null,
      porteCodigo: empresa.porteCodigo || null,
      situacao: empresa.situacao || null,
      telefone: empresa.telefone || null,
      email: empresa.email || null,
      capitalSocial: empresa.capitalSocial ?? null,
      pontuacao,
      classificacao: empresa.classificacao || null,
      rotulo: empresa.rotulo || null,
      criterios: empresa.criterios || [],
      leadId: empresa.leadId || null,
      clienteId: empresa.vinculo?.clienteId || null,
      destino,
      segmentoId: segmento?.id || null,
      segmentoNome: segmento?.nome || null,
      abordagem: rascunhoAbordagem({ ...empresa, segmentoNome: segmento?.nome }),
      aviso: "A pontuação ordena a prioridade comercial. Ela não é probabilidade de compra.",
    };
  });
}
