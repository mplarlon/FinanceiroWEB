# Operação, manutenção e produção

## Publicação segura

1. Faça backup consistente do Firebird e teste a restauração.
2. Use uma cópia de homologação para executar o roteiro funcional.
3. Execute `npm ci`, `npm test`, `npm run build` e `npm run migration:audit`.
4. Registre a versão/commit e o hash SHA-256 do instalador.
5. Pare a tarefa/processo anterior, publique e inicie novamente.
6. Teste login, consulta somente leitura e uma operação controlada.
7. Monitore logs e mantenha o pacote anterior disponível para rollback.

O script `build_installer.ps1` compila, testa, audita, gera um backend
consolidado, inclui o runtime necessário e rejeita fontes front-end no pacote.
O caminho atual do Inno Setup está fixo no script e precisa existir ou ser
adaptado na máquina de build.

## Comandos operacionais

- `INICIAR_SERVICO.bat`, `PARAR_SERVICO.bat`, `STATUS_SERVICO.bat`;
- `reiniciar_dashboard.bat` para execução manual;
- `DIAGNOSTICO_SERVICO.bat` e `VER_LOG_SERVICO.bat` para diagnóstico;
- log padrão: `C:\administracao\Dashboard\logs\dashboard-node.log`.

## Backup mínimo

- backup nativo e validado do arquivo `.FDB`;
- cópia criptografada do diretório de dados/configuração;
- commit/tag do código implantado, lockfile e instalador com hash;
- configurações e certificados externos com controle de acesso;
- documentação deste diretório.

Não trate arquivos `*_prestate*.json` ou SQLs históricos como substitutos de um
backup integral do banco.

## Diagnóstico rápido

1. Confirme que o processo Node está ativo e a porta responde.
2. Leia o log sem expor senhas/tokens.
3. Valide host, porta, caminho e credenciais em `start.ini`.
4. Confirme serviço Firebird e firewall.
5. Execute `npm test` para regressões locais.
6. Se só o front-end estiver antigo, refaça `npm run build` e reinicie.
7. Se uma integração falhar, teste primeiro a configuração pública/mascarada e
   a homologação; não copie tokens para chamados ou documentação.

## Rollback

Aplicação: pare o serviço, restaure o pacote anterior e reinicie. Banco: só
restaure backup após avaliar as escritas feitas pela versão nova. Como algumas
rotas criam estruturas auxiliares e lançamentos financeiros, rollback de
binário não desfaz dados. Use as operações de reversão funcionais quando
disponíveis e preserve trilha de auditoria.

## Checklist periódico

- testar restauração de backup;
- revisar espaço em disco e logs;
- renovar certificados/tokens;
- atualizar Node e dependências em homologação;
- revisar usuários e permissões;
- conferir conciliações, boletos pendentes e alertas;
- executar testes e auditoria antes de cada entrega.

