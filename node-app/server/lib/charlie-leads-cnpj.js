const UFS = new Set("ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to".split(" "));
const SITUACOES = new Set(["ATIVA", "BAIXADA", "INAPTA", "NULA", "SUSPENSA"]);
const PORTES = new Set(["01", "03", "05"]);

export function textoLimpo(valor, maximo = 180) {
  return String(valor ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximo);
}

export function semAcento(valor) {
  return textoLimpo(valor, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function normalizeCnpj(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos : "";
}

const PESOS_CNPJ = [
  [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
];

export function validarCnpj(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base, pesos) => {
    const soma = base.split("").reduce((total, char, index) => total + Number(char) * pesos[index], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(cnpj.slice(0, 12), PESOS_CNPJ[0]) === Number(cnpj[12])
    && digito(cnpj.slice(0, 13), PESOS_CNPJ[1]) === Number(cnpj[13]);
}

function lista(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor == null || valor === "") return [];
  return String(valor).split(/[;,|]/);
}

function inteiro(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero)) return null;
  if (numero < minimo || numero > maximo) return null;
  return numero;
}

function cnae(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length === 7 ? digitos : "";
}

function dataIso(valor) {
  const texto = String(valor ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : "";
}

function digitosExatos(valor, tamanho, quantidade = 30) {
  return [...new Set(lista(valor).map((item) => String(item).replace(/\D/g, "")).filter((item) => item.length === tamanho))].slice(0, quantidade);
}

function regime(entrada, prefixo) {
  const optante = entrada[`${prefixo}Optante`] === true;
  const excluir = entrada[`${prefixo}Excluir`] === true;
  const inicio = dataIso(entrada[`${prefixo}ExclusaoInicio`]);
  const fim = dataIso(entrada[`${prefixo}ExclusaoFim`]);
  const objeto = {};
  if (optante && !excluir) objeto.optante = true;
  if (excluir && !optante) objeto.excluir_optante = true;
  if (inicio || fim) objeto.data_exclusao = { ...(inicio ? { inicio } : {}), ...(fim ? { fim } : {}) };
  return Object.keys(objeto).length ? objeto : null;
}

export function pesquisaCompleta(body) {
  const mais = body?.mais_filtros || {};
  return Boolean(mais.com_telefone || mais.com_email || mais.somente_fixo || mais.somente_celular || body?.ddd || body?.telefone);
}

export function buildPesquisaBody(entrada = {}) {
  const body = {};
  const erros = [];
  const uf = [...new Set(lista(entrada.uf).map((item) => semAcento(item).slice(0, 2)).filter((item) => UFS.has(item)))];
  if (uf.length) body.uf = uf;
  const municipio = [...new Set(lista(entrada.municipio || entrada.cidade).map((item) => semAcento(item)).filter(Boolean))].slice(0, 20);
  if (municipio.length) body.municipio = municipio;
  const principal = [...new Set(lista(entrada.codigo_atividade_principal || entrada.cnae).map(cnae).filter(Boolean))].slice(0, 30);
  if (principal.length) body.codigo_atividade_principal = principal;
  const secundaria = [...new Set(lista(entrada.codigo_atividade_secundaria || entrada.cnaeSecundario).map(cnae).filter(Boolean))].slice(0, 30);
  if (secundaria.length) body.codigo_atividade_secundaria = secundaria;
  if (entrada.incluirSecundaria === true) body.incluir_atividade_secundaria = true;
  const situacao = [...new Set(lista(entrada.situacao || entrada.situacao_cadastral).map((item) => textoLimpo(item, 20).toUpperCase()).filter((item) => SITUACOES.has(item)))];
  if (situacao.length) body.situacao_cadastral = situacao;
  if (entrada.matrizFilial === "MATRIZ" || entrada.matrizFilial === "FILIAL") body.matriz_filial = entrada.matrizFilial;
  const natureza = [...new Set(lista(entrada.naturezaJuridica || entrada.codigo_natureza_juridica).map((item) => String(item).replace(/\D/g, "")).filter((item) => item.length >= 3 && item.length <= 5))].slice(0, 30);
  if (natureza.length) body.codigo_natureza_juridica = natureza;
  const cnpjsInformados = lista(entrada.cnpj).filter((item) => String(item).trim());
  if (cnpjsInformados.length) {
    const cnpjs = [...new Set(cnpjsInformados.map(normalizeCnpj).filter((item) => validarCnpj(item)))].slice(0, 50);
    if (cnpjs.length) body.cnpj = cnpjs;
    else erros.push("Nenhum CNPJ informado é válido.");
  }
  const raiz = digitosExatos(entrada.cnpjRaiz || entrada.cnpj_raiz, 8);
  if (raiz.length) body.cnpj_raiz = raiz;
  const cep = digitosExatos(entrada.cep, 8);
  if (cep.length) body.cep = cep;
  const numero = [...new Set(lista(entrada.enderecoNumero || entrada.endereco_numero).map((item) => textoLimpo(item, 20)).filter(Boolean))].slice(0, 20);
  if (numero.length) body.endereco_numero = numero;
  const bairro = [...new Set(lista(entrada.bairro).map((item) => semAcento(item)).filter(Boolean))].slice(0, 20);
  if (bairro.length) body.bairro = bairro;
  const ddd = digitosExatos(entrada.ddd, 2);
  if (ddd.length) body.ddd = ddd;
  const telefone = [...new Set(lista(entrada.telefone).map((item) => String(item).replace(/\D/g, "")).filter((item) => item.length >= 8 && item.length <= 11))].slice(0, 20);
  if (telefone.length) body.telefone = telefone;
  const mei = regime(entrada, "mei");
  if (entrada.meiOptante === true && entrada.meiExcluir === true) erros.push("Escolha somente optante do MEI ou excluir optante.");
  else if (mei) body.mei = mei;
  const simples = regime(entrada, "simples");
  if (entrada.simplesOptante === true && entrada.simplesExcluir === true) erros.push("Escolha somente optante do Simples ou excluir optante.");
  else if (simples) body.simples = simples;
  const mais = {};
  if (entrada.comTelefone === true) mais.com_telefone = true;
  if (entrada.comEmail === true) mais.com_email = true;
  if (entrada.somenteMatriz === true) mais.somente_matriz = true;
  if (entrada.somenteFilial === true) mais.somente_filial = true;
  if (entrada.somenteFixo === true && entrada.somenteCelular === true) erros.push("Escolha somente telefone fixo ou somente celular.");
  else {
    if (entrada.somenteFixo === true) mais.somente_fixo = true;
    if (entrada.somenteCelular === true) mais.somente_celular = true;
  }
  if (entrada.excluirVisualizadas === true) mais.excluir_empresas_visualizadas = true;
  if (entrada.excluirEmailContabil === true) mais.excluir_email_contab = true;
  if (Object.keys(mais).length) body.mais_filtros = mais;
  const excluir = [...new Set(lista(entrada.excluirCnpj || entrada.excluir?.cnpj).map(normalizeCnpj).filter((item) => validarCnpj(item)))].slice(0, 50);
  if (excluir.length) body.excluir = { cnpj: excluir };
  const portes = [...new Set(lista(entrada.porte).map((item) => textoLimpo(item, 2)).filter((item) => PORTES.has(item)))];
  if (portes.length) body.porte_empresa = { codigos: portes };
  const minimo = inteiro(entrada.capitalMinimo, 0, 999999999999);
  const maximo = inteiro(entrada.capitalMaximo, 0, 999999999999);
  if (minimo != null || maximo != null) body.capital_social = { ...(minimo != null ? { minimo } : {}), ...(maximo != null ? { maximo } : {}) };
  const inicio = dataIso(entrada.aberturaInicio);
  const fim = dataIso(entrada.aberturaFim);
  const ultimos = inteiro(entrada.ultimosDias, 1, 3650);
  if (inicio || fim || ultimos) {
    body.data_abertura = {
      ...(inicio ? { inicio } : {}),
      ...(fim ? { fim } : {}),
      ...(ultimos ? { ultimos_dias: ultimos } : {}),
    };
  }
  const buscas = [];
  if (textoLimpo(entrada.razaoSocial, 80)) {
    buscas.push({ texto: [textoLimpo(entrada.razaoSocial, 80)], tipo_busca: "radical", razao_social: true, nome_fantasia: false, nome_socio: false });
  }
  if (textoLimpo(entrada.nomeFantasia, 80)) {
    buscas.push({ texto: [textoLimpo(entrada.nomeFantasia, 80)], tipo_busca: "radical", razao_social: false, nome_fantasia: true, nome_socio: false });
  }
  if (buscas.length) body.busca_textual = buscas;
  const limite = inteiro(entrada.limite, 1, 1000);
  const pagina = inteiro(entrada.pagina, 1, 100000);
  body.limite = limite || 10;
  body.pagina = pagina || 1;
  if (entrada.limite != null && entrada.limite !== "" && !limite) erros.push("O limite deve ser um inteiro de 1 a 1000.");
  if (entrada.pagina != null && entrada.pagina !== "" && !pagina) erros.push("A página deve ser um inteiro a partir de 1.");
  const filtros = Object.keys(body).filter((chave) => chave !== "limite" && chave !== "pagina");
  if (!filtros.length) erros.push("Informe ao menos um filtro aceito pela API.");
  return { body, erros };
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const listaValores = Array.isArray(valor) ? valor : [valor];
    for (const parte of listaValores) {
      if (typeof parte !== "string" && typeof parte !== "number") continue;
      const item = textoLimpo(parte, 120);
      if (item) return item;
    }
  }
  return null;
}

export function normalizarEmpresa(bruto, filtro = {}) {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const cnpj = normalizeCnpj(bruto.cnpj);
  const endereco = bruto.endereco && typeof bruto.endereco === "object" ? bruto.endereco : {};
  const situacao = bruto.situacao_cadastral;
  const porte = bruto.porte_empresa && typeof bruto.porte_empresa === "object" ? bruto.porte_empresa : null;
  const atividade = bruto.atividade_principal && typeof bruto.atividade_principal === "object" ? bruto.atividade_principal : null;
  const cnaeRetorno = cnae(bruto.cnae_fiscal || atividade?.codigo || "");
  return {
    cnpj,
    cnpjValido: Boolean(cnpj) && validarCnpj(cnpj),
    razaoSocial: textoLimpo(bruto.razao_social, 180) || null,
    nomeFantasia: textoLimpo(bruto.nome_fantasia, 180) || null,
    uf: textoLimpo(endereco.uf || bruto.uf, 2).toUpperCase() || null,
    municipio: textoLimpo(endereco.municipio || bruto.municipio, 80) || null,
    situacao: (typeof situacao === "string" ? textoLimpo(situacao, 20) : textoLimpo(situacao?.situacao_cadastral, 20)).toUpperCase() || null,
    matrizFilial: textoLimpo(bruto.matriz_filial, 10).toUpperCase() || null,
    porteCodigo: porte ? textoLimpo(porte.codigo, 2) || null : null,
    porte: porte ? textoLimpo(porte.descricao || porte.codigo, 40) || null : null,
    capitalSocial: Number.isFinite(Number(bruto.capital_social)) ? Number(bruto.capital_social) : null,
    dataAbertura: dataIso(bruto.data_abertura) || textoLimpo(bruto.data_abertura, 30) || null,
    telefone: primeiroTexto(bruto.telefone, bruto.telefones),
    email: primeiroTexto(bruto.email, bruto.correio_eletronico),
    cnae: cnaeRetorno || null,
    cnaeDescricao: textoLimpo(atividade?.descricao || bruto.cnae_fiscal_descricao, 160) || null,
    cnaeFiltro: cnae(filtro.cnae || filtro.codigo_atividade_principal?.[0] || "") || null,
    cnaeConfirmado: Boolean(cnaeRetorno),
    origem: "casa_dos_dados",
  };
}

export function empresaPublica(empresa) {
  if (!empresa) return null;
  const { cnpjValido, ...resto } = empresa;
  return { ...resto, cnpjValido };
}
