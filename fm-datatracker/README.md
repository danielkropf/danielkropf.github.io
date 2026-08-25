# FM DataTracker

Aplicação pessoal para acompanhar saves do Football Manager por meio de snapshots históricos. O projeto importa exports CSV e, em fase beta, arquivos de save `.fm`; organiza elenco, planejamento, táticas, pesos de funções e comparação com uma base de referência.

> Antes de alterar o projeto, leia o [handoff técnico](docs/HANDOFF.md). Ele é o documento de referência para continuidade segura.

## Estado atual

- Versão do aplicativo: **v0.23.1**.
- CSV é o caminho de importação estável.
- A leitura direta de `.fm` funciona localmente no navegador e permanece beta: campos sem mapeamento confirmado nunca devem ser inventados.
- O projeto usa Supabase para autenticação e dados do usuário; o navegador recebe apenas a chave pública `anon`.

## Stack

React 19, TypeScript strict, Vite, HashRouter, Supabase Auth/PostgreSQL/RLS, Papa Parse, Web Workers, `zstddec` e Vitest.

## Desenvolvimento local

```bash
cd fm-datatracker
npm install
copy .env.example .env.local
npm run dev
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em `.env.local`. Nunca exponha uma chave `service_role` no frontend e nunca versione `.env.local`.

## Verificação obrigatória

```bash
npm run typecheck
npm test
npm run build
```

O build gera `dist/`. O workflow de GitHub Pages publica esse resultado em `/fm-datatracker/`; o `HashRouter` evita falhas ao atualizar rotas estáticas.

## Documentação

- [Handoff técnico e regras de mudança](docs/HANDOFF.md)
- [Arquitetura](docs/architecture.md)
- [Importação CSV e `.fm`](docs/import-format.md)
- [Banco e migrations](docs/database.md)
- [Guia de desenvolvimento e release](docs/development.md)
- [Base de referência](docs/reference-database.md)
- [Pontuação e pesos](docs/scoring.md)
- [Oracle/runtime FM26: contrato seguro](docs/ORACLE-HANDOFF.md)

## Supabase e migrations

Execute as migrations em ordem de nome no SQL Editor:

1. `supabase/migrations/202608150001_initial_schema.sql`
2. `supabase/migrations/202608150002_import_rpc.sql`
3. `supabase/migrations/202608230001_fm_reader_samples.sql`
4. `supabase/migrations/202608230003_oracle_roster_import.sql`

O terceiro arquivo cria um mecanismo opcional e privado para o usuário autorizar o envio de amostras que falharam na validação CSV × `.fm`.

## Limites de segurança

Não comite saves, DLLs proprietárias do FM, dumps de interop, exports privados ou credenciais. O leitor de `.fm` é estritamente de leitura: não deve modificar um save ou o estado persistente do jogo.
