@echo off
setlocal
cd /d "%~dp0node-app"
if "%DASHBOARD_PORT%"=="" set DASHBOARD_PORT=505
if not exist "C:\administracao\Dashboard\logs" mkdir "C:\administracao\Dashboard\logs"
node server\index.js >> "C:\administracao\Dashboard\logs\dashboard-node.log" 2>&1
