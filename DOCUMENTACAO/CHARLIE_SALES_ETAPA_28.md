# Charlie Sales — Etapa 28: Auditoria do ecossistema

Data: 2026-10-27

O menu não tem outra etapa numerada. O dashboard geral passou a contar, em separado, as oportunidades já gravadas no registro comercial e no e-commerce.

## O que entrou

A Auditoria lê, numa lista só, as trilhas que já existem: ações de e-commerce, Marketplace Booster, Charlie Leads, automações, recompra, sinais de compra, guardião de estoque, Autopilot, compras, campanhas e radar de concorrentes.

Arquivo que não abre fica "Não lida". Arquivo sem a trilha fica "Não lido". Nenhum dos dois vira zero. A lista mostra no máximo 100 eventos e avisa quando há mais.

Leads e automações seguem a sessão: quem não é gerencial vê só o próprio registro. Telefone, e-mail, CNPJ e o texto livre da execução não entram. Responsável vazio fica "Não informado".

## Arquivos

Criados:

- `node-app/server/lib/charlie-sales-audit.js`
- `node-app/server/lib/charlie-sales-audit-service.js`
- `node-app/server/routes/charlie-sales-audit.js`
- `node-app/test/charlie-sales-audit.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_28.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/pages/CharlieSalesPanels.jsx`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_26.md`

## Como validar

1. Abra Charlie Sales e Auditoria.
2. Confira a tabela de trilhas lidas e a lista de eventos.
3. Use o filtro local e confirme que nada é gravado.
4. Confira que telefone, e-mail e CNPJ não aparecem.

## Limites

A tela não cria evento, não altera trilha e não cobre módulos que só guardam consulta, sem histórico de ação.
