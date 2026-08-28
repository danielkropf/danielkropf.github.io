# FM DataTracker

Aplicação pessoal para acompanhar saves do Football Manager por meio de snapshots históricos. O DataTracker importa exports CSV e, em fase beta, arquivos `.fm`; organiza elenco, planejamento, táticas, funções e projeções sem promover campos experimentais a dados confirmados.

## Estado atual

- Versão desta entrega: **v0.26.7**.
- CSV continua sendo o caminho estável de importação.
- A leitura direta de `.fm` acontece localmente no navegador e continua **beta**.
- CA/PA extraídos do `.fm` permanecem candidatos experimentais com provenance explícita; CA/PA antigos de CSV/PlayerExport não alimentam Projection.
- Projection v2.1 permanece provisória (`calibrated=false`).
- Autenticação e dados persistentes usam Supabase com RLS; o frontend utiliza somente a chave pública `anon`.

## Stack

React 19, TypeScript strict, Vite, HashRouter, Supabase Auth/PostgreSQL/Storage/RLS, Papa Parse, Web Workers, `zstddec` e Vitest.

## Desenvolvimento local

```bash
cd fm-datatracker
npm ci
copy .env.example .env.local
npm run dev
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em `.env.local`. Nunca exponha uma chave `service_role` no frontend e nunca versione `.env.local`.

## Gates obrigatórios

Antes de considerar uma release válida:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

O build gera `dist/`. GitHub Pages deve usar **Source = GitHub Actions**. O workflow `.github/workflows/deploy-pages.yml` monta `_site/fm-datatracker/` a partir de `dist/` e preserva os demais sites do repositório. Não usar publicação paralela por branch/Jekyll para o DataTracker.

## Documentação canônica

A documentação operacional não vive em `docs/` neste repositório. A fonte canônica está no Google Drive, pasta **FM-Datatracker**, especialmente:

- `FM DataTracker — PROJECT INSTRUCTIONS`
- `FM DataTracker — HANDOFF`
- `FM DataTracker — Architecture`
- `FM DataTracker — Import Format`
- `FM DataTracker — Database`
- `FM DataTracker — Development`
- `FM DataTracker — Reference Database`
- `FM DataTracker — Scoring`
- `FM DataTracker — Design System`
- `Research/FM DataTracker — FM Save Format`
- `Research/FM DataTracker — Validation Ground Truth`

O GitHub é a fonte canônica da implementação publicada; o Drive é a fonte canônica das especificações, pesquisa, decisões e continuidade.

## Supabase e migrations

As migrations em `supabase/migrations/` são histórico append-only e devem ser aplicadas em ordem cronológica. Não reescrever migrations já aplicadas para corrigir drift: adicionar uma migration forward.

O ledger remoto de produção inclui hardening de integridade em `20260827234211` e `20260827234421` e a estabilização `20260828060819`, que restaura `delete_fm_import`, expõe capability detection factual e provisiona o fluxo privado de diagnóstico `.fm` com reserva/cleanup/expiração.

GitHub Pages **não aplica migrations Supabase automaticamente**. O estado remoto deve ser verificado antes de uma release depender de nova capability.

## Limites de segurança

Não comite saves, exports privados, DLLs proprietárias do FM, dumps de interop ou credenciais. O leitor `.fm` é estritamente de leitura e não deve modificar o save do jogo. Campos sem provenance/confiança suficiente devem permanecer indisponíveis em vez de receber valores inferidos.
