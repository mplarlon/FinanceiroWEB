@echo off
setlocal
net session >nul 2>&1 || (echo ERRO: execute como Administrador. & pause & exit /b 1)
schtasks /End /TN "DashboardGerencialNode" >nul 2>&1
schtasks /Delete /TN "DashboardGerencialNode" /F
echo Inicializacao automatica removida. O modo manual continua em iniciar_dashboard.bat.
pause
