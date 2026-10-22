# Charlie — Etapa 17

Foi adicionada a central **Inteligência Comercial**, reutilizando vendas, itens, clientes, vendedores, estoque, auditoria, memória, tarefas e automações existentes.

O processamento identifica inatividade relativa ao intervalo habitual, redução entre períodos equivalentes, recompra estimada e venda cruzada com suporte mínimo. Cada oportunidade preserva fontes, métricas, vendedor, prioridade, situação e histórico. A pontuação representa somente prioridade de abordagem; associação não comprova compatibilidade técnica e causas não são inferidas.

Mensagens são rascunhos revisáveis: não há envio automático, base legal presumida ou preferência de contato inferida. Pedidos só são associados explicitamente, evitando atribuição automática de receita.

Fontes: `SAIDAESTOQUE`, `SAIDAPRODUTO`, `CLIENTE`, `VENDEDOR`, `PRODUTO` e `MOVIMENTO`, por consultas somente leitura e escopo de empresa/filial da sessão.

Limitações: compatibilidade técnica depende de regra validada; o cenário obrigatório deve ser executado em homologação com histórico representativo; a análise limita-se a 10.000 itens por lote; receita incremental comprovada permanece indisponível sem método de atribuição validado.
