export const LEAD_STATUS = [
  "NOVO",
  "QUALIFICADO",
  "ATRIBUIDO",
  "CONTATO_PENDENTE",
  "EM_CONTATO",
  "INTERESSADO",
  "ORCAMENTO",
  "NEGOCIACAO",
  "CONVERTIDO",
  "PERDIDO",
  "DESCARTADO",
];

export const DEFAULT_PESOS = {
  cnae: 25,
  local: 15,
  porte: 10,
  historico: 15,
  contato: 10,
  perfil: 15,
  capital: 10,
};

const PORTE_FATOR = { "01": 0.6, "03": 0.8, "05": 1 };

export function classificarPotencial(score) {
  if (score >= 80) return "POTENCIAL_ALTO";
  if (score >= 50) return "POTENCIAL_MEDIO";
  return "POTENCIAL_BAIXO";
}

export function rotuloPotencial(codigo) {
  if (codigo === "POTENCIAL_ALTO") return "POTENCIAL ALTO";
  if (codigo === "POTENCIAL_MEDIO") return "POTENCIAL MÉDIO";
  return "POTENCIAL BAIXO";
}

function peso(pesos, chave) {
  const valor = Number(pesos?.[chave]);
  if (!Number.isFinite(valor) || valor < 0) return DEFAULT_PESOS[chave];
  return Math.min(100, valor);
}

function fatorCapital(valor) {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  if (valor >= 1000000) return 1;
  if (valor >= 100000) return 0.7;
  return 0.4;
}

export function pontuarLead(empresa, contexto = {}, pesos = DEFAULT_PESOS) {
  const usados = Object.fromEntries(Object.keys(DEFAULT_PESOS).map((chave) => [chave, peso(pesos, chave)]));
  const criterios = [];
  const add = (id, fator, motivo) => {
    const base = usados[id];
    criterios.push({
      id,
      peso: base,
      fator,
      pontos: Math.round(base * fator),
      motivo,
    });
  };

  const cnaeConfirmado = empresa.cnae && contexto.cnaesConfigurados?.includes(empresa.cnae);
  const cnaeFiltrado = empresa.cnaeFiltro && contexto.cnaesConfigurados?.includes(empresa.cnaeFiltro);
  if (cnaeConfirmado) add("cnae", 1, "O retorno da API trouxe um CNAE presente na relação configurada. Isso não comprova intenção de compra.");
  else if (cnaeFiltrado) add("cnae", 0.5, "A pesquisa usou um CNAE configurado. O retorno não confirmou a atividade deste estabelecimento e não comprova intenção de compra.");
  else add("cnae", 0, "Não há CNAE confirmado para comparar com os segmentos configurados.");

  const ufs = (contexto.regioesAtendidas || []).map((item) => String(item).toUpperCase());
  if (!ufs.length) add("local", 0, "A região atendida ainda não foi configurada.");
  else if (empresa.uf && ufs.includes(String(empresa.uf).toUpperCase())) add("local", 1, "A UF informada pela fonte está na região atendida configurada.");
  else add("local", 0, "A UF não está na região atendida ou não veio na fonte.");

  const codigoPorte = String(empresa.porteCodigo || "");
  if (PORTE_FATOR[codigoPorte] != null) add("porte", PORTE_FATOR[codigoPorte], `Porte informado pela fonte: ${empresa.porte || codigoPorte}. Não indica faturamento nem número de funcionários.`);
  else add("porte", 0, "A fonte não informou o código de porte.");

  if (contexto.compradoresUf == null) add("historico", 0, "O histórico de vendas de empresas da mesma UF não foi consultado.");
  else if (contexto.compradoresUf > 0) add("historico", Math.min(1, contexto.compradoresUf / 20), `Há ${contexto.compradoresUf} cliente(s) com venda na mesma UF. Isso não significa histórico deste CNPJ.`);
  else add("historico", 0, "Não há vendas registradas de clientes da mesma UF.");

  if (empresa.telefone || empresa.email) add("contato", 1, "A fonte retornou telefone ou e-mail. O contato ainda depende de base legal e aprovação humana.");
  else add("contato", 0, "A fonte não retornou telefone nem e-mail.");

  if (contexto.clientesMesmaCidade == null) add("perfil", 0, "Não houve comparação com clientes da mesma cidade.");
  else if (contexto.clientesMesmaCidade > 0) add("perfil", Math.min(1, contexto.clientesMesmaCidade / 10), `Há ${contexto.clientesMesmaCidade} cliente(s) comprador(es) na mesma cidade. A semelhança é geográfica, não uma comprovação de perfil.`);
  else add("perfil", 0, "Não há clientes compradores na mesma cidade para comparar.");

  const fator = fatorCapital(empresa.capitalSocial);
  if (fator > 0) add("capital", fator, "Pontuação sobre o capital social declarado pela fonte. Não é faturamento nem estimativa de compra.");
  else add("capital", 0, "A fonte não informou capital social.");

  const maximo = Object.values(usados).reduce((soma, item) => soma + item, 0) || 1;
  const bruto = criterios.reduce((soma, item) => soma + item.pontos, 0);
  const score = Math.max(0, Math.min(100, Math.round((bruto * 100) / maximo)));
  return {
    score,
    classificacao: classificarPotencial(score),
    rotulo: rotuloPotencial(classificarPotencial(score)),
    criterios,
    reproduzivel: true,
  };
}

export function validarPesos(entrada = {}) {
  const proximo = { ...DEFAULT_PESOS };
  for (const chave of Object.keys(DEFAULT_PESOS)) {
    if (entrada[chave] == null || entrada[chave] === "") continue;
    const valor = Number(entrada[chave]);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100)
      throw Object.assign(new Error(`O peso de ${chave} deve ficar entre 0 e 100.`), { status: 400 });
    proximo[chave] = valor;
  }
  return proximo;
}
