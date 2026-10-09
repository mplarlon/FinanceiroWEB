@echo off
cd /d "%~dp0node-app"
echo O Flask foi desativado. Validando a aplicacao Node.js/React...
call npm test
call npm run build
call npm run migration:audit
pause
