@echo off
setlocal EnableExtensions
title Testar acesso ao Dashboard no cliente

set /p "SERVIDOR=Digite o IP do servidor (ex: 192.168.1.97): "
if "%SERVIDOR%"=="" (
    echo IP nao informado.
    pause
    exit /b 1
)

echo.
echo Testando TCP %SERVIDOR%:5050...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip='%SERVIDOR%'; $porta=5050; try { $c=New-Object Net.Sockets.TcpClient; $a=$c.BeginConnect($ip,$porta,$null,$null); if($a.AsyncWaitHandle.WaitOne(4000,$false)){ $c.EndConnect($a); $c.Close(); Write-Host 'OK: porta 5050 acessivel.'; exit 0 } else { $c.Close(); Write-Host 'FALHOU: tempo esgotado conectando na porta 5050.'; exit 2 } } catch { Write-Host ('FALHOU: ' + $_.Exception.Message); exit 1 }"

echo.
echo Se aparecer OK, abra no navegador:
echo   http://%SERVIDOR%:5050
echo.
pause
