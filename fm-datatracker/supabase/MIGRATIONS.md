# Supabase migration/bootstrap notes

## Production state reconciled through Phase 0A — 2026-08-29

Production project: `zuyvivzvicjuhphchhql`.

The historical chain through `20260828183639 move_pg_net_out_of_public` is already reconciled and must not be replayed.

Phase 0A is now also versioned in GitHub and applied in production:

- `20260829000100 core_longitudinal_base`
- `20260829000101 core_longitudinal_history`
- `20260829000102 core_longitudinal_security`

The Supabase management API initially recorded current-time ledger IDs while applying those files. The ledger was reconciled immediately to the canonical filenames above after object verification. Production currently reports `schema_version=202608290001` and `longitudinal_core=true`.

## Phase 0 continuation

Apply the remaining Phase 0 migrations strictly in filename order:

- `20260829000200 core_longitudinal_backfill`
  - covering indexes for the composite Phase 0A FKs;
  - idempotent primary Club/SaveClub backfill;
  - exact-label Seasons without invented dates;
  - conservative historical PlayerMembership checkpoints;
  - IntakeClass backfill only when every intake snapshot resolves to one Club.
- `20260829000300 core_longitudinal_save_structure`
  - `create_save_with_structure(...)` creates Save + primary Club + SaveClub in one transaction while keeping legacy `saves.club_name`.
- `20260829000400 core_longitudinal_imports`
  - import-completion trigger persists trusted Club/Membership/Season/IntakeClass facts;
  - import deletion removes import-owned longitudinal evidence;
  - import parser profile advances to `integrity-v2-longitudinal`.

Application code accompanying these migrations requires schema `202608290004` plus explicit capabilities:
`longitudinal_core`, `longitudinal_backfill`, `longitudinal_save_structure`, and `longitudinal_imports`.

Do not deploy the application changes against a database that has not received the ordered migrations above.

## Validation already performed before publication

- Phase 0B data backfill executed twice inside one rolled-back production transaction.
- Result on the current legacy smoke save: 2 Clubs, 1 active primary SaveClub, 194 membership checkpoints, no duplicate rows.
- Primary legacy `FLU` remained `FLU`; confirmed Bayern contract evidence became a separate observed Club.
- The hash of all 194 legacy `player_snapshots` was identical before and after the backfill dry-run.
- Phase 0D transactional save creation was smoke-tested under an authenticated JWT context and produced synchronized Save + Club + SaveClub rows.
- Phase 0E was exercised through the existing `import_fm_export` and `delete_fm_import` RPCs with normal, loan, intake and stats fixtures inside rollback.
- Longitudinal cleanup removed the deleted intake evidence while preserving unrelated memberships.

## Fresh environment bootstrap

1. Apply every canonical migration in `supabase/migrations/` in filename order.
2. Deploy `supabase/functions/cleanup-fm-reader-samples/index.ts` with JWT verification enabled.
3. Configure the diagnostic-retention Vault secrets and `supabase/ops/configure_diagnostic_retention.sql`.
4. Require `public.datatracker_schema_info().schema_version >= 202608290004`.
5. Require the four longitudinal capabilities listed above to be `true`.
6. Run `supabase/ops/verify_phase0_longitudinal.sql`.
7. Run Supabase Security and Performance Advisors.
8. Run application typecheck, tests and build before release.

## Existing environment upgrade

Do not use blanket reset/replay. Apply only migrations not yet present in the environment ledger. If the schema already contains a verified historical effect but the ledger is damaged, repair that one ledger entry only after object verification.

Never mark a migration applied merely because a later schema marker exists.
