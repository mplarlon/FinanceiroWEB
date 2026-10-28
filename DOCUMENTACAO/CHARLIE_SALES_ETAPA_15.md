# Charlie Sales — Etapa 15: Smart Purchasing

Data: 2026-10-26

A etapa 16 acompanha a carteira do vendedor. O detalhe está em `CHARLIE_SALES_ETAPA_16.md`.

## O que entrou

O Charlie Smart Purchasing lê saldo, saídas consideradas dos últimos 90 dias, pedidos de compra em aberto, entradas do último ano e o índice de qualidade do fornecedor. A sugestão só aparece quando a conta fecha com esses dados.

A quantidade cobre a janela de 7, 15, 30 ou 60 dias, ou o mínimo cadastrado quando ele é maior que zero. Saldo nulo não vira zero e não entra na lista. Pedido em aberto que já cobre a conta não gera compra. Se a consulta dos pedidos falhar, a quantidade não desconta um zero inventado.

O fornecedor é o de menor custo observado na entrada. Custo zero ou em branco não vira preço. O prazo é a mediana dos dias entre a data do pedido e a data da entrada daquele fornecedor. Sem as duas datas, o prazo fica em branco. A qualidade só aparece quando há um único índice cadastrado. Dois índices diferentes não são misturados numa nota.

A demanda prevista repete a média de 90 dias na janela. Não é previsão estatística. A prioridade ordena o acompanhamento e não é probabilidade de ruptura.

Criar solicitação grava um rascunho em `DASH_COMPRA_SUGESTAO`, no módulo de compras que já existe, e exige usuário gerencial, fornecedor, custo, depósito e empresa. A consulta não grava. Emitir o pedido definitivo só ocorre depois de uma autorização gerencial separada e chama a aprovação que já existe nesse módulo. Sem autorização, nenhuma ordem de compra é gerada.

## Arquivos

Criados:

- `node-app/server/lib/charlie-smart-purchasing.js`
- `node-app/server/lib/charlie-smart-purchasing-service.js`
- `node-app/server/routes/charlie-purchasing.js`
- `node-app/client/src/pages/CharlieSmartPurchasing.jsx`
- `node-app/test/charlie-smart-purchasing.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_15.md`

Alterados:

- `node-app/server/routes/purchase-replenishment.js`
- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Smart Purchasing.
2. Confira um produto sem custo de entrada: a sugestão pode existir, mas o custo fica em branco e a solicitação não grava.
3. Crie a solicitação de um item completo. O status no módulo de compras fica rascunho.
4. Sem autorizar a emissão, o botão de pedido não gera ordem. Depois de autorizar, a emissão usa a aprovação já existente.

## Limites

Não há prazo padrão de fornecedor. Não há nota de confiabilidade calculada. A emissão automática começa desligada.
