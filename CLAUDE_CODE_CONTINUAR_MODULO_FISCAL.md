# Handoff para continuar o Modulo Fiscal no Dashboard

Data: 2026-06-10
Workspace: `C:\Dashboard`

## Estado atual

O usuario pediu para comecar o desenvolvimento do modulo fiscal.

Ja foi feito:

- Analise inicial do schema Firebird.
- Documento tecnico consolidado criado em:
  - `C:\Dashboard\FISCAL_MODULO_DESENHO_TECNICO.md`
- Mapeamento inicial da estrutura do Dashboard concluido:
  - Backend principal: `backend.py`.
  - Frontend principal: `dashboard\index.html`.
  - Padrao recomendado: criar modulo separado `fiscal_dashboard.py` e registrar em `backend.py`.
  - Tabs do frontend usam `showTab(tab, el)`, `loadTab(tab)` e `chartsLoaded`.
  - APIs usam prefixo `window.location.origin + '/api'`.
- Nenhuma tabela foi criada ainda.
- Nenhum campo foi criado ainda.
- Nenhum codigo de producao foi alterado ainda, alem dos documentos Markdown.

Arquivo criado nesta etapa de handoff:

- `C:\Dashboard\CLAUDE_CODE_CONTINUAR_MODULO_FISCAL.md`

## Pedido mais recente do usuario

Antes de acabar tokens/parar de trabalhar, gravar um arquivo dizendo o que falta para o Claude Code continuar.

Depois disso, a tarefa ativa e continuar implementando o modulo fiscal.

## Protocolo de continuidade pedido pelo usuario

Atualizar este arquivo ao final de cada topico/bloco concluido.

Exemplos:

- terminou de mapear estrutura/backend/frontend: atualizar este handoff;
- terminou de adicionar migracoes: atualizar este handoff;
- terminou login/permissao: atualizar este handoff;
- terminou APIs fiscais: atualizar este handoff;
- terminou tela/grade: atualizar este handoff;
- terminou testes: atualizar este handoff.

Cada atualizacao deve registrar:

- status do bloco;
- arquivos alterados;
- decisoes tecnicas relevantes;
- pendencias e proximo passo.

## Status por topico

- [x] Mapear estrutura atual do backend/frontend e padroes de rotas.
- [x] Adicionar migracoes idempotentes para campos/tabelas fiscais e auditoria.
- [x] Implementar login, sessao e permissao gerencial.
- [x] Implementar APIs fiscais MVP com resumo, grade e regras.
- [x] Adicionar tela Apuracao Fiscal no Dashboard.
- [x] Testar endpoints e fluxo basico localmente.

## Atualizacao - migracoes idempotentes concluidas

Status: concluido.

Arquivos alterados:

- `C:\Dashboard\fiscal_dashboard.py`
- `C:\Dashboard\backend.py`

O que foi implementado:

- Novo modulo `fiscal_dashboard.py`.
- Funcao `ensure_fiscal_schema(cur)` para criar estruturas fiscais/auditoria de forma idempotente.
- Rotas:
  - `POST /api/fiscal/migrations/apply`
  - `GET /api/fiscal/migrations/status`
- Registro do modulo fiscal em `backend.py`.

O que foi aplicado no Firebird:

- Tabelas criadas:
  - `FISCAL_REGRA_OPERACAO`
  - `FISCAL_REGRA_OPERACAO_HIST`
  - `FISCAL_REVISAO_ITEM`
  - `DASHBOARD_LOGIN_AUDIT`
- Sequences criadas:
  - `GEN_FISCAL_REGRA_OPERACAO_ID`
  - `GEN_FISCAL_REGRA_OPERACAO_H_ID`
  - `GEN_FISCAL_REVISAO_ITEM_ID`
  - `GEN_DASHBOARD_LOGIN_AUDIT_ID`
- Triggers criadas:
  - `BI_FISCAL_REGRA_OPERACAO`
  - `BI_FISCAL_REGRA_OPERACAO_H`
  - `BI_FISCAL_REVISAO_ITEM`
  - `BI_DASHBOARD_LOGIN_AUDIT`
- Campos adicionados em `CONFIGURACAO`:
  - `TOLERANCIA_FISCAL`
  - `INDUSTRIA`
- Campos adicionados em `CTAPAGAR`:
  - `ABATE_PIS_COFINS`
  - `BASE_PIS_COFINS_ABATE`
  - `PIS_ALIQ_ABATE`
  - `COFINS_ALIQ_ABATE`
  - `GERA_CREDITO_PIS_COFINS`
  - `OBS_FISCAL_ABATE`
  - `STATUS_FISCAL_ABATE`
  - `MOTIVO_REVISAO_ABATE`

Validacao:

- `python -m py_compile backend.py fiscal_dashboard.py` executou sem erros.
- A migracao foi executada uma segunda vez e retornou `total_changes 0`, confirmando idempotencia.

Proximo passo:

- Implementar login, sessao e permissao gerencial usando `USUARIOS` e `SIS_OPERACAOUSUARIO.IDOPERACAO = 900`.

## Atualizacao - login, sessao e permissao concluidos

Status: concluido no backend.

Arquivos alterados:

- `C:\Dashboard\backend.py`
- `C:\Dashboard\fiscal_dashboard.py`

O que foi implementado:

- `backend.py` agora configura `app.secret_key` e flags basicas de cookie de sessao:
  - `SESSION_COOKIE_HTTPONLY=True`
  - `SESSION_COOKIE_SAMESITE='Lax'`
  - `SESSION_COOKIE_SECURE` configuravel via env `DASHBOARD_COOKIE_SECURE`.
- Rotas novas:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/session`
- Protecao global das APIs via `before_request`:
  - libera `/api/status`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/session` e webhook WhatsApp;
  - demais `/api/*` exigem sessao valida.
- Sessao:
  - expira em 1 hora desde login;
  - expira em 30 minutos sem acao;
  - atualiza `last_action_at` em requisicoes protegidas.
- Login:
  - usa `USUARIOS.LOGIN`;
  - bloqueia senha vazia;
  - bloqueia `INATIVO = 1`;
  - valida senha por XOR repetido com chave hex `C4 3A 1B`.
- Permissao:
  - exige existir `SIS_OPERACAOUSUARIO` com `IDUSUARIO`, `IDOPERACAO = 900`, `APPID = 1` e `IDMENUITEM` de uma pagina do Dashboard;
  - `SIS_MAINMENU` recebe automaticamente um `IDMENUITEM` para cada pagina do Dashboard na faixa `9000..9017`.
- Auditoria:
  - registra login sucesso, falha e logout em `DASHBOARD_LOGIN_AUDIT`;
  - grava IP/origem.

Validacao executada:

- `python -m py_compile backend.py fiscal_dashboard.py` sem erros.
- Teste com Flask `test_client`:
  - antes do login, `/api/schema` retornou `401`;
  - login `CAROL` / `2907` retornou sucesso;
  - apos login, `/api/fiscal/migrations/status` retornou `200`;
  - logout retornou sucesso;
  - sessao final ficou nao autenticada.

Proximo passo:

- Implementar APIs fiscais MVP: filtros/options, resumo/cards, grade analitica inicial, detalhe e regras fiscais iniciais.

## Atualizacao - APIs fiscais MVP concluidas

Status: concluido para o MVP backend.

Arquivos alterados:

- `C:\Dashboard\fiscal_dashboard.py`

Rotas implementadas:

- `GET /api/fiscal/options`
- `POST /api/fiscal/regras/carga-inicial`
- `GET /api/fiscal/regras`
- `POST /api/fiscal/regras`
- `PUT /api/fiscal/regras/<idregra>`
- `POST /api/fiscal/regras/<idregra>/inativar`
- `GET /api/fiscal/apuracao/resumo`
- `GET /api/fiscal/apuracao/itens`
- `GET /api/fiscal/apuracao/nota/<chave>`
- `POST /api/fiscal/revisao-item`

O que as APIs ja fazem:

- Retornam empresas, CFOPs, CST/CSOSN, tipos de nota, origens e status para filtros.
- Geram carga inicial de regras a partir do historico de `NFE_PRODUTO`/`NFE`.
- Mantem regras fiscais com criar/editar/inativar.
- Gravam historico de regras em `FISCAL_REGRA_OPERACAO_HIST`.
- Calculam resumo de apuracao a partir de `NFE`/`NFE_PRODUTO`.
- Incluem despesas `CTAPAGAR` marcadas com `ABATE_PIS_COFINS = 1`.
- Retornam grade analitica com origem `NFE` ou `CTAPAGAR`.
- Retornam detalhe da nota por chave.
- Permitem gravar revisao manual em `FISCAL_REVISAO_ITEM`.

Validacao executada:

- `python -m py_compile fiscal_dashboard.py backend.py` sem erros.
- Login `CAROL` / `2907` validado via `test_client`.
- `POST /api/fiscal/regras/carga-inicial` processou 595 combinacoes historicas:
  - `created`: 171
  - `skipped`: 424
- `GET /api/fiscal/apuracao/resumo?data_inicio=2026-05-01&data_fim=2026-05-31` retornou valores de ICMS/PIS/COFINS.
- `GET /api/fiscal/apuracao/itens?data_inicio=2026-05-01&data_fim=2026-05-31&limit=5` retornou itens com status.
- `GET /api/fiscal/apuracao/nota/<chave>` retornou capa, itens e revisoes.

Pendencias conhecidas para refino posterior:

- Exportacao Excel/PDF ainda nao foi implementada.
- A regra de comparacao calculado x importado ainda esta simples: calculado inicialmente igual ao importado.
- A selecao de regra fiscal ainda pode duplicar linhas se houver regras concorrentes; precisa refinamento por prioridade em SQL/Python.
- Revisao manual grava historico, mas a apuracao ainda nao aplica automaticamente o ultimo valor corrigido nos totais.

Proximo passo:

- Adicionar tela visual `Apuracao Fiscal` no `dashboard\index.html`, com login visual, filtros, cards, grade, detalhe e aba de regras.

## Atualizacao - tela Apuracao Fiscal adicionada

Status: concluido no frontend inicial.

Arquivos alterados:

- `C:\Dashboard\dashboard\index.html`

O que foi implementado:

- Overlay/tela de login no carregamento do Dashboard.
- Exibicao do usuario logado no topo.
- Botao `Sair`.
- Nova entrada no menu: `Apuracao Fiscal`.
- Nova aba `tab-apuracao-fiscal`.
- Painel `Apuracao` com:
  - filtros por data, empresa, tipo de nota, origem, CFOP, CST/CSOSN e status;
  - botao atualizar;
  - botao para gerar regras iniciais;
  - botoes visuais de exportacao Excel/PDF ainda pendentes de endpoint;
  - cards de resumo;
  - grade analitica por item;
  - detalhe de nota em modal.
- Painel `Regras Fiscais` com:
  - filtros;
  - listagem de regras;
  - inativacao de regra.
- Funcoes JS adicionadas:
  - `initAuth`
  - `submitLogin`
  - `logoutDashboard`
  - `loadApuracaoFiscal`
  - `loadFiscalOptions`
  - `renderApuracaoCards`
  - `renderApuracaoItens`
  - `seedFiscalRules`
  - `loadFiscalRules`
  - `inactivateFiscalRule`
  - `openFiscalDetail`
  - `closeFiscalDetail`

Pendencias:

- Validar visualmente no navegador.
- Implementar endpoints reais de exportacao Excel/PDF.
- Ligar edicao completa de revisao manual no modal.
- Refinar comparativo calculado x importado.

Proximo passo:

- Testar fluxo local: login, carregamento da tela, filtros, cards, grade, detalhe e regras.

## Atualizacao - testes locais concluidos

Status: concluido para o fluxo MVP inicial.

Validacoes backend:

- `python -m py_compile backend.py fiscal_dashboard.py` executou sem erro.
- Servidor Flask iniciado em `http://localhost:5050`.
- Teste HTTP real com cookie:
  - `/api/auth/session` sem login retornou nao autenticado.
  - `/api/fiscal/options` sem login retornou `401`.
  - `POST /api/auth/login` com `CAROL` / `2907` retornou sucesso.
  - `/api/fiscal/options` autenticado retornou `200`.
  - `/api/fiscal/apuracao/resumo?data_inicio=2026-05-01&data_fim=2026-05-31` retornou resumo com valores.
  - HTML principal contem `tab-apuracao-fiscal` e `login-screen`.

Validacoes frontend no navegador in-app:

- Login visual apareceu quando sem sessao.
- Login `CAROL` / `2907` autenticou.
- Usuario `CAROL` apareceu no topo.
- Nova aba `Apuracao Fiscal` abriu.
- Periodo atual sem movimento mostra cards zerados e grade vazia.
- Periodo `2026-05-01` a `2026-05-31` carregou cards e grade com itens reais.
- Modal de detalhe abriu para a nota `000300522CFE`, mostrando capa e item.
- Aba `Regras Fiscais` abriu e carregou 171 regras.

Correcoes feitas durante teste:

- Corrigido erro JavaScript no `onclick` do botao `Detalhar`, trocando escape quebrado por `&quot;`.

Servidor:

- O backend foi iniciado em segundo plano com `python backend.py`.
- URL local para teste: `http://localhost:5050`.

Pendencias para proxima rodada:

- Implementar exportacao real Excel/PDF.
- Implementar modal completo de revisao manual com abas por imposto.
- Fazer a apuracao considerar a ultima revisao aprovada/corrigida nos totais.
- Refinar regra de prioridade para evitar duplicidade quando houver mais de uma regra aplicavel.
- Implementar comparativo calculado x importado de verdade; hoje o MVP ainda usa calculado igual ao importado.
- Melhorar filtros de divergencia assim que a rotina de comparacao estiver pronta.

## Stack e estrutura atual

Backend:

- `backend.py`: Flask principal.
- Conexao Firebird via `firebird_compat.py`.
- Configuracao em `database_config.json`.
- Banco: `C:\Administracao\db\miautomec.fdb`.
- Usuario banco: `SYSDBA`.
- Charset: `WIN1252`.

Frontend:

- `dashboard\index.html`: HTML/CSS/JS monolitico.
- Tabs sao controladas por `showTab(tab, el)`.
- `API = window.location.origin + '/api'`.

Padrao de rotas modulares:

- `sales_dashboard.py`
- `financial_dashboard.py`
- `purchase_dashboard.py`
- `customer_dashboard.py`
- `routes_extra.py`

Em `backend.py`, por volta das linhas 323-344, os modulos sao registrados com:

```python
from sales_dashboard import registrar_rotas_sales_dashboard
registrar_rotas_sales_dashboard(app, query_to_list, api_error, with_db)
```

Recomendacao: criar um novo arquivo `fiscal_dashboard.py` com `registrar_rotas_fiscal_dashboard(app, query_to_list, api_error, with_db, ...)` ou similar, e registrar no `backend.py`.

## Decisoes principais do modulo fiscal

Resumo completo esta em `FISCAL_MODULO_DESENHO_TECNICO.md`.

Pontos criticos:

- Fonte principal: `NFE` + `NFE_PRODUTO`.
- Pode cruzar com `NOTAFISCAL` + `NOTAFIS_PRODUTO` quando necessario.
- Periodo fiscal: `NFE.DEMI`.
- Preparado por `IDEMPRESA` desde o inicio.
- Padrao da tela: mes atual e todas as empresas.
- Entrada/saida:
  - usar `NFE.TPNF`;
  - validar tambem `NFE.CNPJ_EMIT` vs `CONFIGURACAO.CNPJ`;
  - conflito vira `REVISAR`.
- Cancelada:
  - `NFE.STATUS = 9`;
  - mostra na grade com valores;
  - fica vermelha;
  - nao soma nos cards.
- Regime:
  - fonte principal `CONFIGURACAOFISCAL.REGIMETRIBUTARIO`;
  - se ausente/invalido, empresa/apuracao fica em revisar.
- Simples Nacional:
  - regime proprio;
  - valores destacados ficam informativos/conferencia;
  - credito CSOSN 101 fica informativo/revisao no MVP.
- Lucro Real:
  - PIS/COFINS nao cumulativo com debito/credito.
- Lucro Presumido:
  - PIS/COFINS cumulativo sem credito por padrao, salvo regra especifica.
- IPI:
  - so apura para empresa com `CONFIGURACAO.INDUSTRIA = 1`.
- Regras fiscais:
  - criar `FISCAL_REGRA_OPERACAO`;
  - por empresa (`IDEMPRESA` obrigatorio);
  - sem fallback global entre empresas;
  - CST/CSOSN opcionais;
  - mais especifica prevalece;
  - ausencia/conflito = revisar;
  - criar carga inicial automatica por historico e CFOPs padrao;
  - criar aba visual "Regras Fiscais";
  - inativar, nao excluir.
- Historico de regras:
  - criar `FISCAL_REGRA_OPERACAO_HIST`.
- Revisao manual:
  - criar `FISCAL_REVISAO_ITEM`;
  - chave fiscal: `CHAVE + POSIC + CPROD`;
  - gravar tambem `NFE_PRODUTO.ID` quando existir;
  - guardar original/calculado/corrigido por imposto;
  - status Aprovado/Corrigido entram na apuracao;
  - Mantido em revisao fica fora.
- Despesas PIS/COFINS:
  - origem `CTAPAGAR`;
  - entram quando `STATUS = 2`, `DTPAGTO` no periodo, `ABATE_PIS_COFINS = 1`;
  - base `VLPAGTO`;
  - fornecedor por `CDFORNECEDOR`;
  - mostrar junto na grade com `Origem = CTAPAGAR`;
  - codigo/documento usa `NRDOC`;
  - descricao usa `HISTORICO`.
- Exportacao:
  - Excel e PDF desde a primeira versao.

## Login e permissao

O Dashboard inteiro deve exigir login.

Tabelas existentes:

- `USUARIOS`
- `SIS_OPERACAO`
- `SIS_OPERACAOUSUARIO`

Regras:

- Login por `USUARIOS.LOGIN`.
- `USUARIOS.SENHA` vazia bloqueia.
- `USUARIOS.INATIVO = 1` bloqueia.
- Precisa ter permissao `SIS_OPERACAOUSUARIO.IDOPERACAO = 900`.
- Precisa validar `SIS_OPERACAOUSUARIO.IDMENUITEM` e `APPID`.
- Sem permissao: acesso negado e nao carrega dados.
- Sessao:
  - expira em 1h desde login;
  - ou 30 min sem acao;
  - o que ocorrer primeiro.
- Mostrar usuario logado e botao "Sair".
- Registrar login sucesso, falha e logout em tabela nova `DASHBOARD_LOGIN_AUDIT`.
- Registrar IP/origem em auditorias fiscais.

Senha:

- Foi testado o usuario `CAROL` com senha conhecida `2907`.
- Campo `USUARIOS.SENHA` nao e texto puro.
- Para `CAROL`, bate usando XOR repetido com chave hex `C4 3A 1B`.
- Implementacao sugerida:
  - codificar a senha digitada com XOR `C4 3A 1B`;
  - comparar bytes/string com o campo `USUARIOS.SENHA`.
- Usuario `MI` existe mas senha vazia; deve bloquear.

## Campos/tabelas novas planejados

Criar scripts idempotentes antes de alterar o banco.

Campos em `CONFIGURACAO`:

- `TOLERANCIA_FISCAL`
- `INDUSTRIA` `LONG` `0/1`

Campos em `CTAPAGAR`:

- `ABATE_PIS_COFINS` `LONG` `0/1`
- `BASE_PIS_COFINS_ABATE`
- `PIS_ALIQ_ABATE`
- `COFINS_ALIQ_ABATE`
- `GERA_CREDITO_PIS_COFINS`
- `OBS_FISCAL_ABATE`
- `STATUS_FISCAL_ABATE`
- `MOTIVO_REVISAO_ABATE`

Tabelas novas:

- `FISCAL_REGRA_OPERACAO`
- `FISCAL_REGRA_OPERACAO_HIST`
- `FISCAL_REVISAO_ITEM`
- `DASHBOARD_LOGIN_AUDIT`

## Proximo passo recomendado

1. Criar `fiscal_dashboard.py`.
2. Registrar o modulo em `backend.py`.
3. Implementar helper de migracao idempotente:
   - checar tabela/campo via `rdb$relations` e `rdb$relation_fields`;
   - criar somente se nao existir.
4. Implementar endpoints de auth:
   - `POST /api/auth/login`
   - `POST /api/auth/logout`
   - `GET /api/auth/session`
5. Adicionar decorator/validacao para proteger APIs.
6. Atualizar `dashboard/index.html` com:
   - overlay/tela de login;
   - usuario logado + sair;
   - nova nav/tab "Apuracao Fiscal";
   - carregar dados so depois de login valido.
7. Implementar endpoints fiscais MVP:
   - options/filtros;
   - resumo;
   - itens;
   - detalhe da nota;
   - regras fiscais list/edit/inativar;
   - revisao manual;
   - export Excel/PDF.
8. Implementar tela MVP:
   - filtros;
   - cards;
   - grade analitica;
   - filtro divergencias;
   - modal detalhe/revisao;
   - aba Regras Fiscais.
9. Testar:
   - login CAROL / 2907;
   - bloqueio MI por senha vazia;
   - permissao `IDOPERACAO = 900`;
   - endpoint fiscal com mes atual;
   - canceladas `STATUS=9` vermelhas e fora dos totais.

## Consultas ja realizadas

`CTAPAGAR` campos relevantes:

- `CONTROLE`
- `IDEMPRESA`
- `NOTAFISCAL`
- `CDFORNECEDOR`
- `STATUS`
- `NRDOC`
- `DTVENC`
- `DTPAGTO`
- `DTINCLUSAO`
- `HISTORICO`
- `VALOR`
- `TOTAL`
- `VLPAGTO`
- `PIS`
- `COFINS`
- `CHAVE`
- `DTEMISSAO`

`USUARIOS` existe com:

- `IDUSUARIO`
- `LOGIN`
- `NOMECOMPLETO`
- `SENHA`
- `IDGRUPO`
- `CDVENDEDOR`
- `CDCAIXA`
- `INATIVO`
- `VALIDAR`
- `CDBANCO`

`SIS_OPERACAO`:

- `100 Inclusao`
- `200 Alteracao`
- `300 Exclusao`
- `400 Consulta`
- `500 Impressao`
- `600 Cancelamento`
- `700 Especiais`
- `701 Especiais - LGPD`
- `800 Listagem`
- `900 Gerencial`

`NFE.STATUS` distribuicao observada:

- `0`: 260029
- `1`: 288
- `3`: 247
- `9`: 3

Regra aprovada:

- apenas `STATUS=9` = cancelada.

## Observacoes de cuidado

- Nao usar `NFE.CSTAT` para status no MVP; no banco atual esta sempre `'1'`.
- Nao usar `NFE.DTCANCELAMENTO`; no banco atual aparece preenchido com data padrao.
- `NFE_PRODUTO` tem PK natural `CHAVE, CPROD, POSIC` e tambem campo `ID`.
- O frontend tem texto com alguns caracteres mojibake antigos; preservar estilo geral e evitar refatoracao ampla.
- Usar `apply_patch` para edicoes manuais.
- Nao aplicar scripts destrutivos.
- Antes de criar campos/tabelas no Firebird, gerar migracao idempotente e considerar backup.
