# Charlie Sales — Etapa 14: Buying Signals

Data: 2026-10-26

A etapa 15 sugere compra com os dados do ERP. O detalhe está em `CHARLIE_SALES_ETAPA_15.md`.

## O que entrou

O Charlie Buying Signals guarda licitação, edital, demanda, notícia, abertura de unidade, investimento ou projeto que alguém registrou. Ele não abre página e não busca esses avisos na internet.

Fonte, data e empresa são obrigatórias. O segmento só vincula quando o nome coincide com um segmento já cadastrado no Charlie Leads. Produto só entra quando o código informado existe no ERP. Sem esse código, a tela diz que não dá para afirmar que a empresa precisa comprar um item.

A relevância ordena o acompanhamento e não é probabilidade de compra. A abordagem fica em rascunho e não é enviada. Criar oportunidade grava na lista comercial já existente, exige usuário gerencial e não se repete. A consulta não grava oportunidade.

## Arquivos

Criados:

- `node-app/server/lib/charlie-buying-signals.js`
- `node-app/server/lib/charlie-buying-signals-service.js`
- `node-app/server/routes/charlie-signals.js`
- `node-app/client/src/pages/CharlieBuyingSignals.jsx`
- `node-app/test/charlie-buying-signals.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_14.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Buying Signals.
2. Registre um edital com fonte, data e empresa, sem código de produto. A linha não afirma compra.
3. Informe um código que existe no ERP. O produto aparece pelo cadastro.
4. Crie a oportunidade uma vez. A segunda não duplica e nenhuma mensagem sai.

## Limites

Não há varredura de licitações nem de notícias. O rascunho não é enviado.
