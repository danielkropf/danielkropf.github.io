-- Cover composite foreign keys introduced by database_integrity_hardening.
create index if not exists contracts_player_owner_idx on public.contracts(player_id, owner_id);
create index if not exists decisions_player_save_idx on public.decisions(player_id, save_id);
create index if not exists decisions_save_owner_idx on public.decisions(save_id, owner_id);
create index if not exists imports_save_owner_idx on public.imports(save_id, owner_id);
create index if not exists player_projections_player_save_idx on public.player_projections(player_id, save_id);
create index if not exists player_projections_snapshot_player_save_idx on public.player_projections(snapshot_id, player_id, save_id);
create index if not exists player_snapshots_import_save_idx on public.player_snapshots(import_id, save_id);
create index if not exists player_snapshots_player_save_idx on public.player_snapshots(player_id, save_id);
create index if not exists player_stats_import_save_idx on public.player_stats(import_id, save_id);
create index if not exists player_stats_player_save_idx on public.player_stats(player_id, save_id);
create index if not exists players_save_owner_idx on public.players(save_id, owner_id);
create index if not exists role_models_save_owner_idx on public.role_models(save_id, owner_id);
create index if not exists scoring_models_save_owner_idx on public.scoring_models(save_id, owner_id);
