@echo off
cd /d "%~dp0"
title Testar banco do Dashboard

echo.
echo ============================================================
echo  Testando conexao com o banco configurado
echo ============================================================
echo.

python CONFIGURAR_BANCO.py --test-only

echo.
pause
