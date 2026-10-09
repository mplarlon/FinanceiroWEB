# Regra de conciliacao bancaria

Mapeamento confirmado no banco:

- `CONCILIACAO`: cabecalho do periodo conciliado, banco, agencia, conta, saldo inicial e saldo final.
- `EXTRATO`: arquivo/periodo de extrato bancario importado, vinculado a `CONCILIACAO`.
- `EXTRATO_ITEM`: lancamentos vindos do extrato bancario.
- `MOV_BANCARIO`: movimento financeiro interno, usado como vinculo entre contas a receber/pagar e os itens do extrato.

Regras usadas no dashboard:

- Item conciliado: `EXTRATO_ITEM.MOV_BANCARIO` preenchido.
- Item pendente: `EXTRATO_ITEM.MOV_BANCARIO` vazio.
- Diferenca de saldo: `(saldo final bancario - saldo inicial) - soma dos itens do extrato`.
- A camada atual e somente leitura e nao altera dados automaticamente.

## Modulo operacional OFX

Fluxo implementado:

1. O usuario seleciona um arquivo `.ofx` na aba Conciliacao.
2. O backend le o OFX e extrai banco, agencia, conta, periodo, saldo final e lancamentos.
3. A pre-visualizacao nao grava dados; ela apenas mostra os itens e as sugestoes.
4. Ao importar, o sistema grava:
   - `CONCILIACAO`: periodo e saldos.
   - `EXTRATO`: cabecalho do arquivo importado.
   - `EXTRATO_ITEM`: lancamentos do extrato.
5. Se a conciliacao automatica estiver ativa, o sistema busca titulos em:
   - `CTARECEBER` para valores positivos.
   - `CTAPAGAR` para valores negativos.
6. A busca usa:
   - data do movimento (`DTMOV` em `CTARECEBER`, `DTPAGTO` em `CTAPAGAR`);
   - forma de pagamento (`CODPAGTO` ou `TPPAGTO`, vinculada a `RECEBTO`);
   - valor exato.
7. Quando encontra um titulo exato, cria um `MOV_BANCARIO`, atualiza o titulo em `MOV_BANCARIA` e vincula o item do extrato.
8. Quando o valor do extrato corresponde a varios titulos no mesmo dia/forma, o sistema pode criar varios `MOV_BANCARIO` para o mesmo `EXTRATO_ITEM`.
9. Quando nao encontra correspondencia exata, o item fica pendente para associacao manual.

Endpoints novos:

- `POST /api/conciliacao/ofx/preview`
- `POST /api/conciliacao/ofx/importar`
- `GET /api/conciliacao/formas-pagamento`
- `GET /api/conciliacao/titulos`
- `POST /api/conciliacao/associar`

Observacao: a importacao grava no banco somente quando o usuario clica em Importar. A pre-visualizacao e somente leitura.

## Transferencia entre contas

Processo para movimentacoes entre contas proprias (ex.: Sicredi -> Caixa, Caixa -> Bradesco):

1. Itens pendentes com historico de transferencia (TRANSF, PIX REM/DES, TED, APLICACAO, RESGATE) recebem a marca `EH_TRANSFERENCIA` e o badge "<->" na fila de pendentes.
2. O botao "Transf." abre o modal de transferencia. O sistema busca automaticamente o lancamento espelho: mesmo valor com sinal invertido, ate 2 dias de diferenca, em outra conta, ainda pendente.
3. Se o espelho existir, os dois itens sao conciliados juntos. Se nao, o usuario escolhe a outra conta manualmente e apenas o item atual e conciliado (o espelho sera tratado quando o extrato da outra conta for importado).
4. O sistema grava um par de `MOV_BANCARIO`: saida (valor negativo) na conta de origem e entrada (valor positivo) na conta de destino. Ambos recebem CDBANCOORIGEM/AGENCIAORIGEM/NUMCONTAORIGEM e CDBANCODESTINO/AGENCIADESTINO/NUMCONTADESTINO, alem de NUMDOC comum `TRANSF-<extrato_item>`.
5. O TPLANCAMENTO segue a convencao ja existente no banco (detectada em registros antigos com CDBANCOORIGEM preenchido); fallback: 1 saida / 0 entrada. A forma de pagamento usa o primeiro RECEBTO contendo TRANSF ou PIX.

Endpoints:

- `GET /api/conciliacao/transferencia/espelho?extrato_item=N&tolerancia=2`
- `POST /api/conciliacao/transferencia` com `{extrato_item, espelho_item?, conta?: {cdbanco, agencia, numconta}, cdrecebto?, permitir_diferenca?}`
