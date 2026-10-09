@echo off
setlocal EnableExtensions
title Orientar rede privada do Windows

echo ============================================================
echo  REDE PRIVADA - DASHBOARD
echo ============================================================
echo.
echo Este Windows nao possui o comando Get-NetConnectionProfile.
echo Por isso, esta rotina nao muda automaticamente a rede para Privada.
echo.
echo A liberacao da porta 5050 ja foi feita pelo arquivo:
echo   LIBERAR_ACESSO_REDE_DASHBOARD.bat
echo.
echo Se o cliente ainda nao acessar, altere manualmente:
echo.
echo Windows:
echo   Configuracoes ^> Rede e Internet ^> Wi-Fi/Ethernet
echo   Clique na rede conectada
echo   Perfil de rede: Privada
echo.
echo Painel de Controle:
echo   Central de Rede e Compartilhamento
echo   Configuracoes de compartilhamento avancadas
echo   Ativar descoberta de rede
echo.
echo Abrindo configuracoes de rede...
start ms-settings:network
echo.
pause
