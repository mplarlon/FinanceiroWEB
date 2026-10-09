@echo off
cd /d "%~dp0"
title Instalando dependencias

echo.
echo ============================================================
echo  Instalando todas as dependencias necessarias
echo ============================================================
echo.

echo [1/4] Atualizando pip...
python -m pip install --upgrade pip
echo.

echo [2/4] Instalando dependencias do requirements.txt...
python -m pip install -r requirements.txt
echo.

echo [3/4] Instalando driver Firebird (firebird-driver)...
python -m pip install firebird-driver
if %errorlevel% neq 0 (
    echo  firebird-driver falhou. Tentando fdb...
    python -m pip install fdb
)
echo.

echo [4/4] Testando tudo...
python -c "
import flask; print('Flask OK:', flask.__version__)
import pypdf; print('pypdf OK')
try:
    from firebird.driver import connect
    print('Driver OK: firebird-driver')
except:
    try:
        import fdb
        print('Driver OK: fdb')
    except:
        print('ERRO: Nenhum driver Firebird instalado!')
" 2>&1
echo.

echo ============================================================
echo  Pronto! Agora execute iniciar_dashboard.bat
echo ============================================================
echo.
pause
