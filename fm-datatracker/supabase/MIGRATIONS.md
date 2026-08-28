# Supabase migration/bootstrap notes

## Production state already reconciled on 2026-08-28

The production project `zuyvivzvicjuhphchhql` already has the historical versions marked as applied, after schema verification:

- `202608150001 initial_schema`
- `202608150002 import_rpc`
- `202608230001 fm_reader_samples`
- `202608250001 import_integrity`
- `202608260001 model_config_compatibility`
- `202608260002 model_config_integrity`
- `202608260003 player_projections`

Do **not** execute those historical SQL files again in production.

The production ledger also already contains:

- `20260827234211 database_integrity_hardening`
- `20260827234421 database_integrity_fk_indexes`
- `20260828060819 stabilization_capabilities_and_diagnostics`
- `20260828170656 remove_redundant_fk_relationships`
- `20260828170834 advance_schema_marker_after_fk_cleanup`
- `20260828183337 stabilization_indexes_and_retention_infra`
- `20260828183639 move_pg_net_out_of_public`

Therefore, once the two new migration files from this package are committed with those exact filenames, a normal future migration run should see them as already applied in production.

## Fresh environment bootstrap

1. Apply the canonical migration files in filename order from `supabase/migrations/`.
2. Deploy `supabase/functions/cleanup-fm-reader-samples/index.ts` with JWT verification enabled.
3. Create two Vault secrets for that environment:
   - `fm_datatracker_project_url`
   - `fm_datatracker_anon_jwt`
4. Run `supabase/ops/configure_diagnostic_retention.sql`.
5. Invoke the Edge Function once and require HTTP 200.
6. Check `public.datatracker_schema_info()` and require `diagnostics_server_retention=true`.
7. Run Supabase Security and Performance Advisors.

## Existing environment upgrade

Do not use a blanket reset or replay. If an older environment has the same historical schema but a damaged ledger, verify the objects first and use `supabase migration repair --status applied <version>` (one verified version at a time) or the equivalent ledger repair supported by your administration tooling.

Never mark a historical migration applied merely because a later schema marker exists.
