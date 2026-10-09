@echo off
cd /d "%~dp0"
echo Criando menus do Dashboard no Firebird...
echo.
python CRIAR_MENU_DASHBOARD.py %*
echo.
pause
