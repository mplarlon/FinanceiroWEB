# Modulo Fiscal - Diagnostico, Requisitos e Desenho Tecnico

Data: 2026-06-10

Este documento consolida as decisoes levantadas para o modulo fiscal do Dashboard. Ele e um desenho tecnico inicial e nao representa implementacao ainda. Nenhuma tabela, campo, tela ou calculo foi criado nesta etapa.

## 1. Objetivo

Criar uma tela visual no Dashboard chamada **Apuracao Fiscal**, alimentada por backend/API, para ler notas fiscais ja emitidas/importadas no Firebird e apurar impostos por periodo.

O modulo deve:

- Ler notas ja feitas, principalmente `NFE` e `NFE_PRODUTO`.
- Apurar entradas e saidas conforme imposto, regime tributario e regra fiscal.
- Usar data de emissao da NF-e (`NFE.DEMI`) como periodo fiscal.
- Trabalhar preparado por `IDEMPRESA` desde o inicio.
- Exibir dados em tela desde a primeira entrega.
- Separar valores escriturados/importados dos valores recalculados pelo modulo.
- Apontar divergencias fiscais por item e por nota.
- Permitir revisao manual com historico.
- Exportar relatorios em Excel e PDF.
- Exigir login e permissao gerencial para acesso ao Dashboard.

## 2. Fontes de dados existentes

### 2.1 Fonte principal de notas

Base principal:

- `NFE`
- `NFE_PRODUTO`

Uso:

- `NFE` sera a capa da nota.
- `NFE_PRODUTO` sera a base analitica por item.
- `NFE.TPNF` sera usado como regra principal para entrada/saida.
- `NFE.CNPJ_EMIT` sera comparado com `CONFIGURACAO.CNPJ` para validar se o sentido da operacao faz sentido.

Regra de entrada/saida:

- `NFE.TPNF = 0`: entrada.
- `NFE.TPNF = 1`: saida.
- Se `TPNF` conflitar com a comparacao entre emitente e empresa, a nota/item deve ficar como **Revisar**.

### 2.2 Cruzamento opcional com documento interno

Pode cruzar quando necessario:

- `NOTAFISCAL`
- `NOTAFIS_PRODUTO`

Uso:

- Buscar dados internos que nao existam no XML.
- Complementar cliente, pedido, status interno, natureza e campos auxiliares.
- Apoiar identificacao de devolucao, transferencia e outras operacoes.

### 2.3 Produtos

Tabela principal:

- `PRODUTO`

Campos relevantes existentes:

- `CDPRODUTO`
- `PRODUTO`
- `CODIGOBARRA`
- `NCM`
- `NCM_EX`
- `CEST`
- `IPI`
- `ICMS`
- `FRETE`
- `CLASSFISCAL`
- `SITTRIBUT`
- `SUBSTTRIB`
- `VLSUBSTTRIB`
- `PERCSUBSTTRIB`
- `MVAPRINCIPAL`
- `IDIMPOSTO_VENDA`
- `IDIMPOSTO_DEV_CLI`
- `IDIMPOSTO_DEV_FOR`
- `CDFIGURATRIB`
- `ST_CALCULADO`
- `VLST_CALCULADO`
- `BASE`
- `SEMFCP`

Nao duplicar estes campos no modulo fiscal.

### 2.4 Clientes

Tabela principal:

- `CLIENTE`

Campos relevantes:

- `CDCLIENTE`
- `IDEMPRESA`
- `CLIENTE`
- `RAZAO`
- `UF`
- `UF_COB`
- `CDMUNICIPIO`
- `INSCEST`
- `INSCESTMUNIC`
- `CGC`
- `SITFISCAL`
- `SUFRAMA`
- `EMAILFISCAL`
- `CALCULA_PIS_NFE`
- `CALCULA_COFINS_NFE`
- `ENTE_GOVERNAMENTAL`
- `PERC_REDUTOR_COMPRA_GOV`

Observacao:

- Nao existe campo claro chamado `CONTRIBUINTE_ICMS`.
- A analise inicial deve usar `CLIENTE.SITFISCAL`, `CLIENTE.INSCEST`, `NFE.IE_DEST` e regras fiscais.
- Se a informacao for insuficiente, marcar item como **Revisar**.

### 2.5 Fornecedores

Tabela principal:

- `FORNECEDOR`

Campos relevantes:

- `CDFORNECEDOR`
- `FORNECEDOR`
- `UF`
- `CDMUNICIPIO`
- `CGC`
- `INSCEST`
- `SITFISCAL`
- `SUFRAMA`

### 2.6 Empresa e configuracoes

Tabelas:

- `CONFIGURACAO`
- `CONFIGURACAOFISCAL`
- `CONFIGURACOES_SPED`

Campos principais:

`CONFIGURACAO`:

- `IDEMPRESA`
- `NOMEEMPRESA`
- `UF`
- `CNPJ`
- `INSCEST`
- `ICMS`
- `PERCICMS`
- `SIMPLES`
- `SIMPLESCOMEXCESSO`
- `ALIQPIS`
- `ALIQCOFINS`
- `DESTACA_ST`
- `SERIE_NFE`
- `SERIE_NFCE`
- `REGTRIBISSQN`

`CONFIGURACAOFISCAL`:

- `IDEMPRESA`
- `REGIMETRIBUTARIO`
- `CREDITOICMS`
- `APURACAOPISCOFINS`
- `PIS`
- `COFINS`
- `ICMS`
- `RET_PIS`
- `RET_COFINS`
- `EXCLUIRICMSBASEPISCOFINS`
- `ABATEDIFALICMSAIDA`
- `STSEMIPI`
- `STSEMFRETE`

`CONFIGURACOES_SPED`:

- `SIMPLES`
- `REGIME`
- `ALIQ_PIS`
- `ALIQ_COFINS`
- `CSOSN_NO_CST`
- `COD_INC_TRIB`
- `IND_APRO_CREDITO`

Regra:

- `CONFIGURACAOFISCAL.REGIMETRIBUTARIO` sera a fonte principal do regime tributario.
- Se `REGIMETRIBUTARIO` estiver ausente ou invalido, a apuracao da empresa deve ficar como **Revisar configuracao fiscal**.
- Nao inferir automaticamente por `SIMPLES`, `CRT_EMIT` ou SPED quando o campo principal estiver invalido.

### 2.7 Cadastros fiscais auxiliares

Tabelas existentes a reaproveitar:

- `CFOP`
- `CFOP_CST`
- `CST`
- `CSOSN`
- `CST_CSOSN`
- `CST_ENTRADA`
- `CST_SAIDA`
- `IPI_ENTRADA`
- `IPI_SAIDA`
- `PIS_COFINS`
- `NCM`
- `NCM_MVA`
- `CEST`
- `IMPOSTO`
- `IMPOSTO_UF`
- `IMPOSTOUF`
- `UF`
- `UF_ALIQ`
- `PERFIL_ESTADUAL`
- `PERFIL_ESTADUAL_ALIQUOTA`
- `PERFIL_FEDERAL`
- `NATUREZAOP`
- `OPERACAO_CFOP`

Observacao:

- Algumas tabelas existem mas estao vazias, como `NCM`, `CEST`, `CSOSN`, `CST`, `PERFIL_ESTADUAL` e `PERFIL_FEDERAL`.
- O modulo deve reaproveitar o que existir e marcar como **Revisar** quando regra/cadastro for insuficiente.

## 3. Notas canceladas

Regra inicial:

- Nota cancelada = `NFE.STATUS = 9`.
- `NFE.CSTAT` nao sera usado inicialmente porque no banco analisado aparece como `'1'` para todas as notas.
- `NFE.DTCANCELAMENTO` tambem nao sera usado inicialmente porque aparece preenchido com data padrao `1899-12-30`.

Comportamento:

- Nota cancelada aparece na grade.
- Deve ficar destacada visualmente em vermelho.
- Deve mostrar valores originais/importados.
- Nao entra nos calculos da apuracao.
- Nao precisa de card especifico para canceladas.

## 4. Regimes tributarios

### 4.1 Simples Nacional

Para empresas do Simples Nacional:

- Tratar como regime proprio.
- Nao apurar como debito/credito normal de Lucro Real ou Lucro Presumido.
- ICMS, PIS, COFINS e IPI destacados no XML ficam principalmente como informativo/conferencia.
- Credito permitido por CSOSN, como CSOSN 101, deve ser identificado, mas ficar como informativo/revisao na primeira versao.
- Nao incluir automaticamente na apuracao principal sem revisao/aprovacao.

### 4.2 Lucro Real

Para Lucro Real:

- PIS/COFINS devem seguir regime nao cumulativo por padrao.
- Deve haver debitos nas saidas/receitas tributadas.
- Deve permitir creditos nas entradas quando CFOP, CST, natureza e regra fiscal permitirem.
- Separar:
  - debitos de PIS;
  - debitos de COFINS;
  - creditos de PIS;
  - creditos de COFINS;
  - estornos;
  - operacoes sem direito a credito;
  - isentas, nao tributadas ou aliquota zero.

### 4.3 Lucro Presumido

Para Lucro Presumido:

- PIS/COFINS devem ser cumulativos por padrao.
- Nao aproveitar credito de entrada automaticamente.
- Entradas com PIS/COFINS destacados aparecem como informativo/conferencia.
- Credito somente se existir regra fiscal especifica configurada e aprovada.

### 4.4 Prioridade para PIS/COFINS

Prioridade:

1. `CONFIGURACAOFISCAL.APURACAOPISCOFINS`.
2. `CONFIGURACOES_SPED.REGIME`.
3. Regra fiscal especifica de PIS/COFINS.
4. `CONFIGURACAOFISCAL.REGIMETRIBUTARIO`.
5. Se houver conflito ou ausencia, marcar como **Revisar configuracao fiscal**.

## 5. Apuracao por imposto

### 5.1 ICMS proprio

O modulo nao deve apenas somar `VICMS`.

Deve:

- Identificar se entrada gera credito.
- Identificar se saida gera debito.
- Validar por CFOP, CST/CSOSN e tipo de operacao.
- Separar venda tributada, ST, isenta, nao tributada, devolucao, bonificacao, transferencia e outras.
- Considerar valores destacados, mas aplicar regra fiscal para decidir se entram ou nao.

Resultado esperado:

- Total de debitos de ICMS.
- Total de creditos de ICMS.
- Saldo devedor ou credor.
- Itens fora da apuracao.
- Itens pendentes de revisao.

### 5.2 ICMS ST

Deve:

- Separar ICMS proprio de ICMS ST.
- Identificar entradas com ST como mercadoria tributada anteriormente quando aplicavel.
- Apurar ICMS ST separadamente.
- Nao misturar ICMS ST com ICMS proprio.

### 5.3 PIS e COFINS

Deve:

- Aplicar regras por regime tributario.
- Usar CST PIS/COFINS para validar debito, credito ou informativo.
- No Lucro Real, permitir credito/debito conforme regras.
- No Lucro Presumido, nao permitir credito de entrada por padrao.
- Tratar despesas financeiras marcadas em `CTAPAGAR` como abatimento/credito quando configuradas.

### 5.4 IPI

Regra:

- Apuracao de IPI apenas para empresas contribuintes de IPI/industria.
- Deve ser criado campo `CONFIGURACAO.INDUSTRIA` como `LONG`, usando `0/1`.
- Se empresa nao estiver configurada como industria/contribuinte de IPI, valores de IPI ficam como informativo/revisao.

## 6. Comparacao entre valor importado e valor calculado

O modulo deve ter dois comportamentos:

1. Usar valores destacados/importados da nota para escrituração.
2. Recalcular impostos conforme regras fiscais para auditoria/conferencia.

Comparacoes por item e por total de nota:

### 6.1 ICMS proprio

- Base importada.
- Base calculada.
- Aliquota importada.
- Aliquota esperada/calculada.
- Valor destacado.
- Valor calculado.
- Diferenca.

### 6.2 ICMS ST

- Base ST importada.
- Base ST calculada.
- MVA utilizada.
- Aliquota interna.
- Valor ST destacado.
- Valor ST calculado.
- Diferenca.

### 6.3 IPI, PIS e COFINS

Quando existirem no XML:

- Base importada.
- Base calculada.
- Aliquota importada.
- Aliquota calculada.
- Valor importado.
- Valor calculado.
- Diferenca.

### 6.4 Total da nota

- Total de impostos destacados.
- Total calculado pelo modulo.
- Diferenca total.
- Status: `OK`, `Divergente` ou `Revisar`.

### 6.5 Tolerancia

- Tolerancia global para todos os impostos.
- Deve ser salva no banco em `CONFIGURACAO`, vinculada por `IDEMPRESA`.
- Exemplo: R$ 0,01 ou R$ 0,05.
- Se diferenca passar da tolerancia, marcar item como `Divergente`.

Campo sugerido:

- `CONFIGURACAO.TOLERANCIA_FISCAL`

## 7. Status dos itens

Status principais:

- `OK`
- `DIVERGENTE`
- `REVISAR`
- `INFORMATIVO`
- `CANCELADA`

Regras:

- `REVISAR` fica fora da apuracao principal.
- `CANCELADA` fica fora da apuracao principal.
- `OK` entra na apuracao.
- `DIVERGENTE` deve ser exibido e filtravel.
- `INFORMATIVO` aparece na grade, mas nao compoe debito/credito quando a regra indicar informativo.

Itens pendentes:

- Devem aparecer em indicador separado de pendencias/revisoes.
- Nao entram nos cards principais ate serem aprovados ou corrigidos.

## 8. Revisao manual

### 8.1 Comportamento

Ja na primeira versao, o usuario deve poder marcar item pendente como:

- `Aprovado`
- `Corrigido`
- `Mantido em revisao`

Regra:

- `Aprovado` entra na apuracao principal.
- `Corrigido` entra na apuracao principal usando valores corrigidos.
- `Mantido em revisao` continua fora da apuracao.

### 8.2 Identificacao do item

Identificacao fiscal principal:

- `CHAVE`
- `POSIC`
- `CPROD`

Identificacao tecnica auxiliar:

- `NFE_PRODUTO.ID`, quando existir.

Regra:

- Usar `CHAVE + POSIC + CPROD` como chave rastreavel.
- Gravar tambem `NFE_PRODUTO.ID` para performance e joins.
- Nao depender exclusivamente do `ID`.

### 8.3 Estrutura da tabela

Tabela nova:

- `FISCAL_REVISAO_ITEM`

Caracteristica:

- Uma linha por evento/revisao do item.
- Manter historico.
- Nao sobrescrever revisoes anteriores sem rastreio.

Campos principais sugeridos:

- `ID_REVISAO`
- `NFE_PRODUTO_ID`
- `CHAVE`
- `POSIC`
- `CPROD`
- `IDEMPRESA`
- `STATUS_ANTERIOR`
- `STATUS_NOVO`
- `ENTRA_APURACAO`
- `USUARIO_ID`
- `USUARIO_LOGIN`
- `DATA_HORA`
- `IP_ORIGEM`
- `OBSERVACAO`
- `MOTIVO_ALTERACAO`

Campos de ICMS:

- `ICMS_BASE_ORIGINAL`
- `ICMS_BASE_CALCULADA`
- `ICMS_BASE_CORRIGIDA`
- `ICMS_ALIQ_ORIGINAL`
- `ICMS_ALIQ_CALCULADA`
- `ICMS_ALIQ_CORRIGIDA`
- `ICMS_VALOR_ORIGINAL`
- `ICMS_VALOR_CALCULADO`
- `ICMS_VALOR_CORRIGIDO`

Campos de ICMS ST:

- `ICMS_ST_BASE_ORIGINAL`
- `ICMS_ST_BASE_CALCULADA`
- `ICMS_ST_BASE_CORRIGIDA`
- `ICMS_ST_ALIQ_ORIGINAL`
- `ICMS_ST_ALIQ_CALCULADA`
- `ICMS_ST_ALIQ_CORRIGIDA`
- `ICMS_ST_VALOR_ORIGINAL`
- `ICMS_ST_VALOR_CALCULADO`
- `ICMS_ST_VALOR_CORRIGIDO`

Campos de PIS:

- `PIS_BASE_ORIGINAL`
- `PIS_BASE_CALCULADA`
- `PIS_BASE_CORRIGIDA`
- `PIS_ALIQ_ORIGINAL`
- `PIS_ALIQ_CALCULADA`
- `PIS_ALIQ_CORRIGIDA`
- `PIS_VALOR_ORIGINAL`
- `PIS_VALOR_CALCULADO`
- `PIS_VALOR_CORRIGIDO`

Campos de COFINS:

- `COFINS_BASE_ORIGINAL`
- `COFINS_BASE_CALCULADA`
- `COFINS_BASE_CORRIGIDA`
- `COFINS_ALIQ_ORIGINAL`
- `COFINS_ALIQ_CALCULADA`
- `COFINS_ALIQ_CORRIGIDA`
- `COFINS_VALOR_ORIGINAL`
- `COFINS_VALOR_CALCULADO`
- `COFINS_VALOR_CORRIGIDO`

Campos de IPI:

- `IPI_BASE_ORIGINAL`
- `IPI_BASE_CALCULADA`
- `IPI_BASE_CORRIGIDA`
- `IPI_ALIQ_ORIGINAL`
- `IPI_ALIQ_CALCULADA`
- `IPI_ALIQ_CORRIGIDA`
- `IPI_VALOR_ORIGINAL`
- `IPI_VALOR_CALCULADO`
- `IPI_VALOR_CORRIGIDO`

Ordem de prioridade para apuracao:

1. Se existir valor corrigido manualmente e aprovado/corrigido, usar o corrigido.
2. Se nao existir correcao, usar valor aprovado/calculado conforme regra fiscal.
3. Se item estiver pendente de revisao, manter fora da apuracao.

## 9. Regras fiscais configuraveis

### 9.1 Tabela principal

Criar tabela:

- `FISCAL_REGRA_OPERACAO`

Caracteristicas:

- Regras por empresa.
- `IDEMPRESA` obrigatorio.
- Sem fallback global entre empresas.
- Se nao houver regra para empresa, marcar como **Revisar**.
- Permitir CST/CSOSN opcionais para regras mais gerais.
- Regras mais especificas prevalecem sobre regras gerais.
- Permitir inativar, mas nao excluir fisicamente.

Campos sugeridos:

- `IDREGRA`
- `IDEMPRESA`
- `CFOP`
- `TIPO_NOTA_COD`
- `TIPO_NOTA_DESC`
- `CST_ICMS`
- `CSOSN`
- `CST_PIS`
- `CST_COFINS`
- `CST_IPI`
- `TIPO_OPERACAO`
- `GERA_CREDITO_ICMS`
- `GERA_DEBITO_ICMS`
- `ICMS_INFORMATIVO`
- `ICMS_ST`
- `GERA_CREDITO_PIS`
- `GERA_DEBITO_PIS`
- `PIS_INFORMATIVO`
- `GERA_CREDITO_COFINS`
- `GERA_DEBITO_COFINS`
- `COFINS_INFORMATIVO`
- `GERA_CREDITO_IPI`
- `GERA_DEBITO_IPI`
- `IPI_INFORMATIVO`
- `ENTRA_APURACAO`
- `ISENTO`
- `NAO_TRIBUTADO`
- `SUSPENSO`
- `EXIGE_REVISAO`
- `PRIORIDADE`
- `ATIVO`
- `ORIGEM_REGRA`
- `OBSERVACAO`
- `USUARIO_ULT_ALT`
- `DT_ULT_ALT`

### 9.2 Prioridade de busca

Buscar regra nesta ordem:

1. `IDEMPRESA + CFOP + TIPO_NOTA + CST_ICMS/CSOSN`.
2. `IDEMPRESA + CFOP + TIPO_NOTA`.
3. `IDEMPRESA + CFOP`.
4. Se nao encontrar, marcar como **Revisar**.

Observacao:

- Apesar de ter sido citada regra global por CFOP como possibilidade teorica, a decisao final foi exigir regra por empresa.

### 9.3 Conflitos

Marcar como **Revisar** quando:

- Houver mais de uma regra aplicavel com a mesma prioridade.
- Nao encontrar regra aplicavel.
- Regra geral permitir classificacao mas CST/CSOSN indicar comportamento incompatível.
- Houver conflito entre CFOP, tipo da nota e CST/CSOSN.
- Transferencia, devolucao, bonificacao ou remessa tiverem impostos destacados incompatíveis com a regra.

### 9.4 Carga inicial automatica

A primeira versao deve:

- Criar a tabela.
- Gerar carga inicial automaticamente por `IDEMPRESA`.
- Considerar combinacoes historicas reais:
  - `IDEMPRESA`
  - `TPNF`
  - `CFOP`
  - `CST_ICMS`
  - `CSOSN`
  - CSTs PIS/COFINS/IPI quando existirem.
- Criar tambem regras para CFOPs padrao comuns ainda nao encontrados no banco.
- Marcar regras incertas com `EXIGE_REVISAO = 1`.

### 9.5 Manutencao visual

Criar aba dentro de **Apuracao Fiscal**:

- `Regras Fiscais`

Permitir:

- Criar regra.
- Editar regra.
- Inativar regra.
- Consultar regras.
- Filtrar por empresa, CFOP, tipo de nota, CST/CSOSN, tipo de operacao e ativo/inativo.

Nao permitir:

- Exclusao fisica.

### 9.6 Historico de regras

Criar tabela:

- `FISCAL_REGRA_OPERACAO_HIST`

Deve registrar:

- Regra alterada.
- Dados antes/depois.
- Usuario.
- Data/hora.
- IP/origem.
- Motivo da alteracao.

## 10. Classificacao de operacoes

Abordagem hibrida:

1. Regra fiscal configurada no sistema.
2. Classificacao especifica cadastrada para CFOP/natureza.
3. Campos da nota, como finalidade, tipo e natureza.
4. Lista inicial de CFOPs como fallback.
5. Se houver duvida, marcar como **Revisar**.

Tipos de operacao a identificar:

- Venda.
- Compra.
- Devolucao.
- Transferencia.
- Bonificacao.
- Brinde.
- Amostra gratis.
- Remessa.
- Retorno.
- Comodato.
- Demonstracao.
- Conserto.
- Industrializacao.
- Ativo imobilizado.
- Uso e consumo.
- Operacao com ICMS ST.
- Operacao sem credito/debito.
- Outras operacoes fiscais.

### 10.1 Devolucoes

Nao identificar somente por CFOP.

Critérios:

1. CFOP de devolucao.
2. `NFE.FINNFE`, quando indicar devolucao.
3. `NOTAFISCAL.DEVOLUCAO`, se existir.
4. Nota fiscal referenciada, quando houver.
5. Natureza da operacao contendo termos relacionados.

Se houver conflito entre criterios:

- Marcar como **Revisar**.

Na apuracao:

- Devolucoes devem inverter credito/debito automaticamente conforme entrada/saida e CFOP.
- Devem ser demonstradas separadamente.
- Podem estornar debito de venda, estornar credito de entrada e ajustar ICMS proprio, ST, PIS, COFINS e IPI.

### 10.2 Transferencias

Transferencia deve ser uma classificacao fiscal, nao uma decisao automatica de apuracao.

Identificar por:

- CFOP.
- Natureza da operacao.
- Relacao entre empresas/filiais.
- CNPJ origem/destino.
- Campos internos, se existirem.

Aplicar credito/debito conforme:

- CFOP.
- CST/CSOSN.
- Tipo de operacao.
- UF origem/destino.
- Regime tributario.
- Regra fiscal configurada.

Exibir:

- Separadamente em filtros, agrupamentos e relatorios.

### 10.3 Bonificacao, brinde, remessa e operacoes sem cobranca

Seguir a mesma logica:

- Identificar a operacao.
- Aplicar a regra fiscal.
- Nao assumir automaticamente que fica fora da apuracao.
- Marcar como **Revisar** quando houver conflito, ausencia de regra ou inconsistencia.

## 11. Despesas financeiras para abatimento de PIS/COFINS

### 11.1 Tabela origem

Origem:

- `CTAPAGAR`

Entram na apuracao quando:

- `CTAPAGAR.STATUS = 2`.
- `CTAPAGAR.DTPAGTO` dentro do periodo.
- `CTAPAGAR.ABATE_PIS_COFINS = 1`.

Data do periodo:

- `CTAPAGAR.DTPAGTO`.

Base:

- `CTAPAGAR.VLPAGTO`.

Fornecedor:

- `CTAPAGAR.CDFORNECEDOR` cruzando com `FORNECEDOR.FORNECEDOR`.

### 11.2 Campos novos em CTAPAGAR

Criar campos diretamente em `CTAPAGAR`:

- `ABATE_PIS_COFINS` `LONG` `0/1`.
- `BASE_PIS_COFINS_ABATE`.
- `PIS_ALIQ_ABATE`.
- `COFINS_ALIQ_ABATE`.
- `GERA_CREDITO_PIS_COFINS`.
- `OBS_FISCAL_ABATE`.
- `STATUS_FISCAL_ABATE`.
- `MOTIVO_REVISAO_ABATE`.

Status:

- `OK`
- `INFORMATIVO`
- `DIVERGENTE`
- `REVISAR`

### 11.3 Prioridade de aliquota

1. Aliquota especifica do lancamento/despesa.
2. Regra fiscal especifica da natureza da despesa.
3. Aliquota padrao da empresa:
   - `CONFIGURACAO.ALIQPIS`
   - `CONFIGURACAO.ALIQCOFINS`
4. Se nao encontrar regra/aliquota, marcar como **Revisar**.

### 11.4 Exibicao na grade

Despesas de `CTAPAGAR` devem aparecer junto na grade principal, com coluna `Origem`.

Para despesas:

- `Origem`: `CTAPAGAR`.
- Nota/documento: `CTAPAGAR.NRDOC`.
- Codigo exibido: `CTAPAGAR.NRDOC`.
- Descricao: `CTAPAGAR.HISTORICO`, com fornecedor/documento quando disponivel.
- Campos de produto como NCM, CEST, CFOP e CST podem ficar vazios quando nao aplicavel.

Exportacoes PDF/Excel devem ter uma secao propria para despesas que abatem PIS/COFINS.

## 12. Tela Apuracao Fiscal

### 12.1 Primeira entrega visual

A primeira entrega deve ter:

- Tela nova no Dashboard chamada **Apuracao Fiscal**.
- Backend/API alimentando a tela.
- Cards de resumo.
- Grade analitica por item.
- Identificacao de divergencias.
- Detalhe da nota na mesma tela.
- Exportacao Excel/PDF.
- Aba de regras fiscais.
- Estrutura pronta para evoluir regras.

### 12.2 Layout

Pode melhorar a organizacao visual mantendo a identidade do Dashboard.

Periodo padrao:

- Mes atual.

Empresa padrao:

- Todas as empresas.

### 12.3 Filtros

Filtros obrigatorios:

- Empresa.
- Periodo.
- Tipo de nota.
- Imposto.
- CFOP.
- CST/CSOSN.
- Divergencias.
- Origem (`NFE`, `CTAPAGAR`).
- Tipo de operacao.
- Status (`OK`, `DIVERGENTE`, `REVISAR`, `INFORMATIVO`, `CANCELADA`).

### 12.4 Cards

Cards principais:

- Total de notas de entrada.
- Total de notas de saida.
- Total de ICMS credito.
- Total de ICMS debito.
- Saldo de ICMS.
- Total de ICMS ST.
- Total de PIS.
- Total de COFINS.
- Total de IPI.
- Quantidade de itens divergentes.
- Quantidade/valor pendente de revisao em grupo separado.

Observacao:

- Nao precisa card especifico de notas canceladas.

### 12.5 Grade analitica

Uma linha por item, com colunas separadas para ICMS, ICMS ST, PIS, COFINS e IPI.

Colunas minimas:

- Origem.
- Numero da nota/documento.
- Data de emissao/pagamento.
- Entrada ou saida.
- Fornecedor/cliente.
- Codigo do produto/documento.
- Descricao do produto/despesa.
- NCM.
- CEST.
- CFOP.
- CST/CSOSN.
- Base importada.
- Base calculada.
- Aliquota importada.
- Aliquota calculada/esperada.
- Imposto importado.
- Imposto calculado.
- Diferenca.
- Status do item.

### 12.6 Detalhe da nota

Deve abrir na mesma tela, em modal ou painel.

Exibir:

- Capa da nota.
- Itens.
- Totais importados.
- Totais calculados.
- Divergencias.
- Regras fiscais aplicadas.
- Historico de revisoes do item.

### 12.7 Edicao manual

Deve ocorrer em modal do item.

Modal com abas:

- ICMS.
- ICMS ST.
- PIS.
- COFINS.
- IPI.

Permitir editar:

- Base.
- Aliquota.
- Valor.
- Diferenca.
- Status.
- Justificativa.
- Motivo.

## 13. APIs previstas

Rotas sugeridas:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/fiscal/apuracao`
- `GET /api/fiscal/apuracao/resumo`
- `GET /api/fiscal/apuracao/itens`
- `GET /api/fiscal/apuracao/nota/<chave>`
- `POST /api/fiscal/revisao-item`
- `GET /api/fiscal/revisao-item/<chave>/<posic>/<cprod>`
- `GET /api/fiscal/regras`
- `POST /api/fiscal/regras`
- `PUT /api/fiscal/regras/<idregra>`
- `POST /api/fiscal/regras/<idregra>/inativar`
- `POST /api/fiscal/regras/carga-inicial`
- `GET /api/fiscal/export/excel`
- `GET /api/fiscal/export/pdf`

## 14. Exportacoes

Desde a primeira versao:

- Excel.
- PDF.

Relatorios:

- Resumo por imposto.
- Resumo por nota.
- Resumo por CFOP.
- Resumo por CST/CSOSN.
- Resumo por produto.
- Divergencias fiscais.
- Despesas `CTAPAGAR` que abatem PIS/COFINS em secao separada.

## 15. Login, sessao e permissoes

### 15.1 Login

O Dashboard inteiro deve exigir login.

Tabela existente:

- `USUARIOS`

Campos:

- `IDUSUARIO`
- `LOGIN`
- `NOMECOMPLETO`
- `SENHA`
- `IDGRUPO`
- `INATIVO`

Regra:

- Login somente por `USUARIOS.LOGIN`.
- Usuario com `SENHA` vazia fica bloqueado.
- Usuario com `INATIVO = 1` fica bloqueado.
- Validar senha no backend.
- Foi identificado que o usuario `CAROL` com senha conhecida valida usando codificacao XOR repetida com chave hex `C4 3A 1B`.
- Implementacao deve codificar a senha digitada com o mesmo algoritmo e comparar com `USUARIOS.SENHA`.

### 15.2 Permissao

Tabela existente:

- `SIS_OPERACAOUSUARIO`

Operacao:

- `SIS_OPERACAO.IDOPERACAO = 900`
- Operacao: `Gerencial`
- `SIS_MAINMENU.IDMENUITEM = 9000..9017`
- Cada pagina do Dashboard possui um `IDMENUITEM` proprio.

Regra:

- Para acessar o Dashboard, usuario precisa ter `IDOPERACAO = 900` em pelo menos um `IDMENUITEM` do Dashboard.
- A permissao deve validar `IDMENUITEM` e `APPID`.
- Sem permissao, mostrar acesso negado e nao carregar dados.

### 15.3 Sessao

Regras:

- Expira em 1 hora desde o login.
- Expira tambem com 30 minutos sem acao.
- Usar o menor limite entre os dois.
- Mostrar usuario logado e botao `Sair`.
- Preparar para uso em rede com HTTPS/dominio.
- Sessao no backend.
- Cookie com flags adequadas quando em HTTPS.

### 15.4 Auditoria de login

Criar tabela:

- `DASHBOARD_LOGIN_AUDIT`

Registrar:

- Login informado.
- `IDUSUARIO`, quando identificado.
- Data/hora.
- IP/origem.
- Evento: login sucesso, login falha, logout.
- Motivo.

## 16. Campos e tabelas novas previstos

### 16.1 Campos novos

`CONFIGURACAO`:

- `TOLERANCIA_FISCAL`
- `INDUSTRIA` `LONG` `0/1`

`CTAPAGAR`:

- `ABATE_PIS_COFINS` `LONG` `0/1`
- `BASE_PIS_COFINS_ABATE`
- `PIS_ALIQ_ABATE`
- `COFINS_ALIQ_ABATE`
- `GERA_CREDITO_PIS_COFINS`
- `OBS_FISCAL_ABATE`
- `STATUS_FISCAL_ABATE`
- `MOTIVO_REVISAO_ABATE`

### 16.2 Tabelas novas

- `FISCAL_REGRA_OPERACAO`
- `FISCAL_REGRA_OPERACAO_HIST`
- `FISCAL_REVISAO_ITEM`
- `DASHBOARD_LOGIN_AUDIT`

## 17. Campos que nao devem ser duplicados

Nao criar duplicatas para:

- Codigo do produto.
- Descricao do produto.
- NCM.
- CEST do produto.
- CFOP.
- CST/CSOSN.
- Aliquotas destacadas/importadas.
- Valores destacados/importados.
- UF cliente/empresa.
- Regime tributario.
- Valores de produto, desconto, frete e total.
- Bases e valores de impostos existentes nas notas.

Usar as tabelas existentes como fonte e criar apenas campos/tabelas para:

- Configuracao especifica do Dashboard fiscal.
- Regras fiscais configuraveis.
- Revisoes manuais.
- Auditoria.
- Abatimento PIS/COFINS em `CTAPAGAR`.

## 18. Regras de seguranca operacional

Antes da implementacao:

- Criar scripts SQL revisaveis.
- Nao alterar tabelas sem validacao.
- Scripts devem ser idempotentes quando possivel.
- Fazer backup do banco antes de aplicar alteracoes.
- Primeiro criar/validar em ambiente de teste, se disponivel.

## 19. Pendencias tecnicas antes da implementacao

Pontos a confirmar/validar durante a implementacao:

- Mapeamento exato dos valores de `CONFIGURACAOFISCAL.REGIMETRIBUTARIO`.
- Mapeamento de `CONFIGURACAOFISCAL.APURACAOPISCOFINS`.
- Se existe campo `NOTAFISCAL.DEVOLUCAO`; nao apareceu no resumo inicial e precisa ser validado no schema completo antes de usar.
- Como identificar notas referenciadas na estrutura atual.
- Regras iniciais de CFOP padrao para carga automatica.
- Precisao numerica ideal dos campos novos no Firebird.
- Se a codificacao de senha XOR vale para todos os usuarios ou se ha excecoes legadas.

## 20. Proxima etapa sugerida

Depois da aprovacao deste desenho:

1. Criar scripts SQL das tabelas/campos novos.
2. Implementar login, sessao e permissao `IDOPERACAO = 900`.
3. Implementar APIs fiscais iniciais.
4. Criar carga inicial de `FISCAL_REGRA_OPERACAO`.
5. Criar tela visual `Apuracao Fiscal`.
6. Implementar grade, cards, detalhe, revisao manual e exportacoes.
7. Validar os numeros com amostras reais de notas.
