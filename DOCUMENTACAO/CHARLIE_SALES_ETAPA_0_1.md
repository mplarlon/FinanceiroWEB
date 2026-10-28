# Charlie Sales Ecosystem — Etapas 0 e 1

Data: 2026-10-26

A etapa 2 não foi iniciada.

## Etapa 0 — Auditoria

### Backend

- Node.js 20, Express 5, módulos ESM.
- Rotas por domínio em `node-app/server/routes` e regras em `node-app/server/lib`.
- Acesso ao ERP por Firebird (`node-firebird-driver-native`), com SQL parametrizado. Não há ORM.
- Configuração, leads, monitoramento, automações e e-commerce auxiliar ficam em JSON atômico em `C:\Administracao\Dashboard`.
- Autenticação por sessão, contra `USUARIOS` e `SIS_OPERACAOUSUARIO`. As rotas `/api` exigem sessão, com poucas exceções públicas.
- Permissão gerencial e, no e-commerce, listas opcionais de quem aprova, executa e configura (`canEcommerce`).
- Agendadores no próprio processo: monitoramento, automações, café da manhã, leads e sincronização Tray. Não há fila externa.
- Integrações já presentes: Tray, Ollama, WhatsApp, boletos, fiscal, e-mail e relatórios.

### Frontend

- React 19 e Vite 7. A navegação é estado em `client/src/App.jsx`, sem roteador externo.
- Visual único em `client/src/styles.css` (grafite `#29292b` e laranja `#fb590a`).
- Estado local dos componentes. Painéis existentes: visão geral, Charlie, financeiro, caixa, DRE, estoque, compras, clientes, fiscal, executivo e e-commerce.

### Charlie e Ollama

- Ollama é uma instância só, em `server/lib/ollama.js`. Interpreta e redige. Cálculo e gravação ficam em serviços determinísticos.
- Há catálogo de tarefas, confirmação antes de escrita, guarda de SQL, histórico, auditoria, automações, comercial, abastecimento, leads, previsão e modo executivo.
- Resposta do modelo não é executada como comando.

### E-commerce Tray

- OAuth, renovação de token, pedidos, produtos, clientes, webhook, sincronização paginada e estúdio de produto.
- `ecommerce-intelligence.js` consolida pedidos e calcula faturamento, quantidade, ticket, canais e produtos. Margem e lucro operacional permanecem indisponíveis até haver custo, imposto e taxa.
- `ecommerce-advanced.js` gera oportunidades, risco de estoque, ações com aprovação, reversão de preço e campanhas em rascunho.
- Marketplace é identificado quando o pedido traz a origem. Não há integração separada por canal.

### CRM

- Charlie Leads cobre busca, CNPJ, qualificação, gravação e distribuição no fluxo já existente.
- Clientes, orçamentos, vendedores e sinais de inatividade/recompra existem em módulos comerciais do Charlie e do ERP. Customer 360, missões e coach ainda não têm tela própria.

### Mapa para as próximas etapas

| Situação | Onde já está | Entra depois |
| --- | --- | --- |
| Pronto para reutilizar | Tray, Intelligence, Leads, ações, campanhas em rascunho, Ollama, permissão gerencial | — |
| Parcial | Preço e estoque estimados, oportunidades, histórico de ações, modo de automação | Etapas 7, 10, 12, 20, 24, 26 e 28 ampliam o que a tela já mostra |
| Ausente como módulo | Booster, Hunter, WhatsApp Sales, orçamento inteligente, recovery completo, rebuy, radar, Shopping, SEO, kits, compras inteligentes, coach, sinais de compra, equivalência, missões e o motor único de oportunidades | Etapas 2 a 6, 8, 9, 11 e 13 a 23 |

Nenhuma migração Firebird foi necessária na etapa 1. Stores JSON continuam sendo o padrão até o volume justificar tabela.

### Riscos

- A API da Tray não garante comissão, taxa, imposto, custo, carrinho abandonado nem o detalhe de cada marketplace.
- Margem apresentada como número fechado seria fictícia com os dados atuais.
- JSON auxiliar não substitui o ERP e pode crescer com a sincronização.
- O limite documentado da Tray é 180 requisições por minuto.
- O ERP precisa seguir operando com o Ollama indisponível.
- O fonte local tem alterações de financeiro e de tarefas do Charlie que não pertencem a esta etapa. O pacote do servidor não foi republicado para não levá-las à produção.

## Etapa 1 — Painel

### Entrega

- Menu lateral do Charlie Sales, com os grupos Visão geral, Vendas, E-commerce, Prospecção, Gestão e Administração.
- Dashboard Geral com os dez indicadores pedidos, lidos da Tray e do controle do Charlie.
- Disposição dos indicadores no navegador: ordem, ocultar, mostrar e restaurar.
- Charlie Intelligence, Loja Tray e Charlie Leads permanecem nas entradas correspondentes.
- Preço, estoque, campanhas, automações, histórico e configurações abrem as telas que já existiam.
- Alertas, permissões e auditoria leem o controle já gravado.
- Módulos das etapas 2 em diante aparecem no menu com o número da etapa, sem indicador inventado.

### Arquivos criados

- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/client/src/pages/CharlieSalesDashboard.jsx`
- `node-app/client/src/pages/CharlieSalesPanels.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

### Arquivos alterados

- `node-app/client/src/pages/TrayIntegration.jsx`
- `node-app/client/src/pages/EcommerceIntelligence.jsx`
- `node-app/client/src/App.jsx`
- `node-app/client/src/styles.css`

### Reutilizado

- `GET /api/tray/intelligence/dashboard`
- `GET /api/tray/intelligence/control`
- `POST /api/tray/sincronizar`
- Componentes de Intelligence, Loja Tray e Charlie Leads
- Sessão do ERP e senha adicional da Tray

### Banco, endpoints e integrações novas

- Nenhuma tabela, endpoint ou integração nova.
- Nenhum componente de marketplace, WhatsApp ou CRM novo.

### Testes

`npm test` em `node-app`: 309 testes, 0 falhas. Os quatro testes novos cobrem menu, disposição, ausência de margem inventada, contagem de oportunidades e leitura de auditoria.

`npm run build` gerou `dist/assets/index-CiqkN8DY.js`. A compilação deixou de fora a alteração local ainda em andamento de `FinanceAccounts.jsx`.

### Publicação

- Backup: `C:\Administracao\Dashboard\backups\release-20261026-1517-charlie-sales-etapa-1`
- Interface publicada em `C:\Administracao\node-app\dist`
- `http://localhost:805/` responde o `index-CiqkN8DY.js`, que contém o menu e o dashboard.
- `dashboard.mjs` não foi substituído.
- A conta atual não conseguiu reiniciar `SrvDashboard`. O processo continuou em execução e já entrega os arquivos novos, porque o HTML é lido do disco a cada acesso.

### Limitações

- A personalização fica no navegador de quem ajustou os indicadores.
- Faturamento, pedidos, ticket e canais respeitam o período. Oportunidades, alertas, produtos com problema, recuperações e ações executadas vêm do registro inteiro do Charlie.
- Margem de contribuição segue indisponível enquanto custo, imposto e comissão não estiverem conciliados.
- Cliente recuperado só entra na conta quando a oportunidade de recuperação está convertida.
- A navegação até o fim da tela exige login do ERP. A verificação no navegador parou na tela de entrada. O pacote publicado e os testes cobrem a composição dos indicadores.

### Próxima etapa

Etapa 2 — Charlie Marketplace Booster. Só começa com o comando `ETAPA 1 OK — CONTINUAR PARA ETAPA 2`.
