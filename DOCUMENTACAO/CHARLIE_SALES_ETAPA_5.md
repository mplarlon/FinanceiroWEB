# Charlie Sales — Etapa 5: Smart Quotes

Data: 2026-10-26

A etapa 6 lista oportunidades paradas. O detalhe está em `CHARLIE_SALES_ETAPA_6.md`.

## O que entrou

O Charlie Smart Quotes lê uma lista comercial e procura os itens no cadastro que o Automec já usa. A entrada pode ser texto colado do WhatsApp ou do e-mail, CSV, planilha XLSX ou PDF com texto. Imagem não é interpretada e não gera item.

Cada linha precisa de um produto reconhecível e, para fechar o valor, de uma quantidade. Código igual a `CDPRODUTO`, código do fabricante ou código de barras entra direto. Nome parecido, seja um ou vários, fica para escolha. O código que não existe não é trocado por outro produto: não há tabela de equivalência técnica no ERP.

Preço é o da tabela padrão do produto. Estoque é a soma de `MOVIMENTO`. Os dois ficam em branco quando o cadastro não tem o dado. O total soma só item encontrado ou escolhido, com quantidade e preço. Não reserva estoque e não promete prazo.

Confirmar grava o rascunho no Charlie. Não insere `ORCAMENTO` nem `ORCPROD`. A tela do Automec continua sendo o orçamento oficial, porque o item de lá leva ICMS, ST, custo e comissão.

Uma lista recebida no WhatsApp, que não seja pergunta de preço ou estoque, também abre esse rascunho e não recebe resposta automática.

## Arquivos

Criados:

- `node-app/server/lib/charlie-smart-quotes.js`
- `node-app/server/lib/charlie-smart-quotes-service.js`
- `node-app/server/routes/charlie-quotes.js`
- `node-app/client/src/pages/CharlieSmartQuotes.jsx`
- `node-app/test/charlie-smart-quotes.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_5.md`

Alterados:

- `node-app/server/index.js`
- `node-app/server/routes/whatsapp.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/client/src/styles.css`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Smart Quotes.
2. Cole `10 cabo flexível` e `CABO123;4`. Monte o rascunho.
3. Onde houver mais de um produto, escolha um. Sem escolha, a confirmação recusa.
4. Confira preço, estoque e total. Confirmar mostra que nada foi gravado no Automec.
5. Envie uma imagem: a resposta diz que ela não foi lida.

## Limites

PDF escaneado sem texto e planilha XLS antiga não entram. O rascunho não vira o número de orçamento do ERP.
