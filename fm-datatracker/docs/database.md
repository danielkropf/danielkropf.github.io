# Banco de dados e migrations

O FM DataTracker usa Supabase/Postgres. O navegador autentica com a chave `anon`; acesso privilegiado, `service_role`, exports privados, DLLs e saves nunca pertencem ao repositório nem ao bundle web.

## Migrations existentes

Execute migrations apenas em ordem crescente de nome:

1. `202608150001_initial_schema.sql` — perfil, saves, imports, jogadores, snapshots, atributos, estatísticas, modelos, decisões e RLS inicial.
2. `202608150002_import_rpc.sql` — contratos e RPC transacional `import_fm_export`.
3. `202608230001_fm_reader_samples.sql` — bucket privado `fm-reader-samples` e tabela de consentimento para amostras do leitor `.fm`.
4. `202608230003_oracle_roster_import.sql` — revisão local/legada criada durante a investigação do Oracle.
5. `202608250001_import_integrity.sql` — contrato público atual: identidade segura, atualização do elenco ativo, persistência das estatísticas `.fm`, campos normalizados e patch atômico do `Model Lab`.

Uma migration aplicada é histórico imutável. Para corrigir schema, índice, RLS ou RPC, crie uma migration nova e compatível; não edite uma já executada em outro ambiente.

## Modelo lógico

```text
auth.users
  └── profiles
       └── saves
            ├── imports
            ├── players
            │    └── player_snapshots
            │         └── player_attributes
            ├── player_stats
            ├── contracts
            ├── role_models / scoring_models / player_scores
            └── decisions / import_column_mappings
```

- `saves` é a fronteira principal de isolamento.
- `players` representa a identidade histórica dentro de um save; `fm_player_id` / `UniqueId` é a chave estável. Nome só pode ser fallback sem ambiguidade.
- `imports` registra cada fotografia confirmada. Há proteção contra repetição por `unique(save_id, file_hash)`.
- `player_snapshots` é histórico: a importação cria uma nova fotografia, não sobrescreve a anterior. `unique(player_id, import_id)` impede duplicação no mesmo import.
- Dados normalizados seguem o contrato consumido pelas telas; o JSON bruto é evidência/auditoria. Ambos devem continuar serializáveis.

`imports.file_type` descreve o formato funcional legado (`squad`, `stats`, `intake` ou `unknown`). A interface de versões recentes também mostra a **fonte** do upload (`CSV`, `.fm` ou `CSV + .fm`), derivada dos metadados/raw data do import. Não confunda as duas classificações ao alterar a tela de histórico.

## Persistência de importação

A aplicação chama `import_fm_export` para persistir a prévia já normalizada. A RPC:

- valida a propriedade do save;
- bloqueia hash duplicado calculado pelo conteúdo dos arquivos;
- resolve jogador por ID exato; sem ID, usa nome + nascimento e só recorre a nome isolado quando a correspondência é única;
- promove com segurança um registro histórico sem ID para `fm:<id>` quando nome + nascimento identificam um único jogador;
- grava snapshots e atributos para `squad`/`intake`;
- grava estatísticas do CSV `stats` e também preserva em `player_stats` as estatísticas normalizadas já resolvidas pelo leitor `.fm`;
- em um `squad` que é a fotografia mais recente, marca como inativos os jogadores que desapareceram; imports históricos não alteram o elenco atual;
- executa o conjunto de gravações em transação.

Depois de confirmar, invalidar o cache do save no cliente (`invalidateSaveData`) é obrigatório. Sem isso, Elenco, Planejamento e Perfil podem continuar exibindo dados antigos até o reload.

## Configuração compartilhada do Model Lab

Táticas, Planejamento e Pontuação usam o mesmo registro de `scoring_models`, mas não podem salvar uma cópia inteira desatualizada desse JSON. A RPC `patch_scoring_model_config` serializa a gravação e faz merge apenas das chaves enviadas pela tela: Táticas atualiza `tactics/selected_tactic_id`, Planejamento atualiza `planning` e Pontuação atualiza `general_weights/role_weight_overrides`.

Se ocorrer `Falha na persistência`, preservar o texto detalhado retornado pela RPC/cliente antes de tentar um workaround. Não transformar uma falha transacional em import parcialmente concluído.

## RLS e segurança

RLS está habilitado em todas as tabelas de produto. Uma policy deve conseguir comprovar ownership pelo `owner_id` da própria linha ou pela cadeia que chega em `saves.owner_id`. Ao criar qualquer tabela nova:

1. definir a relação com o save/dono;
2. habilitar RLS;
3. adicionar policies de leitura e escrita compatíveis;
4. testar como usuário autenticado com a chave anon;
5. só então expor o recurso no front-end.

O bucket de amostras `.fm` é privado e exige consentimento explícito. A opção serve para diagnóstico do leitor beta; não pode virar upload automático nem arquivo público.

## Dados do leitor `.fm`

Quando há `.fm`, o import mantém dados complementares em `raw_data`/`normalized_data`, inclusive candidatos de CA/PA, atributos ocultos e habilidades por posição. CA/PA não têm coluna de scoring e continuam apenas candidatos até que o mapeamento seja validado contra âncoras. Nunca migrar esses campos para lógica de nota sem uma decisão explícita e validação de runtime.

## Procedimento seguro para mudanças

1. Ler `docs/HANDOFF.md` e o código/RPC relacionado.
2. Criar nova migration, se houver mudança de banco.
3. Aplicar primeiro em ambiente de teste.
4. Testar CSV, `.fm` e CSV + `.fm`; conferir duplicate hash, histórico e exclusão.
5. Rodar `npm run typecheck`, `npm test` e `npm run build`.
6. Documentar a migration e a regra de compatibilidade no handoff/changelog da versão.
