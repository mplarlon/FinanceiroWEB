@echo off
schtasks /End /TN "DashboardGerencialNode"
if errorlevel 1 echo A tarefa nao estava em execucao ou nao foi instalada.
pause
