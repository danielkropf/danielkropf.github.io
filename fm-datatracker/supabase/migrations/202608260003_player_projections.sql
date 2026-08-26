-- FM DataTracker v0.26.0
-- Projection Model v1.0 persistence. The UI remains disabled until a calibrated
-- projection.fm26-v1 reference is available; this migration does not create or
-- invent development curves.

create table if not exists public.player_projections (
  id uuid primary key default gen_random_uuid(),
  save_id uuid not null references public.saves(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  snapshot_id uuid not null references public.player_snapshots(id) on delete cascade,
  score_type text not null check (score_type in ('general','function')),
  score_key text not null,
  current_score numeric(6,2),
  projected_score numeric(6,2),
  projection_status text not null,
  projection_model_version text not null,
  exact_age numeric(8,5),
  peak_age numeric(6,2),
  cp_percentile numeric(8,6),
  mdi numeric(8,6),
  personality_shift numeric(8,6) not null default 0,
  history_shift numeric(8,6) not null default 0,
  trajectory_quantile numeric(8,6),
  personality_source text not null default 'neutral',
  reference_version text,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(save_id,snapshot_id,score_type,score_key,projection_model_version)
);

create index if not exists player_projections_player_idx on public.player_projections(save_id,player_id,snapshot_id);
create index if not exists player_projections_reference_idx on public.player_projections(reference_version,projection_model_version);

alter table public.player_projections enable row level security;

drop policy if exists player_projections_owner on public.player_projections;
create policy player_projections_owner on public.player_projections
for all
using (exists(select 1 from public.saves s where s.id=save_id and s.owner_id=auth.uid()))
with check (
  exists(select 1 from public.saves s where s.id=save_id and s.owner_id=auth.uid())
  and exists(select 1 from public.players p where p.id=player_id and p.save_id=save_id)
  and exists(select 1 from public.player_snapshots ps where ps.id=snapshot_id and ps.player_id=player_id)
);

create or replace function public.datatracker_schema_info()
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select jsonb_build_object(
    'schema_version','202608260003',
    'app_version','0.26.0',
    'features',jsonb_build_array(
      'patch_scoring_model_config',
      'delete_fm_import',
      'schema_version_marker',
      'canonical_model_lab_identity',
      'scoring_models_save_ownership_rls',
      'player_projections_v1'
    )
  );
$$;

notify pgrst, 'reload schema';
