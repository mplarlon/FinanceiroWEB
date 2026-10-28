# Central de Atualizações do Dashboard

## Arquitetura encontrada

O produto é uma aplicação Express 5 e React 19/Vite, distribuída para Windows x64. O backend consolidado (`dashboard.mjs`) e o frontend compilado ficam em `C:\Program Files\Dashboard\node-app`; o runtime Node fica fora dessa pasta. O serviço `SrvDashboard` é controlado pelo WinSW. Configurações, certificados, logs e demais dados persistentes ficam em `C:\Administracao\Dashboard`. Cada cliente aponta para uma instância Firebird configurada em `start.ini`; o banco não integra o pacote de atualização.

Não foram encontrados Docker, PM2 ou CI/CD configurados. A geração atual é local por PowerShell/Inno Setup. A nova solução preserva esse desenho e não modifica tabelas ou regras do Firebird.

## Componentes

- `node-app/update-system/center`: API e painel React da central. O armazenamento inicial é um arquivo JSON atômico e pacotes em disco, ambos em diretório externo configurável.
- `node-app/update-system/agent`: processo independente que só abre conexões de saída HTTPS. Mantém identidade, downloads, journal e backups no diretório persistente do cliente.
- `node-app/update-system/shared.js`: semver, SHA-256, assinatura Ed25519, assinatura de requisição e escrita atômica.
- `node-app/scripts/publish-update.js`: cria o pacote reproduzível, gera e assina o manifesto e envia uma versão como rascunho.
- `installer/UpdaterService.xml` e `installer/InstallUpdater.ps1`: serviço Windows `ErpAutoUpdater`, independente de `SrvDashboard`.

O agente usa uma chave Ed25519 exclusiva por instalação. A central guarda somente a chave pública. Tokens de registro são individuais, expiram e só podem ser usados uma vez. Toda consulta, download e confirmação posterior é assinada com timestamp e nonce. Pacotes só são aceitos quando manifesto, versão, plataforma, arquitetura, tamanho e SHA-256 conferem com a assinatura feita pela chave de releases.

## Fluxo de atualização e recuperação

1. O agente consulta a central a cada 30 minutos (configurável).
2. A central só devolve uma versão publicada, compatível e autorizada para aquela instalação, grupo ou lote determinístico.
3. O agente baixa para `.part`, suporta retomada HTTP e valida limite, tamanho, SHA-256 e assinatura.
4. O `.tar.gz` é listado antes da extração; caminhos absolutos, `..` e links são recusados.
5. A nova pasta precisa conter `node-app/server/dashboard.mjs` e `node-app/dist/index.html`.
6. Um journal persistente marca a transação como preparada. O agente para `SrvDashboard`, move a pasta atual para o backup e ativa a nova pasta por renomeação no mesmo volume.
7. O serviço é iniciado e `/api/status` precisa ficar saudável. Em falha, a versão nova é retirada e o backup volta ao lugar.
8. Se a máquina reiniciar no meio do processo, o journal pendente provoca rollback no próximo início do agente.
9. As três versões anteriores são retidas por padrão. O banco não é revertido automaticamente.

O navegador consulta `version.json` sem cache. Se detectar outra versão, oferece **Atualizar agora** ou **Atualizar posteriormente**; nunca recarrega sozinho.

## API principal

Instalação: `POST /api/v1/enroll`, `POST /api/v1/check`, `GET /api/v1/packages/:version` e `POST /api/v1/events`.

Administração: resumo, instalações, releases, eventos, criação de token de registro, upload de pacote, autorização, bloqueio, suspensão global e revogação de instalação em `/api/admin/*`. Todos exigem `Authorization: Bearer <UPDATE_CENTER_ADMIN_TOKEN>`.

## Configuração e hospedagem da central

Variáveis obrigatórias:

```text
UPDATE_CENTER_ADMIN_TOKEN=<segredo longo gerado fora do repositorio>
UPDATE_CENTER_READ_TOKEN=<segredo diferente, somente leitura para o Charlie>
UPDATE_CENTER_METRICS_TOKEN=<segredo diferente para monitoramento>
UPDATE_CENTER_DATA_DIR=D:\Dados\ErpUpdateCenter
UPDATE_CENTER_PORT=8443
UPDATE_CENTER_HOST=127.0.0.1
UPDATE_SIGNING_PUBLIC_KEY_FILE=D:\Segredos\erp-update\release-public.pem
```

Compile e inicie:

```powershell
cd node-app
npm run build:update-center
npm run start:update-center
```

A aplicação Node serve HTTP localmente. Em produção, publique-a atrás de IIS, nginx, Caddy ou balanceador com HTTPS válido, limite de requisições e backup do `UPDATE_CENTER_DATA_DIR`. Não exponha a porta Node diretamente. O diretório de dados da central não pode ficar dentro do Git ou da pasta substituída por releases.

O armazenamento JSON é suficiente para homologação e uma frota pequena. Antes de escala elevada ou alta disponibilidade, substituir `UpdateStore` por banco transacional/objeto compatível, preservando o contrato e os testes.

### Implantação HTTPS pronta para parametrização

Os arquivos em `deploy/update-center` sobem a central e o Caddy. Copie `.env.example` para `.env`, substitua todos os segredos, coloque somente a chave pública em `deploy/update-center/secrets/release-public.pem`, configure o DNS de `UPDATE_CENTER_DOMAIN` e execute:

```powershell
docker compose -f deploy/update-center/compose.yml up -d --build
```

O Caddy obtém e renova o certificado público depois que DNS e portas 80/443 estiverem corretos. Esses valores dependem da infraestrutura real e não são preenchidos pelo código.

### Monitoramento e backup

`GET /metrics` expõe métricas Prometheus mediante `UPDATE_CENTER_METRICS_TOKEN`. Para uma verificação externa:

```powershell
.\deploy\update-center\check-update-center.ps1 -Url https://updates.exemplo.com -MetricsToken '<token>'
```

Agende o backup fora do host/volume da central:

```powershell
.\deploy\update-center\backup-update-center.ps1 -DataDir D:\Dados\ErpUpdateCenter -Destination E:\Backups\ErpUpdateCenter -RetentionDays 30
```

O backup gera ZIP e SHA-256 e aplica retenção. Teste periodicamente a restauração em outra central.

## Primeira configuração criptográfica

```powershell
cd node-app
npm run update:keys -- D:\Segredos\erp-update
```

A chave privada `release-private.pem` permanece somente na máquina/cofre de publicação. Faça backup seguro e restrinja ACL. Apenas `release-public.pem` é distribuída ao agente.

## Instalar o agente em cliente existente

1. Na máquina de build, prepare o agente:

```powershell
.\build_updater_agent.ps1 -PublicKeyFile D:\Segredos\erp-update\release-public.pem
```

2. No painel/API da central, crie um token para a empresa e grupo desejados. O valor é exibido uma única vez.
3. Copie `output\updater-agent` para o cliente piloto e execute como Administrador:

```powershell
.\InstallUpdater.ps1 -CenterUrl https://updates.exemplo.com `
  -EnrollmentToken '<token-individual>' -CompanyName 'Empresa Piloto' `
  -CurrentVersion '2.4.5'
```

4. Confirme o serviço `ErpAutoUpdater` e a primeira comunicação no painel. Nenhuma porta de entrada é necessária.

O padrão é instalar assim que a central tiver uma versão autorizada para o cliente, em qualquer horário. O agente consulta a cada 5 minutos. Uma operação crítica em andamento continua adiando a troca. Para limitar a um horário, use `ERP_UPDATE_WINDOW=HH:MM-HH:MM` no XML do serviço e reinstale o serviço.

Operações críticas usam arquivos temporários em `C:\Administracao\Dashboard\update-blockers`. Rotinas do ERP devem usar `withCriticalOperation()` de `server/lib/update-readiness.js`; o agente remove bloqueadores expirados e adia a atualização enquanto houver um ativo.

## Publicar a primeira atualização

Primeiro execute o pipeline existente que testa e produz `build\cliente-sem-fontes\runtime\node-app`. Depois:

```powershell
$env:UPDATE_CENTER_URL='https://updates.exemplo.com'
$env:UPDATE_CENTER_ADMIN_TOKEN='<segredo-admin>'
$env:UPDATE_SIGNING_PRIVATE_KEY_FILE='D:\Segredos\erp-update\release-private.pem'
$env:ERP_BUILD_VERSION='2.5.0'
cd node-app
npm run build
npm run update:publish -- --version=2.5.0 --channel=stable --notes='Correções|Melhorias'
```

A publicação fica em `draft`: ela não é entregue automaticamente. No painel, libere primeiro para o grupo `pilot`. Somente após observar instalações saudáveis amplie para 5%, 20%, 50% e 100%. O lote usa hash estável do ID da instalação, evitando que clientes mudem de lote entre consultas.

Para uma release com migração aditiva já homologada, use `--databaseStrategy=additive-compatible --migrationReference=DOCUMENTACAO/...`. Estratégias destrutivas são recusadas pelo agente; consulte [POLITICA_MIGRACOES_ATUALIZACAO.md](POLITICA_MIGRACOES_ATUALIZACAO.md).

## Teste piloto obrigatório

1. Use uma máquina/VM de homologação com cópia não produtiva dos dados necessários.
2. Registre-a no grupo `pilot` e confira a versão atual.
3. Publique uma versão de teste assinada e libere somente para a instalação piloto.
4. Verifique download, reinício, `/api/status`, `version.json`, confirmação no painel e preservação de `C:\Administracao\Dashboard`.
5. Publique uma versão propositalmente incapaz de passar no health check e confirme `rollback`, versão anterior funcional e evento de auditoria.
6. Interrompa uma atualização após a ativação em homologação e reinicie a máquina para validar recuperação pelo journal.
7. Só depois habilite clientes reais gradualmente.

Na VM piloto, valide o estado local com:

```powershell
.\scripts\Test-UpdaterPilot.ps1 -RequireCompletedUpdate
.\scripts\Test-UpdaterPilot.ps1 -RequireRollback
```

## Operações de emergência

- **Bloquear versão:** altere seu status para `blocked`; novas consultas e downloads são recusados.
- **Suspender frota:** use “Suspender distribuição”; o ERP continua operando e agentes retomam depois.
- **Revogar cliente:** revogue apenas a instalação comprometida; as demais identidades continuam válidas.
- **Falhas repetidas:** após três falhas daquela versão, o agente para de tentar até uma versão corrigida ou intervenção local.

## Riscos e pendências de infraestrutura

- É necessário definir domínio, certificado TLS, proxy HTTPS, hospedagem, monitoramento, backup e política de retenção da central.
- Assinatura Authenticode foi integrada ao build por `scripts/Sign-Artifact.ps1`. Configure `SIGN_CERT_THUMBPRINT` e, opcionalmente, `SIGN_TIMESTAMP_URL`; o build assina e verifica o artefato. A aquisição/proteção do certificado e a reputação SmartScreen continuam externas.
- Migrações Firebird devem ser aditivas/compatíveis e ter procedimento próprio testado. O atualizador deliberadamente não executa nem reverte SQL.
- A detecção de operação crítica agora possui contrato e bloqueador persistente. Cada rotina de negócio longa deve ser marcada ao ser criada; operações ainda não marcadas dependem da janela configurada.
- O Charlie consulta resumo, instalações, versões e falhas usando `UPDATE_CENTER_READ_TOKEN`. Essa credencial não passa na API de escrita. Liberar, bloquear ou revogar continuam fora do Charlie.
- Testes reais de proxy HTTPS, queda de internet, reinicialização física, permissão de serviço e atualizações simultâneas dependem do ambiente de homologação.

## Testes locais

```powershell
cd node-app
node --test test/update-system.test.js
npm test
npm run build
npm run build:update-center
```

Os testes automatizados cobrem semver, assinatura adulterada, autenticação individual, anti-replay, registro único, revogação, autorização, versão bloqueada/suspensa/incompatível, cliente atualizado, ativação, pacote corrompido, rollback por health check e recuperação por journal.

O workflow `.github/workflows/update-system-ci.yml` repete testes, builds e consolidação do agente em Windows. Ele não publica nem implanta automaticamente.
