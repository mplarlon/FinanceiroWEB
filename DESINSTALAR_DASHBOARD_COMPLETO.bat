@echo off
setlocal EnableExtensions
title Desinstalar Dashboard por completo

set "SERVICE_NAME=SrvDashboard"
set "TARGET_DIR=C:\Dashboard"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Solicitando permissao de administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo  DESINSTALAR DASHBOARD POR COMPLETO
echo ============================================================
echo.
echo Esta rotina vai:
echo  - Parar o servico %SERVICE_NAME%
echo  - Remover o servico do Windows
echo  - Encerrar processos Python usando %TARGET_DIR%
echo  - Apagar a pasta %TARGET_DIR%
echo.
echo ATENCAO: isto remove a instalacao local do Dashboard.
echo.
set /p "CONFIRMA=Digite APAGAR para continuar: "
if /I not "%CONFIRMA%"=="APAGAR" (
    echo Operacao cancelada.
    pause
    exit /b 1
)

set "WORKER=%TEMP%\desinstalar_dashboard_worker_%RANDOM%%RANDOM%.bat"

> "%WORKER%" echo @echo off
>>"%WORKER%" echo setlocal EnableExtensions
>>"%WORKER%" echo title Desinstalar Dashboard - executando
>>"%WORKER%" echo set "SERVICE_NAME=%SERVICE_NAME%"
>>"%WORKER%" echo set "TARGET_DIR=%TARGET_DIR%"
>>"%WORKER%" echo cd /d "%%TEMP%%"
>>"%WORKER%" echo echo.
>>"%WORKER%" echo echo [1/5] Parando servico %%SERVICE_NAME%%...
>>"%WORKER%" echo sc stop "%%SERVICE_NAME%%" ^>nul 2^>^&1
>>"%WORKER%" echo timeout /t 5 /nobreak ^>nul
>>"%WORKER%" echo echo [2/5] Removendo servico %%SERVICE_NAME%%...
>>"%WORKER%" echo sc delete "%%SERVICE_NAME%%" ^>nul 2^>^&1
>>"%WORKER%" echo if exist "%%TARGET_DIR%%\dashboard_service.py" ^(
>>"%WORKER%" echo   echo [3/5] Tentando remover via dashboard_service.py...
>>"%WORKER%" echo   pushd "%%TARGET_DIR%%"
>>"%WORKER%" echo   python dashboard_service.py stop ^>nul 2^>^&1
>>"%WORKER%" echo   python dashboard_service.py remove ^>nul 2^>^&1
>>"%WORKER%" echo   popd
>>"%WORKER%" echo ^) else ^(
>>"%WORKER%" echo   echo [3/5] dashboard_service.py nao encontrado, pulando remocao via Python.
>>"%WORKER%" echo ^)
>>"%WORKER%" echo echo [4/5] Encerrando processos Python do Dashboard...
>>"%WORKER%" echo powershell -NoProfile -ExecutionPolicy Bypass -Command "$target='C:\Dashboard'; $names=@('python.exe','pythonw.exe','py.exe'); Get-CimInstance Win32_Process ^| Where-Object { $names -contains $_.Name.ToLowerInvariant() -and $_.CommandLine -and $_.CommandLine.Contains($target) } ^| ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('  Processo encerrado: ' + $_.ProcessId + ' ' + $_.Name) } catch {} }"
>>"%WORKER%" echo timeout /t 2 /nobreak ^>nul
>>"%WORKER%" echo echo [5/5] Apagando pasta %%TARGET_DIR%%...
>>"%WORKER%" echo if exist "%%TARGET_DIR%%" powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath 'C:\Dashboard' -Recurse -Force -ErrorAction Stop"
>>"%WORKER%" echo if exist "%%TARGET_DIR%%" ^(
>>"%WORKER%" echo   echo.
>>"%WORKER%" echo   echo AVISO: A pasta ainda existe. Feche Explorer, terminais e editores abertos em %%TARGET_DIR%% e rode novamente.
>>"%WORKER%" echo   pause
>>"%WORKER%" echo   exit /b 1
>>"%WORKER%" echo ^)
>>"%WORKER%" echo echo.
>>"%WORKER%" echo echo Dashboard desinstalado por completo.
>>"%WORKER%" echo pause

echo.
echo Iniciando desinstalador temporario...
start "Desinstalar Dashboard" cmd /c ""%WORKER%""
exit /b
