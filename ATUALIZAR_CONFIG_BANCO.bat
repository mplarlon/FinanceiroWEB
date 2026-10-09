@echo off
cd /d "%~dp0"
title Atualizar configuracao do banco

echo.
echo ============================================================
echo  Atualizar configuracao do banco do Dashboard
echo ============================================================
echo.

python CONFIGURAR_BANCO.py --force
if %errorlevel% neq 0 (
    echo.
    echo ERRO: configuracao nao concluida.
    pause
    exit /b 1
)

echo.
set /p REINICIAR=Reiniciar servico SrvDashboard, se existir? (S/N):
if /i "%REINICIAR%"=="S" (
    python dashboard_service.py restart
)

echo.
echo Pronto.
pause
