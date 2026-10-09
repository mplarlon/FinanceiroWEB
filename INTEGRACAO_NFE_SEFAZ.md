# Integração NF-e / SEFAZ

O emissor do Dashboard é o ACBrMonitorPLUS local. A integração não abre nem
automatiza a interface do ERP: gera o INI da NF-e diretamente a partir do
Firebird e envia comandos ao ACBr por TCP.

O ACBr deve escutar apenas em `127.0.0.1:3434` e utilizar o certificado do
repositório do Windows. O thumbprint configurado é
`F99BD81C565F194DB197FA5BE8E4C78D04C20B75`. Comece sempre em homologação e
altere `enabled` para `true` somente após `GET /api/fiscal/nfe/acbr/status`
retornar o status da SEFAZ.

É possível apontar outro arquivo de configuração pela variável
`DASHBOARD_NFE_CONFIG`.

## Operações ACBr

- Emissão: `NFE.CriarEnviarNFe`.
- Cancelamento: `NFE.CancelarNFe`.
- Inutilização: `NFE.InutilizarNFe`.
- Carta de correção: `NFE.EnviarEvento`.
- Diagnóstico: `NFE.StatusServico`.

O Dashboard só marca a emissão após `cStat` 100/150, o cancelamento após
101/135/155, a inutilização após 102 e a CC-e após 135/136.

## Rotas do Dashboard

- `POST /api/fiscal/nfe/<idnf>/emitir`
- `POST /api/fiscal/nfe/<idnf>/cancelar`
- `POST /api/fiscal/nfe/inutilizar`
- `POST /api/fiscal/nfe/<idnf>/carta-correcao`
- `GET /api/fiscal/nfe/acbr/status`
- `POST /api/fiscal/nfe/devolucao/xml` (multipart; leitura e criacao do rascunho)

## Devolucao a partir do XML original

Na tela **Emissao NF-e**, selecione o XML autorizado, confira os itens e ajuste
as quantidades. O Dashboard identifica a contraparte pelo CNPJ, exige que ela e
os produtos estejam cadastrados e cria um rascunho sem transmitir. A NF-e
gerada usa finalidade 4, referencia a chave original, converte o CFOP para a
devolucao interna/interestadual e informa pagamento 90 com valor zero. A
transmissao continua sendo feita pelo botao **Emitir** da lista.

Ao gerar o fechamento, a transmissão ocorre automaticamente quando a
integração está habilitada. A resposta de `/fechamento-carteira/gerar` inclui
`emissao_automatica` e um resultado por nota em `emissoes`. Uma rejeição não
desfaz a criação da nota nem reenvia documentos que já foram autorizados.

## Boleto CAIXA após autorização

Depois do `cStat` 100/150, o Dashboard procura as parcelas abertas da NF-e e,
quando `boletos_caixa_config.json` está completo e homologado, gera um PDF por
parcela e uma remessa CNAB 240. O número do documento usa o NRDOC da nota com
sufixos AC, BC, CC e assim por diante. A operação é idempotente: parcelas que
já possuem boleto não são geradas novamente.

Copie `boletos_caixa_config.example.json` para `boletos_caixa_config.json` e
preencha agência, conta, código do beneficiário, convênio, CNPJ e nome do
beneficiário. Mantenha `homologado` como `false` até o arquivo e as amostras de
boleto serem aprovados pela CAIXA. Falha na geração bancária é informada na
resposta como `boleto_caixa`, sem desfazer a autorização fiscal.
