@echo off
setlocal
cd /d "%~dp0"
title Dashboard Gerencial - Instalador Node.js
echo Verificando Node.js 20 ou superior...
where node >nul 2>&1 || (echo ERRO: instale Node.js 20 ou superior. & pause & exit /b 1)
for /f "tokens=1 delims=." %%M in ('node -p "process.versions.node"') do set NODE_MAJOR=%%M
if %NODE_MAJOR% LSS 20 (echo ERRO: Node.js 20 ou superior e obrigatorio. & pause & exit /b 1)
echo Instalando dependencias, compilando e testando...
pushd node-app
call npm ci || (popd & pause & exit /b 1)
call npm run build || (popd & pause & exit /b 1)
call npm test || (popd & pause & exit /b 1)
popd
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Dashboard Gerencial.lnk')); $s.TargetPath='%~dp0iniciar_dashboard.bat'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo Instalacao concluida. Use iniciar_dashboard.bat ou INSTALAR_SERVICO.bat como Administrador.
pause
