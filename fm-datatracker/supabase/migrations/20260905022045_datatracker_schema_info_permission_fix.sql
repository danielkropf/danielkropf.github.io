-- Mirrors the production hotfix already applied as migration 20260905022045.
-- Keep datatracker_schema_info SECURITY INVOKER and do not grant frontend access
-- to the cron schema. Optional retention introspection fails closed instead.

create or replace function public.datatracker_schema_info()
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_import_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb)') is not null;
  v_import_membership_rpc boolean := to_regprocedure('public.import_fm_export(uuid,text,text,date,text,text,jsonb,jsonb,jsonb)') is not null;
  v_delete_rpc boolean := to_regprocedure('public.delete_fm_import(uuid,uuid)') is not null;
  v_model_patch boolean := to_regprocedure('public.patch_scoring_model_config(uuid,text,text,jsonb)') is not null;
  v_projections boolean := to_regclass('public.player_projections') is not null;
  v_diag_table boolean := to_regclass('public.fm_reader_samples') is not null;
  v_diag_bucket boolean := exists(select 1 from storage.buckets where id='fm-reader-samples' and public=false);
  v_diag_reservation boolean := exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='fm_reader_samples' and column_name='storage_prefix'
  );
  v_diag_retention boolean := false;
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
    and not exists(
      select 1 from public.saves s
      where nullif(btrim(s.club_name),'') is not null
        and not exists(
          select 1 from public.save_clubs sc
          where sc.save_id=s.id and sc.tracking_role='primary' and sc.is_active
        )
    );
  v_longitudinal_save_structure boolean := to_regprocedure('public.create_save_with_structure(text,text,text)') is not null;
  v_longitudinal_imports boolean :=
    to_regprocedure('public.sync_longitudinal_import()') is not null
    and to_regprocedure('public.cleanup_longitudinal_import()') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.imports'::regclass and tgname='sync_longitudinal_import_on_status' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid='public.imports'::regclass and tgname='cleanup_longitudinal_import_before_delete' and not tgisinternal);
  v_analyzer_stats_context boolean :=
    to_regprocedure('public.datatracker_sync_player_stat_context()') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.player_stats'::regclass and tgname='sync_player_stat_context_before_write' and not tgisinternal);
  v_multiclub_tracking_management boolean :=
    to_regprocedure('public.track_save_club(uuid,uuid)') is not null
    and to_regprocedure('public.create_tracked_club(uuid,text,text)') is not null
    and to_regprocedure('public.set_tracked_club_active(uuid,uuid,boolean)') is not null;
  v_emc01b boolean :=
    to_regclass('public.club_structural_team_links') is not null
    and to_regclass('public.club_structural_team_link_evidence') is not null
    and v_import_membership_rpc
    and to_regprocedure('public.datatracker_sync_fm_membership_rows(uuid,uuid,date,jsonb)') is not null
    and to_regprocedure('public.datatracker_bind_structural_organization(uuid,uuid,uuid,uuid,uuid,jsonb)') is not null;
  v_features text[] := array['schema_version_marker'];
begin
  -- authenticated legitimately has no USAGE on the cron schema. The diagnostic
  -- retention capability is optional, so lack of visibility must fail closed
  -- instead of making the entire compatibility RPC return 403.
  begin
    v_diag_retention :=
      exists(select 1 from pg_extension where extname='pg_cron')
      and exists(select 1 from pg_extension where extname='pg_net')
      and exists(select 1 from cron.job where jobname='fm-reader-samples-retention');
  exception when insufficient_privilege then
    v_diag_retention := false;
  end;

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
  if v_multiclub_tracking_management then v_features := array_append(v_features,'multiclub_tracking_management_v1'); end if;
  if v_emc01b then v_features := array_append(v_features,'factual_membership_emc01b_v1'); end if;

  return jsonb_build_object(
    'schema_version','202609030001',
    'app_version','0.29.6',
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
      'analyzer_stats_context',v_analyzer_stats_context,
      'multiclub_tracking_management',v_multiclub_tracking_management,
      'factual_membership_emc01b',v_emc01b
    )
  );
end
$$;

notify pgrst,'reload schema';
