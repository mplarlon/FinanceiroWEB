@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo Instalando biblioteca cryptography...
echo.

REM Tenta python -m pip
python -m pip install cryptography 2>nul
if %errorlevel% == 0 goto sucesso

REM Tenta py launcher
py -m pip install cryptography 2>nul
if %errorlevel% == 0 goto sucesso

REM Busca python em locais comuns
set PYCANDIDATES=^
C:\Python313\python.exe ^
C:\Python312\python.exe ^
C:\Python311\python.exe ^
C:\Python310\python.exe ^
C:\Python39\python.exe ^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python313\python.exe ^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe ^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\python.exe ^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python310\python.exe

for %%P in (%PYCANDIDATES%) do (
    if exist "%%P" (
        echo Encontrado: %%P
        "%%P" -m pip install cryptography
        if !errorlevel! == 0 goto sucesso
    )
)

echo ERRO: Nao foi possivel encontrar o Python.
echo Verifique onde o Python esta instalado e rode manualmente:
echo    python -m pip install cryptography
goto fim

:sucesso
echo.
echo SUCESSO! Biblioteca instalada.

:fim
echo.
pause
