# Charlie Sales — Etapa 19: Kit Builder

Data: 2026-10-26

A etapa 20 acompanha receita por produto e canal e só fecha a margem quando custo, tributo, comissão e taxa existem. O detalhe está em `CHARLIE_SALES_ETAPA_20.md`.

## O que entrou

O Charlie Kit Builder sugere pares de produtos que saíram no mesmo pedido pelo menos duas vezes no último ano. Um único pedido não vira kit. O mesmo código consigo mesmo também não. A consulta traz no máximo os 200 pares com mais pedidos e avisa que isso não é o total do ano.

O preço é a soma dos preços de cadastro, sem desconto. A margem só aparece quando os dois custos são conhecidos e maiores que zero. Custo ausente não vira zero. Estoque ausente não vira “sem estoque”. Estoque zero conhecido marca o par como insuficiente.

Par que já está no mesmo kit cadastrado sai da lista de sugestões e aparece à parte. A tela não grava kit no ERP nem na loja.

## Arquivos

Criados:

- `node-app/server/lib/charlie-kit-builder.js`
- `node-app/server/lib/charlie-kit-builder-service.js`
- `node-app/server/routes/charlie-kits.js`
- `node-app/client/src/pages/CharlieKitBuilder.jsx`
- `node-app/test/charlie-kit-builder.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_19.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_18.md`

## Como validar

1. Abra Charlie Sales e o item Charlie Kit Builder.
2. Veja um par com pelo menos dois pedidos juntos. O preço é a soma, sem desconto.
3. Confira um item sem custo. A margem fica “Não informado”.
4. Confira que nenhum kit novo aparece no cadastro depois da consulta.

## Limites

A sugestão para em dois itens. Imposto, comissão e taxa não entram na margem. Não há gravação de kit.
