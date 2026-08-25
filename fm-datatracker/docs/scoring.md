# Pontuação, pesos e escala visual

## Princípios

- Atributos do FM são valores de 1 a 20.
- Ausência de atributo não equivale a zero: a média ponderada é recalculada apenas com atributos presentes.
- Pesos são configuráveis por save, função e fase tática; mudanças persistem no save.
- CA/PA não entram no cálculo de nota. Mesmo quando vierem de `.fm`, são candidatos de leitura e não dados de scoring confiáveis.

## Cálculo interno

Em `src/lib/scoring.ts`, cada atributo é normalizado para uma base interna de 0–100:

```text
atributo_normalizado = ((valor - 1) / 19) × 100
```

O slider visual de peso 1–5 não é linear. Ele vira o coeficiente efetivo abaixo:

| Peso visual | Coeficiente |
| --- | --- |
| 1 | 0 |
| 2 | 1 |
| 3 | 2 |
| 4 | 4 |
| 5 | 6 |

`attributeScore` calcula a média ponderada com esses coeficientes. Pesos de atributos ausentes são removidos do denominador, o que evita punir um export incompleto.

Quando existem estatísticas, o score atual pode combinar atributos e desempenho:

```text
confidence = min(1, sqrt(minutes / 1800))
performance_weight = 0.35 × confidence
attribute_weight = 1 - performance_weight
current_score = attribute_score × attribute_weight + performance_score × performance_weight
```

Sem estatísticas válidas, a nota atual é a nota de atributos. Componentes, pesos e explicação devem continuar gravados no JSON do score para auditoria.

## Escala apresentada ao usuário

O cálculo interno 0–100 é convertido para a escala visual inspirada no FM:

```text
nota_FM = 1 + (score_interno / 100) × 19
```

As telas exibem no máximo duas casas decimais e usam `ScoreBadge`/as cores configuradas, em vez de reinventar estilos locais. A escala visual não deve ser tratada como um atributo real 1–20: ela é uma projeção da qualidade relativa calculada.

## IP, OOP e nota combinada

Para uma vaga que liga fases **IP** (in possession) e **OOP** (out of possession), cada fase é pontuada com a função/posição correspondente e convertida para a escala visual. A nota de planejamento usa a média geométrica:

```text
nota_combinada = sqrt(nota_IP × nota_OOP)
```

Isso penaliza uma fase muito fraca sem reduzir a vaga a uma média aritmética enganosa. Tooltips devem informar a combinação IP/OOP usada, mas o card principal mostra apenas a nota combinada da vaga.

## Padrões e restauração

Os defaults por função são definidos em `src/lib/roleWeights.ts` e devem acompanhar a matriz/documentação de pesos do FM26. O comando **Restaurar padrão** restaura esse preset da função, não um conjunto genérico de sliders 3. Uma função nova começa com o preset aplicável; uma função antiga personalizada só muda se o usuário restaurar explicitamente.

## Validação após mudança

Ao alterar fórmula, pesos ou labels:

1. rodar os testes de `scoring` e `roleWeights`;
2. conferir a conversão 1–20, arredondamento e cores em Elenco, Planejamento, Táticas e tooltips;
3. validar uma vaga IP/OOP assimétrica e uma com atributos ausentes;
4. confirmar que dados históricos e scores existentes continuam renderizando.
