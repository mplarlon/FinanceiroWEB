@echo off
cd /d "%~dp0"
echo Listando cargas/rotas concluidas para revisao antes de apagar...
echo.
python LIMPAR_CARGAS_ANTIGAS.py
pause
