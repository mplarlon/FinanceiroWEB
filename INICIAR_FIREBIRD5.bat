@echo off
setlocal
set "FB5_DIR=%~dp0Firebird-5.0.4"
set "FB5_EXE=%FB5_DIR%\firebird.exe"

netstat -ano | findstr /R /C:":3051 .*LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 0

if not exist "%FB5_EXE%" (
    echo ERRO: Firebird 5 nao encontrado em "%FB5_EXE%".
    exit /b 1
)

start "Firebird 5.0 - Dashboard" /min /d "%FB5_DIR%" "%FB5_EXE%" -a

for /L %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    netstat -ano | findstr /R /C:":3051 .*LISTENING" >nul 2>&1 && exit /b 0
)

echo ERRO: Firebird 5 nao iniciou na porta 3051.
exit /b 1
