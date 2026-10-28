# Charlie Sales — Etapa 20: Profit Tracker

Data: 2026-10-26

A etapa 21 monta a ficha do cliente com compra, orçamento em aberto e lead já ligado. O detalhe está em `CHARLIE_SALES_ETAPA_21.md`.

## O que entrou

O Charlie Profit Tracker junta venda por produto e canal. O canal ERP usa o pedido dos últimos 90 dias. O canal da Tray usa o pedido já sincronizado e o marketplace identificado nele.

A margem só é calculada quando receita, custo histórico do item, tributos, comissão e taxa do canal são números lidos. Zero gravado conta. Campo ausente não vira zero. Se um item do grupo não tem custo, tributo ou comissão, o total do grupo fica sem esse componente.

O pedido do ERP não tem taxa de canal, então a margem desse canal permanece em branco. O pedido sincronizado da Tray não trouxe custo, imposto, comissão nem taxa, então a margem da loja também permanece em branco. A receita conhecida continua visível.

A leitura do ERP para nos 200 produtos de maior receita e avisa que não é o total. A tela não grava valor.

## Arquivos

Criados:

- `node-app/server/lib/charlie-profit-tracker.js`
- `node-app/server/lib/charlie-profit-tracker-service.js`
- `node-app/server/routes/charlie-profit.js`
- `node-app/client/src/pages/CharlieProfitTracker.jsx`
- `node-app/test/charlie-profit-tracker.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_20.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_19.md`

## Como validar

1. Abra Charlie Sales e o item Charlie Profit Tracker.
2. Veja um produto do canal ERP. A taxa fica “Não conciliado” e a margem fica “Não conciliada”.
3. Confira que a receita aparece quando o pedido tem valor.
4. Abra “Ver o que o faturamento já mostra” e volte. Nenhum valor foi gravado.

## Limites

Sem taxa de canal lida, a margem não fecha. Imposto de nota fiscal fora do item do pedido não entra nesta conta.
