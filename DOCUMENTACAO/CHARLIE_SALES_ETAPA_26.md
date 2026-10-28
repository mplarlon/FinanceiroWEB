# Charlie Sales — Etapa 26: Central de Alertas

Data: 2026-10-27

A etapa 28 junta as trilhas já gravadas. O detalhe está em `CHARLIE_SALES_ETAPA_28.md`.

## O que entrou

A Central de Alertas mostra a preferência gravada no controle do e-commerce: avisos ligados ou desligados, horário do relatório diário, e-mail, WhatsApp e envio real. Campo que não está no arquivo fica "Não gravado". O padrão do código não completa horário nem canal.

O agrupamento conta os alertas em aberto pelo tipo já gravado. Convertido e encerrado ficam de fora. A lista mostra no máximo 100 alertas e avisa quando há mais.

E-mail e telefone gravados não aparecem. A tela não dispara aviso.

## Arquivos

Criados:

- `node-app/server/lib/charlie-alert-center.js`
- `node-app/server/lib/charlie-alert-center-service.js`
- `node-app/server/routes/charlie-alerts.js`
- `node-app/test/charlie-alert-center.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_26.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/pages/CharlieSalesPanels.jsx`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_24.md`

## Como validar

1. Abra Charlie Sales e a Central de Alertas.
2. Veja avisos, horário, e-mail, WhatsApp e envio real. O que não foi gravado aparece como "Não gravado".
3. Confira o agrupamento por tipo e a lista em aberto.
4. Confira que nenhum endereço ou telefone aparece.

## Limites

A tela não altera a preferência e não envia e-mail nem WhatsApp.
