# Supabase migration/bootstrap notes

## Production state reconciled through 2026-08-28

The production project `zuyvivzvicjuhphchhql` already has the historical versions marked as applied, after schema verification:

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

Do **not** execute those historical SQL files again in production.

## Phase 0A — Core Longitudinal Domain

Approved domain contract: `FM DataTracker — Core Longitudinal Domain`.

The next ordered migrations are:

- `20260829000100 core_longitudinal_base`
- `20260829000101 core_longitudinal_history`
- `20260829000102 core_longitudinal_security`

They are intentionally additive. They create the normalized Club/SaveClub/Season/PlayerMembership/IntakeClass/SaveEvent foundation, preserve every legacy column/table, enable authenticated-only RLS/Data API access, and advance `datatracker_schema_info()` to schema marker `202608290001` with capability `longitudinal_core=true` only after the complete domain exists.

At package creation time these three Phase 0A migrations were validated as one transaction against the production Postgres 17 schema and rolled back successfully. They were **not applied to production**, because the GitHub integration could not version the files (`403 Resource not accessible by integration`). Preserve repository/database parity: commit these files first, then apply the same ordered migrations to production.

## Fresh environment bootstrap

1. Apply the canonical migration files in filename order from `supabase/migrations/`.
2. Deploy `supabase/functions/cleanup-fm-reader-samples/index.ts` with JWT verification enabled.
3. Create two Vault secrets for that environment:
   - `fm_datatracker_project_url`
   - `fm_datatracker_anon_jwt`
4. Run `supabase/ops/configure_diagnostic_retention.sql`.
5. Invoke the Edge Function once and require HTTP 200.
6. Check `public.datatracker_schema_info()` and require `diagnostics_server_retention=true`.
7. After Phase 0A is applied, also require `longitudinal_core=true`.
8. Run Supabase Security and Performance Advisors.

## Existing environment upgrade

Do not use a blanket reset or replay. If an older environment has the same historical schema but a damaged ledger, verify the objects first and use `supabase migration repair --status applied <version>` (one verified version at a time) or the equivalent ledger repair supported by your administration tooling.

Never mark a historical migration applied merely because a later schema marker exists.
