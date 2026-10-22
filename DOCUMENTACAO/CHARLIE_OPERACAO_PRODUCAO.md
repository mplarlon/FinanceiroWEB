# Charlie — operação, implantação e recuperação

## Arquitetura operacional

O Charlie é um módulo do servidor Node/Express e da interface React do Dashboard. Ele não executa texto SQL produzido pelo Ollama: intenções passam por catálogo, validação e executores internos; consultas livres passam pelo guard de somente leitura. O Firebird é acessado pelo driver nativo, com transações de leitura ou escrita explícitas. O Ollama é opcional e possui fallback determinístico.

Os componentes principais estão em `node-app/server/routes/assistant.js`, `server/lib/charlie-task-*`, `server/lib/charlie-automation-*`, `server/lib/charlie-monitor*`, `server/lib/charlie-audit-*`, `server/lib/charlie-enterprise-knowledge.js`, `server/lib/charlie-predictive-*`, `server/lib/ollama.js` e nas páginas `client/src/pages/Charlie*.jsx`.

## Configuração segura

- Execute com Node.js 20 ou superior e Firebird compatível com o cliente empacotado 5.0.4.
- Use uma conta Firebird exclusiva e de menor privilégio via `CHARLIE_DB_USER`, `CHARLIE_DB_PASSWORD` e, se aplicável, `CHARLIE_DB_ROLE`. Não use `SYSDBA` em produção.
- Mantenha `DASHBOARD_DEBUG_LOGIN=0` e `DASHBOARD_ADHOC_QUERY_ENABLED=0`. Ative temporariamente somente em diagnóstico controlado, reinicie o serviço e desative logo depois.
- Use `DASHBOARD_COOKIE_SECURE=true` quando o acesso estiver protegido por HTTPS.
- Restrinja `CHARLIE_OLLAMA_URL` à rede local confiável. Defina modelo, timeout e keep-alive por `CHARLIE_OLLAMA_MODEL`, `CHARLIE_OLLAMA_TIMEOUT_MS` e `CHARLIE_OLLAMA_KEEP_ALIVE`.
- Ajuste concorrência de automações com `CHARLIE_AUTOMATION_CONCURRENCY`; comece com 1 ou 2 e aumente somente após medir Firebird e Ollama.
- Não habilite `CHARLIE_AI_LOG_SQL` em produção normal. Logs podem revelar estrutura e filtros empresariais.

## Checklist pré-implantação

1. Criar backup verificável do Firebird e copiar o diretório `DASHBOARD_DATA_DIR`.
2. Confirmar Node, cliente Firebird, banco/charset e modelo Ollama instalados.
3. Executar `npm ci`, `npm test`, `npm run build` e `npm run migration:audit`.
4. Executar `npm audit --omit=dev`; não liberar com vulnerabilidade crítica ou alta sem mitigação aprovada.
5. Conferir a conta de serviço, permissões de arquivos, firewall, HTTPS e cookie seguro.
6. Validar com usuários de cada perfil: consulta, relatório, confirmação, automação e acesso negado.
7. Conferir cálculos com relatórios oficiais do ERP usando o mesmo período, filial e status.
8. Executar os oito cenários de ponta a ponta em cópia de homologação do Firebird.
9. Registrar responsáveis por aplicação, Firebird, infraestrutura, segurança e negócio.
10. Obter aprovação formal. Este procedimento não autoriza implantação automática.

## Ativação gradual

- Fase A: consultas e relatórios, somente para grupo piloto.
- Fase B: monitoramento e alertas; observar falsos positivos e latência.
- Fase C: automações exclusivamente de leitura e notificações.
- Fase D: escritas de baixo volume com confirmação, idempotência e auditoria; ampliar por ação.
- Fase E: previsões, risco comportamental e recursos avançados somente após backtesting e aceite.

Uma fase só avança após período de observação definido pelo responsável. O Ollama pode ser desativado com `CHARLIE_AI_ENABLED=false`; consultas determinísticas permanecem disponíveis. Automações podem ser pausadas individualmente na interface.

## Monitoramento

Monitore `/api/status` externamente apenas como disponibilidade genérica. Informações do Ollama, tarefas, automações, monitoramentos e auditoria ficam em rotas autenticadas do Charlie. Alertar quando houver indisponibilidade, crescimento de falhas, automações atrasadas, lock expirado recorrente, aumento de latência, erro de banco, falha de relatório ou crescimento anormal dos arquivos em `DASHBOARD_DATA_DIR`.

Não envie conteúdo de perguntas, documentos, SQL, credenciais, dados bancários ou valores confidenciais ao monitor externo. Preserve logs e trilhas de auditoria conforme a política de retenção da empresa.

## Backup e restauração

Inclua no backup: Firebird pelo mecanismo oficial já adotado; todo `DASHBOARD_DATA_DIR` (configurações, automações, tarefas, alertas, auditoria, memória, previsões e resultados); arquivos de serviço/ambiente; e relação do modelo Ollama instalado. Não copie um `.FDB` em uso como substituto do backup consistente.

Teste de restauração, sempre isolado:

1. Restaurar o Firebird em caminho e instância sem acesso de usuários.
2. Restaurar `DASHBOARD_DATA_DIR` em diretório isolado e configurar uma porta diferente.
3. Apontar credenciais de homologação, nunca as de produção.
4. Iniciar com automações pausadas e escritas bloqueadas.
5. Validar integridade da auditoria, documentos vigentes/revogados, tarefas e histórico.
6. Executar testes de leitura e apenas depois uma escrita controlada com rollback/backup disponível.
7. Registrar duração, perdas observadas e responsável pelo aceite.

## Reversão e incidentes

Em incidente: bloquear operações de escrita e pausar automações; preservar logs/locks/evidências; verificar o estado real da operação no ERP antes de repetir; desativar o recurso afetado; e reverter o pacote do serviço para a versão aprovada. Restaurar banco somente com decisão do responsável, pois migrações podem não ser reversíveis sem perda.

Para falha após confirmação, use o identificador da tarefa/execução e confirme no Firebird e na auditoria se houve commit. Nunca repita uma operação financeira apenas porque a resposta HTTP se perdeu. Para Ollama indisponível, mantenha fallback determinístico ou desative a IA. Para Firebird indisponível, interrompa automações, preserve filas e só retome após teste de conectividade.

## Critérios de bloqueio

Bloqueiam produção: falha crítica conhecida; permissão não validada; divergência financeira sem explicação; escrita sem idempotência/auditoria; restauração não ensaiada; automação duplicada; dependência crítica/alta sem decisão; ou ausência de homologação representativa. Compilação isolada não constitui aceite.
