-- FM DataTracker — Phase 0D
-- New saves are created transactionally with their canonical primary Club/SaveClub,
-- while the legacy saves.club_name field remains synchronized for compatibility.

create or replace function public.create_save_with_structure(
  p_name text,
  p_club_name text,
  p_country text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_save_id uuid;
  v_club_id uuid;
  v_name text := nullif(btrim(p_name),'');
  v_club_name text := nullif(btrim(p_club_name),'');
  v_country text := nullif(btrim(p_country),'');
begin
  if v_owner is null then raise exception 'Usuário não autenticado'; end if;
  if v_name is null then raise exception 'Nome do save é obrigatório'; end if;
  if v_club_name is null then raise exception 'Clube principal é obrigatório'; end if;

  insert into public.saves(owner_id,name,club_name,country,save_type)
  values(v_owner,v_name,v_club_name,v_country,'normal')
  returning id into v_save_id;

  insert into public.clubs(
    save_id,owner_id,name,normalized_name,country,source_kind,provenance
  )
  values(
    v_save_id,v_owner,v_club_name,
    public.datatracker_normalize_longitudinal_name(v_club_name),
    v_country,'manual',
    jsonb_build_object(
      'source','save_creation_form',
      'source_field','club_name',
      'raw_label',v_club_name,
      'resolution_method','explicit_user_input'
    )
  )
  returning id into v_club_id;

  insert into public.save_clubs(
    save_id,owner_id,club_id,tracking_role,is_active,display_order,settings
  )
  values(
    v_save_id,v_owner,v_club_id,'primary',true,0,
    jsonb_build_object('source','save_creation_form')
  );

  return jsonb_build_object('save_id',v_save_id,'primary_club_id',v_club_id);
end
$$;

revoke execute on function public.create_save_with_structure(text,text,text) from public, anon;
grant execute on function public.create_save_with_structure(text,text,text) to authenticated, service_role;

create or replace function public.datatracker_schema_info()
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
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

  return jsonb_build_object(
    'schema_version','202608290003',
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
      'longitudinal_imports',v_longitudinal_imports
    )
  );
end
$$;

notify pgrst,'reload schema';
