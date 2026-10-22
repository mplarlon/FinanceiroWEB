# Charlie — Modo Diretor

Data: 21/10/2026. Escopo: camada de coordenação executiva sobre os serviços já existentes do Charlie. Nenhuma implantação, migração, escrita no Firebird nem comparação com os relatórios oficiais do ERP foi executada.

A classificação é **implementado e coberto por testes automatizados, com a interface exercida contra um servidor local de demonstração**. Não está validado em homologação com dados reais e não está pronto para produção.

## 1. Componentes implementados

Camada **Charlie Executive Intelligence**. Ela não cria outra IA, outro chatbot, outro executor, outro agendador nem outro motor de análise.

- `node-app/server/lib/charlie-executive-engine.js` — classificação da pergunta, consolidação dos indicadores já recebidos, priorização por regras, texto do resumo, rascunho do plano, investigação (fato, correlação, hipótese e projeção) e leitura de simulação.
- `node-app/server/lib/charlie-executive-service.js` — permissão gerencial, coleta com cache e tempo limite, plano, confirmação, verificação, reunião, decisão e resposta no chat.
- `node-app/server/lib/charlie-executive-store.js` — planos, preferências, reuniões, decisões, verificações e snapshots em JSON, isolados por empresa e filial.
- `node-app/client/src/pages/CharlieDirector.jsx` — painel Modo Diretor dentro do Charlie já aberto: visão geral, prioridades, planos, reunião, resultados e preferências.
- Rotas em `node-app/server/routes/assistant.js`, sob `/api/ia/executivo`: resumo, painel, planos, aprovação, verificação, situação, reunião, preferências e decisões.
- Ação de catálogo `executivo.resumo` e frases da Etapa 10 que disparam o resumo diário, semanal, mensal ou o aviso de risco de caixa.

A priorização usa pesos configuráveis. A gravidade não pode ficar abaixo de 15% depois da normalização. O Ollama, quando disponível, só acrescenta uma leitura conversacional; ele não substitui os números nem define a criticidade.

O comando genérico de resolver um problema prepara o plano e para na confirmação. A preparação chama o executor existente somente com `confirmado: true` e ação escolhida. Criar a tarefa deixa o plano em execução; não o marca como concluído. Simulação não grava dado real. Decisão formal entra na memória da Etapa 11 como rascunho, com `officialPolicy: false`.

## 2. Serviços reutilizados

- Monitoramento e alertas (Etapa 8).
- Catálogo, planejador e executor de tarefas (Etapas 2, 3 e 6).
- Automações e agendador (Etapa 10).
- Memória empresarial (Etapa 11).
- Rentabilidade (Etapa 12).
- Previsão e simulação financeira, de faturamento, de estoque e de preço (Etapa 13).
- Auditoria e investigações (Etapa 14).
- Inteligência comercial (Etapa 17).
- Abastecimento e estoque (Etapa 18).
- Resultados do Charlie (Etapa 19).
- Permissão, empresa e filial já usadas pelo Charlie (Etapa 20).

Ações que o plano pode preparar, todas de nível inferior a escrita empresarial: `preditivo.fluxo_caixa`, `financeiro.inadimplencia`, `financeiro.preparar_cobrancas` (rascunho, sem envio), `preditivo.ruptura_estoque`, `estoque.abaixo_minimo`, `comercial.clientes_inativos`, `comercial.reducao_compras`, `produtos.margem_insuficiente` (premissa de 15% do catálogo), `auditoria.duplicidades_financeiras` e `relatorios.resultados_charlie`. O responsável sugerido permanece vazio.

## 3. Indicadores integrados

Cada sinal guarda serviço, indicador e data da fonte. Quando o módulo não devolve dado, o resumo registra a limitação.

- Caixa: projeção e primeiro saldo negativo (`previsao_fluxo_caixa`).
- Faturamento: projeção (`previsao_faturamento`).
- Estoque: ruptura prevista, itens abaixo do mínimo e excesso de cobertura.
- Compras: reposição urgente e pedidos com previsão vencida.
- Rentabilidade: resultado negativo verificado e margem insuficiente. A referência de 15% é premissa do catálogo.
- Comercial: redução de compras e inatividade. Redução é correlação, não causa comprovada.
- Auditoria: investigações pendentes.
- Resultados: economia comprovada e oportunidade estimada, em campos separados. Sem evidência, o texto não declara economia.

Não há fonte de metas. A comparação mensal informa que as metas não estão cadastradas.

## 4. Arquivos

Novos:

- `node-app/server/lib/charlie-executive-engine.js`
- `node-app/server/lib/charlie-executive-service.js`
- `node-app/server/lib/charlie-executive-store.js`
- `node-app/client/src/pages/CharlieDirector.jsx`
- `node-app/test/charlie-executive.test.js`
- `DOCUMENTACAO/CHARLIE_MODO_DIRETOR_RELATORIO.md`

Alterados para encaixar a camada:

- `node-app/server/routes/assistant.js`
- `node-app/server/lib/charlie-task-catalog.js`
- `node-app/server/lib/charlie-task-actions.js`
- `node-app/server/lib/charlie-automation-plan.js`
- `node-app/server/lib/charlie-automation-engine.js`
- `node-app/client/src/pages/Charlie.jsx`
- `node-app/client/src/styles.css`
- `node-app/client/src/lib/api.js` — inclusão de `api.put`, usada pelo salvamento das preferências
- `DOCUMENTACAO/README.md`
- `DOCUMENTACAO/CHARLIE_GUIA_USUARIO.md`

## 5. Testes executados

`npm test` em `node-app`, em 21/10/2026: **253 testes, 253 aprovações, 0 falhas**, duração de cerca de 11,4 s.

Os 16 testes de `test/charlie-executive.test.js` cobrem:

1. Resumo com período e fonte, sem inventar meta.
2. Consolidação dos indicadores recebidos.
3. Alerta crítico com evidência.
4. Priorização determinística e piso de gravidade.
5. Plano sem responsável e sem status concluído.
6. Preparação só com confirmação explícita.
7. Frase de confirmação no chat não prepara tarefa.
8. Investigação separando fato, correlação, hipótese e projeção.
9. Simulação sem alterar dados e sem inventar produto.
10. Reunião com contexto da área.
11. Verificação sem declarar economia.
12. Decisão formal que não vira política.
13. Automações no planejador da Etapa 10.
14. Permissão gerencial e isolamento entre empresas.
15. Resposta determinística sem Ollama e preservação da tarefa antiga de títulos vencidos.
16. Cache da coleta e priorização de 300 sinais abaixo de 100 ms.

A suíte completa das etapas anteriores passou no mesmo comando.

## 6. Interface

No Vite local, com um servidor de demonstração na porta 505 (não é o Firebird):

- Charlie abre pelo menu e o recurso Modo Diretor abre o painel.
- A visão geral mostrou período, hora da fonte, cartão crítico, oportunidade e a projeção identificada como projeção.
- Prioridades, preparação do plano (`aguardando_aprovacao`) e preparação da ação (`em_execucao` / `preparada`, responsável não atribuído).
- A reunião fecha o painel e envia a pergunta para o Charlie já aberto.
- O salvamento das preferências falhava com `api.put is not a function`. O método foi acrescentado ao cliente e o novo salvamento terminou sem erro.

Os números dessa passagem visual vieram do servidor de demonstração. Eles não comprovam os indicadores do ERP.

## 7. Limitações

- O cenário de homologação com gestor, Firebird e releitura do indicador real não foi executado.
- `permissao_gerencial` continua amplo para o usuário autenticado, pendência já registrada na Etapa 20.
- Investigações da auditoria não têm empresa no armazenamento existente.
- A leitura gerencial da memória empresarial continua podendo ver registros fora do recorte, comportamento da Etapa 11.
- Preferência de frequência não cria a automação. A automação nasce da frase com horário, no agendador existente.
- O cache é por processo. Fontes ao vivo têm limite de 12 segundos. A atualização do painel sem “Atualizar” usa o que já está gravado.
- Simulação de preço sem produtos identificados é recusada. “Simule um reajuste” permanece no planejador de tarefas já existente.
- Itens críticos de outras áreas podem aparecer mesmo quando o escopo pedido é mais estreito.

## 8. Riscos pendentes

- Confundir a projeção de caixa ou a oportunidade estimada com resultado realizado, se a identificação visual for ignorada na operação.
- Tratar o resumo como autorização para cobrança, preço ou compra. O fluxo exige a confirmação da ação.
- Usar o Modo Diretor em produção antes de comparar o resumo com os relatórios oficiais da mesma empresa e filial.
- Deixar a porta de demonstração ativa. O servidor da porta 505 foi encerrado. O Vite desta verificação permaneceu na porta 5173: o processo recusou o encerramento.

## 9. Recomendações de implantação

Não implantar em produção nesta entrega.

1. Homologar com cópia do Firebird e um usuário gerencial real.
2. Pedir “Como está minha empresa hoje?” e conferir cada número com o relatório de origem.
3. Gerar um plano, preparar uma ação permitida, confirmar, reler o indicador e consultar o histórico.
4. Repetir com usuário sem permissão gerencial e com outra empresa ou filial.
5. Desligar o Ollama e confirmar que indicadores, alertas, planos e tarefas agendadas continuam consultáveis.
6. Só depois disso decidir a publicação, com backup e reversão descritos em `CHARLIE_OPERACAO_PRODUCAO.md`.
