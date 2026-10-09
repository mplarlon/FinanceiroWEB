@echo off
setlocal
cd /d "%~dp0node-app"
if "%DASHBOARD_PORT%"=="" set DASHBOARD_PORT=506
if not exist "%ProgramData%\Dashboard\logs" mkdir "%ProgramData%\Dashboard\logs"
node server\index.js >> "%ProgramData%\Dashboard\logs\dashboard-node.log" 2>&1
