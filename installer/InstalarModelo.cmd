@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0InstallOllama.ps1" -Step Completo
echo.
pause
