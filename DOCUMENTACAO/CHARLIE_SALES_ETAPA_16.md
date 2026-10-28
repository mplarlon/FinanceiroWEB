# Charlie Sales — Etapa 16: Sales Coach

Data: 2026-10-26

A etapa 17 confere o catálogo da Tray para o Google Shopping. O detalhe está em `CHARLIE_SALES_ETAPA_17.md`.

## O que entrou

O Charlie Sales Coach lê orçamentos do mês, vendas consideradas do dia e do mês, a meta já gravada no Charlie Daily e os clientes com data de última compra. Quem está ligado a um vendedor vê só a própria carteira. A equipe inteira só aparece para usuário gerencial que pede essa visão. Telefone não entra na tela.

A taxa é orçamento finalizado dividido por orçamento aberto ou finalizado. Cancelado e remessa ficam de fora. Sem orçamento, a taxa fica em branco e não vira zero. Não é probabilidade de fechar o próximo.

A meta mensal é a meta daquele vendedor. A meta da loja aparece só na visão da equipe e não é dividida entre as pessoas. Não há meta diária por vendedor, então o dia da carteira fica em branco. O tempo de resposta fica em branco: o orçamento não tem data de resposta do cliente.

Orçamento aberto sem nome de contato no cadastro entra na lista de acompanhamento. Cliente inativo só entra quando a última compra passa do prazo já configurado no Charlie Daily. Sem data, não entra. Produto complementar não é sugerido aqui.

A consulta não grava tarefa e não envia mensagem. As recomendações ficam na tela.

## Arquivos

Criados:

- `node-app/server/lib/charlie-sales-coach.js`
- `node-app/server/lib/charlie-sales-coach-service.js`
- `node-app/server/routes/charlie-coach.js`
- `node-app/client/src/pages/CharlieSalesCoach.jsx`
- `node-app/test/charlie-sales-coach.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_16.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Sales Coach.
2. Confira que a taxa não aparece quando não há orçamento e que o tempo de resposta está em branco.
3. Com carteira vinculada, os clientes de outro vendedor não aparecem.
4. Peça a visão da equipe. A meta da loja fica separada da meta do vendedor.

## Limites

O par mostra dois produtos que estiveram no mesmo pedido pelo menos 3 vezes nos últimos 365 dias. A lista não confirma compatibilidade e não envia mensagem.
