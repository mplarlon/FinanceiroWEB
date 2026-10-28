# Charlie Sales — Etapa 21: Customer 360°

Data: 2026-10-26

A etapa 22 acompanha a meta já gravada e o faturamento do período. O detalhe está em `CHARLIE_SALES_ETAPA_22.md`.

## O que entrou

O Charlie Customer 360° junta, por cliente, a compra do último ano, o orçamento com status aberto e o lead local já ligado ao código do cliente.

A contagem e a soma saem do pedido e do orçamento antes de buscar o nome do cliente. O cadastro do mesmo cliente em mais de uma empresa não multiplica o total. A receita só soma pedido que tem total. Se algum pedido do cliente não tem total, a receita da ficha fica em branco. Orçamento sem valor não vira zero. Lead convertido, perdido ou descartado não aparece como pendência. A pendência mostrada é "Orçamento em aberto", o status do lead ainda aberto, ou "Sem pendência registrada" quando as duas leituras ocorreram e não acharam nada.

A compra para nos 200 clientes mais recentes. A tela mostra no máximo 100 fichas e avisa que não é a base inteira. Venda sem código de cliente fica de fora. A tela não grava cadastro e não dispara contato.

## Arquivos

Criados:

- `node-app/server/lib/charlie-customer360.js`
- `node-app/server/lib/charlie-customer360-service.js`
- `node-app/server/routes/charlie-customer360.js`
- `node-app/client/src/pages/CharlieCustomer360.jsx`
- `node-app/test/charlie-customer360.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_21.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_20.md`

## Como validar

1. Abra Charlie Sales e o item Charlie Customer 360°.
2. Veja uma ficha com receita ou com "Não informado" quando o total do pedido não veio.
3. Confira a pendência. Ela cita orçamento em aberto ou lead já registrado.
4. Use o filtro. Ele só reduz a lista já carregada.

## Limites

A ficha não traz telefone, não cria tarefa e não converte lead em cliente. Imposto e taxa do canal continuam fora desta tela.
