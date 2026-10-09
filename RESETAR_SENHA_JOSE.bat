@echo off
cd /d "%~dp0"
echo Redefinir senha do usuario JOSE
echo.
python RESETAR_SENHA_USUARIO.py --idusuario 8
echo.
pause
