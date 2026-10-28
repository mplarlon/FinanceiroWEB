# Charlie Sales — Etapa 13: Product Match

Data: 2026-10-26

A etapa 14 registra sinais públicos informados. O detalhe está em `CHARLIE_SALES_ETAPA_14.md`.

## O que entrou

O Charlie Product Match lê produtos ativos que têm código de fabricante ou produto similar, e a tabela de kits. A consulta não grava equivalência.

Um par só aparece quando o código de fabricante coincide, o campo de produto similar aponta um código que existe, ou dois códigos estão no mesmo kit. Nome parecido não gera par.

Marca diferente fica como marca alternativa. Medida diferente fica como divergência. Substituto cadastrado e kit complementar também aparecem. Em todos os casos a compatibilidade técnica fica não confirmada, porque material e aplicação não estão neste cadastro.

## Arquivos

Criados:

- `node-app/server/lib/charlie-product-match.js`
- `node-app/server/lib/charlie-product-match-service.js`
- `node-app/server/routes/charlie-product-match.js`
- `node-app/client/src/pages/CharlieProductMatch.jsx`
- `node-app/test/charlie-product-match.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_13.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Product Match.
2. Dois produtos com o mesmo nome e códigos de fabricante diferentes não formam par.
3. O mesmo código de fabricante com outra marca aparece como marca alternativa e compatibilidade não confirmada.
4. Um código no campo de produto similar só liga se esse código existir no cadastro.

## Limites

A tela não declara produto equivalente nem tecnicamente compatível. Não altera o cadastro.
