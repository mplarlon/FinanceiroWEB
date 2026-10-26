# Política de migrações em atualizações remotas

O agente nunca executa SQL recebido da central e nunca reverte automaticamente o Firebird. Releases usam `database.strategy`:

- `none`: não existe mudança de banco.
- `additive-compatible`: a migração foi aplicada separadamente, é aditiva e funciona simultaneamente com a versão anterior e a nova.
- Qualquer outro valor bloqueia a instalação automática.

Uma migração aditiva precisa ser idempotente, ter backup Firebird validado, não remover nem renomear colunas usadas pela versão anterior e possuir referência operacional em `migrationReference`. Mudanças destrutivas exigem janela manual, plano específico, teste de restauração e autorização fora do atualizador.

O procedimento obrigatório é: backup e teste de restauração; aplicação em homologação; versão anterior funcionando contra o esquema novo; versão nova funcionando contra o esquema novo; somente então publicação para piloto. O rollback automático restaura exclusivamente código e frontend.
