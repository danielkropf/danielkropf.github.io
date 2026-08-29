-- FM DataTracker — Phase 1A / Analyzer Foundation
-- Preserve explicit statistical context and sample-size facts without creating
-- a PerformanceScore or inferring season/competition from filenames or dates.

create or replace function public.datatracker_sync_player_stat_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value text;
begin
  new.season := coalesce(
    nullif(btrim(new.season),''),
    nullif(btrim(new.normalized_stats->>'season'),'')
  );
  new.competition := coalesce(
    nullif(btrim(new.competition),''),
    nullif(btrim(new.normalized_stats->>'competition'),'')
  );
  new.team := coalesce(
    nullif(btrim(new.team),''),
    nullif(btrim(new.normalized_stats->>'team'),'')
  );

  if new.minutes is null then
    v_value := nullif(btrim(new.normalized_stats->>'minutes'),'');
    if v_value ~ '^-?[0-9]+([.][0-9]+)?$' then new.minutes := v_value::numeric; end if;
  end if;
  if new.appearances is null then
    v_value := nullif(btrim(new.normalized_stats->>'appearances'),'');
    if v_value ~ '^-?[0-9]+([.][0-9]+)?$' then new.appearances := v_value::numeric; end if;
  end if;
  if new.starts is null then
    v_value := nullif(btrim(new.normalized_stats->>'starts'),'');
    if v_value ~ '^-?[0-9]+([.][0-9]+)?$' then new.starts := v_value::numeric; end if;
  end if;
  if new.sub_appearances is null then
    v_value := nullif(btrim(new.normalized_stats->>'sub_appearances'),'');
    if v_value ~ '^-?[0-9]+([.][0-9]+)?$' then new.sub_appearances := v_value::numeric; end if;
  end if;

  return new;
end
$$;

revoke execute on function public.datatracker_sync_player_stat_context() from public, anon, authenticated;

drop trigger if exists sync_player_stat_context_before_write on public.player_stats;
create trigger sync_player_stat_context_before_write
before insert or update of season,competition,team,minutes,appearances,starts,sub_appearances,normalized_stats
on public.player_stats
for each row execute function public.datatracker_sync_player_stat_context();

-- Safe backfill: only promote values already present explicitly inside
-- normalized_stats. No filename/date inference and no raw-label guesswork.
update public.player_stats
set
  season = coalesce(nullif(btrim(season),''),nullif(btrim(normalized_stats->>'season'),'')),
  competition = coalesce(nullif(btrim(competition),''),nullif(btrim(normalized_stats->>'competition'),'')),
  team = coalesce(nullif(btrim(team),''),nullif(btrim(normalized_stats->>'team'),''))
where
  (season is null and nullif(btrim(normalized_stats->>'season'),'') is not null)
  or (competition is null and nullif(btrim(normalized_stats->>'competition'),'') is not null)
  or (team is null and nullif(btrim(normalized_stats->>'team'),'') is not null);

create index if not exists player_stats_save_player_snapshot_idx
  on public.player_stats(save_id,player_id,snapshot_date desc,created_at desc);
create index if not exists player_stats_save_context_idx
  on public.player_stats(save_id,season,competition,team)
  where season is not null or competition is not null or team is not null;

create or replace function public.datatracker_schema_info()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_import_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)') is not null;
  v_delete_rpc boolean := to_regprocedure('public.delete_fm_import(uuid,uuid)') is not null;
  v_model_patch boolean := to_regprocedure('public.patch_scoring_model_config(uuid,text,text,jsonb)') is not null;
  v_projections boolean := to_regclass('public.player_projections') is not null;
  v_diag_table boolean := to_regclass('public.fm_reader_samples') is not null;
  v_diag_bucket boolean := exists(select 1 from storage.buckets where id='fm-reader-samples' and public=false);
  v_diag_reservation boolean := exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='fm_reader_samples' and column_name='storage_prefix'
  );
  v_diag_retention boolean :=
    exists(select 1 from pg_extension where extname='pg_cron')
    and exists(select 1 from pg_extension where extname='pg_net')
    and exists(select 1 from cron.job where jobname='fm-reader-samples-retention');
  v_longitudinal_core boolean :=
    to_regclass('public.clubs') is not null
    and to_regclass('public.save_clubs') is not null
    and to_regclass('public.seasons') is not null
    and to_regclass('public.player_memberships') is not null
    and to_regclass('public.intake_classes') is not null
    and to_regclass('public.intake_class_members') is not null
    and to_regclass('public.save_events') is not null
    and to_regclass('public.event_decision_links') is not null;
  v_longitudinal_backfill boolean :=
    v_longitudinal_core
    and not exists (
      select 1 from public.saves s
      where nullif(btrim(s.club_name),'') is not null
        and not exists (
          select 1 from public.save_clubs sc
          where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
        )
    );
  v_longitudinal_save_structure boolean :=
    to_regprocedure('public.create_save_with_structure(text,text,text)') is not null;
  v_longitudinal_imports boolean :=
    to_regprocedure('public.sync_longitudinal_import()') is not null
    and to_regprocedure('public.cleanup_longitudinal_import()') is not null
    and exists(
      select 1 from pg_trigger
      where tgrelid='public.imports'::regclass
        and tgname='sync_longitudinal_import_on_status'
        and not tgisinternal
    )
    and exists(
      select 1 from pg_trigger
      where tgrelid='public.imports'::regclass
        and tgname='cleanup_longitudinal_import_before_delete'
        and not tgisinternal
    );
  v_analyzer_stats_context boolean :=
    to_regprocedure('public.datatracker_sync_player_stat_context()') is not null
    and exists(
      select 1 from pg_trigger
      where tgrelid='public.player_stats'::regclass
        and tgname='sync_player_stat_context_before_write'
        and not tgisinternal
    );
  v_features text[] := array['schema_version_marker'];
begin
  if v_import_rpc then v_features := array_append(v_features,'import_fm_export'); end if;
  if v_delete_rpc then v_features := array_append(v_features,'delete_fm_import'); end if;
  if v_model_patch then v_features := array_append(v_features,'patch_scoring_model_config'); end if;
  if v_projections then v_features := array_append(v_features,'player_projections_v1'); end if;
  if v_diag_table and v_diag_bucket and v_diag_reservation then v_features := array_append(v_features,'fm_reader_diagnostics_v2'); end if;
  if v_diag_retention then v_features := array_append(v_features,'fm_reader_diagnostics_server_retention'); end if;
  if v_longitudinal_core then v_features := array_append(v_features,'core_longitudinal_domain_v1'); end if;
  if v_longitudinal_backfill then v_features := array_append(v_features,'core_longitudinal_backfill_v1'); end if;
  if v_longitudinal_save_structure then v_features := array_append(v_features,'core_longitudinal_save_structure_v1'); end if;
  if v_longitudinal_imports then v_features := array_append(v_features,'core_longitudinal_imports_v1'); end if;
  if v_analyzer_stats_context then v_features := array_append(v_features,'analyzer_stats_context_v1'); end if;

  return jsonb_build_object(
    'schema_version','202608290005',
    'app_version','0.27.0',
    'features',to_jsonb(v_features),
    'capabilities',jsonb_build_object(
      'import_rpc',v_import_rpc,
      'delete_import_rpc',v_delete_rpc,
      'model_config_patch',v_model_patch,
      'projections',v_projections,
      'diagnostics_table',v_diag_table,
      'diagnostics_bucket',v_diag_bucket,
      'diagnostics_reservations',v_diag_reservation,
      'diagnostics_upload',v_diag_table and v_diag_bucket and v_diag_reservation,
      'diagnostics_server_retention',v_diag_retention,
      'longitudinal_core',v_longitudinal_core,
      'longitudinal_backfill',v_longitudinal_backfill,
      'longitudinal_save_structure',v_longitudinal_save_structure,
      'longitudinal_imports',v_longitudinal_imports,
      'analyzer_stats_context',v_analyzer_stats_context
    )
  );
end
$$;

comment on function public.datatracker_sync_player_stat_context() is
  'Phase 1A: promotes only explicit normalized stat context into player_stats structured columns; does not infer season/competition or compute PerformanceScore.';
