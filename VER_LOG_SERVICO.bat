@echo off
set "LOG=%ProgramData%\Dashboard\logs\dashboard-node.log"
if exist "%LOG%" (type "%LOG%") else (echo Log ainda nao criado: %LOG%)
pause
