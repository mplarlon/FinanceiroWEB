# Charlie Sales — Etapa 22: Sales Mission

Data: 2026-10-26

Não há etapa 23 no menu. A etapa 24 mostra o motor de automações que já existe. O detalhe está em `CHARLIE_SALES_ETAPA_24.md`.

## O que entrou

O Charlie Sales Mission lista a meta que já está gravada no Charlie Daily ou nos relatórios gerenciais. Meta vazia ou zero não vira missão.

O realizado é o faturamento do período. A meta mensal usa o mês corrente e o prazo é o último dia. A diária usa o dia de hoje. A semanal vai de segunda até hoje e o prazo mostrado é o domingo. Se algum pedido do grupo não tem total, o realizado fica em branco e o atingimento também. Zero gravado no pedido conta.

A meta de equipe aparece sem realizado, porque o cadastro não traz a lista de vendedores da equipe. A tela não grava plano e não dispara contato.

## Arquivos

Criados:

- `node-app/server/lib/charlie-sales-mission.js`
- `node-app/server/lib/charlie-sales-mission-service.js`
- `node-app/server/routes/charlie-mission.js`
- `node-app/client/src/pages/CharlieSalesMission.jsx`
- `node-app/test/charlie-sales-mission.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_22.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_21.md`

## Como validar

1. Abra Charlie Sales e o item Charlie Sales Mission.
2. Se houver meta gravada, veja meta, realizado e prazo. Se o total do pedido não veio, o realizado fica "Não consultado".
3. Se não houver meta, a tela diz que nenhuma missão foi criada.
4. O filtro só reduz a lista já carregada.

## Limites

A tela não cria meta, não projeta o fechamento do mês e não monta um roteiro de contato.
