@echo off
schtasks /Run /TN "DashboardGerencialNode"
if errorlevel 1 echo Tarefa nao instalada. Execute INSTALAR_SERVICO.bat como Administrador.
pause
