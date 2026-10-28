# Charlie Sales — Etapa 3: Sales Hunter

Data: 2026-10-26

A etapa 4 passou a usar o WhatsApp da Meta já configurado. O detalhe está em `CHARLIE_SALES_ETAPA_4.md`.

## O que entrou

O Charlie Sales Hunter organiza a prospecção em cima do Charlie Leads. Não há um segundo CRM nem outra fonte cadastral. A pesquisa continua na Casa dos Dados já configurada, com CNAE, segmento cadastrado, município, UF, porte (01, 03 ou 05) e situação cadastral. O texto de atividade só escolhe um segmento quando o nome ou os termos configurados batem com ele.

Cada empresa volta com a conferência do cadastro de clientes do ERP e com o lead já existente pelo CNPJ. Cliente conhecido, lead repetido, cadastro não conferido e pontuação abaixo do mínimo informado ficam de fora da gravação. O botão grava só os marcados como elegíveis, sugere produtos do ERP pelo termo do segmento (ou pelo nome do segmento quando não há termo de produto) e, se pedido, distribui pelos vendedores usando as regras já cadastradas. Sem regra, o lead fica gravado e a distribuição informa o motivo.

A pontuação de 0 a 100 é a mesma prioridade comercial reproduzível do Charlie Leads. A tela e a resposta dizem que isso não é probabilidade de compra. O texto de abordagem é um rascunho para o vendedor, com nome, cidade e atividade que a fonte devolveu. Nada é enviado para fora.

## Arquivos

Criados:

- `node-app/server/lib/charlie-sales-hunter.js`
- `node-app/client/src/pages/CharlieSalesHunter.jsx`
- `node-app/test/charlie-sales-hunter.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_3.md`

Alterados:

- `node-app/server/routes/charlie-leads.js`
- `node-app/server/lib/charlie-leads-service.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/client/src/styles.css`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Sales Hunter.
2. Escolha segmento ou informe CNAE, município ou UF. A pesquisa só ocorre no botão e usa o crédito da Casa dos Dados quando o resultado não está em cache.
3. Confira as colunas de prioridade e situação: já é lead, já é cliente, ou pode virar lead.
4. Grave os marcados e abra o Charlie Leads. O mesmo CNPJ não gera outro lead.
5. A distribuição só atribui vendedor quando existe regra ativa.

## Limites

A fonte não informa intenção de compra, faturamento nem quadro de funcionários. O porte é o código recebido. Produto sugerido é o nome do cadastro que contém o termo do segmento, não uma compatibilidade técnica inventada. A abordagem não sai por WhatsApp, e-mail ou telefone nesta etapa.
