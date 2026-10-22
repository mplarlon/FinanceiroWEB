# Charlie — Etapa 15 — Relatório de implementação

Data da validação: 21/10/2026.

## 1. Componentes implementados

- `Charlie Behavioral Risk Engine`, aplicado sobre os eventos preservados pela Auditoria da Etapa 14.
- Linhas de base por empresa, filial, setor, perfil, tipo de operação e dia da semana.
- Detecção auditável por mediana, desvio absoluto mediano (MAD), percentil 90, horário habitual e rajadas em janela temporal.
- Correlação de sequências vinculadas à mesma entidade: preço–venda–restauração, dados bancários–preparação de pagamento, limite–pedido e estoque–cancelamento.
- Classificação em baixo, moderado e elevado como prioridade de investigação, sempre sem probabilidade de fraude.
- Processamento incremental e em lotes, integrado ao agendador e ao monitoramento já existentes.
- Persistência de análises, parâmetros, versão do modelo, eventos relacionados e feedback humano.
- Área **Análise de Riscos e Anomalias** dentro da Central de Auditoria.
- Investigação contextual com eventos e critérios estruturados, além de orientações da memória empresarial.
- Ação de catálogo e interpretação de automações para análises recorrentes.

## 2. Eventos analisados

O motor aceita os eventos auditáveis já registrados: alterações de preço, descontos, cancelamentos/estornos, movimentações de estoque, alterações bancárias, limites comerciais, pedidos/vendas, preparação de pagamentos e cancelamentos de movimentações. A capacidade efetiva depende da instrumentação existente em cada fluxo do ERP. Nesta versão, alterações de preço executadas pelo Charlie já alimentam imediatamente a trilha; as demais categorias passam a ser analisadas quando seus eventos forem registrados pela instrumentação da Etapa 14.

## 3. Métodos de detecção

- Mediana e MAD para desvio robusto.
- Percentil 90 com multiplicador configurável.
- Frequência por horário e identificação de horário incomum.
- Rajadas por ator, tipo e janela configurável.
- Sequências temporais com vínculo pela mesma entidade e limite máximo de tempo.
- Contextos autorizados verificáveis para campanhas, lotes, inventários e rotinas equivalentes.

Nenhum método utiliza atributos pessoais sensíveis. O Ollama não classifica risco e não participa do cálculo; ele permanece apenas como camada opcional de interpretação conversacional.

## 4. Regras e parâmetros configuráveis

- amostra mínima;
- limiar do escore robusto;
- multiplicador do percentil;
- quantidade e janela da rajada;
- limite de alto valor;
- retenção de análises;
- ativação/desativação do processamento.

O feedback permitido é: irregularidade confirmada, operação legítima, falso positivo, dados insuficientes ou necessita acompanhamento. Exige usuário gerencial e justificativa. Uma classificação isolada nunca altera automaticamente os limiares.

## 5. Arquivos da Etapa 15

- `node-app/server/lib/charlie-behavioral-risk-engine.js`
- `node-app/server/lib/charlie-behavioral-risk-store.js`
- `node-app/server/lib/charlie-behavioral-risk-service.js`
- `node-app/server/lib/charlie-audit-store.js`
- `node-app/server/charlie-monitor-scheduler.js`
- `node-app/server/lib/charlie-task-catalog.js`
- `node-app/server/lib/charlie-task-actions.js`
- `node-app/server/lib/charlie-automation-plan.js`
- `node-app/server/routes/assistant.js`
- `node-app/client/src/pages/CharlieAuditCenter.jsx`
- `node-app/client/src/styles.css`
- `node-app/test/charlie-behavioral-risk.test.js`

## 6. Testes executados e resultados

- Testes específicos da Etapa 15: **15 aprovados, 0 falhas**.
- Suíte completa: **182 aprovados, 0 falhas**.
- Build Vite de produção: **concluído com sucesso**.

Foram verificados grupos comparáveis, isolamento de perfis, anomalia robusta, histórico insuficiente, rajadas, sequências, proteção de dados bancários, classificação sem probabilidade, qualidade de evidência, contexto autorizado, preservação dos critérios, lote legítimo, feedback/permissão, automação existente e funcionamento sem Ollama. A suíte integral também cobre auditoria, alertas, investigação, memória, executor, automações, previsões e compatibilidade das etapas anteriores.

## 7. Segurança e governança

- Isolamento de análises e linhas de base por empresa e filial.
- Alertas não bloqueiam usuário, pagamento ou operação.
- Dados bancários completos, credenciais e segredos não são preservados nas evidências.
- Evidências mantêm modelo, versão, critérios e identificadores de origem.
- O resultado declara explicitamente que é prioridade de investigação, não prova ou probabilidade de fraude.
- Acesso à Central, configuração e feedback permanece restrito ao perfil gerencial existente.

## 8. Limitações e riscos pendentes

- Não foi executada alteração real no Firebird de produção ou homologação, pois não houve autorização nem ambiente identificado para escrita. Portanto, o cenário obrigatório de homologação com operação real permanece pendente e não é usado como alegação de eficácia em produção.
- O histórico anterior só pode ser analisado nas categorias que já possuam eventos confiáveis; não existe reconstrução retrospectiva por inferência.
- A persistência atual reutiliza o armazenamento JSON protegido da arquitetura Charlie. O encadeamento permite detectar adulteração, mas não constitui armazenamento legalmente imutável.
- Sazonalidade além do dia da semana requer histórico e volume suficientes; ainda não há modelo calibrado para probabilidade de fraude.
- A eficácia e a taxa de falsos positivos precisam ser medidas em homologação com dados reais autorizados.

## 9. Recomendações de implantação

1. Validar com Segurança, Auditoria, Privacidade e Relações de Trabalho a finalidade, retenção, acesso e comunicação aos usuários.
2. Instrumentar gradualmente os fluxos ainda sem eventos, propagando empresa, filial e identidade do usuário de aplicação.
3. Executar o cenário obrigatório em homologação, com eventos reais registrados, alerta, evidências, investigação, feedback e histórico.
4. Iniciar com limiares conservadores e período silencioso de calibração, sem decisões disciplinares ou bloqueios automáticos.
5. Medir falsos positivos por categoria e grupo comparável antes de alterar regras; toda alteração crítica deve permanecer revisada por humano.
6. Avaliar armazenamento append-only ou serviço de evidências com controles mais fortes caso haja exigência regulatória.

## 10. Conclusão

A camada técnica da Etapa 15 está implementada e validada por testes automatizados e build. Ela identifica desvios e sequências verificáveis sobre os eventos disponíveis, preserva evidências, integra alertas, investigação, memória, catálogo e automações e continua operando sem Ollama. A capacidade de detectar fraudes reais não é declarada como comprovada; sua validação depende do piloto controlado em homologação e da governança humana recomendada acima.
