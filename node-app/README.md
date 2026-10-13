# Dashboard Gerencial em Node.js e React

Esta pasta contém a aplicação Node.js e React usada em produção. Os contratos
`/api` permanecem compatíveis com os clientes existentes.

## Desenvolvimento

```powershell
cd C:\Dashboard\node-app
npm install
npm run dev
```

React abre em `http://localhost:5173` e encaminha as APIs ao Node na porta 505.

## Ollama no Charlie

O Charlie usa o Ollama opcionalmente para interpretar perguntas ambíguas e
melhorar a redação. As consultas continuam definidas no servidor: o modelo não
produz nem executa SQL. Sem o Ollama, o assistente usa as regras locais.

```powershell
winget install Ollama.Ollama
ollama pull qwen3:8b
$env:CHARLIE_AI_ENABLED="auto"
$env:CHARLIE_OLLAMA_URL="http://127.0.0.1:11434"
$env:CHARLIE_OLLAMA_MODEL="qwen3:8b"
$env:CHARLIE_OLLAMA_TIMEOUT_MS="20000"
$env:CHARLIE_OLLAMA_KEEP_ALIVE="10m"
npm start
```

Use `CHARLIE_AI_ENABLED=false` para desativar. O estado aparece no cabeçalho
da tela Charlie.

## Produção

```powershell
npm run build
npm start
```

Os dados locais ficam em `C:\administracao\Dashboard`. A migração inclui
configuração do Firebird, autenticação, dashboards, módulos fiscal, financeiro,
comercial, compras, DP, boletos, expedição e integrações. O módulo Crédito
Trabalhador foi removido por decisão de produto.

Na raiz do projeto, `iniciar_dashboard.bat` compila a interface quando
necessário e inicia diretamente o servidor Node.js. O backend Flask não é
mais iniciado por esse atalho. A inicialização automática também usa Node.js,
por meio da tarefa agendada `DashboardGerencialNode`.

## Auditoria da migração

```powershell
npm test
npm run build
npm run migration:audit
```

O auditor extrai o inventário das rotas Flask históricas (ignorando módulos
removidos) e confirma cada contrato contra os routers Express montados.
