# Charlie Sales — Etapa 17: Google Shopping

Data: 2026-10-26

A etapa 18 sugere título, descrição e caminho a partir do cadastro. O detalhe está em `CHARLIE_SALES_ETAPA_18.md`.

## O que entrou

O Charlie Google Shopping confere o catálogo que a Tray já sincronizou. Ele não abre o Google Merchant Center e não cria outra integração.

O produto fica incompleto quando falta título, descrição, preço, imagem, marca ou disponibilidade nos dados que a Tray enviou. Campo que não veio na sincronização continua ausente: não vira zero e não vira “sem estoque”. Preço zero não entra na comparação.

A diferença de preço só aparece quando a Tray e o ERP têm preço maior que zero para a mesma referência. Essa conta não é o preço publicado no Google. Link e GTIN não vieram na sincronização e ficam em branco.

A tela não grava título nem descrição. Erro guardado na sincronização da Tray aparece como erro da Tray. Recusa do Google só existiria se a Tray tivesse enviado essa recusa; hoje a lista fica vazia.

A consulta não altera anúncio.

## Arquivos

Criados:

- `node-app/server/lib/charlie-google-shopping.js`
- `node-app/server/lib/charlie-google-shopping-service.js`
- `node-app/server/routes/charlie-shopping.js`
- `node-app/client/src/pages/CharlieGoogleShopping.jsx`
- `node-app/test/charlie-google-shopping.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_17.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Google Shopping.
2. Veja um produto sem descrição sincronizada. A falta aparece e nenhum título novo é gravado.
3. Compare um preço da Tray com o preço do ERP da mesma referência. Sem os dois preços, não há diferença.
4. Confira que a lista de recusas do Google permanece vazia enquanto a Tray não enviar esse erro.

## Limites

Não há envio ao Merchant Center. Título e descrição não são reescritos nesta etapa.
