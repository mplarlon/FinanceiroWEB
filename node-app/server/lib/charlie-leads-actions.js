const texto = (rotulo, extra = {}) => ({ tipo: "texto", rotulo, maximo: 80, ...extra });
const inteiro = (rotulo, extra = {}) => ({ tipo: "inteiro", rotulo, minimo: 1, maximo: 1000, ...extra });

export const LEAD_ACTIONS = [
  ["leads.buscar_empresas", "Buscar empresas", "Pesquisa estabelecimentos na Casa dos Dados quando a consulta paga está autorizada.", "buscar_empresas", {
    uf: texto("UF", { opcional: true, maximo: 2 }),
    municipio: texto("município", { opcional: true }),
    cnae: texto("CNAE", { opcional: true, maximo: 7 }),
    limite: inteiro("limite", { padrao: 10 }),
    pagina: inteiro("página", { padrao: 1 }),
    ultimosDias: inteiro("dias", { minimo: 1, maximo: 3650, opcional: true }),
  }],
  ["leads.consultar_cnpj", "Consultar CNPJ", "Consulta um CNPJ na Casa dos Dados.", "consultar_cnpj", { cnpj: texto("CNPJ", { obrigatorio: true, maximo: 18 }) }],
  ["leads.verificar_saldo", "Verificar saldo da API", "Consulta o saldo da Casa dos Dados.", "verificar_saldo_api", {}],
  ["leads.analisar_lead", "Analisar lead", "Explica a pontuação já calculada de um lead.", "analisar_lead", { id: texto("lead", { obrigatorio: true, maximo: 40 }) }],
  ["leads.qualificar_lead", "Qualificar lead", "Recalcula a leitura do lead com as regras determinísticas.", "qualificar_lead", { id: texto("lead", { obrigatorio: true, maximo: 40 }) }],
  ["leads.verificar_cliente", "Verificar cliente existente", "Localiza o CNPJ no cadastro do ERP.", "verificar_cliente_existente", { cnpj: texto("CNPJ", { obrigatorio: true, maximo: 18 }) }],
  ["leads.sugerir_produtos", "Sugerir produtos", "Busca produtos reais do ERP para o segmento configurado do lead.", "sugerir_produtos", { id: texto("lead", { obrigatorio: true, maximo: 40 }) }],
  ["leads.criar_lead", "Criar lead", "Grava um lead sem alterar o cadastro de clientes.", "criar_lead", { cnpj: texto("CNPJ", { obrigatorio: true, maximo: 18 }) }],
  ["leads.atribuir_vendedor", "Atribuir vendedor", "Distribui leads sem responsável segundo as regras configuradas.", "atribuir_vendedor", { quantidade: inteiro("quantidade", { padrao: 50, maximo: 500 }) }],
  ["leads.criar_oportunidade", "Criar oportunidade", "Registra uma oportunidade no ciclo do lead, sem gerar pedido.", "criar_oportunidade", { id: texto("lead", { obrigatorio: true, maximo: 40 }) }],
  ["leads.historico_comercial", "Consultar histórico comercial", "Lista o histórico guardado do lead.", "consultar_historico_comercial", { id: texto("lead", { obrigatorio: true, maximo: 40 }) }],
  ["leads.relatorio_prospeccao", "Gerar relatório de prospecção", "Calcula indicadores a partir dos leads e dos pedidos vinculados.", "gerar_relatorio_prospeccao", {}],
].map(([id, nome, descricao, servico, parametros]) => ({
  id, nome, descricao, modulo: "comercial",
  nivel: id.includes("criar") || id.includes("atribuir") ? 3 : 2,
  confirmacao: false,
  permissao: id.includes("criar") || id.includes("atribuir") ? "gerencial" : "consulta",
  habilitada: true,
  servico,
  auditoria: ["usuario", "parametros", "quantidade"],
  parametros,
}));
