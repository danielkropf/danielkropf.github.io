-- FM DataTracker — remove redundant legacy foreign keys after composite integrity hardening.
-- The composite FKs below fully subsume the legacy single-column relationships
-- while also enforcing owner/save/player/import consistency. Keeping both makes
-- PostgREST embeds ambiguous (PGRST201).

alter table public.contracts
  drop constraint if exists contracts_player_id_fkey;

alter table public.decisions
  drop constraint if exists decisions_player_id_fkey,
  drop constraint if exists decisions_save_id_fkey;

alter table public.fm_reader_samples
  drop constraint if exists fm_reader_samples_save_id_fkey;

alter table public.imports
  drop constraint if exists imports_save_id_fkey;

alter table public.player_projections
  drop constraint if exists player_projections_snapshot_id_fkey,
  drop constraint if exists player_projections_player_id_fkey;

alter table public.player_snapshots
  drop constraint if exists player_snapshots_import_id_fkey,
  drop constraint if exists player_snapshots_player_id_fkey;

alter table public.player_stats
  drop constraint if exists player_stats_import_id_fkey,
  drop constraint if exists player_stats_player_id_fkey;

alter table public.players
  drop constraint if exists players_save_id_fkey;

alter table public.role_models
  drop constraint if exists role_models_save_id_fkey;

alter table public.scoring_models
  drop constraint if exists scoring_models_save_id_fkey;

notify pgrst, 'reload schema';
