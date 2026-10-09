@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Dashboard Gerencial

echo.
echo  ============================================================
echo   Dashboard Gerencial
echo  ============================================================
echo.

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERRO: Node.js 20 ou superior nao encontrado. Execute INSTALAR.bat primeiro.
    pause & exit /b 1
)

if not exist "node-app\node_modules" (
    echo  Instalando dependencias Node.js...
    pushd node-app
    call npm ci
    if errorlevel 1 (popd & pause & exit /b 1)
    popd
)

if not exist "node-app\dist\index.html" (
    echo  Compilando interface React...
    pushd node-app
    call npm run build
    if errorlevel 1 (popd & pause & exit /b 1)
    popd
)

if "%DASHBOARD_PORT%"=="" set DASHBOARD_PORT=506

echo  Iniciando servidor...
echo  Acesse: http://localhost:%DASHBOARD_PORT%
echo  Para encerrar: feche esta janela ou pressione Ctrl+C
echo.
echo  -- LOG DO SERVIDOR -----------------------------------------
echo.

:: Abre o navegador apos 4 segundos
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:%DASHBOARD_PORT%"

:: Roda o servidor Node.js e serve a interface React compilada
pushd node-app
node server/index.js 2>&1
popd

echo.
echo  -- SERVIDOR ENCERRADO --------------------------------------
echo.
echo  Se houve erro acima, copie a mensagem e informe ao suporte.
echo.
pause
