# Distribuição para clientes

## Padrão permanente da versão cliente

Sempre que for solicitada uma **versão cliente**, gerar o instalador completo
com **Ollama e ACBr incluídos**. Esse é o padrão de distribuição deste projeto;
uma versão sem Ollama ou sem ACBr somente deve ser produzida quando isso for
pedido explicitamente.

Execute na máquina de desenvolvimento:

```powershell
.\build_installer.ps1 -Version 2.4.5 -WithOllama
```

O resultado fica em `output\installer`. O pacote leva o executável congelado, o
frontend e modelos de configuração. Fontes `.py`, senhas reais, certificados,
logs, backups e documentos de desenvolvimento não são distribuídos.

No cliente, binários ficam em `Program Files\Dashboard` e dados em
`C:\administracao\Dashboard`. O serviço `SrvDashboard` inicia com o Windows
e atende em `http://localhost:805`.

Antes da entrega comercial, assine digitalmente o executável e o instalador para
reduzir alertas do SmartScreen. Empacotamento dificulta cópia do código, mas não
impede engenharia reversa especializada.
