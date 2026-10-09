@echo off
setlocal EnableExtensions
title Liberar porta 805 - Dashboard

set "PORTA=805"
set "REGRA=Dashboard - Porta 805 TCP"

rem Solicita permissao de Administrador automaticamente.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo Solicitando permissao de Administrador...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo Configurando o Firewall do Windows para o Dashboard...

rem Remove a regra com o mesmo nome para permitir executar o arquivo novamente.
netsh advfirewall firewall delete rule name="%REGRA%" >nul 2>&1

rem Libera conexoes TCP de outros computadores da mesma rede local.
netsh advfirewall firewall add rule name="%REGRA%" ^
    dir=in action=allow protocol=TCP localport=%PORTA% ^
    remoteip=LocalSubnet profile=any enable=yes >nul

if not "%errorlevel%"=="0" (
    echo.
    echo ERRO: nao foi possivel criar a regra do firewall.
    pause
    exit /b 1
)

echo.
echo SUCESSO: a porta TCP %PORTA% foi liberada para a rede local.
echo Regra criada: %REGRA%
echo.
echo Enderecos IPv4 deste computador:
ipconfig | findstr /I "IPv4"
echo.
echo No outro computador, acesse pelo navegador:
echo   http://IP-DESTE-COMPUTADOR:%PORTA%
echo.
echo Observacao: o Dashboard precisa estar aberto neste computador.
echo.
pause
exit /b 0
