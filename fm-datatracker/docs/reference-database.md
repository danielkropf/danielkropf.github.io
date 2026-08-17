# Base de referência

A base v1 contém 10.908 jogadores distribuídos por nove mercados de sete países. O número no nome do CSV representa a divisão nacional.

## Privacidade e distribuição

O artefato publicado é anonimizado. Nomes e identificadores do Football Manager não são armazenados. Cada registro contém somente país, divisão, idade, posição e os 47 atributos necessários para os cálculos estatísticos.

## Método atual

1. O usuário seleciona país e divisão na tela de Elenco.
2. Cada jogador é comparado apenas com jogadores da mesma linha posicional primária: GK, D, WB, DM, M, AM ou ST.
3. A nota da população é recalculada usando os pesos gerais atualmente configurados no save e os coeficientes efetivos `0, 1, 2, 4, 6`.
4. O percentil informa a proporção da população de referência cuja nota é menor ou igual à nota do jogador.

Faixas: Fraco (P0–P14), Abaixo da média (P15–P34), Médio (P35–P64), Bom (P65–P84), Excelente (P85–P94) e Elite (P95–P100).

Percentil não representa potencial, valor de mercado ou garantia de desempenho. É uma comparação de atributos com o recorte selecionado.

## Atualização

Execute `node scripts/build-reference-data.mjs <arquivos...>` usando arquivos no padrão `País N Players.csv`. O gerador valida as 47 colunas e recria `public/reference/players.v1.json`.
