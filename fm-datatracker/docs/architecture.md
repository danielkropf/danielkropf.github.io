# Arquitetura do FM DataTracker

## Princípios

- O app permanece isolado do site estático e usa `base: /fm-datatracker/`.
- O `HashRouter` mantém todas as rotas compatíveis com GitHub Pages.
- A chave pública do Supabase é o único segredo disponível no cliente; o isolamento dos dados depende de RLS.
- Regras de negócio puras ficam fora dos componentes React e possuem testes unitários.
- Páginas coordenam casos de uso. Componentes de aplicação cuidam somente da estrutura global.
- Imports nunca alteram snapshots anteriores: o histórico é append-only.

## Camadas e dependências

```text
main.tsx
└── app/                    composição global
    ├── AppShell            navegação e layout
    ├── AppRoutes           mapa de rotas e proteção por save
    ├── SettingsModal       composição das configurações
    └── styles/index.css    ordem única dos estilos globais

pages/                      telas e coordenação de casos de uso
features/                   estado e comportamento de cada domínio
components/                 componentes compartilhados sem domínio específico
lib/                        regras puras, parsers, cálculos e infraestrutura
types/                      contratos persistidos e compartilhados
```

Fluxo permitido de dependências:

```text
app → pages/features/components → lib/types
pages → features/components/lib/types
features → components/lib/types
lib → types
```

`lib` não deve importar páginas, componentes ou estado React. Uma página pode temporariamente conter componentes privados quando eles só existem naquela tela; ao serem reutilizados, devem migrar para a feature correspondente.

## Domínios existentes

- `features/auth`: sessão e entrada do usuário.
- `features/saves`: save ativo e persistência da escolha local.
- `features/imports`: fluxo interativo de importação.
- `features/appearance`: leitura, escrita e aplicação das preferências visuais.
- `lib/importer`: CSV, normalização, datas, inferência e preparação de linhas.
- `lib/positions`: interpretação da notação posicional completa do FM.
- `lib/tactics`: nós do campo, fases e funções disponíveis.
- `lib/scoring`: normalização e composição matemática das notas.
- `lib/reference`: percentis e comparação com a base de referência.
- `lib/roleWeights`: matriz estática de pesos por função.

## Persistência e fluxo de dados

```text
arquivo local
→ parser e normalização
→ preview obrigatório
→ hash e duplicidade
→ identidade do jogador
→ RPC transacional de importação
→ snapshots imutáveis
→ scoring derivado
→ páginas de análise e planejamento
```

Configurações específicas do save, como táticas, pesos e planejamento, são persistidas no modelo do save. Preferências puramente visuais são locais ao navegador.

## Estilos

`app/styles/index.css` é o único ponto importado pelo JavaScript e documenta a ordem de cascata existente. A fragmentação histórica dos arquivos foi preservada nesta reorganização para não alterar a aparência. Novos estilos devem ser agrupados por feature; estilos globais de controles ficam no final da cascata.

## Dívida técnica controlada

- `PlanningPage`, `TacticsPage` e `SquadPage` ainda são coordenadores grandes. A extração futura deve ocorrer por componente ou hook, acompanhada de testes de caracterização.
- `roleWeights.ts` é um dataset estático grande; deve continuar isolado de componentes.
- O bundle principal ultrapassa 500 kB. Lazy loading por rota é uma otimização futura, não aplicada agora para preservar rigorosamente o comportamento de carregamento.

## Critérios para mudanças estruturais

Toda reorganização deve manter:

1. URLs e rotas públicas.
2. Formato persistido no Supabase e no `localStorage`.
3. Ordem da cascata CSS.
4. Resultados dos cálculos e parsers.
5. Testes, TypeScript e build de produção aprovados.
