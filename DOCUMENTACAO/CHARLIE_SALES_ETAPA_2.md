# Charlie Sales — Etapa 2: Marketplace Booster

Data: 2026-10-26

A etapa 3 não foi iniciada.

## O que entrou

O Marketplace Booster lê os anúncios já sincronizados da Tray e o estoque do ERP. Cada linha da tabela só aparece quando há evidência: título curto ou ausente, descrição vazia quando o campo veio na sincronização, imagem ausente quando a Tray informou a foto, medidas do cadastro que não aparecem na descrição, queda de venda em janela de pelo menos 28 dias, estoque sem venda quando o histórico tem 30 dias ou mais, margem negativa ou abaixo da mínima quando preço e custo existem, e produto do ERP com estoque sem código correspondente na Tray.

Preço de concorrente não gera linha. A API sincronizada não separa título e descrição por marketplace; o canal da venda entra só na queda de vendas. Foto e produto novo ficam para execução manual, com a limitação gravada no achado. Alteração de preço continua na inteligência de preços.

A sugestão de texto usa nome, marca, referência, categoria, modelo e medidas já cadastrados. Se o Ollama responder, o texto só substitui o do cadastro quando não traz número ou unidade fora desses fatos. A publicação na Tray exige aprovação e permissão de execução, grava o texto anterior e permite reverter.

Quando a análise automática do e-commerce já está ligada, a sincronização da Tray também grava essa leitura. Ela não chama o Ollama.

## Arquivos

Criados:

- `node-app/server/lib/marketplace-booster.js`
- `node-app/client/src/pages/CharlieMarketplaceBooster.jsx`
- `node-app/test/marketplace-booster.test.js`

Alterados:

- `node-app/server/lib/ecommerce-intelligence.js`
- `node-app/server/routes/tray.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/client/src/styles.css`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Banco e endpoints

Nenhuma tabela nova. O resultado fica em `ecommerce_marketplace_booster.json`, no diretório de dados do Dashboard.

- `GET /api/tray/booster`
- `POST /api/tray/booster/analisar`
- `POST /api/tray/booster/:id/sugerir`
- `POST /api/tray/booster/:id/decisao`
- `POST /api/tray/booster/:id/aplicar`
- `POST /api/tray/booster/:id/reverter`

A aplicação de texto reutiliza o `PUT` de produto da Tray. A criação de anúncio novo não é feita por aqui.

## Testes

`npm test`: 313 testes, 0 falhas. Os quatro testes novos cobrem campo ausente, problema sem evidência, sugestão com número estranho, aprovação e preservação do histórico.

## Publicação

Backup: `C:\Administracao\Dashboard\backups\release-20261026-1540-charlie-marketplace-booster`.

A interface `index-Cvg0Rcf6.js` e o `dashboard.mjs` com o Booster foram copiados para `C:\Administracao\node-app`. O pacote do servidor foi gerado sem as alterações locais de financeiro, custo da venda e tarefas do Charlie. A conta atual não conseguiu reiniciar o `SrvDashboard`. O processo que está no ar ainda executa o servidor anterior até um reinício com permissão de administrador. A página inicial já entrega a interface nova.

## Limitações

- Descrição e imagem só viram problema depois que a sincronização gravar esses campos.
- A correspondência com o ERP usa código, código do fabricante, código de barras e referência da Tray.
- A lista guarda os 200 achados de maior prioridade e, entre os sem anúncio, os 40 de maior estoque.
- A foto não é enviada por este comando.
- O anúncio novo não é criado automaticamente, porque a Tray exige categoria, peso e medidas.

## Próxima etapa

Etapa 3 — Charlie Sales Hunter, somente com o comando `ETAPA 2 OK — CONTINUAR PARA ETAPA 3`.
