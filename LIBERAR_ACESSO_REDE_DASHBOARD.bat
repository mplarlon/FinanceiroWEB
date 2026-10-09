@echo off
setlocal EnableExtensions
title Liberar acesso de rede ao Dashboard

set "PORTA=805"
set "REGRA=Dashboard Gerencial Porta 805"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Solicitando permissao de administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Liberando porta %PORTA% no Firewall do Windows...
netsh advfirewall firewall delete rule name="%REGRA%" >nul 2>&1
netsh advfirewall firewall add rule name="%REGRA%" dir=in action=allow protocol=TCP localport=%PORTA% profile=any

echo.
echo Liberando resposta a ping ICMPv4 para diagnostico...
netsh advfirewall firewall delete rule name="Dashboard Gerencial Ping ICMPv4" >nul 2>&1
netsh advfirewall firewall add rule name="Dashboard Gerencial Ping ICMPv4" dir=in action=allow protocol=icmpv4 profile=any >nul

echo.
echo IPs IPv4 desta maquina:
ipconfig | findstr /I "IPv4"

echo.
echo Verificando se a porta %PORTA% esta escutando neste servidor:
netstat -ano | findstr ":%PORTA%"
echo.
echo No computador cliente, acesse:
echo   http://IP_DO_SERVIDOR:%PORTA%
echo.
echo Exemplo:
echo   http://192.168.1.97:%PORTA%
echo.
pause
