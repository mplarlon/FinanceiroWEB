@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":505 " 2^>nul') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul
start "Dashboard Gerencial" /D "%~dp0node-app" node server\index.js
echo Dashboard Node.js reiniciado em http://localhost:505
pause
