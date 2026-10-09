@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Ajustar banco da nova maquina

echo.
echo ============================================================
echo  Ajustes do banco para o Dashboard
echo ============================================================
echo.

if not exist "database_config.json" (
    echo ERRO: database_config.json nao encontrado.
    echo Execute INSTALAR.bat ou CONFIGURAR_BANCO.py antes.
    pause
    exit /b 1
)

echo [1/4] Testando conexao...
python CONFIGURAR_BANCO.py --test-only
if %errorlevel% neq 0 (
    echo.
    echo ERRO: corrija a conexao antes de aplicar ajustes.
    pause
    exit /b 1
)
echo.

echo [2/4] Criando/validando menus do Dashboard...
set /p GRANT_ALL=Conceder acesso ao Dashboard para todos os usuarios ativos? (S/N):
if /i "!GRANT_ALL!"=="S" (
    python CRIAR_MENU_DASHBOARD.py --grant-all-active
) else (
    python CRIAR_MENU_DASHBOARD.py
)
if %errorlevel% neq 0 (
    echo.
    echo ERRO: falha ao criar menus/permissoes.
    pause
    exit /b 1
)
echo.

echo [3/4] Criando/validando indices de performance...
python CRIAR_INDICES.py --no-pause
if %errorlevel% neq 0 (
    echo.
    echo AVISO: algum indice pode nao ter sido criado. Confira a mensagem acima.
)
echo.

echo [4/4] Validando importacao do backend...
python -c "import backend; print('Backend importado com sucesso na porta', backend.PORT)"
if %errorlevel% neq 0 (
    echo.
    echo ERRO: backend nao carregou. Confira dependencias e logs.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Ajustes concluidos.
echo  Agora instale o servico com INSTALAR_SERVICO.bat como Administrador.
echo ============================================================
echo.
pause
