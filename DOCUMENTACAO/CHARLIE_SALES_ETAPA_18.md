# Charlie Sales — Etapa 18: SEO

Data: 2026-10-26

A etapa 19 sugere pares comprados juntos. O detalhe está em `CHARLIE_SALES_ETAPA_19.md`.

## O que entrou

O Charlie SEO sugere título, descrição e caminho com os campos que a Tray já sincronizou e, quando a referência existe, com o nome do produto no ERP.

Descrição que não veio na sincronização continua ausente. O texto vazio não vira um parágrafo novo. Marca e modelo só entram no título sugerido quando já estão no cadastro e ainda não aparecem no nome. O nome do ERP só substitui o título quando a Tray não tem nome útil.

O caminho é um rascunho gerado do título sugerido. Não é a URL publicada. A URL da loja não veio na sincronização e fica em branco. Caminho igual em dois produtos aparece como repetido.

A tela não grava título, descrição nem URL.

## Arquivos

Criados:

- `node-app/server/lib/charlie-seo.js`
- `node-app/server/lib/charlie-seo-service.js`
- `node-app/server/routes/charlie-seo.js`
- `node-app/client/src/pages/CharlieSeo.jsx`
- `node-app/test/charlie-seo.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_18.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_17.md`

## Como validar

1. Abra Charlie Sales e o item Charlie SEO.
2. Veja um produto sem descrição sincronizada. A falta aparece e nenhum texto novo é gravado.
3. Confira que a URL publicada permanece “não sincronizada”.
4. Confira que marca e modelo só aparecem no título quando já existem no cadastro.

## Limites

Não há publicação na Tray nem consulta a ferramenta de busca. Volume de busca e posição no Google não são estimados.
