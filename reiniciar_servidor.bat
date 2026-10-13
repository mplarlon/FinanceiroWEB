@echo off
:: Auto-elevacao: pede admin se necessario
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Solicitando permissao de administrador...
    PowerShell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"
title Reiniciar BocadoMato Dashboard

echo ============================================
echo  Reiniciando BocadoMato Dashboard
echo ============================================
echo.

echo [1] Parando servico Windows (se ativo)...
schtasks /End /TN "DashboardGerencialNode" >nul 2>&1

echo [2] Encerrando processo na porta 505...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":505 " 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [3] Aguardando liberacao da porta...
timeout /t 3 /nobreak >nul

echo [4] Localizando Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERRO: Node.js nao encontrado!
    echo Instale o Node.js 20 ou superior.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo Node.js encontrado: %%v
echo.
echo [5] Iniciando servidor...
start "BocadoMato Dashboard - Servidor" /D "%~dp0node-app" node server/index.js

echo.
echo Aguardando inicializacao (5 segundos)...
timeout /t 5 /nobreak >nul
echo.
echo ============================================
echo  Servidor iniciado!
echo  Acesse: http://localhost:505
echo  Logs: C:\administracao\Dashboard\logs\dashboard-node.log
echo  (Uma janela "BocadoMato Dashboard - Servidor" deve estar aberta)
echo ============================================
echo.
pause
