# Supabase migration/bootstrap notes

## Estado canônico verificado — 2026-09-04

Projeto de produção: `zuyvivzvicjuhphchhql`.

O ledger remoto foi revalidado diretamente antes desta entrega e está reconciliado desde a migration inicial até:

- `20260904030511 emc01b_fk_index_stabilization`

Não reaplique migrations que já constem no ledger. Não edite migrations históricas aplicadas.

O banco reporta atualmente:

- `schema_version = 202609030001`
- `app_version = 0.29.5`
- `factual_membership_emc01b = true`
- retenção server-side de diagnósticos `.fm` ativa
- migrations históricas de Phase 0, Analyzer, Multiclub e E-MC-01B registradas no ledger.

O `schema_version` permanece `202609030001` depois da migration de índices 0.29.5 porque ela é exclusivamente de performance/reprodutibilidade e não introduz capability ou contrato de dados novo.

## Cadeia atual relevante

A ordem canônica inclui, entre outras, estas migrations já aplicadas em produção:

- `202608150001 initial_schema`
- `202608150002 import_rpc`
- `202608230001 fm_reader_samples`
- `202608250001 import_integrity`
- `202608260001 model_config_compatibility`
- `202608260002 model_config_integrity`
- `202608260003 player_projections`
- `20260827234211 database_integrity_hardening`
- `20260827234421 database_integrity_fk_indexes`
- `20260828060819 stabilization_capabilities_and_diagnostics`
- `20260828170656 remove_redundant_fk_relationships`
- `20260828170834 advance_schema_marker_after_fk_cleanup`
- `20260828183337 stabilization_indexes_and_retention_infra`
- `20260828183639 move_pg_net_out_of_public`
- `20260829000100 core_longitudinal_base`
- `20260829000101 core_longitudinal_history`
- `20260829000102 core_longitudinal_security`
- `20260829000200 core_longitudinal_backfill`
- `20260829000300 core_longitudinal_save_structure`
- `20260829000400 core_longitudinal_imports`
- `20260829000500 analyzer_stats_context`
- `20260830000100 multiclub_tracking_management`
- `20260831043351 extend_import_fm_export_timeout`
- `20260903000100 emc01b_factual_membership`
- `20260903191855 emc01b_phase0e_nested_reconciliation`
- `20260904030511 emc01b_fk_index_stabilization`

## Diagnósticos `.fm`

A infraestrutura de retenção server-side está ativa em produção:

- `pg_cron` e `pg_net` instalados;
- job `fm-reader-samples-retention` agendado diariamente;
- Edge Function `cleanup-fm-reader-samples` permanece a unidade de cleanup;
- índice `(save_id, owner_id)` de `fm_reader_samples` existe.

O cleanup client-side continua sendo defesa complementar; a retenção não depende exclusivamente do navegador.

## E-MC-01B

`20260903000100_emc01b_factual_membership.sql` introduz o registry Structural Team ID → Club UUID, evidência auditável e persistência factual fail-closed.

`20260903191855_emc01b_phase0e_nested_reconciliation.sql` corrige a reconciliação de evidência Phase0E quando o sinal confiável está em `provenance.fm_identity.resolution_method`, preservando histórico e removendo Structural Team ID residual de `clubs.fm_club_id` somente nos casos comprovados.

`20260904030511_emc01b_fk_index_stabilization.sql` adiciona índices de cobertura para todas as FKs compostas novas das tabelas `club_structural_team_links` e `club_structural_team_link_evidence`. O Performance Advisor deixou de reportar `unindexed_foreign_keys` para essas tabelas após a aplicação. Índices recém-criados podem aparecer temporariamente como `unused_index`; isso não autoriza removê-los automaticamente.

## Bootstrap de ambiente novo

1. Aplique todos os arquivos de `supabase/migrations/` em ordem de filename.
2. Faça deploy de `supabase/functions/cleanup-fm-reader-samples/index.ts` com JWT verification habilitada.
3. Configure os secrets de retenção e execute `supabase/ops/configure_diagnostic_retention.sql` conforme o procedimento do projeto.
4. Confirme `public.datatracker_schema_info()` e todas as capabilities exigidas pela versão do aplicativo.
5. Execute os scripts de verificação em `supabase/ops/` aplicáveis às fases instaladas.
6. Rode Security e Performance Advisors.
7. Rode `npm ci`, version sync, typecheck, testes e build antes de qualquer publicação.

## Upgrade de ambiente existente

Não use reset/replay global em produção. Compare o diretório `supabase/migrations/` com `supabase_migrations.schema_migrations` e aplique somente versões ausentes.

Se um efeito histórico estiver comprovadamente presente no schema mas o ledger estiver danificado, repare somente aquela entrada após verificar os objetos correspondentes. Nunca marque uma migration como aplicada apenas porque existe um marker de schema posterior.

## Pendências de configuração fora do source tree

A proteção de branch/required checks do GitHub `master` não pode ser substituída por um arquivo no overlay. O workflow de Pages já executa install, version sync, typecheck, testes e build antes do deploy, mas a proteção do branch precisa ser mantida como configuração do repositório.

O Security Advisor ainda reporta `Leaked Password Protection Disabled`. Essa configuração pertence ao Supabase Auth e não deve ser simulada por migration SQL de banco.
