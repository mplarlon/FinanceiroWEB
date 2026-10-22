# Charlie Daily — Etapa 1, diagnóstico

Data: 22/10/2026. O módulo foi implementado em seguida no Dashboard, com a agenda desligada e o envio real desligado. Este texto registra as fontes e as fórmulas usadas por esse módulo.

O módulo entra como orquestração sobre a Charlie, os relatórios gerenciais, o WhatsApp da Meta e o SMTP já existentes. O processo Express do serviço `SrvDashboard` continua sendo o único executor. O navegador não participa do agendamento.

## 1. Tecnologias em uso

| Camada | O que já existe |
|---|---|
| Interface | React 19 e Vite 7 em `node-app/client` |
| API | Express 5 em `node-app/server/index.js`, sessão HTTP-only |
| Banco | Firebird via `node-firebird-driver-native`; leituras `READ_ONLY` |
| IA | Ollama local (`charlie-ai.js`, `ollama.js`). Padrão `qwen3:8b` em `127.0.0.1:11434`. Se cair, a resposta volta para regras determinísticas |
| E-mail | Nodemailer e `email_config.json` no diretório de dados |
| WhatsApp | API oficial Graph da Meta em `routes/whatsapp.js` e `whatsapp_config.json` |
| PDF | PDFKit, hoje usado no relatório fiscal |
| Testes | `node:test` em `node-app/test` |
| Operação | O mesmo processo serve API e `dist`. O agendador vive no processo, fora do navegador |

Dados de configuração ficam em `DASHBOARD_DATA_DIR`, com padrão `C:\administracao\Dashboard`. Credenciais de banco, SMTP e WhatsApp ficam nesse diretório ou em variável de ambiente. Nenhuma credencial nova entra no código.

A porta padrão do código é 505. O serviço publicado atende a porta 805.

## 2. O que a Charlie já faz e deve ser reutilizado

| Necessidade do Charlie Daily | Serviço existente | Uso na próxima etapa |
|---|---|---|
| Vendas, ticket, margem, ranking de vendedor e loja | `routes/management-reports.js` (`sellers`, `stores`, `margins`) e `routes/sales.js` | Mesma fórmula de venda efetivada |
| Meta por loja, vendedor e grupo | `management_reports.json` (`goals`, `seller_goals`, `category_goals`) | Estender período e meta diária/semanal/equipe sem apagar as metas atuais |
| Resumo diário por e-mail e WhatsApp | `management-scheduler.js` | Manter. O Charlie Daily é outro agendamento, desligado até a validação |
| Alertas com situação e descarte | `charlie-monitor-rules.js` e `charlie-monitor-store.js` | Novos alertas entram nesse armazenamento. Situação `ignorado` do pedido corresponde a `descartado`, que já exige motivo |
| Queda de vendas, estoque mínimo, negativo, parado e ruptura | Monitores `vendas_queda`, `vendedores_queda`, `estoque_*`, `ruptura` | Reusar limiares já configuráveis |
| Cliente inativo, redução de compras e venda cruzada | `charlie-commercial-engine.js` | Associação de produtos exige pelo menos 3 pedidos juntos. O texto já declara que isso não prova compatibilidade técnica |
| Cobertura e sugestão de compra | `purchase-assistant.js` e `routes/purchase-replenishment.js` | Média diária = vendas válidas de 90 dias ÷ 90. Cobertura = estoque ÷ média. Prioridade alta: estoque zerado ou cobertura inferior a 5 dias |
| Caixa, inadimplência e despesa | `cashflow` e `buildAlerts` dos relatórios gerenciais; monitores financeiros | Contas usam `STATUS=1` |
| Resumo executivo e priorização | `charlie-executive-engine.js` | Ollama só interpreta números já calculados. Meta ausente continua sendo declarada como ausente |
| Agenda com fuso e dias da semana | `charlie-automation-plan.js` (`America/Sao_Paulo`) | O horário 07:00 e os dias da semana seguem esse cálculo, com trava de execução própria |
| Permissão | `USUARIOS` e `SIS_OPERACAOUSUARIO` (`IDOPERACAO=900`, `APPID=1`) | Painel e destinatários gerenciais exigem a permissão já usada pela Charlie |
| Isolamento | `IDEMPRESA` e `CONFIGURACAO`; depósito em `DEPOSITO` | Todo indicador recebe empresa. Filial sem empresa explícita usa o depósito ligado em `CONFIGURACAO.CDDEPOSITO` |

## 3. Tabelas e relacionamentos que sustentam os indicadores

Venda efetivada, regra já comentada em `sales.js` como a do Automec:

`SAIDAESTOQUE` + `SAIDAPRODUTO` + `PRODUTO` + `VENDEDOR` + `CLIENTE` + `CONFIGURACAO`

Condições: `DTCANCELAMENTO IS NULL`, `STATUS IN (1,3)`, `STATUS_ORC IS NULL OR STATUS_ORC<>0`, item com `STATUSSE=0`.

Valor do item: `COALESCE(SAIDAPRODUTO.TOTAL, QTDPRODUTO*VLUNIT, 0)`.

Custo do item: `QTDPRODUTO * COALESCE(VLCUSTOREAL, VLCUSTO, PRODUTO.VLCUSTOMEDIO, 0)`.

Ticket: faturamento ÷ quantidade de `NRPEDIDO` distintos.

Orçamento, ainda sem nenhuma consulta no `node-app`:

- `ORCAMENTO` (33.318 registros no schema). Chave `NRORCAMENTO` + `IDEMPRESA`. Ligações: `CLIENTE`, `VENDEDOR`, `CONFIGURACAO`, `RECEBTO`.
- `ORCPROD`. Itens por `NRORCAMENTO` + `IDEMPRESA` + `POSIC`, com `CDPRODUTO`, quantidade, valor e unidade.
- Conversão observável: `SAIDAESTOQUE.NRORCAMENTO` preenchido e a saída passando no filtro de venda efetivada da mesma empresa.

`ORCAMENTO` não tem coluna de validade. `AGENDAMENTO` e `COMPROMISSO` existem e estão vazios no schema. `CLIENTECONTATO` guarda nome e telefone de contato do cliente (174 registros), sem data de acompanhamento. Por isso, nas primeiras entregas, “último contato”, “orçamento vencido” e “sem acompanhamento há 48 horas” saem como **dado indisponível**, até existir fonte ou um prazo configurado pelo usuário. `DTALTER` é alteração do registro, não contato comercial.

Estoque:

- Saldo: `MOVIMENTO` (`QTDEATUAL`, `QTDEMINIMA`, `QTDEMAXIMA`, `QTDEMEDIA`, `QTDESEGURANCA`) por produto e depósito.
- Ledger: `MOV_PRODUTO` (`TIPOMOVIMENTO`, `QTENTRADA`, `QTSAIDA`, `DTMOVIMENTO`, `HISTORICO`, `IDINVENTARIO`, `QTDANTERIOR`, `VL_PERDA_GANHO`). No fonte do Automec, nota e ajuste de inventário gravam `TIPOMOVIMENTO = 5`. A quantidade de entrada fica em `QTENTRADA` e a de saída em `QTSAIDA`. O histórico de estoque também filtra `TIPOMOVIMENTO = 5`. Baixa manual continua identificada pelo `HISTORICO` (por exemplo, “Ajuste na Tela de Inventário”), sem tratar o lançamento como fraude.
- Entrada de compra: `ENTRESTOQUE` + `ENTRPRODUTO`.
- Transferência: `TRANSFERENCIA` + `TRANSF_PRODUTO`.
- Inventário formal: `INVENTARIO` e `MOV_INVENTARIO`, ambos com zero registros no schema lido.

Financeiro: `CTARECEBER` (`DIVIDA` ou `VALOR`, `DTVENC`, `STATUS`) e `CTAPAGAR` (`VALOR` ou `TOTAL`). Não há tabela de contrato, seguro, licença ou consentimento de comunicação.

Preço de concorrente: não há fonte externa autorizada no ERP. A inteligência de preços de mercado permanece desligada. Preço interno continua em `PRODUTOPRECO` e `TABELAPRECO`.

## 4. Fórmulas do relatório diário

Fuso de calendário: `America/Sao_Paulo`.

Período padrão, com o envio às 07:00:

- Dia de referência: o dia civil anterior, intervalo `[00:00, 24:00)`.
- Mês acumulado: do dia 1 do mês até o fim desse dia anterior.
- Comparável: a janela imediatamente anterior, com a mesma quantidade de dias. Percentual só é emitido quando a base anterior é maior que zero. Base zerada produz o texto “sem base comparável”.
- Vendedor sem pedido no período não entra no ranking e não é tratado como menor resultado.
- Empate de valor mantém a mesma posição. O desempate de exibição é o nome.

Metas já gravadas em `management_reports.json` são valores absolutos, sem distinção de dia, semana ou mês. O atingimento atual dos relatórios divide o realizado do período filtrado por esse número. No Charlie Daily a meta usada no percentual mensal será a meta mensal. Enquanto só existir o número único já cadastrado, o relatório usa esse número como meta mensal e informa a origem. Meta diária, semanal, de equipe e o ritmo por dia útil entram na configuração nova e ficam vazios até o usuário gravar. Ritmo necessário = valor restante ÷ dias úteis restantes do mês, com segunda a sexta como padrão e feriado ainda não cadastrado. Projeção = realizado ÷ dias úteis decorridos × dias úteis do mês, apenas quando houver pelo menos um dia útil decorrido com venda.

Conversão de orçamento, quando a etapa 2 consultar `ORCAMENTO`:

- Novo: `DTORC` dentro do dia de referência e `DTCANCELAMENTO IS NULL`.
- Convertido: existe venda efetivada com o mesmo `NRORCAMENTO` e `IDEMPRESA`.
- Taxa: convertidos ÷ novos, somente se novos for maior que zero.
- Em aberto: não cancelado e sem venda efetivada vinculada.
- `ORCAMENTO.STATUS` é o índice da lista de orçamentos do Automec: 0 aberto, 1 finalizado, 2 cancelado, 3 remessa aberta, 4 remessa finalizada, 5 remessa cancelada. A baixa do orçamento grava 1. Em aberto para o relatório é status 0. Convertido em pedido é status 1. Remessa fica em grupo próprio.
- `INDFINAL` é coluna da própria `ORCAMENTO`. O mesmo campo existe em `NOTAFISCAL` e `NFE`. Na tela do orçamento é o checkbox “Consumidor Final”: marcado grava -1 e desmarcado grava 0. A NF-e lê `NOTAFISCAL.INDFINAL` e, na montagem, -1 vira 1. Esse campo não entra na conversão do orçamento.
- Pedidos com `STATUS_ORC=0` já são excluídos da venda. Eles não serão somados de novo aos orçamentos de `ORCAMENTO` sem uma conferência de que os dois conjuntos são documentos diferentes.

Prioridade de oportunidade, determinística, só com campos disponíveis:

- Valor, idade em dias desde `DTORC`, margem `TOTALLUCRO/VLTOTAL` quando `VLTOTAL>0`, e estoque dos itens em `ORCPROD` contra `MOVIMENTO`.
- Histórico do cliente reutiliza o faturamento já calculado pelo motor comercial.
- Probabilidade numérica só aparece se houver conversões anteriores suficientes do mesmo cliente. Abaixo disso, o campo fica “dado indisponível”.
- Faixas e o valor mínimo saem da configuração, com padrão documentado na implementação e sem efeito de envio.

Estoque crítico reutiliza a cobertura do assistente de compras. Capital parado reutiliza `estoque × VLCUSTOMEDIO` e as faixas de 30, 60, 90 e 180 dias já montadas em `inventory()`.

Financeiro do cartão diário: soma de `CTARECEBER` e `CTAPAGAR` em aberto (`STATUS=1`), vencidos (`DTVENC<hoje`) e a vencer na janela configurada. Contratos próximos da renovação permanecem “dado indisponível”.

A Charlie recebe o JSON desses cálculos. O prompt pede de 3 a 5 observações e 3 prioridades usando somente chaves presentes. Número ausente no JSON não pode ser completado pelo modelo. Com Ollama indisponível, o relatório sai com os indicadores e com as três prioridades ordenadas pela severidade das regras.

## 5. Lacunas do que já está no ar

O resumo diário atual (`management-scheduler.js`) está desligado por padrão, dispara às 08:00 no relógio local do processo e consolida o dia corrente, não o anterior. A trava de duplicidade usa a data UTC. Não há retentativa, histórico de destinatário, HTML nem PDF. O texto segue mesmo sem template aprovado na Meta. Mensagem iniciada pela empresa fora da janela de 24 horas da API oficial precisa de modelo aprovado. O Charlie Daily não será habilitado para números reais enquanto `whatsapp_config.json` e `email_config.json` não estiverem completos e um envio de teste for aceito. Até lá o canal fica em modo simulado, gravando o texto no histórico e sem chamar a Meta nem o SMTP.

Não há opt-in de comunicação comercial. Campanha e recado individual ao vendedor ficam desligados na etapa 1. O alerta individual só poderá usar o vendedor destinatário da própria carteira, depois que o telefone e o consentimento estiverem gravados.

O monitor da Charlie já impede alerta duplicado em aberto e tem situação de acompanhamento. O pedido de status “ignorado” não cria um quinto estado paralelo: o descarte existente cobre esse caso.

## 6. Decisão para as etapas seguintes

Ordem mantida, com estes encaixes:

1. Etapa 2 — serviço determinístico de indicadores do dia anterior, mês, ranking, metas e orçamentos, com testes e sem Ollama.
2. Etapa 3 — alertas novos no armazenamento do monitor, com deduplicação já existente.
3. Etapa 4 — interpretação pela `ollamaChat`, com fallback.
4. Etapa 5 — montagem do texto e do HTML do Charlie Daily a partir do JSON, mais link autenticado com expiração.
5. Etapa 6 — agenda 07:00, `America/Sao_Paulo`, todos os dias, persistida, com histórico, erro e retentativa. Permanece desligada.
6. Etapas 7 e 8 — SMTP e WhatsApp já existentes. Template e simulação antes de destinatário real.
7. Etapa 9 — página em Charlie, no padrão visual do Dashboard, sem substituir o Modo Diretor nem o Resumo diário.
8. Etapas 10 e 11 — estoque, CRM, financeiro e campanha somente onde a fonte desta etapa existir. Preço de concorrente e renovação de contrato permanecem indisponíveis.

Nenhuma tabela Firebird precisa ser criada para o relatório básico. Configuração, histórico de execução e fila ficam em JSON no diretório de dados, no mesmo padrão de `management_reports.json` e do monitor da Charlie. Índice novo no Firebird só entra se a consulta de `ORCAMENTO` do dia anterior se mostrar lenta; os índices `ORCAMENTO_DTORC` e `PK_ORCAMENTO` já existem.

## 7. Configurações pendentes antes de operar

O painel já filtra empresa, depósito, dia de referência, vendedor, categoria e severidade. As metas diária, semanal e de equipe entram na configuração. O giro de 30, 60 e 90 dias, a compra recente sem venda, a probabilidade do cliente quando há pelo menos cinco orçamentos e a sugestão de classificação de despesa também entram no relatório. A sugestão de despesa só vale depois que alguém confirma. O PDF abre pelo painel. O WhatsApp real usa o modelo aprovado, com três variáveis: data, venda do dia e link.

Continua dependendo de cadastro, sem invenção de dado:

- Confirmar se `SAIDAESTOQUE.STATUS_ORC=0` duplica `ORCAMENTO`.
- Gravar metas, destinatários, empresas e o consentimento de cada vendedor.
- Completar SMTP e o token da Meta fora do repositório.
- Aprovar na Meta o modelo com três variáveis de texto.
- Preço de concorrente, último contato comercial e renovação de contrato seguem como dado indisponível: o banco não tem essas fontes.
- A agenda e o envio real permanecem desligados até essa validação.
