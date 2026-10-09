@echo off
setlocal EnableExtensions
title Liberar acesso por nome ao Dashboard

set "PORTA=805"
set "NOME_SERVIDOR=%COMPUTERNAME%"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: execute este arquivo como Administrador.
    echo Clique com o botao direito e escolha Executar como administrador.
    pause
    exit /b 1
)

echo ============================================================
echo  LIBERAR ACESSO POR NOME AO DASHBOARD
echo ============================================================
echo.
echo Nome deste servidor: %NOME_SERVIDOR%
echo Endereco para testar no cliente:
echo   http://%NOME_SERVIDOR%:%PORTA%
echo.

echo [1/4] Liberando porta %PORTA%...
netsh advfirewall firewall delete rule name="Dashboard 805 TCP" >nul 2>&1
netsh advfirewall firewall add rule name="Dashboard 805 TCP" dir=in action=allow protocol=TCP localport=%PORTA% profile=any

echo.
echo [2/4] Liberando descoberta de rede do Windows...
netsh advfirewall firewall set rule group="Descoberta de Rede" new enable=Yes >nul 2>&1
netsh advfirewall firewall set rule group="Network Discovery" new enable=Yes >nul 2>&1
netsh advfirewall firewall set rule group="Compartilhamento de Arquivo e Impressora" new enable=Yes >nul 2>&1
netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=Yes >nul 2>&1

echo.
echo [3/4] Liberando NetBIOS/LLMNR/mDNS para resolucao de nomes na rede...
netsh advfirewall firewall delete rule name="Dashboard NetBIOS UDP 137" >nul 2>&1
netsh advfirewall firewall delete rule name="Dashboard LLMNR UDP 5355" >nul 2>&1
netsh advfirewall firewall delete rule name="Dashboard mDNS UDP 5353" >nul 2>&1
netsh advfirewall firewall add rule name="Dashboard NetBIOS UDP 137" dir=in action=allow protocol=UDP localport=137 profile=any >nul
netsh advfirewall firewall add rule name="Dashboard LLMNR UDP 5355" dir=in action=allow protocol=UDP localport=5355 profile=any >nul
netsh advfirewall firewall add rule name="Dashboard mDNS UDP 5353" dir=in action=allow protocol=UDP localport=5353 profile=any >nul

echo.
echo [4/4] Conferindo servico e porta...
sc query SrvDashboard
echo.
netstat -ano | findstr ":%PORTA%"
echo.
echo IPs IPv4 deste servidor:
ipconfig | findstr /I "IPv4"
echo.
echo Agora teste no cliente:
echo   http://%NOME_SERVIDOR%:%PORTA%
echo.
echo Se nao resolver pelo nome, no cliente teste:
echo   ping %NOME_SERVIDOR%
echo   nslookup %NOME_SERVIDOR%
echo.
pause
