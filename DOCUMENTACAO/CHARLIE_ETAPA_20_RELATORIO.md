# Charlie — Etapa 20: auditoria final e preparação para produção

Data da auditoria: 21/10/2026. Escopo: código local e testes automatizados; nenhuma implantação, migração destrutiva, stress em produção ou escrita no Firebird foi executada.

## A. Resumo executivo

O Charlie compila e a suíte automatizada está consistente. A auditoria identificou e corrigiu exposição crítica pré-autenticação de configuração/teste do Firebird e diagnóstico de login, vazamento de material criptográfico no diagnóstico, detalhes internos no healthcheck e disponibilidade padrão de SQL avulso. A vulnerabilidade crítica transitiva de `proxy-addr` foi corrigida por override compatível.

A classificação é **pronto para homologação**, não pronto para produção. Faltam testes com cópia representativa do Firebird, perfis reais, carga, restauração e os oito fluxos ponta a ponta com dados autorizados.

## B. Funcionalidades verificadas

| Etapa | Área | Componentes/evidência | Resultado |
|---:|---|---|---|
| 1 | Arquitetura | rotas, serviços, stores e documentação mapeados; build | Validada parcialmente |
| 2 | Catálogo | `charlie-task-catalog`, testes de metadados/validação | Validada |
| 3 | Execução | `charlie-task-engine/actions/store`; confirmação, concorrência e recuperação | Validada |
| 4 | Relatórios | assistente/exportação; PDF, Excel e CSV | Validada |
| 5 | Tarefas compostas | `charlie-composite-*`; dependências, retomada e cancelamento | Validada |
| 6 | Alterações | transação, prévia, confirmação, expiração e idempotência em mocks | Validada parcialmente |
| 7 | Interface | build React e componentes integrados; sem inspeção visual completa | Validada parcialmente |
| 8 | Monitoramento | regras, store, scheduler e lock multiestação em teste | Validada |
| 9 | Segurança | guard SQL, permissões e regressões da Etapa 20 | Validada parcialmente |
| 10 | Automações | plano, engine, store, lock, recorrência e pausa em teste | Validada |
| 11 | Memória | importação, versão, revogação, permissão e prompt injection | Validada |
| 12 | Perdas | regras determinísticas e separação de conceitos | Validada |
| 13 | Previsões | backtesting, qualidade, intervalos e fallback | Validada |
| 14 | Auditoria | trilha, integridade, segregação e investigação | Validada |
| 15 | Anomalias | baseline comparável, MAD, evidência e falsos positivos | Validada |
| 16 | Treinamento | contexto, progresso, isolamento e publicação | Validada |
| 17 | Comercial | oportunidade, deduplicação, rascunho e automação | Validada |
| 18 | Compras/estoque | demanda, fornecedor, simulação, rascunho e confirmação | Validada parcialmente |
| 19 | Resultados | metodologia, evidência, deduplicação, ROI e privacidade | Validada |

“Parcialmente” significa que falta integração real, inspeção visual ou aceite de negócio; não indica falha automática.

## C. Problemas identificados

- Crítico, corrigido: configuração e teste de banco e diagnóstico de login eram públicos.
- Crítico, corrigido: `proxy-addr <2.0.8`, com risco de spoofing de IP em redes confiando no proxy.
- Alto, corrigido: diagnóstico retornava bytes da senha armazenada e chaves legadas.
- Alto, corrigido: `/api/query` aceitava SELECT avulso por padrão; agora requer opt-in e sessão gerencial.
- Médio, corrigido: healthcheck público divulgava caminho, host e porta do banco e erro interno.
- Médio, residual: `mammoth -> argparse -> sprintf-js` possui alerta de DoS sem atualização compatível disponível; upload está limitado a um arquivo e tamanho configurável, mas deve rodar com limites de CPU/memória e receber nova avaliação.
- Alto, residual: todos os usuários autenticados pelo contrato atual recebem `permissao_gerencial: true`; é necessário mapear um atributo/permissão gerencial real do ERP antes da produção ampla.
- Alto, residual: não houve Firebird de homologação autorizado, logo escritas e cálculos não foram comparados com relatórios oficiais reais.
- Médio, residual: carga, falhas de processo, restauração e inspeção visual completa não foram executadas neste ambiente.

## D. Correções realizadas

- `node-app/server/security-policy.js`: política explícita de rotas públicas e flags opt-in.
- `node-app/server/index.js`: proteção de endpoints, diagnóstico desativado, SQL avulso desativado e healthcheck sanitizado.
- `node-app/server/auth.js`: remoção de senha cifrada, chaves e chave correspondente do diagnóstico.
- `node-app/server/config.js`: máscara de senha sem prefixo/sufixo.
- `node-app/package.json` e lock: override de `proxy-addr` para versão corrigida.
- `node-app/test/security-policy.test.js`: regressões de exposição e configuração.
- documentação operacional, recuperação, usuário e este relatório.

## E. Testes executados

Linha de base: `npm test` aprovou 231/231 e `npm run build` concluiu em 2,31 s. Após as correções, `npm test` aprovou 235/235 em 5,38 s e `npm run build` concluiu em 3,67 s. O bundle principal ficou em 442,27 kB (123,06 kB gzip). `npm audit --omit=dev` terminou sem vulnerabilidades críticas/altas e com três moderadas da mesma cadeia do importador DOCX. `npm run migration:audit` executou sem erro, mas encontrou `0/0` contratos; esse resultado revela inventário vazio e não comprova cobertura de migração.

Não executados: stress/carga multiusuário real, plano Firebird com estatísticas de produção, indisponibilidade física do banco, kill/restart do serviço, restauração de backup, Ollama sob carga e E2E com dados empresariais. Executá-los apenas em homologação autorizada.

## F. Desempenho

Há timeouts em consultas Charlie (tipicamente 10–30 s), limite de resultado, cache preditivo, limite de tokens/contexto no Ollama, cancelamento de exportação e concorrência configurável. O build gerou bundle JS de aproximadamente 442 kB (123 kB gzip). Sem base representativa não há evidência suficiente para criar índices; nenhuma estrutura Firebird foi alterada.

## G. Segurança

Foram verificados guard de somente leitura, parâmetros SQL, catálogo fechado, confirmação, expiração, idempotência, lock entre estações, segregação de stores, sanitização de auditoria, revogação documental e fallback do Ollama. Bloqueio atual: resolver perfil gerencial real e validar negativas de permissão com contas reais.

## H. Compatibilidade

Node >=20; Express 5.2.1; React 19.1.1; Vite 7; driver Firebird nativo 3.6; cliente Firebird empacotado 5.0.4; Ollama opcional, modelo padrão `qwen3:8b`. Dados locais são JSON atômico em `DASHBOARD_DATA_DIR`; banco principal permanece Firebird.

## I. Pendências

1. Definir e implementar a fonte real de perfil gerencial do ERP.
2. Homologar Firebird com cópia mascarada e conferir indicadores com relatórios oficiais.
3. Executar carga, caos controlado, backup/restauração e E2E dos oito cenários.
4. Validar UX em resoluções e perfis suportados.
5. Reavaliar/importador DOCX ou isolar parsing quando houver versão segura compatível.
6. Definir responsáveis, SLOs, retenção e canal de alertas.
7. Corrigir/popular o inventário usado por `migration:audit`, hoje sem contratos verificáveis.

## J. Recomendação

**Pronto para homologação.** Os controles críticos descobertos no código foram corrigidos e a suíte automatizada fornece boa cobertura, mas os bloqueios acima impedem classificar como pronto para implantação gradual ou produção.
