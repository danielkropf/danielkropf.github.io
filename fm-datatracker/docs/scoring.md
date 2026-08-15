# Scoring

Um atributo FM é normalizado por `((valor - 1) / 19) × 100`. A nota por função é a média ponderada dos atributos presentes; ausências não viram zero e os pesos são renormalizados.

`confidence = min(1, sqrt(minutes / 1800))`. `performance_weight = 0.35 × confidence`; `attribute_weight = 1 - performance_weight`; `current_score = attribute_score × attribute_weight + performance_score × performance_weight`. Sem estatísticas, a nota atual é a nota de atributos. Cada score persistido guarda versão, componentes, pesos e explicação JSON.
