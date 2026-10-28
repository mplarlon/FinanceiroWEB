# Charlie Sales — Etapa 8: Competitor Radar

Data: 2026-10-26

A etapa 9 calcula a recompra pelo intervalo mediano. O detalhe está em `CHARLIE_SALES_ETAPA_9.md`.

## O que entrou

O Charlie Competitor Radar guarda referências cadastradas. Ele não abre página, não pesquisa marketplace e não completa preço, frete, disponibilidade ou promoção que não tenham sido informados.

A comparação usa marca, código e modelo. Marca e código iguais dão confiança alta e podem gerar o alerta de preço acima da referência. Marca e modelo iguais, sem código, mostram os preços e não geram alerta. Código, marca ou modelo divergentes interrompem a comparação: produtos diferentes não entram como equivalentes.

Marca e código nossos vêm do produto sincronizado. O modelo nosso só existe se alguém digitar no cadastro da referência. Características, quantidade e condições do anúncio ficam como foram escritas.

Uma consulta nova na mesma referência guarda a troca de preço, com o valor anterior, o novo e a data informada.

## Arquivos

Criados:

- `node-app/server/lib/charlie-competitor-radar.js`
- `node-app/server/lib/charlie-competitor-radar-service.js`
- `node-app/client/src/pages/CharlieCompetitorRadar.jsx`
- `node-app/test/charlie-competitor-radar.test.js`
- `DOCUMENTACAO/CHARLIE_SALES_ETAPA_8.md`

Alterados:

- `node-app/server/routes/tray.js`
- `node-app/client/src/lib/charlie-sales-ecosystem.js`
- `node-app/client/src/pages/CharlieSalesShell.jsx`
- `node-app/test/charlie-sales-ecosystem.test.js`

## Como validar

1. Abra Charlie Sales e o item Charlie Competitor Radar.
2. Cadastre um anúncio com o mesmo código do produto. O alerta aparece se o nosso preço for maior, com fonte e data.
3. Cadastre o mesmo produto com outro código. Não há alerta e o preço do anúncio não entra na comparação.
4. Registre uma segunda consulta com preço diferente. A tela mostra de quanto foi para quanto.

## Limites

Não há varredura automática de anúncios. A confiança alta significa que marca e código informados coincidem, não que o anúncio foi verificado fora do cadastro.
