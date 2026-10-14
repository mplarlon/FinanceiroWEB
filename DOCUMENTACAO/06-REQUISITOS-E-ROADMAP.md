# Requisitos, cobertura e roadmap

## Primeira etapa

| Requisito | Cobertura | Falta para encerrar |
|---|---|---|
| Atualização sem sair da tela | Código concluído | teste de aceite com usuário |
| Categoria em pagar/receber | Código concluído | validar nomes e padrões do banco real |
| Parcelar uma conta em duas | Correção concluída | testar criação, visibilidade, soma e reversão |
| Centro de custo com categorias | Código concluído | validar herança e gravação nos dois tipos |
| Charlie/telefone | Parcial | recuperar e formalizar a conversa original |

## Segunda etapa e validação antecipada

| Pergunta de negócio | Situação atual | Fonte/tela |
|---|---|---|
| Projetar caixa com receitas e despesas | Implementado | “Fluxo projetado”, cenários e horizontes |
| Projetado versus registrado | Parcial | metas/realizado e títulos existem; falta uma visão única explícita de previsto x realizado financeiro |
| Quanto entrou e quanto saiu? | Implementado | controle de caixa e resumo diário |
| Despesas de maior peso | Parcial | pagar ordenável e fornecedores; falta painel consolidado por categoria/centro de custo |
| Saldo disponível | Implementado, dependente de configuração | saldo bancário/caixa e contas selecionadas |
| Entradas cobrem despesas futuras? | Implementado | saldo provável/pessimista e capital de giro |
| Período de maior/menor movimentação | Parcial | filtros e relatórios por período; falta ranking temporal dedicado |
| Vendas atrasadas por vendedor | Parcial | títulos vencidos e filtro por vendedor; falta relatório agrupado/totalizado por vendedor |

## Desejáveis

- Lançar entradas/saídas simples: conta manual e controle de caixa já existem;
  revisar se o fluxo é simples o bastante com usuários reais.
- Classificar e automatizar: hierarquia e padrões existem; próximo passo é
  sugerir categoria/centro por histórico, sempre com confirmação e auditoria.
- Consultar lançamentos anteriores: implementado por filtros, detalhe e
  histórico de acordos.
- Integrações de boleto e extrato: boletos e importação OFX/cartão existem;
  homologar cada banco e documentar credenciais/certificados fora do Git.

## Backlog priorizado

1. Homologar a primeira etapa em banco real e registrar evidências.
2. Formalizar os requisitos da conversa sobre Charlie/telefone.
3. Criar relatório “Previsto x realizado” por período, tipo e categoria.
4. Criar análise de despesas por categoria e centro de custo.
5. Criar série temporal/ranking de movimentação.
6. Criar inadimplência/vendas atrasadas agrupadas por vendedor.
7. Parametrizar caminho do Inno Setup no build.
8. Reduzir e arquivar com segurança os artefatos históricos da raiz.

## Critério de pronto

Um item só é concluído quando tem regra documentada, implementação, teste
automatizado proporcional ao risco, aceite no Firebird de homologação,
instrução operacional e plano de reversão quando grava dados.

