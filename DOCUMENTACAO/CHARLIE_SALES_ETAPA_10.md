# Charlie Sales — Etapa 10: Stock Guardian

Data: 2026-10-26

A etapa 11 monta campanhas em rascunho. O detalhe está em `CHARLIE_SALES_ETAPA_11.md`.

## O que entrou

O Charlie Stock Guardian lê o saldo do ERP, as saídas consideradas dos últimos 90 dias, os pedidos de compra em aberto, o saldo por depósito e o estoque sincronizado da Tray. A consulta não grava nada e não mexe em quantidade física.

A cobertura é o saldo dividido pela demanda diária observada. A janela é de 7, 15, 30 ou 60 dias e não representa prazo de fornecedor. Estoque reservado e prazo de fornecedor ficam em branco, porque essa leitura não tem esses campos.

Entram na lista ruptura na janela, venda com saldo zero ou negativo, estoque parado, saldo acima do máximo cadastrado, demanda alta e divergência entre o saldo do ERP e o saldo da Tray quando a referência coincide. A quantidade vendida na Tray aparece por canal e não é somada à demanda do ERP.

A compra sugerida desconta o saldo e, quando a consulta funcionou, o pedido de compra em aberto. Redistribuição só descreve um depósito com saldo e outro sem saldo. Campanha é rascunho para estoque parado e não é publicada. Alerta, compra, redistribuição e campanha exigem usuário gerencial e não se repetem.

## Arquivos

Criados:

- `node-app/server/lib/charlie-stock-guardian.js`
- `node-app/server/lib/charlie-stock-guardian-service.js`
- `node-app/server/routes/charlie-stock.js`
- `node-app/client/src/pages/CharlieStockGuardian.jsx`
- `node-app/test/charlie-stock-guardian.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_10.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Stock Guardian.
2. Produto sem saldo registrado não aparece como zero.
3. Produto com saída e cobertura menor que a janela aparece como ruptura, com compra sugerida.
4. Saldo do ERP diferente do saldo Tray da mesma referência aparece como divergência.
5. Registrar alerta não altera o saldo e a segunda vez não duplica.

## Limites

A prioridade não é probabilidade de ruptura. A sugestão de compra não gera ordem. A redistribuição não transfere saldo.
