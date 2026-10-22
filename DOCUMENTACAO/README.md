# Documentação técnica e de continuidade

Atualizada em 22/10/2026. Este diretório é o ponto de entrada para entender,
instalar, validar, operar e continuar o Dashboard Gerencial sem depender do
histórico da máquina em que ele foi desenvolvido.

## Ordem de leitura

1. [01-ESTADO-ATUAL.md](01-ESTADO-ATUAL.md) — fotografia do produto e das pendências.
2. [02-ARQUITETURA.md](02-ARQUITETURA.md) — componentes, dados e integrações.
3. [03-AMBIENTE-E-REPRODUCAO.md](03-AMBIENTE-E-REPRODUCAO.md) — como reproduzir.
4. [04-OPERACAO-E-PRODUCAO.md](04-OPERACAO-E-PRODUCAO.md) — operação, backup e diagnóstico.
5. [05-HISTORICO-E-APRENDIZADOS.md](05-HISTORICO-E-APRENDIZADOS.md) — decisões e alterações.
6. [06-REQUISITOS-E-ROADMAP.md](06-REQUISITOS-E-ROADMAP.md) — rastreabilidade dos pedidos.
7. [07-VALIDACAO-FUNCIONAL.md](07-VALIDACAO-FUNCIONAL.md) — roteiro de aceite.
8. [CHARLIE_OPERACAO_PRODUCAO.md](CHARLIE_OPERACAO_PRODUCAO.md) — implantação gradual, operação, backup e reversão do Charlie.
9. [CHARLIE_GUIA_USUARIO.md](CHARLIE_GUIA_USUARIO.md) — orientações para usuários do Charlie.
10. [CHARLIE_ETAPA_20_RELATORIO.md](CHARLIE_ETAPA_20_RELATORIO.md) — auditoria final, evidências e pendências de liberação.
11. [CHARLIE_MODO_DIRETOR_RELATORIO.md](CHARLIE_MODO_DIRETOR_RELATORIO.md) — camada executiva do Charlie, testes e limitações.
12. [CHARLIE_CAFE_MANHA_ETAPA_1_DIAGNOSTICO.md](CHARLIE_CAFE_MANHA_ETAPA_1_DIAGNOSTICO.md) — diagnóstico do Charlie Daily: fontes, fórmulas e o que já existe.

## Documentos históricos ainda válidos

- `../LEIA-ME.md`: início rápido.
- `../DISTRIBUICAO_CLIENTE.md`: pacote instalável.
- `../SERVICO_DASHBOARD.md`: tarefa agendada do Windows.
- `../CONCILIACAO.md`: regras de conciliação.
- `../FISCAL_MODULO_DESENHO_TECNICO.md` e `../INTEGRACAO_NFE_SEFAZ.md`: fiscal/NF-e.
- `../IMPLEMENTACAO_DRE_COMPLETO.md` e `../MELHORIAS_DRE_COMPLETO.md`: DRE.

Arquivos `*_apply*.sql`, `*_prestate*`, TSV, JSON de análises, imagens remotas,
logs e backups na raiz são evidências de intervenções específicas. Eles não são
pré-requisitos para compilar a aplicação. Antes de removê-los, arquive-os de
forma segura e verifique se contêm dados pessoais, financeiros ou credenciais.

