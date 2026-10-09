@echo off
schtasks /Query /TN "DashboardGerencialNode" /V /FO LIST
if errorlevel 1 echo Tarefa nao instalada. Execute INSTALAR_SERVICO.bat como Administrador.
pause
