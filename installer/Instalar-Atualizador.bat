@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0InstallUpdater.ps1"
echo.
echo Servico Dashboard Gerencial Update instalado.
echo Volte ao Dashboard e clique em Atualizar.
pause
