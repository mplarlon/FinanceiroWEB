# Dashboard Gerencial

> Documentação completa de arquitetura, reprodução, estado, aprendizados,
> roadmap e validação: [`DOCUMENTACAO/README.md`](DOCUMENTACAO/README.md).

Aplicacao de producao migrada integralmente para Node.js 20+, Express e React.
O Flask/Python permanece apenas como fonte historica de consulta e nao participa
da instalacao, inicializacao ou execucao do sistema.

## Instalar e executar

1. Instale Node.js 20 ou superior.
2. Execute `INSTALAR.bat`.
3. Use `iniciar_dashboard.bat` para o modo manual.
4. Opcionalmente, execute `INSTALAR_SERVICO.bat` como Administrador para criar
   a tarefa `DashboardGerencialNode`, iniciada automaticamente com o Windows.

O sistema atende em `http://localhost:505`. A configuracao do Firebird fica em
`C:\administracao\Dashboard\start.ini` e tambem pode ser alterada pela
tela/API de configuracao do banco.

## Operacao

- `INICIAR_SERVICO.bat`, `PARAR_SERVICO.bat` e `STATUS_SERVICO.bat` controlam a tarefa Node.
- `reiniciar_dashboard.bat` reinicia uma execucao manual.
- Logs da inicializacao automatica: `C:\administracao\Dashboard\logs\dashboard-node.log`.
- O modulo Credito Trabalhador foi removido da aplicacao ativa.

## Validacao tecnica

Na pasta `node-app`, execute `npm test`, `npm run build` e
`npm run migration:audit`. O ultimo comando compara os contratos legados ativos
com as rotas Express realmente montadas.
