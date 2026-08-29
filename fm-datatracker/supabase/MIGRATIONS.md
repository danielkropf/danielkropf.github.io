# Supabase migration/bootstrap notes

## Production state reconciled through Phase 0 — 2026-08-29

Production project: `zuyvivzvicjuhphchhql`.

The historical chain through `20260828183639 move_pg_net_out_of_public` is already reconciled and must not be replayed.

Phase 0 is versioned in GitHub and applied in production:

- `20260829000100 core_longitudinal_base`
- `20260829000101 core_longitudinal_history`
- `20260829000102 core_longitudinal_security`
- `20260829000200 core_longitudinal_backfill`
- `20260829000300 core_longitudinal_save_structure`
- `20260829000400 core_longitudinal_imports`

Production reports `schema_version=202608290004` with `longitudinal_core`, `longitudinal_backfill`, `longitudinal_save_structure` and `longitudinal_imports` enabled. Phase 0 verification returned zero longitudinal integrity violations and RLS is enabled on all eight longitudinal tables.

## Phase 1A — Analyzer statistical context

Next ordered migration:

- `20260829000500 analyzer_stats_context`
  - promotes only explicit `season`, `competition` and `team` values already present in `player_stats.normalized_stats` into their structured columns;
  - preserves normalized sample-size fields (`minutes`, `appearances`, `starts`, `sub_appearances`) when they are explicit numeric values;
  - adds read indexes for player/date and statistical context;
  - exposes capability `analyzer_stats_context` and advances the schema marker to `202608290005`;
  - does **not** infer season or competition from filename/date;
  - does **not** create, calculate or backfill a PerformanceScore.

The application code accompanying Phase 1A requires schema `202608290005` plus all Phase 0 capabilities and `analyzer_stats_context=true`.

Do not deploy the Phase 1A application changes against a database that has not received `20260829000500_analyzer_stats_context.sql`.

## Validation contract

After applying Phase 1A:

1. Run `supabase/ops/verify_phase0_longitudinal.sql`.
2. Run `supabase/ops/verify_phase1_analyzer.sql`.
3. Confirm `public.datatracker_schema_info().schema_version = 202608290005`.
4. Confirm `analyzer_stats_context=true`.
5. Import a stats fixture containing `ID_FM`, `Club`, `Appearances=5 (24)`, `Starts=5` and `Minutes` and verify structured persistence as total appearances 29, starts 5 and sub appearances 24.
6. Confirm no `player_scores.score_type='performance'` rows are produced by Phase 1A.
7. Run Supabase Security and Performance Advisors.
8. Run application typecheck, tests and build before release.

## Fresh environment bootstrap

1. Apply every canonical migration in `supabase/migrations/` in filename order.
2. Deploy `supabase/functions/cleanup-fm-reader-samples/index.ts` with JWT verification enabled.
3. Configure the diagnostic-retention Vault secrets and `supabase/ops/configure_diagnostic_retention.sql`.
4. Require `public.datatracker_schema_info().schema_version >= 202608290005`.
5. Require the four longitudinal capabilities plus `analyzer_stats_context` to be `true`.
6. Run both Phase 0 and Phase 1A verification SQL files.
7. Run Supabase Security and Performance Advisors.
8. Run application typecheck, tests and build before release.

## Existing environment upgrade

Do not use blanket reset/replay. Apply only migrations not yet present in the environment ledger. If the schema already contains a verified historical effect but the ledger is damaged, repair that one ledger entry only after object verification.

Never mark a migration applied merely because a later schema marker exists.
