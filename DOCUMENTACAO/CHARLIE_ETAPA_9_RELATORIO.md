# Charlie — Etapa 9: relatório de validação, segurança e estabilidade

Data da auditoria: 20/10/2026.

## Resultado executivo

A implementação foi auditada sem executar operações de escrita no banco configurado. A suíte automatizada completa passou com **117 testes aprovados, 0 falhas, 0 ignorados**, e o frontend compilou para produção. Um smoke test estritamente `READ_ONLY` confirmou conexão com o Firebird e disponibilidade do Ollama.

A Etapa 9 fica **validada parcialmente**: os controles principais possuem evidência automatizada, mas homologação de escrita, reconciliação dos números com telas oficiais do ERP, testes de carga e isolamento multiempresa ainda dependem de ambiente e evidências que não estavam disponíveis nesta execução.

## Componentes analisados e classificação

| Componente | Situação | Evidência |
|---|---|---|
| Catálogo de ações | Validada | Invariantes das 37 ações; ações habilitadas têm executor; níveis críticos permanecem desabilitados; entradas inválidas e extras são rejeitadas/descartadas. |
| Planejador e tarefas compostas | Validada | Ordenação, dependências, contexto, falha intermediária, repetição seletiva e permissões cobertas pela suíte. |
| Executor e confirmação | Validada | Prévia, confirmação explícita, expiração, proprietário, permissão, transação, idempotência sequencial e confirmação simultânea cobertas. |
| Operações de preço | Validada parcialmente | Cálculo, arredondamento, prévia, concorrência e auditoria testados com transação simulada; nenhuma escrita real foi feita. |
| Cadastro/atualização de cliente | Validada parcialmente | Preparação e serviço injetado testados. O fallback SQL inseguro foi removido; sem serviço oficial a confirmação falha de forma segura com 503. |
| Criação de pedido | Validada parcialmente | Preparação e bloqueio sem serviço oficial cobertos; fluxo real exige serviço do ERP em homologação. |
| Relatórios/exportações | Validada | Consultas parametrizadas, totais, CSV, Excel, PDF, cancelamento e prevenção de fórmula em planilha cobertos. |
| Segurança de SQL e prompt | Validada | Somente leitura, catálogo de tabelas, limites, parâmetros e dado malicioso tratado como dado cobertos. |
| Permissões e propriedade | Validada | Permissão no backend por ação/etapa e tarefa isolada por usuário cobertas. |
| Ollama/fallback | Validada parcialmente | Desligado/falha usa regras determinísticas; instância e modelo estavam disponíveis no smoke. Timeout e respostas inválidas têm tratamento, mas não houve teste real de queda durante operação. |
| Monitoramento e alertas | Validada | Deduplicação, lock entre estações, atualização, encerramento/reabertura, vínculo com tarefa e reavaliação cobertos. |
| Interface | Validada parcialmente | Build de produção concluído; estados e ações possuem testes backend. Não houve teste E2E em navegador nesta execução. |
| Firebird financeiro/comercial/produtos | Validada parcialmente | Smoke `READ_ONLY` e consultas automatizadas executados; comparação formal com cada rotina oficial do ERP não foi realizada. |
| Auditoria/rastreabilidade | Validada parcialmente | Solicitante, confirmação, tarefa, operação, resultado e valores são registrados sem chaves sensíveis; armazenamento em JSON não é imutável. |
| Recuperação | Validada | Escritas interrompidas ficam com resultado indeterminado e não são repetidas automaticamente; tarefas compostas preservam etapas concluídas. |
| Desempenho | Não testada | Limites, timeout e paginação existem, mas não houve benchmark representativo nem análise de plano/índices. |

## Correções realizadas

1. Fechada a janela de corrida entre leitura do estado e início da transação de confirmação. Duas confirmações simultâneas da mesma tarefa no processo agora resultam em uma única transação.
2. Recuperação de escrita interrompida deixou de afirmar, sem prova, que nada foi aplicado. O estado agora é `resultado_indeterminado`, exige conferência do ERP/auditoria e impede repetição automática.
3. Removido o fallback de cadastro que usava `MAX(CDCLIENTE)+1` e `IDEMPRESA=1`. Cadastro e alteração de cliente exigem o serviço oficial da instalação; ausência resulta em 503 sem executar SQL.
4. Adicionados testes de contrato do catálogo, política de risco, permissões, parâmetros estranhos/maliciosos, fallback sem Ollama, concorrência de confirmação e recuperação indeterminada.

## Execuções e evidências

- `npm test`: 117 aprovados, 0 falhas, 0 ignorados.
- `npm run build`: concluído; 44 módulos transformados.
- `node scripts/smoke-charlie-readonly.js`: conexão Firebird em modo somente leitura; 472 tabelas de usuário; Ollama online com `qwen3:8b` disponível.
- Amostra consultada pelo smoke em 20/10/2026: 1.106 títulos a pagar vencidos, total bruto retornado `100897,45999999995`; 2.300 vendas em outubro, total bruto retornado `300500,83999999735`. Esses números apenas provam execução da consulta e **não** constituem reconciliação com o ERP.

## Riscos pendentes

| Prioridade | Risco | Recomendação |
|---|---|---|
| Alta | Persistência de tarefas/auditoria em JSON não oferece coordenação distribuída nem trilha imutável. | Migrar estado/idempotência/auditoria para tabela transacional com chave única de operação e privilégios restritos. |
| Alta | O lock de confirmação cobre um processo Node; múltiplas instâncias precisam de idempotência compartilhada. | Criar chave idempotente única no banco e registrar `iniciada/concluída/indeterminada` na mesma fronteira transacional. |
| Alta | Não há escopo de empresa/filial no usuário do Charlie; consultas consolidadas podem ser legítimas, mas não demonstram isolamento por tenant. | Definir escopo autorizado na sessão e aplicá-lo no backend a consultas, relatórios, alertas e escritas. |
| Alta | Mapeamentos financeiros/comerciais não foram reconciliados tela a tela com as rotinas oficiais. | Executar roteiro de homologação com casos de cancelamento, baixa parcial, devolução, desconto e competência, assinados pelo responsável do ERP. |
| Média | Auditoria em arquivo pode ser alterada por quem possui acesso ao sistema operacional. | Persistir em estrutura append-only ou serviço central, com retenção, hash encadeado e acesso administrativo separado. |
| Média | Não houve carga com volume representativo nem inspeção dos planos do Firebird. | Capturar tempos, leituras, memória, conflitos e planos em clone de produção; só então propor índices via migração aprovada. |

## Funcionalidades não testadas nesta execução

- Escrita real de preços, clientes ou pedidos em banco homologado.
- Comparação dos totais com telas/relatórios oficiais do ERP.
- Vários processos/servidores Node confirmando a mesma tarefa.
- Queda real de rede exatamente após commit do Firebird.
- Testes E2E da interface em navegador e acessibilidade.
- Benchmark com milhares/milhões de registros e análise de índices.

## Recomendação de implantação

Não liberar escritas empresariais em produção até concluir homologação com backup, serviço oficial de clientes/pedidos, escopo de empresa/filial e idempotência persistida no Firebird. Recursos somente leitura, relatórios e monitoramento determinístico podem seguir para piloto controlado, com logs e limites atuais, desde que as permissões de consulta sejam compatíveis com o acesso consolidado pretendido.
