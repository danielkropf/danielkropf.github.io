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

## Phase 3A — Tracked Club Workspace

Prepared next ordered migration (not yet applied in production):

- `20260830000100 multiclub_tracking_management`
  - reuses the existing `clubs` and `save_clubs` tables; no new table is introduced;
  - adds `track_save_club(uuid,uuid)` to track or reactivate an existing Club from the same owned save;
  - adds `create_tracked_club(uuid,text,text)` to atomically create an explicit manual Club and its `SaveClub` link;
  - adds `set_tracked_club_active(uuid,uuid,boolean)` for soft activation/deactivation;
  - refuses to deactivate the active primary Club;
  - never deletes Club history and never rewrites `player_memberships`;
  - never merges Clubs by name and never invents `first_tracked_date` / `last_tracked_date`;
  - uses `SECURITY INVOKER`, existing RLS, explicit `auth.uid()` ownership checks and explicit EXECUTE grants;
  - exposes capability `multiclub_tracking_management` and advances the schema marker to `202608300001`.

Preparation verification on 2026-08-30 used a transaction-only dry-run against production schema `202608290005`. The test created a manual tracked Club, deactivated it, reactivated the same `SaveClub`, verified primary deactivation fails closed, then rolled the transaction back. After rollback production still reported schema `202608290005` and the temporary RPCs were absent. This is evidence of compatibility, **not** an applied migration.

Release ordering for Phase 3A:

1. v0.27.7 (`.fm → Táticas`) is published and its post-deploy E2E smoke is PASS.
2. Publish the re-anchored v0.27.8 Phase 3A application overlay and require GitHub Actions/deploy to pass before changing production schema.
3. Apply `20260830000100_multiclub_tracking_management.sql` only after the v0.27.8 code SHA is verified green. Until then, missing 3A RPCs must remain a localized workspace error and must not break single-club behavior.
4. Confirm `datatracker_schema_info().schema_version = 202608300001` and `multiclub_tracking_management=true`, then run Security and Performance Advisors.
5. Run a real Saves-page smoke: track a known Club, create a manual Club, deactivate/reactivate the same tracked Club, reload, and confirm the primary Club cannot be deactivated.

## Import RPC timeout hotfix

Applied in production and now mirrored canonically:

- `20260831043351 extend_import_fm_export_timeout`
  - sets `statement_timeout='60s'` only on `public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)`;
  - preserves `SECURITY INVOKER`, grants and the global timeout of the `authenticated` role;
  - prevents the known J1-sized atomic import from being cancelled by the previous 8-second role timeout;
  - is a functional timeout exception, not a substitute for later import-performance optimization.

Fresh environments must apply this migration after `20260830000100`. Existing production already has the matching ledger entry and must not replay it.

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

After applying Phase 3A additionally verify:

1. Primary SaveClub remains active and cannot be deactivated by the RPC.
2. Creating a manual Club creates exactly one new `Club` and one active `SaveClub(tracking_role='tracked')` in the same save/owner.
3. Deactivate/reactivate preserves the same `Club` and `SaveClub` IDs.
4. An existing Club from another save/owner cannot be tracked.
5. `player_memberships`, `intake_classes` and `save_events` are unchanged by tracking-management operations.
6. Security and Performance Advisors introduce no new blocking findings.

## Fresh environment bootstrap

1. Apply every canonical migration in `supabase/migrations/` in filename order.
2. Deploy `supabase/functions/cleanup-fm-reader-samples/index.ts` with JWT verification enabled.
3. Configure the diagnostic-retention Vault secrets and `supabase/ops/configure_diagnostic_retention.sql`.
4. Require `public.datatracker_schema_info().schema_version >= 202608290005` (or `>= 202608300001` once Phase 3A is part of the deployed app baseline).
5. Require the four longitudinal capabilities plus `analyzer_stats_context` to be `true`; Phase 3A additionally requires `multiclub_tracking_management=true`.
6. Run both Phase 0 and Phase 1A verification SQL files, plus the Phase 3A checks above when applicable.
7. Run Supabase Security and Performance Advisors.
8. Run application typecheck, tests and build before release.

## Existing environment upgrade

Do not use blanket reset/replay. Apply only migrations not yet present in the environment ledger. If the schema already contains a verified historical effect but the ledger is damaged, repair that one ledger entry only after object verification.

Never mark a migration applied merely because a later schema marker exists.
