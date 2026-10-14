# Ambiente e reprodução em outra máquina

## Pré-requisitos

- Windows 10/11 ou Windows Server compatível;
- Node.js 20 ou superior e npm;
- acesso de rede ao Firebird e uma cópia/backup autorizado do banco;
- cliente Firebird compatível (ou `DASHBOARD_FBCLIENT` apontando para ele);
- para gerar instalador: Inno Setup 6;
- opcionais: Ollama, ACBr, certificados, SMTP e credenciais das integrações.

## Código e dependências

```powershell
git clone <URL-DO-REPOSITORIO> FinanceiroWEB
Set-Location FinanceiroWEB\node-app
npm ci
npm test
npm run build
npm run migration:audit
```

`npm ci` usa exatamente `package-lock.json`. Não copie `node_modules` entre
máquinas. A auditoria de migração compara contratos legados inventariados com
as rotas Express montadas. Neste checkout, a fonte legada não está disponível e
o inventário resulta em `0/0`; restaure essa fonte/inventário antes de usar o
comando como evidência de cobertura.

## Configuração mínima do banco

Crie `C:\administracao\Dashboard\start.ini` como JSON. Exemplo sem segredo:

```json
{
  "type": "firebird",
  "name": "Banco principal",
  "host": "localhost",
  "port": 3051,
  "database": "C:\\Administracao\\db\\MIAUTOMEC.FDB",
  "user": "USUARIO_DASHBOARD",
  "password": "SUBSTITUIR",
  "charset": "WIN1252",
  "role": "",
  "active": true
}
```

Prefira usuário dedicado com os privilégios necessários. Não use os valores
padrão de desenvolvimento em produção. O caminho pode ser alterado com
`DASHBOARD_DATA_DIR`.

## Variáveis de ambiente

| Variável | Uso/padrão |
|---|---|
| `DASHBOARD_PORT` | porta HTTP; padrão `505` |
| `DASHBOARD_DATA_DIR` | dados locais; padrão `C:\administracao\Dashboard` |
| `DASHBOARD_FBCLIENT` | caminho explícito de `fbclient.dll` |
| `DASHBOARD_COOKIE_SECURE` | `true` quando servido exclusivamente por HTTPS |
| `DASHBOARD_NFE_CONFIG` | arquivo alternativo da configuração NF-e |
| `CHARLIE_AI_ENABLED` | `auto`, `false` ou habilitação do Ollama |
| `CHARLIE_OLLAMA_URL` | padrão `http://127.0.0.1:11434` |
| `CHARLIE_OLLAMA_MODEL` | modelo local do Charlie |
| `CHARLIE_OLLAMA_TIMEOUT_MS` | timeout; padrão 20000 ms |
| `WHATSAPP_VERIFY_TOKEN` | validação do webhook Meta |
| `WHATSAPP_ACCESS_TOKEN` | token de acesso Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número remetente |
| `WHATSAPP_APP_SECRET` | validação HMAC do webhook |
| `WHATSAPP_API_VERSION` | padrão `v20.0` |

## Execução

Desenvolvimento: `npm run dev` dentro de `node-app`.

Produção a partir dos fontes:

```powershell
npm run build
npm start
```

Ou execute `INSTALAR.bat` na raiz e depois `iniciar_dashboard.bat`. Para a
tarefa agendada, siga `../SERVICO_DASHBOARD.md` e execute os scripts de serviço
como Administrador.

## Dados que precisam ser migrados separadamente

Copiar com canal seguro, sem Git:

- banco Firebird ou sua conexão autorizada;
- `C:\administracao\Dashboard\start.ini`;
- demais JSONs necessários no mesmo diretório (`management_reports.json`,
  `whatsapp_config.json`, configurações bancárias e `sessions.json` apenas se
  realmente necessário);
- certificados e chaves privadas;
- configuração NF-e/ACBr, SMTP e diretórios de PDF/remessa.

Após copiar, revise ACLs, caminhos absolutos, host/porta e validade dos
certificados. Não reutilize sessões em uma nova produção: preferencialmente
remova `sessions.json` e faça novo login.

