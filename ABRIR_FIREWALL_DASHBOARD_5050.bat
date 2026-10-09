@echo off
setlocal EnableExtensions
title Abrir Firewall Dashboard 5050

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: este arquivo precisa ser executado como Administrador.
    echo.
    echo Clique com o botao direito no arquivo e escolha:
    echo   Executar como administrador
    echo.
    pause
    exit /b 1
)

echo Removendo regras antigas, se existirem...
netsh advfirewall firewall delete rule name="Dashboard 5050 TCP" >nul 2>&1
netsh advfirewall firewall delete rule name="Dashboard 5050 PythonService" >nul 2>&1
netsh advfirewall firewall delete rule name="Dashboard Ping ICMPv4" >nul 2>&1

echo.
echo Criando regra de entrada TCP porta 5050...
netsh advfirewall firewall add rule name="Dashboard 5050 TCP" dir=in action=allow protocol=TCP localport=5050 profile=any

echo.
echo Criando regra para permitir ping IPv4...
netsh advfirewall firewall add rule name="Dashboard Ping ICMPv4" dir=in action=allow protocol=icmpv4 profile=any

echo.
echo Regras criadas:
netsh advfirewall firewall show rule name="Dashboard 5050 TCP"
echo.
netsh advfirewall firewall show rule name="Dashboard Ping ICMPv4"

echo.
echo Porta escutando no servidor:
netstat -ano | findstr ":5050"

echo.
echo IPs IPv4 do servidor:
ipconfig | findstr /I "IPv4"

echo.
echo No cliente, teste no navegador:
echo   http://192.168.1.97:5050
echo.
pause
