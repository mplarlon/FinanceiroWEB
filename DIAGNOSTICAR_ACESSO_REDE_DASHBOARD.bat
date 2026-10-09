@echo off
setlocal EnableExtensions
title Diagnosticar acesso de rede ao Dashboard

set "PORTA=805"
set "SERVICO=SrvDashboard"

echo ============================================================
echo  DIAGNOSTICO DE REDE DO DASHBOARD
echo ============================================================
echo.
echo [1] Servico:
sc query "%SERVICO%"
echo.
echo [2] Porta %PORTA% escutando:
netstat -ano | findstr ":%PORTA%"
echo.
echo [3] IPs IPv4 do servidor:
ipconfig | findstr /I "IPv4"
echo.
echo [4] Regras do firewall contendo Dashboard:
netsh advfirewall firewall show rule name=all | findstr /I "Dashboard 805 ICMP"
echo.
echo No cliente, use o IP IPv4 da mesma rede. Exemplo:
echo   http://192.168.1.97:%PORTA%
echo.
pause
