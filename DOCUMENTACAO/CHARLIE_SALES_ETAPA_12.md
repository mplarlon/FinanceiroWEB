# Charlie Sales — Etapa 12: Autopilot

Data: 2026-10-26

A etapa 13 compara produto por cadastro. O detalhe está em `CHARLIE_SALES_ETAPA_13.md`.

## O que entrou

O Charlie Autopilot lê oportunidades e ações já gravadas na central de e-commerce e campanhas já gravadas no Smart Campaigns. O ciclo não consulta o banco de novo e não inventa problema quando esses registros estão vazios.

Cada registro entra em baixo, médio ou alto risco. Baixo risco é alerta, relatório ou tarefa interna. Médio risco é preço, campanha ou descrição. Alto risco é operação financeira, crédito, cancelamento, alteração em massa ou exclusão.

A automação de baixo risco nasce desligada. Ligada, ela só grava um registro interno: não envia mensagem e não altera cadastro. Preço, campanha e descrição não são executados nesta tela; continuam na central de ações. Alto risco permanece bloqueado.

O resultado observado só aparece quando a central já tiver uma venda vinculada. Estimativa e observado ficam separados.

## Arquivos

Criados:

- `node-app/server/lib/charlie-autopilot.js`
- `node-app/server/lib/charlie-autopilot-service.js`
- `node-app/server/routes/charlie-autopilot.js`
- `node-app/client/src/pages/CharlieAutopilot.jsx`
- `node-app/test/charlie-autopilot.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_12.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Autopilot.
2. Rode o ciclo sem registros: a lista fica vazia.
3. Uma ação de preço aparece como risco médio e o botão de registrar não a executa.
4. Com o baixo risco desligado, um alerta não é executado. Ligado, vira registro interno.

## Limites

O Autopilot não substitui a central de ações. Não altera preço, estoque, campanha, financeiro nem cadastro.
