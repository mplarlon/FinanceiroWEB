# Estado atual do projeto

## Resumo executivo

O sistema ativo é o Dashboard Gerencial 2.0, uma aplicação web local em Node.js
20+, Express 5, React 19 e Firebird. O servidor atende, por padrão, em
`http://localhost:505`. A versão Flask/Python é apenas referência histórica e
não participa da execução atual.

Em 14/10/2026, a suíte automatizada passou com 41 testes e o front-end compilou
com sucesso. A validação com uma cópia representativa do banco de produção ainda
é obrigatória antes da publicação, pois os testes não executam todos os fluxos
contra um Firebird real.

`npm run migration:audit` executa neste checkout, mas atualmente informa `0/0`:
a fonte legada usada pelo gerador de inventário não está presente. Portanto,
esse resultado não deve ser interpretado como cobertura de rotas; recupere a
fonte histórica ou preserve um inventário aprovado para tornar a auditoria útil.

## Módulos visíveis

- visão geral e dashboards comercial/financeiro;
- Charlie (assistente financeiro, com Ollama opcional);
- contas a pagar e receber, criação, quitação, acordo e reversões;
- controle de caixa e fechamento;
- conciliação OFX e de cartões;
- DRE;
- fiscal, NF-e, apuração, regras e guias;
- compras, reposição e fornecedores;
- clientes, estoque, expedição e PDV;
- boletos Bradesco, CAIXA, Banco do Brasil e Sicredi;
- relatórios gerenciais: lojas, metas, margens, estoque, fluxo projetado,
  vendedores, retenção, fornecedores, alertas e resumo diário.

## Alterações em foco

| Item solicitado | Estado em 14/10/2026 | Evidência/observação |
|---|---|---|
| Atualizar dados sem sair da tela | Implementado | Operações recarregam a grade; botão “Buscar / atualizar”; leituras têm uma nova tentativa após reinício breve do servidor. |
| Categoria em pagar e receber | Implementado, requer aceite | Forma prevista usa `PAGTO` em contas a pagar e `RECEBTO` em contas a receber; classificação contábil possui quatro níveis dependentes. |
| Parcelamento em duas não apareceu | Corrigido nesta revisão | A API retorna primeiro/último vencimento; a tela muda para títulos abertos e expande o período para mostrar todas as parcelas. |
| Centro de custo junto com categorias | Implementado | Centro de custo está no mesmo bloco “Classificação contábil” e pode herdar padrão da forma de recebimento. |
| Melhorias tratadas no Charlie por telefone | Parcial/precisa aceite | Integração WhatsApp, histórico e envio de resumo existem; o conteúdo exato da conversa telefônica não estava versionado e deve ser confirmado com o solicitante. |

## Riscos e limites conhecidos

- O Firebird legado é a fonte de verdade; nomes e semântica de campos variam
  entre pagar e receber.
- Algumas rotas criam tabelas/sequências auxiliares sob demanda. O usuário do
  banco precisa de DDL/DML compatível ou a preparação deve ser feita por DBA.
- Configurações e sessões ficam fora do Git em
  `C:\administracao\Dashboard`; uma cópia apenas do repositório não leva esses
  segredos nem preferências.
- Integrações bancárias e WhatsApp exigem credenciais externas e homologação.
- O instalador depende hoje de Inno Setup em um caminho específico da máquina
  de build; isso deve ser parametrizado em evolução futura.
- A raiz contém grandes artefatos operacionais históricos. Eles ajudam em
  auditoria, mas aumentam o risco de transportar dados sensíveis.

## Próxima ação recomendada

Executar o roteiro de `07-VALIDACAO-FUNCIONAL.md` em ambiente de homologação,
principalmente criação de conta, classificação, acordo em duas parcelas,
fluxo projetado e relatório de vendedores. Só depois gerar o instalador.

