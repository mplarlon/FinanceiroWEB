import { LEAD_ACTIONS } from "./charlie-leads-actions.js";

export const TASK_STATUS = {
  PREPARANDO: "preparando",
  AGUARDANDO_INFORMACOES: "aguardando_informacoes",
  AGUARDANDO_CONFIRMACAO: "aguardando_confirmacao",
  EM_EXECUCAO: "em_execucao",
  CONCLUIDA: "concluida",
  CONCLUIDA_PARCIAL: "concluida_parcial",
  FALHOU: "falhou",
  CANCELADA: "cancelada",
};

const texto = (rotulo, extra = {}) => ({ tipo: "texto", rotulo, maximo: 80, ...extra });
const inteiro = (rotulo, extra = {}) => ({ tipo: "inteiro", rotulo, minimo: 1, maximo: 500, ...extra });

const BASE_ACTIONS = [
  {
    id: "financeiro.titulos_vencidos",
    nome: "Consultar títulos vencidos",
    descricao: "Lista títulos em aberto vencidos, com saldo conservador e dias de atraso.",
    modulo: "financeiro",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "consultarTitulos",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      dominio: { tipo: "enum", rotulo: "domínio", valores: ["receber", "pagar"], padrao: "receber" },
      dias: inteiro("dias de atraso", { minimo: 0, maximo: 3650, padrao: 1 }),
      comparacao: { tipo: "enum", rotulo: "comparação", valores: ["maior", "maior_ou_igual"], padrao: "maior_ou_igual" },
      limite: inteiro("limite", { padrao: 100 }),
      agrupar: { tipo: "enum", rotulo: "agrupamento", valores: ["nenhum", "vendedor", "fornecedor", "cliente"], padrao: "nenhum" },
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
      pessoa: texto("pessoa", { opcional: true }),
      clientes: { tipo: "inteiros", rotulo: "clientes", maximo: 150, opcional: true },
      incluirContatos: { tipo: "enum", rotulo: "incluir contatos", valores: ["nao", "sim"], padrao: "nao" },
    },
  },
  {
    id: "financeiro.titulos_a_vencer",
    nome: "Consultar títulos a vencer",
    descricao: "Lista títulos em aberto que vencem no horizonte informado.",
    modulo: "financeiro",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "consultarTitulos",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      dominio: { tipo: "enum", rotulo: "domínio", valores: ["receber", "pagar"], padrao: "receber" },
      dias: inteiro("horizonte em dias", { minimo: 1, maximo: 365, padrao: 7 }),
      limite: inteiro("limite", { padrao: 100 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
      pessoa: texto("pessoa", { opcional: true }),
    },
  },
  {
    id: "financeiro.preparar_cobrancas",
    nome: "Preparar cobranças",
    descricao: "Agrupa títulos vencidos por cliente e monta rascunhos. Não envia mensagens.",
    modulo: "financeiro",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "prepararCobrancas",
    auditoria: ["usuario", "parametros", "quantidade", "rascunhos"],
    parametros: {
      dominio: { tipo: "enum", rotulo: "domínio", valores: ["receber"], padrao: "receber" },
      dias: inteiro("dias de atraso", { minimo: 0, maximo: 3650, padrao: 1 }),
      comparacao: { tipo: "enum", rotulo: "comparação", valores: ["maior", "maior_ou_igual"], padrao: "maior_ou_igual" },
      limite: inteiro("limite de clientes", { padrao: 50 }),
      agrupar: { tipo: "enum", rotulo: "agrupamento", valores: ["cliente", "vendedor"], padrao: "cliente" },
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
      pessoa: texto("pessoa", { opcional: true }),
      clientes: { tipo: "inteiros", rotulo: "clientes", maximo: 150, opcional: true },
      alertaId: inteiro("alerta", { minimo: 1, maximo: 1000000, opcional: true }),
    },
  },
  {
    id: "comercial.clientes_inativos",
    nome: "Identificar clientes inativos",
    descricao: "Lista clientes ativos cuja última compra é anterior ao prazo informado.",
    modulo: "comercial",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "clientesInativos",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      dias: inteiro("dias sem compra", { minimo: 1, maximo: 3650, padrao: 60 }),
      limite: inteiro("limite", { padrao: 100 }),
      agrupar: { tipo: "enum", rotulo: "agrupamento", valores: ["nenhum", "vendedor"], padrao: "vendedor" },
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
    },
  },
  {
    id: "comercial.ranking_clientes",
    nome: "Ranking de clientes por vendedor",
    descricao: "Soma vendas válidas, sem cancelamentos, e organiza por vendedor.",
    modulo: "comercial",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "rankingClientes",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, opcional: true }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "ano", "mes"], padrao: "ano" },
      limite: inteiro("limite", { padrao: 100 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "comercial.rascunho_pedido",
    nome: "Preparar pedido em rascunho",
    descricao: "Organiza cliente e itens informados. Não grava pedido no ERP.",
    modulo: "comercial",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "rascunhoPedido",
    auditoria: ["usuario", "parametros"],
    parametros: {
      cliente: texto("cliente", { obrigatorio: true, maximo: 80 }),
      itens: texto("itens", { obrigatorio: true, maximo: 500 }),
    },
  },
  {
    id: "produtos.margem_insuficiente",
    nome: "Identificar margens insuficientes",
    descricao: "Consulta preços e custos da tabela e lista margens abaixo do limite.",
    modulo: "produtos",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "margemInsuficiente",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      tabela: inteiro("tabela de preços", { minimo: 1, maximo: 999, opcional: true }),
      margem: { tipo: "numero", rotulo: "margem máxima", minimo: 0, maximo: 100, obrigatorio: true },
      limite: inteiro("limite", { padrao: 100 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
    },
  },
  {
    id: "produtos.simular_reajuste",
    nome: "Simular reajuste de preços",
    descricao: "Calcula os novos preços sem gravar.",
    modulo: "produtos",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "simularReajuste",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      tabela: inteiro("tabela de preços", { minimo: 1, maximo: 999, obrigatorio: true }),
      percentual: { tipo: "numero", rotulo: "percentual", minimo: -50, maximo: 100, obrigatorio: true },
      margem: { tipo: "numero", rotulo: "margem máxima", minimo: 0, maximo: 100, opcional: true },
      limite: inteiro("limite", { maximo: 500, padrao: 500 }),
    },
  },
  {
    id: "produtos.reajuste_precos",
    nome: "Atualizar preços da tabela",
    descricao: "Prepara e, somente após confirmação explícita, atualiza PRODUTOPRECO.",
    modulo: "produtos",
    nivel: 3,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: true,
    servico: "aplicarReajuste",
    auditoria: ["usuario", "confirmacao", "anteriores", "novos", "servico"],
    parametros: {
      tabela: inteiro("tabela de preços", { minimo: 1, maximo: 999, obrigatorio: true }),
      percentual: { tipo: "numero", rotulo: "percentual", minimo: -50, maximo: 100, obrigatorio: true },
      limite: inteiro("limite", { maximo: 500, padrao: 500 }),
    },
  },
  {
    id: "cadastro.criar_cliente",
    nome: "Cadastrar cliente",
    descricao: "Valida, apresenta a prévia e cadastra um cliente pelo serviço interno do ERP.",
    modulo: "cadastro", nivel: 3, confirmacao: true, permissao: "gerencial", habilitada: true,
    servico: "clienteService.criar", auditoria: ["usuario", "confirmacao", "anteriores", "novos", "servico"],
    parametros: {
      nome: texto("nome", { obrigatorio: true, maximo: 100 }),
      documento: texto("CPF/CNPJ", { opcional: true, maximo: 18 }),
      email: texto("e-mail", { opcional: true, maximo: 250 }),
      telefone: texto("telefone", { opcional: true, maximo: 15 }),
      endereco: texto("endereço", { opcional: true, maximo: 150 }),
      cidade: texto("cidade", { opcional: true, maximo: 60 }),
      uf: texto("UF", { opcional: true, maximo: 2 }),
      cep: texto("CEP", { opcional: true, maximo: 10 }),
    },
  },
  {
    id: "cadastro.atualizar_cliente",
    nome: "Atualizar cadastro de cliente",
    descricao: "Altera um campo não sensível do cliente após prévia e confirmação.",
    modulo: "cadastro", nivel: 3, confirmacao: true, permissao: "gerencial", habilitada: true,
    servico: "clienteService.atualizar", auditoria: ["usuario", "confirmacao", "anteriores", "novos", "servico"],
    parametros: {
      cliente: texto("cliente", { obrigatorio: true, maximo: 100 }),
      campo: { tipo: "enum", rotulo: "campo", valores: ["telefone", "email", "endereco", "observacao"], obrigatorio: true },
      valor: texto("novo valor", { obrigatorio: true, maximo: 250 }),
    },
  },
  {
    id: "comercial.criar_pedido_rascunho",
    nome: "Criar pedido de venda em rascunho",
    descricao: "Valida cliente, produtos e preços e grava somente um pedido em rascunho.",
    modulo: "comercial", nivel: 3, confirmacao: true, permissao: "gerencial", habilitada: true,
    servico: "pedidoService.criarRascunho", auditoria: ["usuario", "confirmacao", "novos", "servico"],
    parametros: {
      cliente: texto("cliente", { obrigatorio: true, maximo: 100 }),
      itens: texto("itens", { obrigatorio: true, maximo: 500 }),
    },
  },
  {
    id: "estoque.abaixo_minimo",
    nome: "Consultar estoque abaixo do mínimo",
    descricao: "Lista produtos ativos com saldo igual ou inferior ao mínimo.",
    modulo: "estoque",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "estoqueBaixo",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      limite: inteiro("limite", { padrao: 100 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
      sugerir: { tipo: "enum", rotulo: "sugestão", valores: ["nao", "sim"], padrao: "nao" },
    },
  },
  {
    id: "estoque.sugestao_compra",
    nome: "Preparar sugestão de compra",
    descricao: "Calcula a quantidade para recompor o estoque mínimo. Não gera ordem de compra.",
    modulo: "estoque",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "sugestaoCompra",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      limite: inteiro("limite", { padrao: 100 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
    },
  },
  {
    id: "relatorios.faturamento_vendedor",
    nome: "Faturamento por vendedor",
    descricao: "Soma vendas não canceladas no período e separa por vendedor.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "faturamentoVendedor",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 6 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "meses" },
      limite: inteiro("limite", { padrao: 100, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "relatorios.faturamento_mensal",
    nome: "Comparar faturamento mensal",
    descricao: "Compara o faturamento mês a mês, desconsiderando cancelamentos.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "faturamentoMensal",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 2, maximo: 36, padrao: 6 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "meses" },
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "relatorios.produtos_sem_venda",
    nome: "Produtos sem venda",
    descricao: "Lista produtos ativos sem venda válida no período.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "produtosSemVenda",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      dias: inteiro("dias", { minimo: 1, maximo: 3650, padrao: 90 }),
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "auditoria.anomalias_comportamentais",
    nome: "Analisar riscos e anomalias",
    descricao: "Analisa incrementalmente eventos da auditoria e lista prioridades de investigação.",
    modulo: "auditoria", nivel: 1, confirmacao: false, permissao: "gerencial", habilitada: true,
    servico: "analisarRiscosComportamentais", auditoria: ["usuario", "parametros", "quantidade", "modelo"],
    parametros: { risco: { tipo: "enum", rotulo: "nível mínimo", valores: ["todos", "moderado", "elevado"], padrao: "todos" }, limite: inteiro("limite", { minimo: 1, maximo: 500, padrao: 100 }) },
  },
  {
    id: "auditoria.duplicidades_financeiras",
    nome: "Auditar possíveis duplicidades financeiras",
    descricao: "Compara títulos recentes e lista coincidências para investigação, sem alterar lançamentos.",
    modulo: "auditoria", nivel: 1, confirmacao: false, permissao: "gerencial", habilitada: true,
    servico: "auditarDuplicidadesFinanceiras", auditoria: ["usuario", "parametros", "quantidade"],
    parametros: { dias: inteiro("período em dias", { minimo: 1, maximo: 365, padrao: 90 }), limite: inteiro("limite", { minimo: 1, maximo: 1000, padrao: 500 }) },
  },
  {
    id: "preditivo.faturamento",
    nome: "Prever faturamento",
    descricao: "Projeta o faturamento futuro com backtesting e método auditável.",
    modulo: "preditivo", nivel: 1, confirmacao: false, permissao: "consulta", habilitada: true,
    servico: "preverFaturamento", auditoria: ["usuario", "parametros", "quantidade", "modelo"],
    parametros: { dias: inteiro("horizonte em dias", { minimo: 1, maximo: 366, padrao: 30 }) },
  },
  {
    id: "preditivo.fluxo_caixa",
    nome: "Projetar fluxo de caixa",
    descricao: "Projeta saldos por data sem alterar lançamentos.",
    modulo: "preditivo", nivel: 1, confirmacao: false, permissao: "consulta", habilitada: true,
    servico: "preverFluxoCaixa", auditoria: ["usuario", "parametros", "quantidade"],
    parametros: { dias: inteiro("horizonte em dias", { minimo: 1, maximo: 180, padrao: 30 }) },
  },
  {
    id: "preditivo.ruptura_estoque",
    nome: "Prever ruptura de estoque",
    descricao: "Estima cobertura e risco de falta sem gerar compra.",
    modulo: "preditivo", nivel: 1, confirmacao: false, permissao: "consulta", habilitada: true,
    servico: "preverRupturaEstoque", auditoria: ["usuario", "parametros", "quantidade"],
    parametros: { dias: inteiro("histórico em dias", { minimo: 30, maximo: 365, padrao: 90 }) },
  },
  {
    id: "relatorios.faturamento_periodo",
    nome: "Faturamento por período",
    descricao: "Soma vendas não canceladas no período informado.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "faturamentoPeriodo",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 6 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "meses" },
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "relatorios.faturamento_cliente",
    nome: "Faturamento por cliente",
    descricao: "Soma vendas não canceladas e separa por cliente.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "faturamentoCliente",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 6 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "meses" },
      limite: inteiro("limite", { padrao: 100, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "relatorios.produtos_vendidos",
    nome: "Ranking de produtos vendidos",
    descricao: "Lista os produtos mais ou menos vendidos, sem cancelamentos.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "produtosVendidos",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      ordem: { tipo: "enum", rotulo: "ordem", valores: ["mais", "menos"], padrao: "mais" },
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 6 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "meses" },
      limite: inteiro("limite", { padrao: 20, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "financeiro.inadimplencia",
    nome: "Inadimplência por cliente ou vendedor",
    descricao: "Soma títulos vencidos por cliente. Por vendedor, só quando o relacionamento existe.",
    modulo: "financeiro",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "inadimplencia",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      dominio: { tipo: "enum", rotulo: "domínio", valores: ["receber", "pagar"], padrao: "receber" },
      dias: inteiro("dias de atraso", { minimo: 0, maximo: 3650, padrao: 1 }),
      comparacao: { tipo: "enum", rotulo: "comparação", valores: ["maior", "maior_ou_igual"], padrao: "maior_ou_igual" },
      agrupar: { tipo: "enum", rotulo: "agrupamento", valores: ["cliente", "vendedor", "fornecedor"], padrao: "cliente" },
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "financeiro.recebimentos_periodo",
    nome: "Recebimentos por período",
    descricao: "Lista títulos a receber quitados no período.",
    modulo: "financeiro",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "recebimentosPeriodo",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 1 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "mes" },
      limite: inteiro("limite", { padrao: 500, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "financeiro.pagamentos_periodo",
    nome: "Pagamentos por período",
    descricao: "Lista títulos a pagar quitados no período.",
    modulo: "financeiro",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "pagamentosPeriodo",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 1 }),
      periodo: { tipo: "enum", rotulo: "período", valores: ["meses", "mes", "ano"], padrao: "mes" },
      limite: inteiro("limite", { padrao: 500, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "estoque.negativo",
    nome: "Estoque negativo",
    descricao: "Lista produtos ativos com saldo negativo.",
    modulo: "estoque",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "estoqueNegativo",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "estoque.sem_movimentacao",
    nome: "Produtos sem movimentação",
    descricao: "Lista produtos ativos com saldo e sem venda válida no período.",
    modulo: "estoque",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "semMovimentacao",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      dias: inteiro("dias sem movimentação", { minimo: 1, maximo: 3650, padrao: 90 }),
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "produtos.comparativo_precos",
    nome: "Comparativo de preços",
    descricao: "Compara preço e custo da tabela padrão, ou duas tabelas informadas.",
    modulo: "produtos",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "comparativoPrecos",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      tabela: inteiro("tabela de preços", { minimo: 1, maximo: 999, opcional: true }),
      tabelaComparar: inteiro("segunda tabela", { minimo: 1, maximo: 999, opcional: true }),
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "produtos.alteracao_custo",
    nome: "Alterações relevantes de custo",
    descricao: "Lista entradas recentes em que o custo variou acima do percentual informado.",
    modulo: "produtos",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "alteracaoCusto",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      percentual: { tipo: "numero", rotulo: "variação mínima", minimo: 0, maximo: 1000, padrao: 10 },
      dias: inteiro("dias", { minimo: 1, maximo: 3650, padrao: 30 }),
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "cadastro.rascunho_cliente",
    nome: "Preparar cadastro de cliente",
    descricao: "Organiza os dados informados em um rascunho. Não grava o cliente.",
    modulo: "cadastro",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "rascunhoCliente",
    auditoria: ["usuario", "parametros"],
    parametros: {
      nome: texto("nome", { obrigatorio: true, maximo: 100 }),
      documento: texto("documento", { opcional: true, maximo: 20 }),
      email: texto("e-mail", { opcional: true, maximo: 120 }),
      telefone: texto("telefone", { opcional: true, maximo: 40 }),
      cidade: texto("cidade", { opcional: true, maximo: 80 }),
    },
  },
  {
    id: "comercial.reducao_compras",
    nome: "Analisar redução de compras",
    descricao: "Compara períodos equivalentes e identifica clientes com redução relevante, organizados por vendedor.",
    modulo: "comercial",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "reducaoCompras",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses por período", { minimo: 1, maximo: 12, padrao: 3 }),
      percentual: { tipo: "numero", rotulo: "redução mínima", minimo: 0, maximo: 100, padrao: 10 },
      limite: inteiro("limite", { padrao: 200, maximo: 2000 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
    },
  },
  {
    id: "produtos.calcular_preco_margem",
    nome: "Calcular preço para margem alvo",
    descricao: "Calcula, sobre dados estruturados já consultados, o preço necessário para atingir a margem alvo. Não altera preços.",
    modulo: "produtos",
    nivel: 2,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "calcularPrecoMargem",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      margemAlvo: { tipo: "numero", rotulo: "margem alvo", minimo: 0.01, maximo: 99.99, obrigatorio: true },
    },
  },
  {
    id: "relatorios.dados_estruturados",
    nome: "Preparar relatório com dados estruturados",
    descricao: "Entrega ao mecanismo de relatórios existente os dados produzidos pelas etapas anteriores.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "consulta",
    habilitada: true,
    servico: "relatorioEstruturado",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      formato: { tipo: "enum", rotulo: "formato", valores: ["excel", "pdf", "csv"], padrao: "excel" },
      titulo: texto("título", { opcional: true, maximo: 100 }),
    },
  },
  {
    id: "relatorios.resultados_charlie",
    nome: "Relatório de resultados do Charlie",
    descricao: "Consolida benefícios por categoria sem misturar valores comprovados, estimados e associados.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "gerencial",
    habilitada: true,
    servico: "resultadosCharlie",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      meses: inteiro("meses", { minimo: 1, maximo: 36, padrao: 1 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "excel" },
    },
  },
  {
    id: "executivo.resumo",
    nome: "Resumo executivo",
    descricao: "Consolida indicadores já disponíveis do Charlie em um resumo executivo. Não altera dados.",
    modulo: "relatorios",
    nivel: 1,
    confirmacao: false,
    permissao: "gerencial",
    habilitada: true,
    servico: "resumoExecutivo",
    auditoria: ["usuario", "parametros", "quantidade"],
    parametros: {
      limite: inteiro("prioridades", { minimo: 1, maximo: 10, padrao: 3 }),
      formato: { tipo: "enum", rotulo: "formato", valores: ["nenhum", "excel", "pdf", "csv"], padrao: "nenhum" },
    },
  },
  {
    id: "financeiro.enviar_cobranca",
    nome: "Enviar cobranças",
    descricao: "Envio por canal oficial. Bloqueado até existir fluxo próprio de autorização.",
    modulo: "financeiro",
    nivel: 4,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: false,
    servico: null,
    auditoria: ["usuario", "bloqueio"],
    parametros: {},
  },
  {
    id: "financeiro.baixar_titulos",
    nome: "Baixar títulos",
    descricao: "Baixa financeira. Bloqueada.",
    modulo: "financeiro",
    nivel: 4,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: false,
    servico: null,
    auditoria: ["usuario", "bloqueio"],
    parametros: {},
  },
  {
    id: "comercial.efetivar_pedido",
    nome: "Efetivar pedido de venda",
    descricao: "Gravação de pedido. Bloqueada até existir serviço oficial de pedidos.",
    modulo: "comercial",
    nivel: 4,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: false,
    servico: null,
    auditoria: ["usuario", "bloqueio"],
    parametros: {},
  },
  {
    id: "cadastro.efetivar_cliente",
    nome: "Efetivar cadastro de cliente",
    descricao: "Gravação de cliente. Bloqueada até existir serviço oficial de cadastro.",
    modulo: "cadastro",
    nivel: 4,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: false,
    servico: null,
    auditoria: ["usuario", "bloqueio"],
    parametros: {},
  },
  {
    id: "cadastro.excluir",
    nome: "Excluir cadastro",
    descricao: "Exclusão de registros. Bloqueada.",
    modulo: "cadastro",
    nivel: 4,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: false,
    servico: null,
    auditoria: ["usuario", "bloqueio"],
    parametros: {},
  },
  {
    id: "fiscal.transmitir",
    nome: "Transmitir documento fiscal",
    descricao: "Transmissão fiscal. Bloqueada.",
    modulo: "fiscal",
    nivel: 4,
    confirmacao: true,
    permissao: "gerencial",
    habilitada: false,
    servico: null,
    auditoria: ["usuario", "bloqueio"],
    parametros: {},
  },
];

const ACTIONS = BASE_ACTIONS.concat(LEAD_ACTIONS);

const BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

export function listActions({ includeDisabled = true } = {}) {
  return ACTIONS.filter((action) => includeDisabled || action.habilitada).map((action) => ({ ...action }));
}

export function getAction(id) {
  const action = BY_ID.get(id);
  return action ? { ...action, parametros: { ...action.parametros } } : null;
}

export function enabledActionIds() {
  return ACTIONS.filter((action) => action.habilitada).map((action) => action.id);
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function failParam(errors, message) {
  errors.push(message);
}

export function validateActionParams(action, input = {}) {
  const params = {};
  const errors = [];
  const source = input && typeof input === "object" ? input : {};
  for (const [key, spec] of Object.entries(action?.parametros || {})) {
    let value = source[key];
    const empty = value == null || value === "" || (Array.isArray(value) && !value.length);
    if (empty) {
      if (spec.padrao !== undefined) value = spec.padrao;
      else if (spec.obrigatorio) failParam(errors, `Informe ${spec.rotulo || key}.`);
      if (empty && spec.padrao === undefined) continue;
    }
    if (spec.tipo === "inteiro") {
      const number = Number(value);
      if (!Number.isInteger(number)) failParam(errors, `${spec.rotulo || key} precisa ser um número inteiro.`);
      else if (number < spec.minimo || number > spec.maximo)
        failParam(errors, `${spec.rotulo || key} deve ficar entre ${spec.minimo} e ${spec.maximo}.`);
      else params[key] = number;
    } else if (spec.tipo === "numero") {
      const number = Number(String(value).replace(",", "."));
      if (!Number.isFinite(number)) failParam(errors, `${spec.rotulo || key} precisa ser numérico.`);
      else if (number < spec.minimo || number > spec.maximo)
        failParam(errors, `${spec.rotulo || key} deve ficar entre ${spec.minimo} e ${spec.maximo}.`);
      else params[key] = Math.round(number * 100) / 100;
    } else if (spec.tipo === "enum") {
      const text = String(value || "").trim();
      if (!spec.valores.includes(text)) failParam(errors, `${spec.rotulo || key} não é uma opção permitida.`);
      else params[key] = text;
    } else if (spec.tipo === "inteiros") {
      const values = (Array.isArray(value) ? value : [value])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0);
      params[key] = [...new Set(values)].slice(0, spec.maximo || 50);
    } else {
      const text = cleanText(value, spec.maximo || 80);
      if (spec.obrigatorio && !text) failParam(errors, `Informe ${spec.rotulo || key}.`);
      else if (text) params[key] = text;
    }
  }
  return { ok: !errors.length, errors, params };
}

export function userCan(action, user, phase = "preparar") {
  if (!action?.habilitada || action.nivel >= 4) return false;
  if (phase === "executar" && action.nivel >= 3) return Boolean(user?.gerencial);
  if (phase === "preparar" && action.nivel >= 3 && action.permissao === "gerencial")
    return Boolean(user?.gerencial);
  return true;
}
