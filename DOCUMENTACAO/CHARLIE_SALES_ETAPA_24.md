# Charlie Sales — Etapa 24: Central de Automações

Data: 2026-10-26

A etapa 26 lê a frequência, o agrupamento e a preferência de aviso já gravados. O detalhe está em `CHARLIE_SALES_ETAPA_26.md`.

## O que entrou

A Central de Automações do Charlie Sales passou a ler o motor que já grava as automações do Charlie. A tela mostra nome, situação, modalidade, ação, agenda e próxima execução.

Horário só aparece quando hora e minuto estão gravados. Destinatário e parâmetro não saem na lista. Quem não é gerencial vê só a automação que ele mesmo criou, a mesma regra do motor.

A tela não confirma, não pausa e não executa. A preparação continua no Charlie, com a confirmação que já existia.

## Arquivos

Criados:

- `node-app/server/lib/charlie-automation-center.js`
- `node-app/server/lib/charlie-automation-center-service.js`
- `node-app/server/routes/charlie-automation-center.js`
- `node-app/client/src/pages/CharlieAutomationCenter.jsx`
- `node-app/test/charlie-automation-center.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_24.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_22.md`

## Como validar

1. Abra Charlie Sales e a Central de Automações.
2. Veja o aviso de que nada foi executado.
3. Se houver automação gravada, a situação é o texto já salvo.
4. O filtro só reduz a lista já carregada.

## Limites

Modo, margem mínima e limite de alteração continuam nas Configurações. Esta tela não cria automação.
