@echo off
echo Node.js:
node --version
echo.
echo Tarefa automatica:
schtasks /Query /TN "DashboardGerencialNode" /V /FO LIST
echo.
echo Porta 506:
netstat -ano | findstr ":505 "
pause
