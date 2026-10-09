@echo off
cd /d "%~dp0"
echo Rodando diagnostico de login para o usuario MI...
python DIAGNOSTICAR_LOGIN.py MI > _diag_login_mi_resultado.txt 2>&1
echo Concluido. Resultado em _diag_login_mi_resultado.txt
type _diag_login_mi_resultado.txt
pause
