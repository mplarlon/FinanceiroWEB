# Charlie Sales — Etapa 9: Rebuy

Data: 2026-10-26

A etapa 10 acompanha o estoque sem alterar quantidade. O detalhe está em `CHARLIE_SALES_ETAPA_10.md`.

## O que entrou

O Charlie Rebuy lê as vendas consideradas: saída não cancelada, status 1 ou 3, fora de `STATUS_ORC` igual a zero e item não cancelado. Para cada cliente e produto, só entra quem tem pelo menos três datas de compra.

A data mostrada é a última compra mais o intervalo mediano entre essas datas. Se essa data cai na janela de 7, 14 ou 30 dias, ou se já passou, o cliente aparece. A prioridade ordena o contato e a tela diz que não é probabilidade de compra.

A quantidade é a mediana observada. Quando não há quantidade, fica em branco. Se o mesmo mês do calendário teve compra em dois anos ou mais, a tela registra isso e não muda a data prevista.

Criar oportunidade grava na lista comercial que já existe, com tipo recompra. Criar tarefa grava uma tarefa planejada no Charlie, para o vendedor do cadastro. As duas ações exigem usuário gerencial, não se repetem e não geram pedido nem mensagem. A consulta da tela não grava nada.

## Arquivos

Criados:

- `node-app/server/lib/charlie-rebuy.js`
- `node-app/server/lib/charlie-rebuy-service.js`
- `node-app/server/routes/charlie-rebuy.js`
- `node-app/client/src/pages/CharlieRebuy.jsx`
- `node-app/test/charlie-rebuy.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_9.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Rebuy.
2. Um produto com duas compras não aparece.
3. Um produto com três datas e a próxima data pelo intervalo dentro da janela aparece, com quantidade mediana ou "não informada".
4. Criar oportunidade e criar tarefa uma vez. A segunda tentativa não duplica.

## Limites

O intervalo mediano não é previsão estatística. A sazonalidade não ajusta a data. A tarefa não entra em contato com o cliente.
