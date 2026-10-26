@echo off
setlocal
NET SESSION >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  PowerShell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

title Ativar atualizacao Tray
echo Reiniciando o Dashboard Gerencial...
PowerShell -NoProfile -Command "Restart-Service -Name 'SrvDashboard' -Force -ErrorAction Stop"
if errorlevel 1 (
  echo ERRO: nao foi possivel reiniciar o servico.
  pause
  exit /b 1
)

timeout /t 6 /nobreak >nul
PowerShell -NoProfile -Command "$s=New-Object Microsoft.PowerShell.Commands.WebRequestSession; try { Invoke-RestMethod -Uri 'http://127.0.0.1:805/api/tray/config' -WebSession $s -TimeoutSec 20 ^| Out-Null } catch { if($_.Exception.Response.StatusCode.value__ -eq 401){ Write-Host 'SUCESSO: modulo Tray carregado e protegido por login.' -ForegroundColor Green; exit 0 }; throw }"
if errorlevel 1 (
  echo O servico iniciou, mas a rota Tray nao respondeu como esperado.
  pause
  exit /b 1
)

echo Atualizacao ativada. No navegador, pressione Ctrl+F5.
pause
