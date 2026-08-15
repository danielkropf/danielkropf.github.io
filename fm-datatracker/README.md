# FM DataTracker

Banco Mestre pessoal para saves do Football Manager. Cada CSV importado representa um snapshot imutável; jogadores, atributos, estatísticas e notas permanecem históricos e isolados por save.

## Stack

React 19, TypeScript strict, Vite, HashRouter, Supabase Auth/PostgreSQL/RLS, Papa Parse e Vitest. O HashRouter evita erros ao atualizar rotas no GitHub Pages.

## Desenvolvimento local

```bash
npm install
copy .env.example .env.local
npm run dev
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com valores públicos do projeto Supabase. Nunca use `service_role` no navegador.

## Supabase

1. Crie um projeto.
2. Execute `supabase/migrations/202608150001_initial_schema.sql` no SQL Editor.
3. Em Authentication > URL Configuration, adicione as URLs local e publicada.
4. Configure `.env.local`.

## Deploy no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` preserva as páginas estáticas existentes, compila este aplicativo e publica o conteúdo de `dist` em `/fm-datatracker/`.

No GitHub, abra **Settings → Pages → Build and deployment** e selecione **GitHub Actions** em **Source**. Cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em **Settings → Secrets and variables → Actions**, como Repository secrets ou Repository variables. O workflow interrompe o deploy com uma mensagem clara se algum valor estiver ausente.

Não configure o Pages para publicar a pasta fonte `fm-datatracker`: seu `index.html` é destinado ao Vite e referencia TypeScript ainda não compilado.

## Qualidade

`npm run typecheck`, `npm test` e `npm run build`. O build gera `dist/` e o workflow publica esse resultado automaticamente.

## Estado desta fundação

Inclui login por e-mail e senha, contexto de saves, dashboard navegável, preview de CSV, detecção Squad/Stats/Intake, datas do profile Numancia, preservação de CA/PA apenas em raw data, fórmulas explicáveis e schema com RLS. A confirmação/persistência do import e as telas completas de elenco são a próxima etapa.
