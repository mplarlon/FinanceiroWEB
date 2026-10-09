@echo off
schtasks /End /TN "DashboardGerencialNode" >nul 2>&1
timeout /t 2 /nobreak >nul
schtasks /Run /TN "DashboardGerencialNode"
if errorlevel 1 echo Tarefa nao instalada. Execute INSTALAR_SERVICO.bat como Administrador.
pause
