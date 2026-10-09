@echo off
setlocal EnableExtensions
title Mapear server-marica para o Dashboard

set "IP_DASHBOARD=192.168.1.97"
set "NOME_DASHBOARD=server-marica"
set "HOSTS=%SystemRoot%\System32\drivers\etc\hosts"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: execute este arquivo como Administrador na MAQUINA CLIENTE.
    echo Clique com o botao direito e escolha Executar como administrador.
    pause
    exit /b 1
)

echo Removendo entradas antigas de %NOME_DASHBOARD% no hosts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$hosts='%HOSTS%'; $name='%NOME_DASHBOARD%'; $lines=Get-Content -LiteralPath $hosts -ErrorAction Stop; $lines | Where-Object { $_ -notmatch ('(?i)\s' + [regex]::Escape($name) + '(\s|$)') } | Set-Content -LiteralPath $hosts -Encoding ASCII"

echo Adicionando:
echo   %IP_DASHBOARD% %NOME_DASHBOARD%
>>"%HOSTS%" echo %IP_DASHBOARD% %NOME_DASHBOARD%

echo Limpando cache DNS...
ipconfig /flushdns

echo.
echo Testando nome:
ping -n 1 %NOME_DASHBOARD%

echo.
echo Testando porta 5050:
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip='%NOME_DASHBOARD%'; $porta=5050; try { $c=New-Object Net.Sockets.TcpClient; $a=$c.BeginConnect($ip,$porta,$null,$null); if($a.AsyncWaitHandle.WaitOne(4000,$false)){ $c.EndConnect($a); $c.Close(); Write-Host 'OK: porta 5050 acessivel.' } else { $c.Close(); Write-Host 'FALHOU: tempo esgotado conectando na porta 5050.' } } catch { Write-Host ('FALHOU: ' + $_.Exception.Message) }"

echo.
echo Se o teste der OK, abra:
echo   http://%NOME_DASHBOARD%:5050
echo.
pause
