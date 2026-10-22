# Charlie — Etapa 18 — Compras e Abastecimento

## Componentes implementados

- Motor determinístico `Charlie Supply Intelligence` para disponibilidade, reposição, estoque de segurança, ABC, variabilidade, giro, excesso, custo total, desempenho e comparação de fornecedores, agrupamento e simulação.
- Serviço de abastecimento que reutiliza as consultas de compras e o histórico já existentes.
- Central **Compras e Abastecimento** na interface atual do Charlie.
- Rascunhos de solicitação isolados por usuário, empresa e filial, com prévia e confirmação.
- Integração segura com serviço oficial de compras quando disponível; sem `INSERT` direto e sem efetivação automática de pedido.
- Endpoints para painel, comparação de fornecedores, simulação e preparação/confirmação de rascunhos.

## Funcionalidades disponíveis

- Necessidades de reposição com saldo disponível, previsão, cobertura, prazo, segurança, quantidade e urgência.
- Regras de quantidade mínima e múltiplo de embalagem.
- Segurança adaptada a demanda estável/variável ou intermitente, com fallback declarado.
- Curva ABC por valor de consumo, giro, excesso e capital imobilizado.
- Custo total com componentes conhecidos e lista explícita dos ausentes.
- Histórico de prazo, pontualidade, atraso, divergência, devolução e cancelamento.
- Ranking de fornecedores sem assumir que menor preço é a melhor condição.
- Simulações sem alteração de estoque ou pedidos.
- Monitoramento de ordens abertas e atraso estimado.
- Funcionamento determinístico sem Ollama.

## Fontes de dados

`PRODUTO`, `MOVIMENTO`, `SAIDAESTOQUE`, `SAIDAPRODUTO`, `ORDEMCOMPRA`, `ORDEMCOMPRAPROD`, `ENTRESTOQUE`, `ENTRPRODUTO` e `PRODUTO_CODFORN`, por consultas parametrizadas do módulo existente.

## Arquivos principais

- `server/lib/charlie-supply-engine.js`
- `server/lib/charlie-supply-service.js`
- `server/lib/charlie-supply-store.js`
- `server/lib/charlie-write-services.js`
- `server/routes/assistant.js`
- `client/src/pages/CharlieSupply.jsx`
- `client/src/pages/Charlie.jsx`
- `client/src/styles.css`
- `test/charlie-supply.test.js`

## Validação executada

- Suíte completa: 209 testes aprovados, nenhuma falha.
- Build Vite de produção concluído.
- Casos novos cobrem disponibilidade e reservas sem dupla contagem, compras pendentes, previsão, reposição, segurança, ABC, giro, excesso, fornecedores, custo total, entregas, mínimo, embalagem, agrupamento, simulação, isolamento, confirmação, automação e operação sem Ollama.

## Limitações encontradas

- O schema atual não oferece relação validada e uniforme de reserva/pedido de venda por produto para a consulta consolidada; a central declara a limitação e não inventa valores.
- Lead time por fornecedor, frete, seguro, despesas, condições e tributos só podem ser usados quando cadastrados/fornecidos. O padrão de prazo é identificado como hipótese.
- A instalação ainda precisa registrar `app.locals.charlieServices.compras.criarSolicitacaoRascunho` para gravar o rascunho no ERP. Sem ele, a confirmação retorna indisponibilidade e preserva a prévia local.
- Economia potencial permanece “não informada” até haver ofertas comparáveis registradas; não é apresentada como economia realizada.
- A validação de homologação com um pedido real e auditoria depende do banco e do serviço oficial da instalação e não foi simulada com dados demonstrativos.

## Riscos e implantação

- Validar em homologação os status reais de ordem de compra e o significado de `PRAZO` em cada cliente.
- Mapear reservas e pedidos de venda no catálogo semântico antes de habilitar seu desconto no disponível.
- Conectar o serviço oficial de solicitação de compra com idempotência por `draftId` e manter a criação limitada a rascunho.
- Revisar permissões do papel de compras e executar o cenário obrigatório com auditoria antes de produção.
- Programar análises pesadas fora do pico e acompanhar o cache/timeout já usados pelo Charlie.

Valores apresentados são estimativas verificáveis com os dados disponíveis; capital imobilizado não é prejuízo realizado e economia estimada não é economia realizada.
