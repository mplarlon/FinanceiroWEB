# Charlie Sales — Etapa 7: Price Intelligence

Data: 2026-10-26

A etapa 8 compara só referências cadastradas. O detalhe está em `CHARLIE_SALES_ETAPA_8.md`.

## O que entrou

O Charlie Price Intelligence lê o preço e o custo já sincronizados da Tray. A margem é `(preço - custo) / preço`. Sem custo, a margem fica indisponível. Imposto, comissão, taxa financeira e frete não entram na conta e a tela diz isso.

O preço mínimo pela margem configurada é `custo / (1 - margem)`. Dá para gravar um piso por produto e uma margem mínima por canal que já apareceu nos pedidos sincronizados. Canal desconhecido é recusado.

A simulação aceita desconto ou reajuste. Ela mostra a margem nova, se ficou abaixo da mínima, abaixo do piso ou acima do teto de alteração. Produto bloqueado na configuração atual continua bloqueado.

Propor grava uma ação de preço pendente na central que já existe. O preço da loja não muda nessa etapa. No modo somente análise, nada é gravado. No modo automático, proposta fora da margem ou do teto também não é gravada. No modo manual, o excesso de teto pode ir para aprovação.

A comparação por canal usa quantidade e receita dos pedidos sincronizados e desconta só o custo do cadastro. A taxa do marketplace fica em branco.

## Arquivos

Criados:

- `node-app/server/lib/charlie-price-intelligence.js`
- `node-app/server/lib/charlie-price-intelligence-service.js`
- `node-app/client/src/pages/CharliePriceIntelligence.jsx`
- `node-app/test/charlie-price-intelligence.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_7.md`

Alterados:

- `node-app/server/routes/tray.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Price Intelligence.
2. Confira produto sem custo: margem e preço mínimo indisponíveis.
3. Simule um desconto. A margem nova usa o custo real.
4. Tente propor no modo somente análise. Nenhuma ação é gravada.
5. Grave piso e margem só de canal que já aparece na tabela.

## Limites

A contribuição por canal não é lucro operacional. Falta imposto, comissão, taxa e frete. A execução do novo preço continua na central de ações, com aprovação.
