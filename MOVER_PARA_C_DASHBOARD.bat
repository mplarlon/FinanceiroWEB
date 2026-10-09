@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Dashboard Gerencial - Migrar para C:\Dashboard

echo.
echo  ============================================================
echo   Dashboard Gerencial - Migrar para C:\Dashboard
echo  ============================================================
echo.

:: Verificar se eh administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  ATENCAO: Execute este arquivo como ADMINISTRADOR!
    echo.
    echo  Como fazer:
    echo    1. Feche esta janela
    echo    2. Clique com o botao DIREITO em MOVER_PARA_C_DASHBOARD.bat
    echo    3. Selecione: "Executar como administrador"
    echo    4. Clique Sim na janela que aparecer
    echo.
    pause
    exit /b 1
)

echo  Executando como administrador. OK.
echo.
echo  Pasta de origem:  %~dp0
echo  Pasta de destino: C:\Dashboard
echo.

:: Criar pasta destino
echo  [1/3] Criando pasta C:\Dashboard...
if not exist "C:\Dashboard\" mkdir "C:\Dashboard"
if not exist "C:\Dashboard\dashboard\" mkdir "C:\Dashboard\dashboard"
echo  OK
echo.

:: Copiar arquivos
echo  [2/3] Copiando arquivos...
xcopy "%~dp0*" "C:\Dashboard\" /E /Y /I /Q /EXCLUDE:%~dp0excluir.tmp 2>nul

:: Cria lista de exclusao temporaria
echo __pycache__> "%~dp0excluir.tmp"
echo .pyc>> "%~dp0excluir.tmp"
echo backend.err.log>> "%~dp0excluir.tmp"
echo backend.out.log>> "%~dp0excluir.tmp"

xcopy "%~dp0*" "C:\Dashboard\" /E /Y /I /Q 2>nul
del "%~dp0excluir.tmp" 2>nul

if exist "C:\Dashboard\backend.py" (
    echo  OK: Arquivos copiados!
) else (
    echo  ERRO: Falha na copia. Verifique permissoes.
    pause
    exit /b 1
)
echo.

:: Criar atalho
echo  [3/3] Criando atalho na Area de Trabalho...
powershell -NoProfile -Command ^
  "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\Dashboard Gerencial.lnk');$s.TargetPath='C:\Dashboard\iniciar_dashboard.bat';$s.WorkingDirectory='C:\Dashboard';$s.Description='Dashboard Gerencial';$s.Save()"
echo  OK
echo.

echo  ============================================================
echo   Migracao concluida!
echo.
echo   Sistema disponivel em: C:\Dashboard
echo   Atalho criado:         Area de Trabalho ^> Dashboard Gerencial
echo.
echo   Para iniciar: duplo clique em "Dashboard Gerencial"
echo   ou abra C:\Dashboard\iniciar_dashboard.bat
echo  ============================================================
echo.

set /p INICIAR=  Deseja iniciar agora? (S/N):
if /i "!INICIAR!"=="S" start "" "C:\Dashboard\iniciar_dashboard.bat"

echo.
pause
