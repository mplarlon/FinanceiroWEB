# Charlie E-Commerce Intelligence — Fase 1

## Arquitetura encontrada

- Backend Node.js 20 com Express 5, rotas por domínio em `node-app/server/routes`.
- Frontend React 19/Vite, navegação central em `client/src/App.jsx` e componentes sem roteador externo.
- Firebird é a fonte transacional do ERP; configurações e stores auxiliares do Charlie usam JSON atômico em `C:\Administracao\Dashboard`.
- A autenticação consulta `USUARIOS` e `SIS_OPERACAOUSUARIO`; todas as rotas `/api` passam pelo middleware de sessão.
- Charlie usa serviços determinísticos e Ollama opcional. O modelo interpreta/redige; não é fonte de verdade para cálculos.
- Existem agendadores próprios para monitoramento, automações, café da manhã, leads e gestão.

## Integração Tray reaproveitada

A integração existente em `server/routes/tray.js` já possuía OAuth, renovação de token, leitura de pedidos/produtos/clientes, edição protegida, webhook, configuração e agendador. A Fase 1 estende essa implementação; não cria uma segunda integração.

Foram adicionados paginação (50 registros, conforme o máximo documentado), retentativas com backoff para HTTP 429/5xx, espaçamento conservador entre páginas, sincronização inicial e incremental, consolidação idempotente pelo ID externo e registro de falhas/última execução. O webhook continua sendo recebido e auditado; a reconciliação incremental periódica absorve as alterações notificadas. A documentação informa limites de 180 requisições por minuto e 10 mil por dia por loja (50 mil para loja corporativa), que devem ser considerados no dimensionamento da carga inicial.

## Entrega funcional da Fase 1

- Store consolidado `ecommerce_intelligence.json`, gravado atomicamente fora do repositório.
- Normalização de pedidos, produtos, clientes e identificação conservadora do marketplace.
- Endpoint `POST /api/tray/sincronizar` para carga inicial ou incremental.
- Endpoint `GET /api/tray/intelligence/dashboard` com filtros por período, marketplace, produto, cliente e status.
- Dashboard Charlie E-Commerce Intelligence com faturamento, pedidos, ticket médio, cancelamentos, pendências, canais e produtos.
- Indicadores sem dados suficientes são retornados como indisponíveis; não há números fictícios.
- O acesso adicional à área Tray usa `DASHBOARD_TRAY_PASSWORD` quando configurada; sem ela, somente a sessão gerencial autenticada pode liberar a área. Não existe senha padrão incorporada ao código.

## Banco de dados

Nenhuma migração Firebird é necessária nesta fase. A escolha preserva o ERP e segue o padrão dos stores auxiliares do Charlie. Uma futura migração para tabelas relacionais só deve ocorrer após homologação do volume, dos campos efetivamente retornados pela loja e das regras de precedência com o ERP.

## Limitações conhecidas da Tray

Os campos retornados variam conforme o plano, aplicativo, canal e payload da loja. Marketplace, itens, descontos, frete e pagamento são lidos quando presentes. Comissões, taxas detalhadas, impostos, custo real, devoluções e carrinhos abandonados não são presumidos. Margem e lucro permanecem indisponíveis até que essas fontes sejam conciliadas nas fases seguintes.

## Evolução das fases 2 a 5

Após a fundação, foi acrescentada a camada `ecommerce-advanced.js`, que aplica aos dados Tray os padrões já existentes do Charlie:

- oportunidades deduplicadas por produto e tipo, com evidências, confiança, prioridade e potencial separado de valor observado;
- margem de contribuição estimada somente quando preço e custo estão disponíveis;
- demanda média, cobertura e risco de ruptura, sempre marcados como estimativa;
- ações pendentes geradas pelo Charlie, decisão gerencial no backend, execução idempotente de preço e reversão;
- limites de alteração, produtos protegidos e três modos de automação;
- campanhas somente em rascunho, sem publicação ou comunicação externa automática;
- relatório diário e painel de resultados com separação entre observado e estimado;
- interface para oportunidades, preços/estoque, ações, campanhas, resultados e configurações.

Recuperação de clientes e CRM continuam reutilizando o Charlie Comercial e Charlie Leads já existentes. Solicitações de compra continuam passando pelo serviço oficial de abastecimento e nunca são convertidas diretamente em compromisso financeiro pela camada de e-commerce.
