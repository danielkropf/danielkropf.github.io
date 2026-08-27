# FM DataTracker v0.26.5 — Projection v2.1

Pacote de atualização preparado sobre o `master` v0.26.4.

## Como aplicar

Copie o conteúdo desta pasta para `fm-datatracker/` no repositório, substituindo os arquivos existentes quando solicitado.

O pacote contém arquivos completos para:
- `package.json`
- `src/lib/projection-reference.ts`
- `src/lib/projection-player.ts`
- `src/lib/projection-engine.ts`
- `src/lib/base-position-score.ts`
- `src/components/ScoreWithProjection.tsx`
- testes da Projection v2.1
- documentação da Projection v2.1
- `public/reference/projection.fm26-v2-provisional.json`

## package-lock.json

O repositório atual possui `package-lock.json` com versão interna antiga.
O arquivo `package-lock.json.patch` incluído neste pacote altera apenas os dois campos de versão do projeto para `0.26.5`; as dependências não mudam.

## Asset longitudinal validado

- Observações: 43.412
- Bayern: 33.907
- Numancia: 9.505
- Famílias: {"AM": 11557, "D": 8983, "DM": 2703, "GK": 4536, "M": 5506, "ST": 6088, "WB": 4039}
- `calibrated=false`
- status do modelo: `provisional_longitudinal`

O corpus foi incluído integralmente, sem amostragem ou truncamento.

## Estado de publicação

Este pacote está pronto para aplicação manual. O GitHub `master` não foi modificado por esta sessão porque a integração conectada retornou 403 para operações de escrita.
