@echo off
cd /d "%~dp0"
echo Criando indices no banco Firebird para melhorar performance...
echo.
python CRIAR_INDICES.py
