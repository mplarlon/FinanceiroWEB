# Charlie Sales — Etapa 11: Smart Campaigns

Data: 2026-10-26

A etapa 12 classifica o ciclo do Autopilot. O detalhe está em `CHARLIE_SALES_ETAPA_12.md`.

## O que entrou

O Charlie Smart Campaigns lê o catálogo e os pedidos já sincronizados da Tray. A consulta não grava campanha.

As sugestões saem de cinco fatos: saldo sem pedido, margem estimada de preço e custo a partir de 40%, queda de quantidade entre dois períodos de 90 dias, pedido no mesmo mês em dois anos ou mais, e produtos que apareceram juntos em pelo menos três pedidos. Custo ausente ou zerado não vira margem. A queda não explica a causa. A compra conjunta não trata os produtos como equivalentes.

Preço sugerido, meta, período e público ficam em branco. A mensagem nasce como rascunho e não é enviada. Aprovar não publica. Marcar publicação só funciona depois que um gerente liga a autorização, e mesmo assim nenhum canal externo é chamado.

## Arquivos

Criados:

- `node-app/server/lib/charlie-smart-campaigns.js`
- `node-app/server/lib/charlie-smart-campaigns-service.js`
- `node-app/server/routes/charlie-campaigns.js`
- `node-app/client/src/pages/CharlieSmartCampaigns.jsx`
- `node-app/test/charlie-smart-campaigns.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_11.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Smart Campaigns.
2. Produto com saldo e sem pedido aparece como parado, com preço sugerido e meta em branco.
3. Aprovar um rascunho deixa a publicação desligada.
4. Sem autorização, marcar publicação é recusado. Com autorização, a campanha fica marcada e a mensagem continua não enviada.

## Limites

A margem não inclui imposto, comissão nem taxa. Nenhuma venda é atribuída à campanha. A tela antiga de rascunhos do e-commerce continua no Charlie Intelligence.
