-- FM DataTracker — Phase 3A / Tracked Club Workspace
-- Manage the set of clubs explicitly tracked by a save without deleting Club
-- history or rewriting factual PlayerMembership observations.

create or replace function public.track_save_club(
  p_save_id uuid,
  p_club_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_save_club public.save_clubs%rowtype;
  v_next_order integer;
begin
  if v_owner is null then raise exception 'Usuário não autenticado'; end if;

  perform 1 from public.saves s
  where s.id=p_save_id and s.owner_id=v_owner and not s.is_archived
  for update;
  if not found then raise exception 'Save não encontrado ou sem permissão'; end if;

  if not exists (
    select 1 from public.clubs c
    where c.id=p_club_id and c.save_id=p_save_id and c.owner_id=v_owner
  ) then
    raise exception 'Clube não encontrado neste save ou sem permissão';
  end if;

  select * into v_save_club
  from public.save_clubs sc
  where sc.save_id=p_save_id and sc.club_id=p_club_id and sc.owner_id=v_owner
  limit 1
  for update;

  if found then
    update public.save_clubs
    set is_active=true,
        updated_at=now()
    where id=v_save_club.id and owner_id=v_owner
    returning * into v_save_club;
  else
    select coalesce(max(sc.display_order),-1)+1
      into v_next_order
    from public.save_clubs sc
    where sc.save_id=p_save_id and sc.owner_id=v_owner;

    insert into public.save_clubs(
      save_id,owner_id,club_id,tracking_role,is_active,display_order,settings
    )
    values(
      p_save_id,v_owner,p_club_id,'tracked',true,v_next_order,
      jsonb_build_object('source','multiclub_workspace')
    )
    returning * into v_save_club;
  end if;

  return jsonb_build_object(
    'save_club_id',v_save_club.id,
    'club_id',v_save_club.club_id,
    'tracking_role',v_save_club.tracking_role,
    'is_active',v_save_club.is_active,
    'display_order',v_save_club.display_order
  );
end
$$;

create or replace function public.create_tracked_club(
  p_save_id uuid,
  p_name text,
  p_country text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_name text := nullif(btrim(p_name),'');
  v_country text := nullif(btrim(p_country),'');
  v_club_id uuid;
  v_save_club_id uuid;
  v_next_order integer;
begin
  if v_owner is null then raise exception 'Usuário não autenticado'; end if;
  if v_name is null then raise exception 'Nome do clube é obrigatório'; end if;

  perform 1 from public.saves s
  where s.id=p_save_id and s.owner_id=v_owner and not s.is_archived
  for update;
  if not found then raise exception 'Save não encontrado ou sem permissão'; end if;

  insert into public.clubs(
    save_id,owner_id,fm_club_id,name,normalized_name,country,
    source_kind,source_import_id,provenance
  )
  values(
    p_save_id,v_owner,null,v_name,
    public.datatracker_normalize_longitudinal_name(v_name),
    v_country,'manual',null,
    jsonb_build_object(
      'source','multiclub_workspace',
      'source_field','explicit_user_input',
      'raw_label',v_name,
      'resolution_method','explicit_manual_club_creation'
    )
  )
  returning id into v_club_id;

  select coalesce(max(sc.display_order),-1)+1
    into v_next_order
  from public.save_clubs sc
  where sc.save_id=p_save_id and sc.owner_id=v_owner;

  insert into public.save_clubs(
    save_id,owner_id,club_id,tracking_role,is_active,display_order,settings
  )
  values(
    p_save_id,v_owner,v_club_id,'tracked',true,v_next_order,
    jsonb_build_object('source','multiclub_workspace')
  )
  returning id into v_save_club_id;

  return jsonb_build_object(
    'save_club_id',v_save_club_id,
    'club_id',v_club_id,
    'tracking_role','tracked',
    'is_active',true,
    'display_order',v_next_order
  );
end
$$;

create or replace function public.set_tracked_club_active(
  p_save_id uuid,
  p_club_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_save_club public.save_clubs%rowtype;
begin
  if v_owner is null then raise exception 'Usuário não autenticado'; end if;

  select * into v_save_club
  from public.save_clubs sc
  where sc.save_id=p_save_id and sc.club_id=p_club_id and sc.owner_id=v_owner
  limit 1
  for update;

  if not found then
    raise exception 'Clube não é acompanhado por este save ou sem permissão';
  end if;

  if v_save_club.tracking_role='primary' and not p_is_active then
    raise exception 'O clube principal do save não pode ser desativado';
  end if;

  update public.save_clubs
  set is_active=p_is_active,
      updated_at=now()
  where id=v_save_club.id and owner_id=v_owner
  returning * into v_save_club;

  return jsonb_build_object(
    'save_club_id',v_save_club.id,
    'club_id',v_save_club.club_id,
    'tracking_role',v_save_club.tracking_role,
    'is_active',v_save_club.is_active,
    'display_order',v_save_club.display_order
  );
end
$$;

revoke execute on function public.track_save_club(uuid,uuid) from public, anon;
revoke execute on function public.create_tracked_club(uuid,text,text) from public, anon;
revoke execute on function public.set_tracked_club_active(uuid,uuid,boolean) from public, anon;
grant execute on function public.track_save_club(uuid,uuid) to authenticated, service_role;
grant execute on function public.create_tracked_club(uuid,text,text) to authenticated, service_role;
grant execute on function public.set_tracked_club_active(uuid,uuid,boolean) to authenticated, service_role;

comment on function public.track_save_club(uuid,uuid) is
  'Phase 3A: tracks or reactivates an existing Club in the same owned save; never deletes Club history.';
comment on function public.create_tracked_club(uuid,text,text) is
  'Phase 3A: creates an explicit manual Club and its tracked SaveClub atomically; does not merge by name.';
comment on function public.set_tracked_club_active(uuid,uuid,boolean) is
  'Phase 3A: soft-activates/deactivates a tracked SaveClub; active primary Club cannot be deactivated.';

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
  v_multiclub_tracking_management boolean :=
    to_regprocedure('public.track_save_club(uuid,uuid)') is not null
    and to_regprocedure('public.create_tracked_club(uuid,text,text)') is not null
    and to_regprocedure('public.set_tracked_club_active(uuid,uuid,boolean)') is not null;
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
  if v_multiclub_tracking_management then v_features := array_append(v_features,'multiclub_tracking_management_v1'); end if;

  return jsonb_build_object(
    'schema_version','202608300001',
    'app_version','0.27.8',
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
      'multiclub_tracking_management',v_multiclub_tracking_management
    )
  );
end
$$;

notify pgrst,'reload schema';
