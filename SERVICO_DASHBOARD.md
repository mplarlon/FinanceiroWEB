# Inicializacao automatica do Dashboard

O Dashboard usa Node.js e inicia pela tarefa agendada `DashboardGerencialNode`.

1. Execute `INSTALAR.bat` para instalar dependencias, compilar e testar.
2. Execute `INSTALAR_SERVICO.bat` como Administrador.
3. Consulte com `STATUS_SERVICO.bat`.

Os comandos `INICIAR_SERVICO.bat`, `PARAR_SERVICO.bat`,
`reiniciar_servico.bat` e `REMOVER_SERVICO.bat` controlam a tarefa. O log fica
em `C:\administracao\Dashboard\logs\dashboard-node.log`.
