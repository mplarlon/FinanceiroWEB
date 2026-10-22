# Charlie — Etapa 16

Foi integrado o modo **Me ajude nesta tela** ao Charlie existente, sem criar outro chatbot. A entrega inclui contexto de 11 telas reais, destaques por identificadores determinísticos, guias orientados por eventos, progresso por usuário e versão, retomada, modos Aprender/Executar, procedimentos da memória empresarial e explicação de erros reais.

Os treinamentos iniciais cobrem consulta de títulos, saldos de estoque, necessidades de compra e uso do Charlie. Rascunhos administrativos exigem permissão gerencial e publicação explícita; versões anteriores são preservadas como substituídas. A orientação determinística funciona sem Ollama.

Segurança: usuário, perfil, setor e permissão vêm da sessão; valores dos formulários não são capturados; controles com nomes sensíveis são filtrados; aprender não executa tarefas; executar reutiliza as confirmações existentes.

Limitações: não foi criado ambiente de homologação nem dados fictícios. Algumas telas possuem apenas contexto geral até receberem identificadores internos estáveis. O cenário funcional obrigatório deve ser executado contra a homologação já existente antes da implantação em produção.
