@echo off
cd /d "%~dp0"
title DIAGNOSTICO - Dashboard

echo.
echo ============================================================
echo  DIAGNOSTICO DO SISTEMA
echo ============================================================
echo.

echo [1] Python:
python --version
echo.

echo [2] Flask instalado:
python -c "import flask; print('OK - versao', flask.__version__)" 2>&1
echo.

echo [3] Driver Firebird:
python -c "from firebird.driver import connect; print('OK - firebird-driver')" 2>&1
python -c "import fdb; print('OK - fdb')" 2>&1
echo.

echo [4] database_config.json:
if exist "database_config.json" (
    type database_config.json
) else (
    echo ARQUIVO NAO ENCONTRADO
)
echo.

echo [5] Testando conexao com banco:
python -c "
import json
try:
    with open('database_config.json') as f:
        cfg = json.load(f)
    print('Config lida:', cfg.get('database'))
    try:
        from firebird.driver import connect
        con = connect(database=cfg['database'], user=cfg['user'], password=cfg['password'], charset=cfg.get('charset','WIN1252'))
        con.close()
        print('CONEXAO OK - firebird-driver')
    except Exception as e1:
        print('firebird-driver falhou:', e1)
        try:
            import fdb
            con = fdb.connect(dsn=cfg['database'], user=cfg['user'], password=cfg['password'], charset=cfg.get('charset','WIN1252'))
            con.close()
            print('CONEXAO OK - fdb')
        except Exception as e2:
            print('fdb falhou:', e2)
except Exception as e:
    print('ERRO:', e)
" 2>&1
echo.

echo [6] Tentando iniciar Flask (5 segundos):
python -c "
import sys, threading, time
sys.path.insert(0, '.')
def run():
    import backend
threading.Thread(target=run, daemon=True).start()
time.sleep(5)
print('Backend ainda rodando ou encerrou com erro acima')
" 2>&1
echo.

echo ============================================================
echo  Copie tudo acima e envie ao suporte
echo ============================================================
echo.
pause
