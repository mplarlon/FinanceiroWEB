@echo off
cd /d "%~dp0node-app"
call npm ci
call npm run build
node server\index.js
pause
