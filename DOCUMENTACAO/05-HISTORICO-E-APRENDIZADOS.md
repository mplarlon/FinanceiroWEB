# Histórico, decisões e aprendizados

## Linha do tempo recuperável

- 09/10/2026: importação ampla da aplicação, documentação histórica, scripts
  de instalação, integrações, testes e evidências operacionais.
- 13/10/2026: consolidação da execução Node, instalador sem fontes, melhorias
  financeiras, Charlie, relatórios gerenciais, vídeos/manuais e serviço.
- 14/10/2026: correção da visibilidade de todas as parcelas do acordo,
  atualização explícita na tela e criação desta documentação consolidada.

Para detalhes exatos, use `git log --stat` e `git show <commit>`. O Git é a
fonte de verdade para diferenças de código; este texto registra o contexto.

## Aprendizados técnicos

1. “Criado no banco” não significa “visível na tela”: filtros de status e data
   precisam ser reconciliados após mutações. Foi essa a causa do parcelamento
   em que apenas a primeira parcela parecia existir.
2. Contas a pagar e receber possuem cadastros diferentes. Usar `RECEBTO` para
   ambos gera categorias/formas incorretas em pagar; pagar deve usar `PAGTO`.
3. A classificação não é um único campo: há quatro níveis dependentes, além do
   centro de custo. Ao trocar um nível pai, filhos incompatíveis devem ser
   limpos.
4. Padrões operacionais do Automec importam. Novos títulos preenchem campos de
   auditoria, datas, status, origem e valores para permanecer compatíveis.
5. Escritas financeiras devem ser atômicas. Acordo, baixa e reversão usam uma
   transação, evitando originais alterados sem as parcelas novas.
6. O Firebird legado pode devolver texto como Buffer WIN1252; a normalização
   central evita caracteres quebrados.
7. O Charlie pode usar IA apenas para classificação/redação. Consultas e SQL
   permanecem definidos no servidor; números da resposta vêm do relatório.
8. Atualização de serviço pode interromper leitura brevemente; somente GET é
   repetido automaticamente. Escritas nunca são repetidas para não duplicar.
9. Relatórios gerenciais já cobrem boa parte da etapa 2, porém precisão depende
   da qualidade de classificações, saldos bancários e títulos no ERP.

## Alterações financeiras recentes

- filtro inicial passou a usar início do mês até hoje;
- nova conta retorna vencimento e reaparece sem sair da tela;
- pagar lista formas de `PAGTO`; receber lista formas de `RECEBTO`;
- classificação contábil ganhou quatro níveis e centro de custo agrupado;
- valores padrão podem vir da forma de pagamento/recebimento;
- inserts foram completados com campos exigidos pela operação legada;
- acordo agora informa intervalo completo de vencimentos e a interface expande
  o filtro para exibir todas as parcelas recém-criadas.

## Informação não recuperada

“Melhorias tratadas no Charlie em telefone” é uma referência a conversa não
versionada. O repositório comprova Charlie, WhatsApp, histórico, relatórios e
agendamento, mas não permite afirmar todos os requisitos falados. Registrar a
ata/aceite futuro neste diretório, com data, responsável e exemplos esperados.

