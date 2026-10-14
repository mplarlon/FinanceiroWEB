# Roteiro de validação funcional

Use banco de homologação com backup. Registre data, versão/commit, executor,
empresa usada, resultado e evidência. Não exponha clientes, documentos, tokens
ou valores reais em capturas compartilhadas.

## 1. Atualização na própria tela

1. Abra Contas a pagar/receber e anote quantidade/total.
2. Crie um título de teste dentro do período.
3. Confirme que o modal fecha, a mensagem aparece e a grade atualiza sem sair.
4. Altere filtros e use “Buscar / atualizar”.
5. Quite e reverta um título controlado; confirme atualização imediata.

Esperado: nenhuma recarga manual do navegador nem troca de menu.

## 2. Categoria e centro de custo

Repita para receber e pagar:

1. Crie título com forma prevista, centro de custo e quatro níveis de conta.
2. Troque o nível 1 e confirme que níveis filhos são limpos.
3. Grave e confira os campos diretamente no Firebird ou pela tela legada.
4. Crie outro título só com a forma prevista e confirme os padrões esperados.

Esperado: pagar usa `PAGTO`; receber usa `RECEBTO`; hierarquia não fica
incompatível e `CCUSTO` é persistido.

## 3. Parcelamento em duas

1. Selecione um título aberto com forma prevista.
2. Crie acordo com 2 parcelas, intervalo de 30 dias e valores cuja soma seja o
   novo total.
3. Confirme mensagem com número do acordo.
4. Confirme que as duas linhas aparecem imediatamente, inclusive a futura.
5. Confira parcelas 1 e 2, vencimentos, valores, status e vínculo do acordo.
6. Desfaça o acordo e confirme restauração do original e inativação das novas.

Esperado: operação atômica; nenhuma parcela oculta pelo filtro após salvar.

## 4. Relatórios da segunda etapa

- Fluxo projetado: configure contas do saldo inicial e confira 7/30/60/90 dias.
- Entradas/saídas: reconcilie uma amostra com movimentos do caixa.
- Saldo: compare com os saldos oficiais na mesma data/hora.
- Cobertura futura: valide capital de giro e cenários manualmente em amostra.
- Despesas: ordene pagar por valor e compare fornecedores/categorias.
- Períodos: compare pelo menos dois intervalos com movimentos conhecidos.
- Vendedores: filtre títulos vencidos por vendedor e confira no ERP.

## 5. Charlie e WhatsApp

1. Sem Ollama, faça perguntas de contas a pagar/receber, atraso, caixa e saldo.
2. Com Ollama, repita e confirme que os números continuam iguais aos relatórios.
3. Configure WhatsApp em homologação, valide assinatura do webhook e envio para
   número de teste autorizado.
4. Valide resumo diário, horário, destinatários e comportamento em falha.
5. Compare com a ata da conversa telefônica quando ela for recuperada.

## 6. Regressão técnica

```powershell
Set-Location node-app
npm test
npm run build
npm run migration:audit
```

Aceite final: todos os comandos passam, roteiro funcional aprovado, backup
testado, configurações/segredos fora do pacote e versão registrada.

