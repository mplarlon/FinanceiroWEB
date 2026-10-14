# Arquitetura e mapa do sistema

## Visão geral

```text
Navegador
  -> React/Vite (`node-app/client`)
  -> HTTP `/api`
  -> Express (`node-app/server/index.js`)
  -> rotas por domínio (`node-app/server/routes`)
  -> driver nativo (`node-app/server/db.js`)
  -> Firebird/Automec

Serviços opcionais: Ollama, Meta WhatsApp, APIs bancárias, SMTP e SEFAZ/ACBr.
```

O mesmo processo Express serve a API e os arquivos compilados de
`node-app/dist`. Em desenvolvimento, o Vite atende a interface e encaminha a
API ao servidor local.

## Diretórios importantes

| Caminho | Finalidade |
|---|---|
| `node-app/client/src` | interface React, páginas, componentes e CSS |
| `node-app/server` | servidor, autenticação, banco, rotas e agendador |
| `node-app/test` | testes com `node:test` |
| `node-app/scripts` | inventário/auditoria de rotas e utilitários |
| `installer` | definição do instalador Inno Setup |
| `Firebird-5.0.4` | cliente Firebird empacotável (não versionado) |
| `DOCUMENTACAO` | documentação de continuidade |
| `acbr` | arquivos e evidências ligados à automação fiscal |

## Banco e transações

`server/db.js` escolhe `DASHBOARD_FBCLIENT`, o `fbclient.dll` empacotado ou a
biblioteca padrão. Leituras usam transações `READ_ONLY`. Escritas usam
`withWriteTransaction`, com commit único e rollback em erro. O charset legado
`WIN1252` é convertido para `windows-1252`; buffers textuais são normalizados.

Tabelas principais do ERP incluem `CTARECEBER`, `CTAPAGAR`, `CLIENTE`,
`FORNECEDOR`, `RECEBTO`, `PAGTO`, `CENTROCUSTO`, `CONTAS` e seus níveis.
Tabelas auxiliares do dashboard usam, em geral, prefixos `DASH_`,
`DASHBOARD_`, `FISCAL_` ou nomes de conciliação.

## Contas financeiras

- `FinanceAccounts.jsx` mantém filtros e dados sem navegar para outra página.
- `finance-accounts.js` parametriza filtros e executa criação/baixa/acordo.
- Receber usa cadastros `RECEBTO`; pagar usa `PAGTO`.
- A hierarquia de categoria é `CDCONTA` → `CDSUBCONTA` →
  `CDSUBSUBCONTA` → `CDSUBSUBSUBCONTA`.
- Centro de custo é `CCUSTO` e aparece no mesmo bloco de classificação.
- Um acordo muda o status dos títulos originais e clona o título modelo para
  gerar as novas parcelas; vínculos são registrados em `DASH_FIN_ACORDO*`.

## Autenticação e segurança

O login consulta `USUARIOS` e exige permissão de Dashboard em
`SIS_OPERACAOUSUARIO`. Sessões aleatórias vivem por uma hora e são persistidas
em `sessions.json` no diretório de dados. O cookie é HTTP-only e SameSite Lax;
em HTTPS, configurar `DASHBOARD_COOKIE_SECURE=true`.

Nunca versionar `start.ini`, tokens, senhas, certificados, sessões ou arquivos
de configuração reais. Os arquivos `*.example.json` documentam formatos sem
ser fonte de segredo.

## Relatórios da segunda etapa

`ExecutiveReports.jsx` consome `/api/relatorios-gerenciais/*`. O fluxo de caixa
projetado calcula cenários otimista, provável e pessimista para horizontes,
com saldo inicial selecionável, títulos a receber/pagar e capital de giro. Os
demais relatórios cobrem realizado, margens, fornecedores, períodos,
vendedores, estoque, metas, retenção e alertas.

