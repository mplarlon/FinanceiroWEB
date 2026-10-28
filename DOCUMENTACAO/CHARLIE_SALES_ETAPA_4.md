# Charlie Sales — Etapa 4: WhatsApp Sales

Data: 2026-10-26

A etapa 5 monta o rascunho do orçamento. O detalhe está em `CHARLIE_SALES_ETAPA_5.md`.

## O que entrou

O Charlie WhatsApp Sales usa a conta da Meta já configurada em `/api/whatsapp`. Não há outro provedor. Quando a mensagem recebida pede preço, estoque, produto, código ou prazo, o webhook não responde na hora e não chama o assistente livre. A consulta lê o produto no ERP: código, nome, preço da tabela padrão do cadastro (`PRODUTOPRECO` com o preço e a unidade do produto) e saldo somado em `MOVIMENTO`. O rascunho diz quando o preço não está cadastrado e quando não há saldo registrado. O prazo de entrega fica declarado como ausente neste cadastro.

O envio só ocorre no botão Aprovar, com permissão gerencial, e manda o rascunho gravado. Rejeitar não envia. Mensagem que não é consulta comercial continua no fluxo anterior do webhook.

## Arquivos

Criados:

- `node-app/server/lib/charlie-whatsapp-sales.js`
- `node-app/server/lib/charlie-whatsapp-sales-service.js`
- `node-app/client/src/pages/CharlieWhatsAppSales.jsx`
- `node-app/test/charlie-whatsapp-sales.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_4.md`

Alterados:

- `node-app/server/routes/whatsapp.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie WhatsApp Sales.
2. Uma pergunta como "qual o preço e o estoque do cabo" entra na fila, sem sair pelo WhatsApp.
3. O rascunho mostra o preço e o estoque lidos, ou diz que não estão cadastrados.
4. Aprovar envia esse texto. Rejeitar não envia.

## Limites

Não há reserva de estoque, orçamento nem prazo prometido. A tabela de preço é a padrão do produto, não uma negociação. O envio real depende do access token e do phone number id já gravados na configuração do WhatsApp.
