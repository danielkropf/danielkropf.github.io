# Arquitetura

## Visão geral

```text
main.tsx
└── app/
    ├── AppShell              layout, menu, preload do save e Configurações
    ├── AppRoutes             rotas e proteção por save ativo
    ├── SettingsModal         abas administrativas
    └── styles/index.css      ordem única de importação dos estilos

pages/                        telas e composição de casos de uso
features/                     estado e interface de um domínio
components/                   componentes reutilizáveis de interface
lib/                          regras puras, parsers, cache e infraestrutura
types/                        contratos compartilhados e persistidos
supabase/migrations/          esquema e RPCs executados no Supabase
```

Dependências permitidas:

```text
app → pages/features/components → lib/types
pages → features/components/lib/types
features → components/lib/types
lib → types
```

`lib` não importa React, páginas ou estado de tela. Ao extrair código de páginas grandes, preserve comportamento com testes de caracterização antes de mover a lógica.

## Rotas públicas

| Rota | Tela | Observação |
| --- | --- | --- |
| `#/` | Visão Geral | Pode ser acessada sem save; inicia ações de importação. |
| `#/imports` | Novo snapshot | Exige save ativo. |
| `#/squad` | Elenco | Tabela configurável, perfis e notas. |
| `#/players/:id` | Perfil do jogador | Não aparece no menu; mantém retorno contextual. |
| `#/planning` | Planejamento | Elencos, matriz e grupos de mercado. |
| `#/tactics` | Táticas | IP/OOP, funções e seleção de jogadores. |
| `#/scoring`, `#/models` | Pontuação & Funções | A mesma tela por compatibilidade. |

O projeto usa `HashRouter` e `base: /fm-datatracker/`. Não troque por router de histórico sem reconfigurar GitHub Pages.

## Estado e cache

- `features/saves/SaveContext.tsx` consulta saves não arquivados e guarda o save ativo em `localStorage` sob `fm-datatracker:active-save`.
- `lib/dataCache.ts` memoriza a promessa da consulta rica de jogadores por `saveId`; `preloadSave` é disparado pelo `AppShell` em segundo plano. Use `invalidateSaveData(saveId)` após uma mutação que afete jogadores/snapshots.
- Preferências de aparência e escolhas estritamente visuais são locais ao navegador. Dados de save, táticas, planejamento, imports e jogadores são persistidos no Supabase.

## Domínios principais

- `features/auth`: autenticação e proteção de sessão.
- `features/saves`: lista, criação e seleção persistente de saves.
- `features/imports`: painel de CSV/`.fm`, validação e histórico.
- `features/appearance`: aplicação de preferências visuais.
- `lib/importer`: CSV, normalização, detecção de colunas, hash e data sugerida.
- `lib/fm26-offline-*`: leitor local beta de `.fm`, normalização e worker.
- `lib/fm26-team-resolver`: camada separada e fail-closed que resolve Team IDs estruturais para nomes de equipes a partir do próprio `game_db.dat`; ela não altera o parser legado e não classifica clube proprietário/empréstimo.
- `lib/fm-comparison`: normalização semântica de datas, pés e posições para CSV × `.fm`.
- `lib/fm26-reader`: normalizador para o resultado JSON do Oracle de runtime; é um caminho separado do leitor offline.
- `lib/positions`, `lib/tactics`: notação posicional, funções e ligações IP/OOP.
- `lib/scoring`, `lib/roleWeights`, `lib/reference`: notas, pesos por função e percentis de referência.

## Persistência

```text
arquivo local
  → parser/worker no navegador
  → preview e validação explícita
  → hash do(s) arquivo(s)
  → RPC transacional import_fm_export
  → imports + players + snapshots + atributos
  → cache invalidado e telas derivadas recalculadas
```

Snapshots são append-only. A importação nunca deve sobrescrever uma fotografia anterior. A identidade prioriza `fm_player_id`/`UniqueId`; nome é apenas fallback quando inequivocamente único no save.

## Estilos e UX

`src/app/styles/index.css` é o único arquivo CSS importado pelo JavaScript e define a ordem de cascata. Adicione estilos globais no fim dessa cascata; mantenha estilos de tela/feature no seu arquivo específico. Controles de dropdown, tooltip, score badge, barras de rolagem e estados de interação devem reutilizar os padrões existentes, não criar uma aparência paralela.

## Dívida técnica consciente

`PlanningPage`, `TacticsPage`, `SquadPage` e `ImportPanel` têm coordenação considerável. Extrações futuras devem ser incrementais, mantendo rotas, dados persistidos, atalhos de interação, CSS e testes.
