-- FM DataTracker 0.47.1 — WC-C foreign-key index hardening.
-- Adds covering indexes reported by the Supabase performance advisor after
-- the 0.47.0 persistence schema reached production. No semantic or RLS change.

create index if not exists world_run_batches_reader_owner_fk_idx
  on private.world_run_batches(reader_run_id, owner_id);

create index if not exists world_run_uploads_reader_owner_fk_idx
  on private.world_run_uploads(reader_run_id, owner_id);

create index if not exists world_checkpoints_canonical_run_owner_fk_idx
  on public.world_checkpoints(canonical_reader_run_id, id, owner_id);

create index if not exists world_checkpoints_lineage_save_owner_fk_idx
  on public.world_checkpoints(lineage_id, save_id, owner_id);

create index if not exists world_checkpoints_save_owner_fk_idx
  on public.world_checkpoints(save_id, owner_id);

create index if not exists world_checkpoints_source_owner_fk_idx
  on public.world_checkpoints(source_artifact_id, owner_id);

create index if not exists world_coverage_reader_owner_fk_idx
  on public.world_coverage_capabilities(reader_run_id, owner_id);

create index if not exists world_lineages_parent_owner_fk_idx
  on public.world_lineages(parent_lineage_id, owner_id);

create index if not exists world_lineages_save_owner_fk_idx
  on public.world_lineages(save_id, owner_id);

create index if not exists world_reader_runs_checkpoint_save_owner_lineage_fk_idx
  on public.world_reader_runs(checkpoint_id, save_id, owner_id, lineage_id);

create index if not exists world_state_packages_base_owner_fk_idx
  on public.world_state_packages(base_anchor_package_id, owner_id);

create index if not exists world_state_packages_reader_save_owner_lineage_fk_idx
  on public.world_state_packages(reader_run_id, save_id, owner_id, lineage_id);

create index if not exists world_state_segments_package_owner_fk_idx
  on public.world_state_segments(package_id, owner_id);
