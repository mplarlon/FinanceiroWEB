@echo off
setlocal
NET SESSION >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  PowerShell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

title Corrigir conexao Firebird - Pontual
set "DB_FILE=D:\ADMINISTRACAO\DB\MIAUTOMEC.FDB"

echo Verificando o banco...
if not exist "%DB_FILE%" (
  echo ERRO: o arquivo %DB_FILE% nao esta acessivel.
  echo Verifique a unidade D: antes de continuar.
  pause
  exit /b 1
)

echo Reiniciando Firebird Server - DefaultInstance...
PowerShell -NoProfile -Command "Restart-Service -Name 'FirebirdServerDefaultInstance' -Force -ErrorAction Stop"
if errorlevel 1 (
  echo ERRO: nao foi possivel reiniciar o Firebird.
  pause
  exit /b 1
)

timeout /t 3 /nobreak >nul
echo Reiniciando Dashboard Gerencial...
PowerShell -NoProfile -Command "Restart-Service -Name 'SrvDashboard' -Force -ErrorAction Stop"
if errorlevel 1 (
  echo ERRO: nao foi possivel reiniciar o Dashboard.
  pause
  exit /b 1
)

timeout /t 6 /nobreak >nul
echo Testando conexao...
PowerShell -NoProfile -Command "$r=Invoke-RestMethod -Uri 'http://127.0.0.1:805/api/status' -TimeoutSec 30; if(-not $r.ok){throw $r.erro}; Write-Host 'SUCESSO: banco conectado.' -ForegroundColor Green"
if errorlevel 1 (
  echo O servico reiniciou, mas o banco ainda nao respondeu. Nao altere nem restaure o arquivo.
  pause
  exit /b 1
)

echo.
echo Correcao concluida. Atualize a pagina do Dashboard e tente entrar novamente.
pause
