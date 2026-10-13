@echo off
setlocal
cd /d "%~dp0"
title Instalar inicializacao automatica do Dashboard Node.js
net session >nul 2>&1 || (echo ERRO: execute como Administrador. & pause & exit /b 1)
where node >nul 2>&1 || (echo ERRO: Node.js nao encontrado. Execute INSTALAR.bat. & pause & exit /b 1)
if not exist "node-app\dist\index.html" (pushd node-app & call npm ci & call npm run build & popd)
schtasks /Delete /TN "DashboardGerencialNode" /F >nul 2>&1
schtasks /Create /TN "DashboardGerencialNode" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "\"%~dp0executar_dashboard_silencioso.bat\"" /F
if errorlevel 1 (echo ERRO ao criar a tarefa de inicializacao. & pause & exit /b 1)
schtasks /Run /TN "DashboardGerencialNode"
echo Dashboard Node.js configurado para iniciar com o Windows na porta 505.
pause
