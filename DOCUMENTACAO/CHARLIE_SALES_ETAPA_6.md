# Charlie Sales — Etapa 6: Recovery

Data: 2026-10-26

A etapa 7 simula preço em cima do custo sincronizado. O detalhe está em `CHARLIE_SALES_ETAPA_7.md`.

## O que entrou

O Charlie Recovery lê oportunidades que já existem no ERP e no Charlie Leads. Não cria outra carteira.

Entram na lista:

- Orçamento com status aberto, cancelamento vazio e data anterior ao prazo informado. O valor é o do orçamento, não uma estimativa de fechamento.
- Cliente ativo com `DTULTCOMPRA` anterior ao prazo. O histórico de compras aparece separado. Ele não vira valor potencial.
- Cliente cuja venda dos últimos 90 dias ficou pelo menos 30% abaixo dos 90 dias anteriores. A diferença é queda observada. A causa não é inferida.
- Saída não cancelada com `STATUS_ORC=0`, status que o faturamento já deixa fora da venda.
- Lead do Charlie Leads em negociação ou orçamento sem atualização no prazo. O valor só soma orçamento já localizado.

Carrinho abandonado fica como lacuna. A sincronização da Tray não guarda esse dado, e nenhum carrinho foi criado para preencher a lista.

A prioridade de 0 a 100 junta valor de referência e idade. A tela diz que isso não é probabilidade de recuperação. Não há data de último contato; a idade usa a data do documento ou da última compra. A frequência é a contagem de pedidos em 365 dias, quando a consulta devolve.

Tarefa, mensagem, alerta ao vendedor, campanha e retorno ficam gravados no Charlie. A campanha nasce não publicada. Nada é enviado por WhatsApp, e-mail ou telefone.

## Arquivos

Criados:

- `node-app/server/lib/charlie-recovery.js`
- `node-app/server/lib/charlie-recovery-service.js`
- `node-app/server/routes/charlie-recovery.js`
- `node-app/client/src/pages/CharlieRecovery.jsx`
- `node-app/test/charlie-recovery.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_6.md`

Alterados:

- `node-app/server/index.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Recovery.
2. Atualize. A lista só mostra documento mais antigo que o prazo.
3. Abra um item e confira o rascunho, a idade e o aviso de que não é probabilidade.
4. Registre tarefa, mensagem e resultado. Nada sai para o cliente.
5. A frase de carrinho abandonado aparece nas lacunas.

## Limites

Não há consentimento de contato nesta tela, por isso o envio externo não existe. O resultado "recuperado" não lança venda nem receita.
