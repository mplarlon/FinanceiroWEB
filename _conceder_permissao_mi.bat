@echo off
cd /d "%~dp0"
echo Concedendo permissao do Dashboard ao usuario MI...
python CONCEDER_PERMISSAO_DASHBOARD.py MI > _conceder_permissao_mi_resultado.txt 2>&1
echo Concluido. Resultado em _conceder_permissao_mi_resultado.txt
type _conceder_permissao_mi_resultado.txt
pause
